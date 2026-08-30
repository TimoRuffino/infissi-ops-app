# Gate OpenAI — proposta alla direzione (30/08/2026)

> Decisione richiesta: modello, budget e autorizzazione alla PRIMA
> chiamata reale. Fino ad allora: provider finto, zero chiamate, zero
> costi. Fonti: developers.openai.com (pagine pricing e modelli,
> consultate il 30/08/2026 — da ricontrollare al momento della firma).

## 1. Modelli disponibili rilevanti (famiglia corrente GPT-5.6)

| Modello | Input /1M | Cached /1M | Output /1M | Posizionamento |
|---|---|---|---|---|
| `gpt-5.6-sol` | $4.00* | $0.40 | $20.00* | flagship «complex professional work» (*promo fino al 21/11/2026; listino $5/$30) |
| `gpt-5.6-terra` | $2.00 | $0.20 | $12.00 | «balance intelligence and cost» (fascia mini delle famiglie precedenti) |
| `gpt-5.6-luna` | $0.20 | $0.02 | $1.20 | alto volume, sensibile ai costi (fascia nano) |

Tutti e tre: contesto 1.050.000 token, output max 128k, **Responses
API, function calling, structured outputs e prompt caching supportati**
(≈90% di sconto sull'input cache-ato — il nostro prefisso stabile C2 è
costruito per questo). Nessuno snapshot datato pubblicato per la
famiglia 5.6 alla data di consultazione: si parte con l'alias e si
fissa lo snapshot appena disponibile (il modello effettivo è già
registrato per-run nella telemetria `tars_run`).

Embeddings (per la futura C5, NON in questo gate):
`text-embedding-3-small` $0.02/1M.

## 2. Raccomandazione

- **`TARS_MODEL_INTERACTIVE = gpt-5.6-terra`**: il lavoro di Tars è
  tool-calling disciplinato su strumenti tipizzati con risposte brevi —
  la fascia «balance» è il punto di partenza giusto; `sol` solo se gli
  eval comparativi mostrano un gap reale su selezione strumenti o
  groundedness (il confronto è parte degli eval del gate).
- **Fallback/`TARS_MODEL_AUTOMATION` = `gpt-5.6-luna`** per i futuri
  run automatici ad alto volume (triage, briefing arricchito), da
  valutare con eval dedicati prima dell'uso.

## 3. Costi attesi e budget proposto

Run interattivo tipico (prompt v4 + catalogo ≈3k token cache-abili,
2 giri di strumenti ≈10k input totali di cui ~60% cached a regime,
~600 output): con `terra` ≈ **1-3 centesimi di dollaro a run**.

Proposta di budget (valori da confermare o correggere):
- **Eval del gate**: ~60 casi reali (30 selezione strumenti/groundedness,
  15 injection/sicurezza, 15 attrito) su terra + campione comparativo su
  sol e luna → stima < $5 totali.
- **Budget mensile pilota**: $20 (≈600-1500 run: ben oltre l'uso
  atteso di 2-3 persone).
- **Limite per richiesta**: già nel codice — max 6 passi strumento,
  1200 token output, timeout 45s (env: TARS_MAX_TOOL_STEPS,
  TARS_MAX_OUTPUT_TOKENS, TARS_PROVIDER_TIMEOUT_MS).
- **Limite giornaliero**: $2. Circuito economico: il circuit breaker
  attuale è su ERRORI (3 consecutivi → pausa 60s); il tetto di SPESA
  giornaliero come blocco software (contatore su `tars_run` → provider
  degradato a fine budget) va implementato PRIMA della fase 1 reale —
  è la prima attività post-autorizzazione, senza chiamate necessarie.
- **Rollback**: rimuovere `TARS_PROVIDER` → provider finto; i flag
  restano indipendenti (runbook docs/runbooks/rollout-tars.md).

## 4. Tetto di spesa software — IMPLEMENTATO (30/08/2026)

Il governor applicativo è in `server/tars/costi/` (spec §27) ed è
attivo per costruzione, non per configurazione:

- limiti **0,10 USD per run / 2,00 al giorno / 20,00 al mese**
  (`TARS_MAX_COST_PER_RUN_USD`, `TARS_DAILY_BUDGET_USD`,
  `TARS_MONTHLY_BUDGET_USD`): sono i default, e una configurazione
  mancante/invalida/incoerente rende il provider reale INDISPONIBILE;
- ogni chiamata a pagamento passa dal decoratore che **prenota prima**
  (stima prudenziale) e **riconcilia dopo** (costo reale, quota
  inutilizzata liberata), su ledger PostgreSQL con lock globale;
- senza `DATABASE_URL` non esiste ledger autorevole → niente provider
  reale;
- timeout ed esiti incerti restano contati (mai sottostima);
- budget esaurito = messaggio italiano, nessuna chiamata, nessun retry.

**Numero misurato in test**: con il catalogo strumenti attuale (21
strumenti) la prenotazione prudenziale di una singola chiamata è
**≈0,03 USD**, quindi il tetto per-run da 0,10 consente **3-7 chiamate
al modello per run** a seconda di quanto morde il prompt caching (la
prenotazione ignora lo sconto cache per prudenza, la riconciliazione lo
recupera subito). Se gli eval reali mostrassero run legittimi fermati
dal tetto, la taratura corretta è alzare il per-run (non allentare la
prudenza della stima): decisione da registrare.

## 5. Cosa serve per procedere (decisione della direzione)

1. Conferma del modello (`gpt-5.6-terra`, reasoning `medium`) e dei
   budget sopra (o valori diversi).
2. **Chiave dedicata NUOVA** (procedura al §6), non quella residua.
3. Dove: prima in ambiente di prova con database di prova (eval),
   mai direttamente in produzione.

Fino a questa firma: nessuna chiamata, nessun costo, chiave mai letta.

## 6. Configurazione OpenAI — passi da eseguire DOPO l'autorizzazione

Questi passi li esegue la direzione (o io su richiesta esplicita, senza
mai vedere la chiave in chiaro in chat, log, commit o screenshot):

1. **Progetto dedicato**: nel pannello OpenAI creare un progetto
   `ruffino-flow-tars` (separa costi, limiti e revoca dal resto).
2. **Service account dedicato** dentro quel progetto (non un utente
   personale: sopravvive al turnover e non porta permessi estranei).
3. **API key nuova ed esclusiva** generata dal service account.
   Nessun riutilizzo di chiavi personali o legacy — in particolare NON
   la `OPENAI_API_KEY` residua oggi su Railway, che resta inutilizzata
   e andrebbe rimossa quando la nuova entra in servizio.
4. **Modelli autorizzati**: limitare il progetto a `gpt-5.6-terra`.
5. **Hard spend limit** del progetto: **20 USD/mese** (seconda cintura,
   NON sostituisce il governor: quello di OpenAI arriva dopo la spesa,
   il nostro la impedisce prima).
6. **Alert** al 25%, 50%, 75%, 90% del limite.
7. **Salvataggio**: solo come secret Railway `OPENAI_API_KEY` (e nel
   gestore di password della direzione). Mai in `.env` versionati, mai
   in chat, mai in screenshot.
8. **Flag spenti** durante tutta la configurazione e il deploy:
   `TARS_PROVIDER` NON impostato finché non si eseguono gli eval.
9. Prima esecuzione: eval reali in ambiente di prova secondo
   `piano-eval-reali.md` (60 casi, ~1-2 USD).
10. Rimozione della chiave vecchia dopo il primo esito positivo.
