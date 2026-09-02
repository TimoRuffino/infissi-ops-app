# Tars smistamento — «un cervello operativo non si fa scappare niente»

> Mandato direzione 02/09/2026: «al momento non sta proponendo nessun tipo
> di proposta, non sta analizzando l'azienda, non sta analizzando le
> comunicazioni e non sta collegando in automatico gli allegati che
> arrivano nelle comunicazioni alle commesse. Un cervello operativo
> dell'azienda non deve farsi scappare niente, deve avere tutto sotto
> controllo e deve aiutare e capire.»

## 1. Diagnosi (produzione, 02/09/2026)

- 10.261 comunicazioni; ultimi 30 gg: 978 email in (905 senza commessa,
  436 con allegati) + 365 WhatsApp in. 2.466 allegati orfani totali.
- Proposte create: 0. Analisi documenti: 0. Ordini fornitore: 0. Tutta la
  pipeline proposte/DI è ancorata al modulo ordini fornitore, non usato.
- All'arrivo scatta SOLO `matchComunicazione` (deterministico) + il
  pre-filtro spam. Nessun evento, notifica, caso, classificazione,
  archiviazione. Dal 28/08 tutto entra `da_classificare`.
- WhatsApp si aggancia bene (numero); email no: mittenti interni
  (`*@ruffinogroup.it`), fornitori, PEC, inoltri («Fwd:», «I:») col
  cliente dentro il corpo; la regola cognome-nell'oggetto spara su
  «Ruffino» (155 falsi «bassa» in 60 gg).
- Osservazioni (130 aperte), Panorama e Miglioramenti: nessuna UI. Il
  componente `ActionCenter` esiste ma non è montato. `tars_riepilogo` /
  `tars_istruzione` / `listDaAnalizzare` / `salvaEsitoTarsComunicazione`:
  coda del vecchio smistamento, orfana.

## 2. Decisioni registrate

- **D1 Collegamento automatico** solo quando è CERTO e deterministico:
  match `alta` (codice commessa, numero/email univoci) o ereditarietà di
  thread certa (stesso filo, controparte già collegata). Il modello NON
  collega: propone, con candidati che il server ha generato e verifica.
  La proposta si accetta con un click (Messaggi, Situazione).
- **D2 Archiviazione automatica allegati** solo su comunicazioni già
  collegate a una commessa (certo o manuale), per documenti riconosciuti
  (classificatore lessicale ∧ modello concordi, o modello con confidenza
  alta su pdf/docx/xml/p7s); immagini solo da WhatsApp collegato, come
  «foto», sopra 30 KB. `vietaRiassegnazione`, nota «Archiviato
  automaticamente da Tars», idempotente per sourceRef. Reversibile:
  cancellazione dal fascicolo. Il resto → proposta.
- **D3 Modello di smistamento**: `TARS_MODEL_SMISTAMENTO` (default
  `gpt-5.6-terra`, reasoning `low`), classe di costo `smistamento`,
  output strutturato JSON (schema chiuso, id solo dai candidati). Il
  provider nasce dal governor come tutti.
- **D4 Nessun invio autonomo**: non esiste un canale di invio nel dominio.
- **D5 Arretrato**: ultimi 90 giorni col modello (recenti prima), più
  vecchi solo deterministico. WhatsApp media > 30 gg non recuperabile
  (Meta): dichiarato, non simulato.
- **D6 Flag** `FLAG_TARS_SMISTAMENTO` (interruttore `tarsSmistamento`),
  fail-closed; richiede `tars` + `tarsCommunications` + `tarsProactive`
  e storage autorevole (PostgreSQL).

## 3. Architettura (`server/tars/smistamento/`)

| Modulo | Ruolo |
|---|---|
| `repository.ts` | tabella additiva `tars_smistamento` (esito per comunicazione, proposta e suo stato, tentativi, errori); memoria nei test |
| `candidati.ts` | candidati deterministici e verdetto certo: match esistente + mittente interno/inoltro (mittente originale nel corpo) + thread + nomi/ragioni sociali/località/telefoni nel testo |
| `analisi.ts` | prompt e schema del modello; validazione zod; id verificati contro i candidati; fallback deterministico senza modello |
| `applica.ts` | effetti deterministici: collegamento certo, archiviazione certa, scrittura triage (categoria/riepilogo/istruzione), proposta, segnali |
| `worker.ts` | coda per sede (60 s; recenti prima, arretrato a goccia), retry con backoff |

Superfici: Centro Azioni (nuovi `ActionSignalKind` `comunicazione_decisione` / `comunicazione_risposta`), briefing (`smistamento: daDecidere / daRispondere / urgenti`), lettore email/WhatsApp (banner «Tars propone…», riepilogo, allegati archiviati), endpoint `tars.smistamento.*` (stato, proposte, approva, rifiuta, riesamina).

## 4. Task

- T1 contratto provider: output JSON strutturato (adapter + fake); classe `smistamento`; interruttore.
- T2 comunicazioni: `collegaAutomaticoComunicazione` (senza toccare lo stato), `listDaSmistare`, ricerca thread.
- T3 repository `tars_smistamento` (+ memoria).
- T4 candidati deterministici con test su casi reali anonimizzati.
- T5 analisi modello (prompt v1, schema, verifica) con provider finto.
- T6 applica (collega/archivia/triage/proposta/segnali) con test.
- T7 worker + boot + endpoint + Centro Azioni + briefing.
- T8 UI: lettore messaggi, briefing/Situazione, lista.
- T9 docs (matrice, runbook, handoff, PRD), deploy, flag, verifica su dati veri.

Fase successiva (fuori da questo piano): analisi azienda su dati reali
(pattern su comunicazioni/commesse/pagamenti) + sintesi giornaliera del
modello; Centro Azioni montato come pagina.
