# Tars — rimosso il 28/08/2026

Il vecchio agente è stato tolto per intero su decisione della direzione: «va
rifatto da zero». Questo documento sostituisce `Agente_Ruffino_Ops.md`, che
descriveva un sistema che non esiste più. Serve a chi ricostruirà: cosa c'era,
cosa è sopravvissuto, dove sono finiti i dati e cosa resta da decidere.

## Cosa è stato tolto

~27.000 righe in `server/tars/` più il router, le pagine e i componenti:

| pezzo | cosa faceva |
|---|---|
| loop + strumenti + prompt | il giro agentico su OpenAI Responses API |
| proposte | 17 tipi di azione, tutte con approvazione umana |
| smistamento | classificava email e fatture in arrivo, proponeva collegamenti |
| `classificaCostiFic` | classificava i costi FiC col modello |
| Command Center `/tars` | Oggi, proposte, analisi, chat, registro |
| planner + workflows | piani ripartibili e workflow riprendibili |
| context engine + search | contesto persistente per entità, ricerca ibrida |
| autonomy | esecuzione autonoma per capability, mai accesa in produzione |
| evals + learning | casi di valutazione ed esiti per capability |
| auditProcessi + experiments | proposte di miglioramento di processo misurabili |

## Cosa è rimasto, e perché

`server/tars/` conteneva anche roba che non era l'agente, finita lì per ragioni
storiche. Spostata in **`server/comunicazioni/`**:

- `comunicazioni.ts` — la tabella Postgres, l'Inbox, le conversazioni WhatsApp
- `whatsapp.ts` — integrazione Meta, webhook, onboarding, storico
- `imap.ts` — sincronizzazione email
- `caselle.ts` — store delle caselle
- `match.ts` — matcher deterministico cliente/commessa, **usato anche dalle
  fatture FiC**
- `filtroComunicazioni.ts` — regole filtro mittente

Cancellare la cartella avrebbe spento Email, WhatsApp, Inbox e l'abbinamento
fatture. Non era quello che era stato chiesto.

È rimasta anche la **Conoscenza aziendale** (`/conoscenza`), spostata in
`server/routers/conoscenza.ts`: è una scheda che le persone scrivono e
rileggono, non il cervello di nessuno. Era nel router Tars perché nata per
alimentarne il prompt.

I flag di piattaforma sono passati a `server/routers/platform.ts`: erano
esposti solo da `tars.config.get`, e con loro sarebbe sparito anche lo stream
SSE delle notifiche, che non c'entra niente.

## Cosa non funziona più, di proposito

- Le comunicazioni in arrivo **non vengono più classificate né collegate
  automaticamente**: entrano col match deterministico e restano da lavorare.
- Le fatture FiC senza commessa **non generano più proposte**: si collegano a
  mano, oppure si crea la commessa col bottone «Crea le N commesse mancanti».
- I costi FiC **non vengono più classificati dal modello**: si classificano in
  Acquisti, che è comunque diventata la fonte del costo fisso.
- Il Centro Azioni **non ha più l'analisi automatica del caso**.
- La diagnostica **non espone più piani e workflow**.

## I dati

Esportati **prima** della rimozione in `~/Downloads/tars-export-2026-08-28.json`
(10,3 MB), poi cancellati da `kv_store`:

| chiave | record |
|---|---|
| `azioni_suggerite` | 498 |
| `agente_esecuzioni` | 999 |
| `tars_learning_outcomes` | 95 |
| `tars_chat` | 6 |
| `tars_process_snapshots` | 6 |
| `agente_config` | 2 |
| `tars_workflow_operations` | 2 |
| `tars_process_experiments` | 2 |

Le tabelle `tars_entity_contexts`, `tars_context_versions` e
`tars_context_evidence` **non esistevano in produzione**: il motore di contesto
non era mai stato acceso.

Restano in piedi due cose, apposta:

- le colonne `tars_analizzata`, `tars_riepilogo`, `tars_istruzione`,
  `tars_ultima_analisi_at` su `comunicazioni` — costano nulla e il prossimo
  agente probabilmente le rivuole;
- le capability `tars.*` in `authz/capabilities.ts`, perché
  `tars.manage_policy` governa i permessi stessi: rinominarla vorrebbe dire
  migrare le regole già salvate. Le altre tre non compaiono più nella UI dei
  permessi, che prometteva una funzione inesistente.

## Domande aperte per il prossimo

Nessuna è stata decisa. Sono in ordine di quanto pesano.

1. **Cosa deve fare, in concreto, prima di essere considerato utile?** Il
   vecchio faceva diciassette tipi di proposta e nessuno era stato scelto:
   erano cresciuti uno alla volta.
2. **Propone e basta, o esegue?** Il vecchio aveva entrambe le modalità e
   l'autonomia è rimasta spenta per sempre. Vale la pena chiedersi perché.
3. **Dove vive?** Una pagina sua, o dentro le schede dove il lavoro succede
   davvero. Il Command Center era un posto in più da aprire.
4. **Quanto può costare al mese, e chi se ne accorge se sfora?**
5. **Cosa succede quando sbaglia** — chi lo scopre, e come si torna indietro.
