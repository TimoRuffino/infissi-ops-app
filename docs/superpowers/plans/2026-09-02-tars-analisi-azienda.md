# Tars — Analisi azienda e sintesi giornaliera (02/09/2026, sera)

Fase successiva dichiarata dal piano smistamento (§4) e mandato direzione
del 02/09: «non sta analizzando l'azienda … deve proporre, deve capire».
Lo smistamento copre le comunicazioni; qui Tars guarda l'azienda intera
una volta al giorno e dice cosa vede, cosa rischia e cosa farebbe.

## 1. Principio

- **Fotografia deterministica** (`analisi/fotografia.ts`): fatti letti dai
  servizi di dominio, sede-scoped, senza importi: commesse attive per
  stato e quelle ferme da più tempo, casi aperti del Centro Azioni,
  osservazioni aperte, pattern azienda (Panorama), smistamento (urgenti,
  da rispondere, da decidere), ticket aperti, interventi dei prossimi
  sette giorni, proposte in attesa. Ogni fatto porta i riferimenti delle
  entità (`commessa:12`, `caso:4`, …) e un link.
- **Sintesi del modello** (`analisi/analisi.ts`, prompt `analisi-v1`,
  output JSON strict): sintesi, punti (rischio / anomalia / andamento /
  opportunità) con priorità, proposte con la frase da dire a Tars per
  eseguirle, domande per la direzione. Verifica deterministica: le entità
  citate devono esistere nella fotografia, importi scrubbati, limiti di
  lunghezza. Senza provider: sintesi deterministica dai contatori.
- **Proposte eseguibili, non eseguite**: ogni proposta ha
  `richiestaPerTars`; il click «Chiedi a Tars» precompila la chat. Tars
  esegue con i suoi strumenti (Tars libero), gli effetti finiscono nel
  Registro. Nessuna mutazione nasce dall'analisi.
- **Una al giorno per sede** (`analisi/worker.ts`): dalle 06:00 ora di
  Roma, se manca quella di oggi; rigenerabile a mano dalla direzione.
  Registro `tars_analisi_azienda` (jsonb con `sql.json`, memoria senza
  PostgreSQL).
- **Governance**: flag `FLAG_TARS_ANALISI_AZIENDA` (fail-closed; richiede
  `FLAG_TARS_PROACTIVE`), classe di costo `analisi_azienda`, modello
  `TARS_MODEL_ANALISI` (default `gpt-5.6-sol`: una chiamata al giorno,
  vale la qualità). Lettura riservata alla direzione (come il Panorama).

## 2. Superfici

- `tars.analisiAzienda` (ultima analisi della sede) e
  `tars.analisiAziendaRigenera` (direzione; passa dal governor).
- Pagina `/tars`: sezione «Analisi di oggi» nel pannello contesto
  (sintesi, punti, domande, Rigenera); stato vuoto della conversazione
  mostra la sintesi; scheda **Proposte** con il gruppo «Dall'analisi
  dell'azienda» e il bottone «Chiedi a Tars».

## 3. Non in questo taglio

Dati economici (pavimento economico: mai importi nel modello), invio della
sintesi via mail/notifica, storico e confronto fra giorni, Centro Azioni
come pagina.
