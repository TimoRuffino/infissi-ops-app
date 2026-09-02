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
| `FLAG_TARS_PROACTIVE` | segnalazioni shadow nel briefing + OSSERVATORE T6 (persistenza osservazioni dal reconcile del Centro Azioni) | FLAG_TARS + FLAG_TARS_READ_TOOLS |
| `FLAG_TARS_PATTERNS` | pattern aziendali / Panorama (T7): tool `panorama_azienda` ed endpoint `tars.panorama`, direzione-only | FLAG_TARS + FLAG_TARS_PROACTIVE |
| `FLAG_TARS_IMPROVEMENTS` | proposte di miglioramento (T8): `tars.miglioramenti` + feedback/accetta, direzione-only | FLAG_TARS + FLAG_TARS_PROACTIVE |
| `FLAG_TARS_COMMUNICATIONS` | lettura comunicazioni (estratti) + archiviazione R1 allegati (T4, con FLAG_TARS_L2_ACTIONS) | FLAG_TARS + FLAG_TARS_READ_TOOLS |
| `FLAG_TARS_SMISTAMENTO` | smistamento automatico delle comunicazioni in ingresso (02/09/2026): worker ogni 60 s per sede, triage col modello (`TARS_MODEL_SMISTAMENTO`, default `gpt-5.6-terra`, classe di costo `smistamento`), collegamenti CERTI deterministici, archiviazione allegati riconosciuti su comunicazioni collegate, proposte a un click (`tars.smistamento*`, Situazione, Centro Azioni) | FLAG_TARS + FLAG_TARS_COMMUNICATIONS + FLAG_TARS_PROACTIVE + PostgreSQL |
| `FLAG_TARS_SEMANTIC_SEARCH` | NON ESISTE codice: resta spento | gate chiave (embeddings) |

Modalità osservatore (T6): `TARS_OBSERVER_MODE` = `shadow` (default:
calcola e persiste, non espone) oppure `active` (espone
`tars.osservazioni` filtrando sede e capability a ogni richiesta).
Senza PostgreSQL l'osservatore non scrive: fail-closed.

Assunzione di replica: la serializzazione in-process del servizio
canonico d'archivio (sourceRef) e lo scheduler promemoria assumono UNA
istanza del server; prima di scalare a più repliche serve la decisione
registrata (lease condivisi). Le reservation R1 orfane si sbloccano da
sole dopo `TARS_R1_RESERVATION_TTL_MS` (default 20 min, solo azioni con
idempotenza di dominio).

Budget per CLASSE di costo (T9): `TARS_BUDGET_<CLASSE>_USD` con classi
`DOCUMENT_INTELLIGENCE`, `PROACTIVE_COMMESSA`, `PATTERN_AZIENDA`,
`MIGLIORAMENTO_CRM`, `EVAL`. Dal 01/09/2026 (gate §8): variabile
ASSENTE = nessun tetto per la classe; **0 esplicito = kill switch
della classe**; un valore positivo = tetto giornaliero. `interactive`
non ha un tetto separato: valgono i tetti globali, se impostati. Una
variabile invalida blocca SOLO la sua classe.

Provider: `TARS_PROVIDER` NON impostato = provider finto (nessuna
chiamata di rete possibile). Il provider reale richiede TUTTE e tre le
condizioni: `TARS_PROVIDER=openai` + `FLAG_TARS=on` + `OPENAI_API_KEY`.

Config modello (solo quando autorizzato): `TARS_MODEL_INTERACTIVE`
(unico approvato: `gpt-5.6-terra`), `TARS_REASONING_INTERACTIVE`
(`medium`; la famiglia 5.6 accetta `none|low|medium|high|xhigh|max`,
NON `minimal` — verificato sul vivo: 400), `TARS_SERVICE_TIER`
(`auto|default|flex|priority`; assente = default del progetto;
`priority` compra latenza a tariffa 2× e il ledger scala le tariffe di
conseguenza), `TARS_MAX_TOOL_STEPS` (6), `TARS_MAX_OUTPUT_TOKENS`
(1200), `TARS_PROVIDER_TIMEOUT_MS` (45000), `TARS_MAX_MODEL_CALLS` (8),
`TARS_MAX_RUN_MS` (180000), `TARS_MAX_CONTEXT_CHARS` (120000),
`TARS_C0_TTL_MS` (90000). Latenza: i run registrano `durataMs` e
`chiamateModello` nei `contatori` di `tars_run` (anche i degradati).

**Budget (tetto software, spec §27 — aggiornato dal gate §8,
01/09/2026)**: `TARS_MAX_COST_PER_RUN_USD`, `TARS_DAILY_BUDGET_USD`,
`TARS_MONTHLY_BUDGET_USD`. NON hanno più default: variabile assente =
NESSUN tetto (decisione della direzione, «un cervello operativo non ha
bisogno di budget»). Un valore impostato resta applicato; impostarlo
male (valore non numerico, negativo, o run > giorno > mese fra i tetti
presenti) DISABILITA il provider reale invece di allentare il tetto.
La contabilità su ledger è identica con o senza tetti (`tars.costi`
mostra sempre la spesa reale). Il provider reale richiede comunque
`DATABASE_URL` (ledger autorevole con prenotazioni atomiche): senza,
resta disabilitato.

Verifica rapida dello stato: `tars.costi` (direzione) mostra provider
effettivo, motivo di eventuale indisponibilità, budget configurato,
spesa e residui di giorno e mese. I totali sono GLOBALI (tutte le sedi),
perché il tetto è globale: il payload lo dichiara.

**Prima di accendere `TARS_PROVIDER=openai`** verificare che
`tars.costi` risponda con `provider.tipo = "finto"` e un motivo
esplicito: se il motivo è «Ledger dei costi non autorevole» manca
`DATABASE_URL` e il provider reale resterebbe disabilitato comunque.
La tabella `tars_costi` nasce da sola al primo uso (`CREATE TABLE IF
NOT EXISTS`, come il resto del progetto): nessuna migrazione da
eseguire al deploy, nessun rollback da preparare.

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
La direzione approva `docs/tars/gate-openai.md` (modelli e prezzi
ufficiali correnti, budget, limiti) e fa creare progetto, service
account, chiave dedicata e hard limit OpenAI secondo il §6 di quel
documento. SOLO DOPO: `TARS_PROVIDER=openai` in un ambiente di PROVA
con database di prova, e batteria di eval reali secondo
`docs/tars/piano-eval-reali.md` (60 casi, ~1-2 USD, soglia
inderogabile: zero azioni critiche non autorizzate, zero leak).
Prima di procedere alla fase 2, leggere `tars.costi`: la spesa reale
degli eval è la prima misura vera del costo per run e del cache hit.

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
