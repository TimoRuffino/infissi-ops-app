# Matrice dei test e dei limiti — budget governor

> Stato al 30/08/2026, branch `feature/tars-v2`. Tutti i test girano col
> provider FINTO; cinque girano contro un PostgreSQL reale (in CI con un
> servizio dedicato). Zero chiamate a provider a pagamento.

## 1. Limiti configurati

| Limite | Variabile | Default | Cosa succede se manca/è invalido |
|---|---|---|---|
| Spesa per run | `TARS_MAX_COST_PER_RUN_USD` | 0,10 USD | Provider reale INDISPONIBILE |
| Spesa giornaliera | `TARS_DAILY_BUDGET_USD` | 2,00 USD | Provider reale INDISPONIBILE |
| Spesa mensile | `TARS_MONTHLY_BUDGET_USD` | 20,00 USD | Provider reale INDISPONIBILE |
| Gerarchia | — | run ≤ giorno ≤ mese | Incoerente ⇒ INDISPONIBILE |
| Margine stima | `TARS_MARGINE_STIMA` | 1,25 | < 1 ⇒ INDISPONIBILE |
| Scadenza prenotazione | `TARS_SCADENZA_PRENOTAZIONE_MS` | 600.000 | ≤ 2× timeout ⇒ INDISPONIBILE |
| Chiamate al modello per run | `TARS_MAX_MODEL_CALLS` | 8 | Degrada con messaggio proprio |
| Passi di strumenti | `TARS_MAX_TOOL_STEPS` | 6 | Degrada |
| Token di output per risposta | `TARS_MAX_OUTPUT_TOKENS` | 1.200 | — |
| Timeout per chiamata | `TARS_PROVIDER_TIMEOUT_MS` | 45.000 | — |
| Tempo totale del run | `TARS_MAX_RUN_MS` | 180.000 | Degrada con messaggio proprio |
| Caratteri di contesto | `TARS_MAX_CONTEXT_CHARS` | 120.000 | Degrada con messaggio proprio |
| Retry | — | 1, solo primo passo, solo transitori | — |
| Invii per principal | `TARS_RATE_LIMIT_INVII` | 20 / 5 min | `TOO_MANY_REQUESTS` |
| Dedup doppio invio | `TARS_DEDUP_INVIO_MS` | 15.000 | Stesso run riusato |

**Numeri misurati** (non stimati a parole): con 21 strumenti a catalogo
la prenotazione prudenziale di una chiamata è ≈0,021-0,03 USD, quindi il
tetto per-run consente 3-7 chiamate a seconda del prompt caching. Il
test `MISURA:` in `integrazione.test.ts` fallisce se la prenotazione
supera un terzo del tetto per-run: il numero resta sotto controllo
mentre il catalogo cresce.

## 2. I 21 requisiti del mandato → dove sono provati

| # | Requisito | File:test |
|---|---|---|
| 1 | Nessuna chiamata con flag spenti | `costi.test.ts` (FLAG_TARS nel confine) + `integrazione.test.ts` (router) |
| 2 | Provider non configurato | `costi.test.ts` (condizioni cumulative + fabbrica) |
| 3 | Tariffa sconosciuta | `costi.test.ts` (modello senza tariffa; catalogo chiuso) |
| 4 | Budget mancante/invalido | `costi.test.ts` (configurazione fail-closed) |
| 5 | Blocco per run | `costi.test.ts` (tetto per run, aggregazione) |
| 6 | Blocco giornaliero | `costi.test.ts` (orologio iniettato) |
| 7 | Blocco mensile | `costi.test.ts` (giorno diverso, mese nuovo pulito) |
| 8 | Input/cached/output separati | `costi.test.ts` (aritmetica + riconciliazione) |
| 9 | Aggregazione nello stesso run | `costi.test.ts`, `integrazione.test.ts` |
| 10 | Retry idempotente | `costi.test.ts` (tentativo 2 = chiamata distinta) |
| 11 | Doppio click idempotente | `integrazione.test.ts` (due invii → un run) |
| 12 | Prenotazioni concorrenti | `costi.test.ts` (numero esatto + picco) e `pgConcorrenza.test.ts` (20 parallele su PG) |
| 13 | Riavvio prenotazione/riconciliazione | `costi.test.ts` (expired contato) e `pgConcorrenza.test.ts` |
| 14 | Timeout e stato incerto | `costi.test.ts` (uncertain trattenuto) |
| 15 | Rilascio quota inutilizzata | `costi.test.ts` (settled < prenotato) |
| 16 | Europe/Rome, DST, cambio mese | `costi.test.ts` (CET invernale, mezzanotte UTC, cambio anno) |
| 17 | Nessun bypass del provider | `confine.test.ts` (7 guardie strutturali) |
| 18 | Nessun leak economico/cross-sede | `integrazione.test.ts` (costi direzione-only, payload di soli numeri) |
| 19 | Messaggio controllato | `integrazione.test.ts` (testo esatto, nessun retry, nessun circuito) |
| 20 | CRM indifferente con Tars spento | `integrazione.test.ts` (router non-Tars rispondono) |
| 21 | Nessuna rete nei test | `server/_core/testSetup.ts` (guardia globale) + `integrazione.test.ts` (adapter reale invocato e fermato) |

## 3. Mutation test (la guardia deve MORDERE)

| # | Mutazione applicata | Test che fallisce |
|---|---|---|
| 1 | Rimosso il controllo del tetto giornaliero | tetto giornaliero, sedi |
| 2 | `>` → `>=` con offset sul tetto per run | tetto per run |
| 3 | Cached tariffato come input pieno | tariffazione separata, riconciliazione |
| 4 | Chiamata diretta al provider reintrodotta | confine (import grezzo, router) |
| 5 | Ledger autorevole anche in memoria | confine, condizioni cumulative |
| 6 | Chiave idempotente randomizzata | doppia contabilizzazione |
| 7 | Uso non plausibile riconciliato a zero | risposta senza uso |
| 8 | Stima ottimistica (4 caratteri/token) | stima come soffitto |
| 9 | Limiti run trattati da guasto provider | limiti non travestiti |
| 10 | Dedup doppio click rimossa | doppio click |
| 11 | Guardia di rete globale disattivata | guardia anti-rete |
| 12 | Import del grezzo in produzione | confine |
| 13 | `setupFiles` rimosso dalla config | guardia registrata |

## 4. Esiti degli stati del ledger

| Stato | Quando | Costo contato |
|---|---|---|
| `reserved` | prenotata, chiamata in corso | prenotato |
| `settled` | riconciliata con uso plausibile | REALE |
| `released` | 4xx o 429 (nessun token generato) | 0 |
| `uncertain` | timeout, rete, risposta invalida, uso non riportato | prenotato |
| `expired` | mai riconciliata (crash/riavvio) | prenotato |

Principio: si sovrastima, mai si sottostima.
