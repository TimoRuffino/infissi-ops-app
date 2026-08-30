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

## 4. Cosa serve per procedere (decisione della direzione)

1. Conferma del modello (`terra`) e dei budget sopra (o valori diversi).
2. Autorizzazione a usare la chiave (quella residua su Railway o una
   NUOVA chiave dedicata a Tars con budget cap sul pannello OpenAI —
   RACCOMANDATA la seconda: separazione dei costi e revoca pulita).
3. Dove: prima in locale/ambiente di prova (eval), mai direttamente in
   produzione.

Fino a questa firma: nessuna chiamata, nessun costo, chiave mai letta.
