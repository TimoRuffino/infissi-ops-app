# Rollout di Tars v2 — runbook (T9)

> Stato: PREPARATO, non eseguito. Ogni accensione di flag in produzione,
> l'uso reale della chiave OpenAI e qualunque costo sono decisioni della
> direzione. Con tutti i flag spenti il CRM funziona identico a prima:
> nessuna dipendenza di avvio da Tars.

## 1. Interruttori (tutti FAIL-CLOSED: spenti in produzione se non impostati)

| Flag | Cosa accende | Prerequisiti |
|---|---|---|
| `FLAG_TARS` | master: router, pagina `/tars`, voce menu | — (senza, tutto il resto è morto) |
| `FLAG_TARS_READ_TOOLS` | letture L0 (commesse, gate, ordini, fascicoli, Centro Azioni, promemoria) | FLAG_TARS |
| `FLAG_TARS_MEMORY` | memoria (ricorda/dimentica + contesto nei run) | FLAG_TARS |
| `FLAG_TARS_REMINDERS` | promemoria L1 (crea/sposta/annulla/completa) | FLAG_TARS |
| `FLAG_TARS_L2_ACTIONS` | azioni L2 (casi Centro Azioni, analisi conferme) | FLAG_TARS (+ FLAG_DOCUMENT_INTELLIGENCE per l'analisi) |
| `FLAG_TARS_PROPOSALS` | proposta L3 data consegna (gateway D7) | FLAG_TARS + FLAG_DOCUMENT_INTELLIGENCE + FLAG_PROPOSTE |
| `FLAG_TARS_PROACTIVE` | segnalazioni shadow nel briefing | FLAG_TARS + FLAG_TARS_READ_TOOLS |
| `FLAG_TARS_COMMUNICATIONS` | lettura comunicazioni (estratti) | FLAG_TARS + FLAG_TARS_READ_TOOLS |
| `FLAG_TARS_SEMANTIC_SEARCH` | NON ESISTE codice: resta spento | gate chiave (embeddings) |

Provider: `TARS_PROVIDER` NON impostato = provider finto (nessuna
chiamata di rete possibile). Il provider reale richiede TUTTE e tre le
condizioni: `TARS_PROVIDER=openai` + `FLAG_TARS=on` + `OPENAI_API_KEY`.

Config modello (solo quando autorizzato): `TARS_MODEL_INTERACTIVE`,
`TARS_MAX_TOOL_STEPS` (6), `TARS_MAX_OUTPUT_TOKENS` (1200),
`TARS_PROVIDER_TIMEOUT_MS` (45000), `TARS_C0_TTL_MS` (90000).

## 2. Fasi proposte (ognuna = decisione esplicita della direzione)

Prima di OGNI fase: backup Drive riuscito nelle ultime 24 ore; deploy
stabile; `pnpm eval:tars` verde sull'ultimo commit.

**Fase 0 — provider finto in produzione (facoltativa, zero costi)**
`FLAG_TARS=on` + `FLAG_TARS_READ_TOOLS=on` per la sola direzione di
fatto (la pagina è visibile a tutti gli utenti della sede: valutare se
accettabile — le letture rispettano capability e sede). Il provider
finto risponde con messaggi di servizio: serve a validare UI, telemetria
e isolamento su dati veri SENZA modello. Osservazione: 2-3 giorni,
`tars_run` senza errori, zero regressioni CRM.

**Fase 1 — gate OpenAI (decisione: modello, budget, limiti)**
La direzione approva la proposta di gate (documento separato:
modelli/prezzi ufficiali correnti, budget mensile, limite per richiesta
e giornaliero, circuito economico, numero di eval reali). SOLO DOPO:
`TARS_PROVIDER=openai` in un ambiente di prova o con perimetro pilota.
Primi eval reali controllati e misurati (tool selection, injection,
groundedness, latenza, costo, cached_tokens/cache_write C2).

**Fase 2 — pilota letture+memoria+promemoria**
`FLAG_TARS_MEMORY=on`, `FLAG_TARS_REMINDERS=on`. Perimetro: la
direzione e 1-2 utenti scelti (i flag sono per installazione: il
perimetro pilota è organizzativo — chi non è invitato non usa /tars).
Osservazione 1 settimana: conferme L1 = 0, duplicati = 0, promemoria
consegnati dal worker esistente, costi entro budget.

**Fase 3 — L2 + proposte**
`FLAG_TARS_L2_ACTIONS=on`, poi `FLAG_TARS_PROPOSALS=on` (richiede il
rollout DI già deciso a parte: FLAG_DOCUMENT_INTELLIGENCE/PROPOSTE).
Osservazione: undo rate, proposte rifiutate/approvate, zero applicazioni
senza click umano (struttura: impossibile, ma si verifica in telemetria).

**Fase 4 — proattività e comunicazioni**
`FLAG_TARS_PROACTIVE=on` (solo segnalazioni nel briefing: nessuna
emissione), poi `FLAG_TARS_COMMUNICATIONS=on`. Metrica rumore dai run
`proattivita-shadow` (segnalazioni/agganciate) PRIMA di qualunque
decisione su emissioni reali.

## 3. Osservazione (per ogni fase)

- `tars_run`: totale, degradati, errori per classe, contatori
  (c0Hit/c1Hit/token/azioni). Query: `SELECT stato, provider, COUNT(*)
  FROM tars_run GROUP BY 1,2;`
- Attrito: nei run con azioni L1, nessun turno di conferma aggiuntivo.
- Isolamento: nessun NOT_FOUND anomalo di massa, nessun reclamo
  cross-sede.
- Costi (fase 1+): token da `contatori` vs budget; il circuito apre a 3
  errori consecutivi (pausa 60s) — un'apertura frequente è un segnale.
- CRM: le superfici esistenti NON cambiano comportamento con i flag
  accesi (Tars solo aggiunge).

## 4. Rollback

Ogni fase torna indietro SPEGNENDO il flag (env su Railway, riavvio del
servizio): nessuna migrazione, nessun dato da ripulire. Le tabelle
`tars_*` e la kv `tars_memoria` restano (storia; innocue da spente).
Rollback totale: rimuovere `FLAG_TARS` → il CRM è identico a prima per
costruzione (provato dai test kill switch). `TARS_PROVIDER` rimosso →
qualunque residuo di chiave è inerte.

## 5. Owner ed esiti

| Fase | Owner decisione | Owner osservazione | Esito registrato in |
|---|---|---|---|
| 0-4 | direzione | direzione (pannello Railway + /tars stato) | PRD §33 + handoff |

## 6. Cosa NON esiste (niente da spegnere)

- Invio di comunicazioni da Tars (nessun canale di invio nel dominio).
- Ricerca semantica/embeddings (gate chiave).
- Promemoria event-driven proattivi (arrivano dopo l'osservazione
  shadow, su decisione).
