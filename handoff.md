# Handoff - Ruffino Flow (`infissi-ops-app`)

> Stato tecnico e operativo del CRM. Questo documento è pensato per chi entra
> nel progetto senza il contesto delle sessioni precedenti.

**Aggiornato:** 04/09/2026<br>
**Base Git descritta:** `main`, Tars v2 presente nel checkout; la rimozione del 28/08 è storia, non stato corrente<br>
**Produzione:** https://crm-ruffinogroup.up.railway.app<br>
**Deploy:** Railway segue `main`

> **Novità 03/09/2026 sera — il costo fornitore nasce dalla conferma d'ordine.**
> Regola di dominio deterministica (`server/commesse/costoDaConferma.ts`, piano
> `docs/superpowers/plans/2026-09-03-costo-da-conferma.md`): quando un documento
> di tipo `conferma_ordine` entra nel fascicolo (upload, archiviazione da mail,
> riclassificazione, spostamento) la commessa registra in `costi[]` l'IMPONIBILE
> letto dal PDF (`costi[].documentoId` lo lega al documento; cancellare o
> riclassificare il documento toglie il costo). Il worker
> `costoDaConfermaWorker` (boot +30 s, ogni 60 s, 10 per giro, OCR locale
> ammesso, `COSTO_DA_CONFERMA_WORKER=off` per spegnerlo) legge le conferme già
> archiviate e le scansioni; il documento ricorda l'esito in `letturaCosto`.
> Senza imponibile nel documento non si scorpora l'IVA: la scheda commessa e la
> fotografia di Tars dicono «registra a mano». La chat di Tars
> (`registra_costo_fornitore` 1.1.0) serve solo a rimettere un costo tolto a mano.
>
> **Stessa sera, seconda tranche.** (1) La stessa lettura scrive la **merce in
> arrivo a magazzino** (`estrazioneMerce.ts`, righe con `documentoId`; il
> magazzino parte da «Da ordinare»; senza righe riconosciute una riga sola da
> completare). (2) Le conferme **certe** (mail già collegata alla commessa +
> nome file di conferma) si archiviano da sole: worker
> `tars/documenti/confermeAutoArchivio.ts` (ogni 10 min,
> `CONFERME_AUTO_ARCHIVIO=off` per spegnerlo), `origine: "automatico"`; le
> dubbie restano proposte. (3) **Registro conferme d'ordine**: campo
> `Documento.origine`, procedura `preventiviContratti.registroConferme`, pagina
> `/conferme-ordine`. Piano: `docs/superpowers/plans/2026-09-03-costo-da-conferma.md`.
>
> **Notte del 04/09, caso Giacomazzi.** Una conferma entra in un fascicolo da
> sola SOLO se il suo testo cita la commessa (`documenti/riscontroCommessa.ts`:
> codice, cliente anche troncato, indirizzo, ordine noto) e non è una copia
> (stesso riferimento d'ordine nel nome o nel testo → `duplicato`): vale per
> smistamento, worker delle conferme certe e strumento
> `archivia_allegato_comunicazione` 1.1.0. Lettura 1.2.0: ricontrollo di
> tutte le conferme archiviate da automatismi (senza riscontro → costo e merce
> ritirati, «È di questa commessa» nel registro e nella scheda) e del
> magazzino (righe rigenerate con l'estrattore nuovo se non toccate a mano).
> Settimana di APPRONTAMENTO ≠ consegna (data vuota, nota esplicita). Resolver:
> «commessa 393» = COM-2026-393, mai l'id (prompt v11). OCR: `FLAG_OCR=on`
> impostato in Railway il 04/09 (prima era spento; i binari c'erano già),
> tesseract `--psm 6` + `preserve_interword_spaces`. Poi: `leggi_conferma_ordine`
> 1.2.0 (riscontro pieno, vostro riferimento, fornitore dall'intestazione),
> stato operativo del run = ultima azione decisiva, prompt «Non fatto:» su
> rifiuto, proposte gestite dietro un toggle e analisi rigenerata (4 h, o 30
> min se tutte gestite; le scartate non si ripropongono). Aperto: lo scavalco
> dei gate quando l'utente nomina lo stato di arrivo (oggi consentito dal
> mandato del 02/09) e la lettura con il modello dei PDF scansionati.
>
> **Mattina del 04/09, «è ancora troppo stupido» (conferma BT Glass per De
> Petris, letta senza importi e con il fornitore sbagliato).** Il testo dei
> PDF nativi ora viene ricostruito dalla GEOMETRIA dei frammenti
> (`documenti/testoPdf.ts`, parser 2.0.0, stile `pdftotext -layout`): righe
> vere, celle separate da tre spazi, valori allineati sotto le etichette.
> Estrattore 1.1.0: imponibile anche per aritmetica dell'IVA, «Imposta» come
> IVA, importi solo con decimali, «IVA esclusa» → il totale è l'imponibile,
> numero mai una data, fornitore non è agente/banca/destinatario (poi firma
> in calce, poi dominio), «vs. riferimento» nella cella accanto o sotto,
> colonna «Consegna». Merce 1.2.0 a celle, unità a misura, righe uguali
> sommate. Riscontro con un carattere di tolleranza sul cognome. Lettura
> 1.4.0: rilettura di tutte le conferme. Corpus di 15 conferme reali (non
> nel repo): 5 nativi giusti, 8 scansioni su 10 leggibili con l'OCR locale,
> 1 pagina ruotata illeggibile, 1 PDF con più conferme (totali mescolati:
> da spezzare, prossima tranche). Scoperto e corretto nei log: lo store
> `fic_pagamenti_links` si registrava DOPO `bootstrapAll` (modulo importato
> solo dinamicamente) e i suoi salvataggi venivano rinviati per sempre
> («save deferred … bootstrap not complete yet» ogni secondo): import
> statico in `_core/index.ts` e store tardivi che si caricano da soli in
> `persistence.ts`. Poi, letta la produzione con una sonda in sola lettura
> (`railway ssh -- node …`, i comandi passano da una shell remota: pipe e
> redirezioni vanno quotate localmente), lettura 1.5.0: una rilettura
> corregge i costi nati dalla regola e mai toccati (tre Pail a «22,00»), la
> conferma aggiornata dello stesso ordine sostituisce la vecchia (Oskura
> «(2).pdf»), il CAP non è un riferimento d'ordine (Brianzatende). Un costo
> è «nato dalla regola» se porta la sua impronta (descrizione e nota) e
> nessuno l'ha modificato dalla scheda (`costi[].modificatoAMano`, marcato
> da `commesse.updateCosto`): solo quello una rilettura corregge. Piano:
> `docs/superpowers/plans/2026-09-03-costo-da-conferma.md` (quinta tranche).
>
> **Tarda mattina del 04/09 — lettura visiva e foto (sesta tranche).** Le
> foto (jpeg/png/webp) passano da tesseract (`eseguiOcrImmagine`). Quando
> l'OCR manca, fallisce o legge poco e male, il modello TRASCRIVE le pagine
> (`documenti/letturaVisiva.ts`: 150 dpi, al più 8 pagine, riga per riga con
> le colonne a tre spazi) e il testo attraversa gli stessi estrattori: il
> modello non decide niente. A pagamento, dietro governor e ledger (classe
> `lettura_documenti`), con `FLAG_LETTURA_VISIVA` (fail-closed; acceso in
> Railway il 04/09) e modello `TARS_MODEL_VISIONE` (default: quello
> interattivo). Parte solo con un'identità: worker (utente di sistema),
> `leggi_conferma_ordine` 1.3.0 e `registra_costo_fornitore` (utente della
> chat); mai in upload, archiviazione o smistamento. I turni utente del
> provider portano immagini (`immagini[]`), l'adapter le manda come
> `input_image` (`openai/corpo.ts`), il governor le conta nella stima.
> Lettura 1.7.0. Poi (settima tranche) i PDF con più conferme (Bertolotto,
> tre ordini in otto pagine): `sezioniConferma` ed
> `estraiConfermeNelDocumento` leggono ogni sezione da sola e il costo è la
> SOMMA degli imponibili, solo se ogni sezione ha il suo (`motivoSomma`
> altrimenti); «TOTALE ORDINE» batte «TOT. MERCE». Lettura 1.8.0.
>
> **Pomeriggio del 04/09 — «Tars non fa proposte, è tutto fermo, idem le
> conferme ordine; non deve arrendersi, deve essere sicuro e molto più
> attivo».** Diagnosi in produzione (sonde in sola lettura): l'analisi
> azienda girava (5+1 proposte/giorno, versione 1.2.0) ma sprecava posti
> in «registra a mano»; lo smistamento smistava (49 mail/giorno) senza
> aprire proposte perché i candidati nascevano solo dalla mail; le conferme
> dei fornitori — 60 PDF in 120 giorni, 57 non archiviati, 52 in mail senza
> commessa («PAIL_2634169 RUFFINO», «Commessa-N-1013363 PENULTIMO PIANO»:
> il cliente è solo dentro il PDF) — restavano allegati; il follow-up
> preventivi moriva ogni mezz'ora su `could not determine data type of
> parameter $3` (42P18: promemoria già esistente cercato con un parametro
> nullo senza cast). Fatto: (1) **la commessa si cerca DENTRO la conferma**
> (`tars/documenti/ricercaCommessaNelDocumento.ts`: il testo — nativo, OCR
> o trascritto dal modello — contro tutte le commesse vive con lo stesso
> riscontro dell'archiviazione; una forte = trovata, due dello stesso
> cliente = quella che aspetta la conferma, altrimenti decide una persona;
> l'azienda stessa non è mai candidata; lettore con memoria 12 h e tetto di
> letture per giro); il detector `confermeMancanti` legge dentro i file
> (`riscontroTesto` + prove su ogni candidato, «certa» solo se il testo non
> smentisce), il worker delle conferme archivia anche dalle mail di nessuno
> e le COLLEGA, lo smistamento legge gli allegati «da conferma» all'arrivo
> (riscontro unico = collegamento certo + archiviazione; più riscontri =
> candidati per il modello) e una conferma apre la proposta anche su mail
> vecchie; `verificaConfermaPerFascicolo` accetta OCR/visione e pagine già
> lette; «conferma ordine cliente» del fornitore non è più esclusa.
> (2) **Analisi**: `archivia_allegato_comunicazione` eseguibile con un click
> dalle proposte (fotografia con comunicazione e `allegatoIndex`), prompt
> analisi-v9 (conferme senza costo leggibile = un punto, mai proposte).
> (3) **Follow-up**: cast `::bigint` in `reminders/repository.ts`, errori
> isolati per commessa, contratto PG `reminders/repository.pg.test.ts`.
> (4) **Prompt v12**: «non ti arrendi» (rileggere e cercare per cognome,
> telefono, comunicazioni prima di dire non posso) e «sicurezza» (niente
> «vuoi che proceda?»). Registro azioni 1.21.0
> (`cerca_conferme_ordine_mancanti` 1.1.0). Costi: al più 8 letture nuove
> per giro del worker (10 min), 10 per giro di smistamento, 6 per
> fotografia/chat; il testo letto resta in memoria 12 ore (30 minuti se la
> lettura è fallita). Primo giro vero (15:18): 8 file letti (nativi e OCR),
> tutti «ambigui» — l'indirizzo dell'azienda (Via Crispi, La Spezia) sta in
> ogni conferma e faceva riscontrare quattro commesse, e la data «31/07/26»
> letta come «310726» passava per ordine noto. Riscontro corretto
> (`documenti/riscontroCommessa.ts`): l'indirizzo vale solo con una parola
> DISTINTIVA della via (≥5 lettere, non articoli né nomi da toponomastica,
> non la via della sede) subito dopo «via/piazza/loc.»; il solo indirizzo è
> una prova debole (decide una persona); `sembraData` esclude le date dai
> riferimenti d'ordine (anche nei nomi file). Secondo giro (15:28): «Via
> Francesco Crispi» faceva riscontrare ogni cliente di nome Francesco e
> «Stefano» + «Angelo» sparsi in un ordine Pail passavano per il cliente
> «Stefano Angelo» → i NOMI PROPRI comuni non identificano nessuno (vale il
> cognome dall'anagrafica, o una parola che non sia un nome), il nome
> completo vale solo se le sue parole stanno sulla stessa riga entro tre
> parole, e un cognome solo su una commessa che non aspetta la conferma
> (preventivo) non aggancia da solo. Terzo giro (15:38): «spezia» dentro il
> nome di tre enti clienti → località, enti, articoli lunghi e i cognomi
> più diffusi (Rossi, Bianchi, Ferrari…) fra le parole che da sole non
> identificano nessuno (il cognome diffuso vale con il nome accanto).
> Quarto giro (15:50): riscontro pulito — Cecconi (Alias) unica sulla sua
> commessa (già archiviata: copia), gli altri sette file solo indizi deboli
> («~isanto», «~scotti») → restano proposte «va confermato» nella
> fotografia. Ogni lettura e ogni riscontro lasciano una riga
> `[ricerca-commessa]` nei log, e il giro del worker conta i candidati
> (certe/probabili/non letti). Metodo che ha funzionato: leggere i log del
> giro dopo ogni deploy e togliere UNA classe di falsi positivi per volta.

## 1. Contesto

Ruffino Flow è il gestionale operativo di Ruffino Group per clienti, commesse,
rilievi, ordini, produzione, posa, pagamenti e post-vendita. È usato su dati
reali: compatibilità dei record esistenti, isolamento tra sedi e possibilità di
rollback hanno priorità sulle riscritture estese.

L'interfaccia e i messaggi sono in italiano. Il sistema visuale corrente usa
Plus Jakarta Sans, superfici chiare calde, inchiostro scuro e giallo come
accento. I token sono in `client/src/index.css`; evitare colori hardcoded nelle
pagine quando esiste già un token semantico.

## 2. Stack e architettura

| Livello | Tecnologia |
|---|---|
| Frontend | React 19, Vite 7, Wouter, tRPC 11, React Query, Tailwind 4, shadcn/Radix, lucide |
| Backend | Node, Express, tRPC 11, zod |
| Dati applicativi | PostgreSQL Railway, principalmente `kv_store` JSONB |
| Comunicazioni | tabella PostgreSQL `comunicazioni`, con fallback in memoria locale |
| Azioni operative | tabelle PostgreSQL `azioni_operative` e `azioni_operative_eventi`, fallback in memoria locale |
| File | driver `local` oppure object storage S3-compatible/R2 |
| AI | Tars v2 server-side, con provider governato e strumenti tipizzati; enforcement e automatismi business restano deterministici (§6) |
| PDF | jsPDF/autotable client e server |

### Persistenza

`server/_core/persistence.ts` espone `persistedStore<T>(key, onLoad)`:

- ogni store è un array in memoria e una riga JSONB in `kv_store`;
- `bootstrapAll()` carica gli store all'avvio;
- i campi nuovi richiedono schema, default e backfill in `onLoad`;
- `save()` riscrive l'intera raccolta, quindi i byte dei file non devono
  restare nel JSONB una volta attivato lo storage durevole.

`comunicazioni` è intenzionalmente una tabella vera: il volume di email e
WhatsApp non è compatibile con la riscrittura di un blob unico.

### Invarianti di sicurezza

- Ogni record business porta `sedeId` e ogni lettura/mutazione deve applicare
  lo scope della sede attiva.
- Su mismatch di sede si risponde `NOT_FOUND`, non `FORBIDDEN`, per non
  rivelare l'esistenza di record di altre sedi.
- Tars v2 esiste, ma match, regole, aritmetica, state machine, permessi e gate
  restano deterministici. Il modello non ha capability proprie, non usa tRPC,
  SQL generico o `force`, e ogni provider reale passa dal governor (§6).
- `importoIncassato` è derivato da `pagamenti[]` e non è scrivibile dal client.
- Importi e nomi passano dagli helper in `client/src/lib`, senza parser locali.
- Segreti e token non entrano nel repository né nei documenti.

## 3. Mappa del codice

```text
server/_core/
  index.ts                  Express, tRPC, callback OAuth e scheduler
  persistence.ts            kv_store e bootstrap
  driveBackup.ts            backup Drive, inclusi file con storageKey
  fileStorage.ts            driver local/S3, checksum e probe
  fileStorageMigrate.ts     dry-run/apply base64 -> object storage

server/routers/
  commesse.ts               dominio centrale
  fattureInCloud.ts         OAuth, refresh e sync clienti
  fileStorageAdmin.ts       stato, probe e migrazione direzione
  mail.ts                   configurazione e API Comunicazioni
  backup.ts                 configurazione e run Drive

server/comunicazioni/        (era server/tars/, ma non era l'agente)
  comunicazioni.ts          tabella messaggi, Inbox e conversazioni WhatsApp
  imap.ts                   sincronizzazione email
  whatsapp.ts               integrazione Meta, webhook e storico
  caselle.ts                store delle caselle email
  match.ts                  matcher deterministico cliente/commessa
  filtroComunicazioni.ts    regole filtro mittente

server/events/              registro eventi, consumer e recovery lease
server/notifications/       repository, proiettore, SSE e Web Push
server/observability/       metriche aggregate privacy-safe

server/actionCenter/
  signals.ts                regole pure, priorità e deduplica
  repository.ts             PostgreSQL/memory e audit eventi
  reconcile.ts              ciclo di vita e auto-risoluzione
  scheduler.ts              modalità legacy/shadow/active e recupero

client/src/
  App.tsx                   rotte lazy e boundary di caricamento
  index.css                 design tokens light/dark
  pages/messaggi/EmailPage.tsx     inbox operativa Email
  pages/messaggi/WhatsAppPage.tsx  workspace conversazioni WhatsApp
  pages/Integrazioni.tsx    Drive, FiC, storage e altre integrazioni
  components/ActionCenter.tsx      coda personale/sede e transizioni
```

Comandi principali:

```bash
pnpm dev
pnpm check
pnpm test
pnpm build
pnpm storage:check
pnpm storage:dry-run
pnpm storage:migrate
```

## 4. Storage e backup

### Stato del codice

- I record documentali possono contenere `storageKey` e `checksum` al posto di
  `dataBase64`.
- L'upload manuale nel fascicolo commessa accetta file fino a 250 MB e video
  MP4/MOV/WebM. Usa una rotta binaria che verifica same-origin e autenticazione
  prima di leggere il body, con un solo upload concorrente per processo; la
  lettura usa una rotta autenticata con HTTP Range. Sopra 10 MB un errore
  storage interrompe l'operazione invece di salvare centinaia di MB in JSONB.
  Import da comunicazioni/FiC e allegati ticket restano a 10 MB.
- Il backup Drive risolve prima `storageKey`, verifica SHA-256 e mantiene la
  compatibilità con i record inline legacy.
- Il backup comprende documenti e allegati ticket, anche per commesse orfane.
- `fileStorage.probe` esegue put/get/checksum/delete ed è riservato alla
  direzione.
- La migrazione è idempotente, rileggibile e protetta dal requisito di un
  backup Drive riuscito nelle ultime 24 ore.

La procedura completa R2 è in `docs/storage-r2.md`.

### Azione ancora necessaria in produzione

1. Creare il bucket R2 e un token Object Read & Write.
2. Impostare su Railway `STORAGE_DRIVER=s3` e le variabili `S3_*`.
3. Eseguire `pnpm storage:check` nell'ambiente configurato.
4. Eseguire un backup Drive manuale riuscito.
5. Eseguire `pnpm storage:dry-run`; controllare conteggi e checksum.
6. Solo dopo, eseguire `pnpm storage:migrate`.

Il dry-run locale del 14/08/2026 ha trovato zero record perché non era presente
`DATABASE_URL`: non vale come prova sui dati Railway.

## 5. Fatture in Cloud

Il flusso OAuth Authorization Code è implementato:

- state monouso con scadenza;
- callback `/api/oauth/fic/callback`;
- cifratura di access token e refresh token;
- refresh automatico con deduplica per sede;
- selezione automatica quando l'account ha una sola azienda;
- scopes read-only `entity.clients:r issued_documents.invoices:r issued_documents.credit_notes:r received_documents:r`;
- token manuale mantenuto solo come fallback di emergenza.

Variabili richieste:

```text
FIC_OAUTH_CLIENT_ID
FIC_OAUTH_CLIENT_SECRET
FIC_OAUTH_REDIRECT_URI
MAIL_ENCRYPTION_KEY
```

La roadmap OAuth è quindi **chiusa lato codice**. Resta l'attivazione operativa:
impostare le variabili Railway, registrare lo stesso redirect nella app FiC e
collegare ogni sede dalla pagina Integrazioni.

Dal 25/08/2026 il sync importa anno corrente e precedente in quattro flussi
indipendenti: fatture, note di credito emesse, spese e note di credito passive.
Ogni flusso usa paginazione completa e snapshot non distruttivo; i record non
più restituiti diventano `presenteInFic=false` e smettono di alimentare i KPI.
Una risposta incompleta non marca nulla come rimosso.

**Contratto economico invertito il 26/08/2026 (sera).** Fino a quel giorno il
pattuito era dato CRM e le fatture non potevano toccarlo. Ora vale l'opposto,
per decisione della direzione:

- il pattuito (`importoTotale`) e il piano rate di una commessa **con almeno
  una fattura FiC collegata** sono derivati da quelle fatture. `pattuitoFonte`
  vale `fic`, la scrittura manuale risponde `PRECONDITION_FAILED` e la scheda
  commessa mostra la cifra senza campo di input;
- una commessa **senza fattura collegata** è interamente manuale: pattuito e
  rate li scrive l'operatore (`commesse.addRata`, `updateRata`, `removeRata`),
  `pattuitoFonte` vale `manuale`;
- il passaggio manuale → FiC avviene al primo collegamento; il ritorno solo
  quando l'ultima fattura viene scollegata. Dal 27/08/2026 scollegare a mano
  l'ultima fattura **azzera** il pattuito derivato (`azzeraPattuitoDerivato`
  in `commesse.ts`) e lascia solo le rate manuali: se un umano stacca una
  fattura è perché quel numero non descriveva quella commessa, e un campo
  vuoto che chiede l'importo è meglio di una cifra che nessuno sa
  giustificare. Il sync automatico resta conservativo: una fattura che
  sparisce da FiC non svuota niente da sola;
- le note di credito abbattono il pattuito e non generano rate in attesa;
- il punto unico è `sincronizzaPattuitoDaFic(sedeId)` in `ficFatture.ts`,
  chiamato dal sync, da `collega` e dallo scollegamento. È idempotente.

Il match fattura → commessa è stato riscritto (`server/routers/ficMatch.ts`).
La regola voluta: **basta un solo segnale in comune** fra telefono, email,
nome e cognome, indirizzo o identità fiscale perché la fattura venga allegata.
Il codice commessa citato nell'oggetto vince su tutto.

**Correzione del 27/08/2026.** «Un segnale basta» valeva anche quando gli
altri dati dicevano il contrario, e due fatture di due clienti diversi
finivano sulla stessa commessa — con un pattuito che sommava due lavori. Ora
il matcher guarda anche le contraddizioni e ha tre esiti invece di due:

- **escluso**: partita IVA / codice fiscale diversi, o `clienteId` diverso.
  La commessa non è nemmeno candidata. Solo il codice commessa scritto in
  fattura scavalca il veto;
- **incerto**: intestatario con nome diverso, oppure forza sotto
  `FORZA_MINIMA_AUTOMATICA` (20). Il candidato si vede, con il dubbio
  scritto accanto, ma non si collega da solo. L'unico segnale che da solo non
  arriva a 20 è l'indirizzo: nelle palazzine e nei condomini combacia fra
  persone che non c'entrano niente fra loro;
- **certo**: si collega.

L'altro caso non deciso resta la parità: due commesse con lo stesso punteggio
lasciano la fattura in coda con i candidati esposti. Il sync legge ora anche `email`, `phone`,
`address_street`, `address_city`, `address_postal_code` e
`subject/visible_subject` dall'entity FiC — prima scartava tutto tranne nome,
partita IVA e codice fiscale, ed è per questo che i privati non agganciavano.

**Scollegare una fattura è un'unica operazione** (`scollegaFatturaDaCommessa`
in `ficFatture.ts`), dal 27/08/2026. Prima i tre effetti succedevano
separatamente e restavano a metà: il PDF archiviato rimaneva nel fascicolo
(e il sync successivo lo riattaccava), gli incassi FiC restavano attivi sul
vecchio fascicolo, e togliere l'allegato dalla commessa non scollegava niente.
Ora, da qualunque porta si passi — pulsante Scollega o cancellazione del PDF
dal fascicolo (`preventiviContratti.delete` su un documento `source = "fic"`):

- il legame sparisce dalla fattura e la commessa finisce in
  `commesseEscluse`, così il match automatico non rifà lo stesso errore al
  giro dopo (ricollegarla a mano annulla il rifiuto);
- il PDF esce dal fascicolo;
- i movimenti `origine = fic` di quel documento vengono **rimossi**, non
  stornati (`rimuoviPagamentiFicScollegati`), e `importoIncassato`
  ricalcolato: uno storno dice che un incasso di quella commessa è stato
  annullato, ma se la fattura non era sua quei movimenti non sono mai stati
  suoi, e restare come righe «Stornato» è cronaca di un errore. Sono dati
  derivati: la riconciliazione li ricostruisce da FiC appena la fattura viene
  collegata alla commessa giusta. Pagamenti manuali e link riconciliati a
  mano non si toccano (questi ultimi diventano `superata`). Le righe già
  create dalla prima versione — marcate `ficStato = "scollegata"` — vengono
  ripulite dall'`onLoad` di `commesse`;
- pattuito e piano rate vengono riderivati dalle fatture rimaste;
- la fattura torna nella coda di riconciliazione. `tarsAnalizzata` viene
  riportato a `false` come marcatore di compatibilità: dal 28/08/2026 non ha
  consumatori (§6).

**Fatture orfane (dal 28/08/2026).** Nessuna proposta automatica: la coda
espone i candidati del match con il dubbio scritto e le commesse già
rifiutate. Si collega a mano dopo conferma, si esclude dalla riconciliazione,
oppure — se il cliente non ha commesse — si usa «Crea le N commesse
mancanti». (Storico: il trigger `riconciliazione_fatture` dell'agente
proponeva collegamento o nuovo lead con chiave `ficId`.)

Il resto del contratto resta invariato:

- fatture, rate, importi incassati, date e storni hanno FiC come fonte
  autorevole;
- il sync scrive e aggiorna automaticamente soltanto movimenti con
  `origine = fic`, usando una chiave sorgente stabile e senza duplicarli;
- i pagamenti manuali non vengono mai mutati dal sync: una discordanza produce
  una segnalazione tipizzata nell'esito del sync (`correggi_manuale` /
  `scegli_manuale`) e la fattura resta `da_riconciliare`; la correzione è
  manuale (o via `commesse.correggiPagamento`, oggi senza UI);
- un movimento FiC annullato resta nel registro come `stornato`, conserva
  l'audit e non alimenta `importoIncassato`;
- snapshot FiC incompleti non stornano movimenti assenti dalla risposta.

`commesse.correggiPagamento` rivalida fingerprint del pagamento, rata FiC e
link prima di scrivere: su dati cambiati risponde `PRECONDITION_FAILED` senza
toccare il registro. (Storico: le proposte approvabili con chiave d'azione
canonica e stato `superata` erano dell'agente rimosso.)

Il vincolo di riconciliazione e ora uno-a-uno in entrambe le direzioni: un
pagamento manuale non puo essere riutilizzato per due rate FiC. Il sync ripara
anche i vecchi link duplicati conservando quello compatibile con importo/data e
creando, quando necessario, un movimento FiC distinto per la rata restante.
La scelta resta deterministica anche se FiC restituisce le rate in ordine
diverso e copre i link duplicati tra fatture; un movimento FiC persistito senza
link viene recuperato senza duplicarlo. Se più link puntano alla stessa rata,
il movimento FiC perdente viene stornato; un manuale perdente genera invece
una segnalazione di storno da applicare a mano, senza spostare il link
canonico. Una nota FiC multirata incompatibile con tutte le rate sospende i
nuovi importi di quella fattura fino alla decisione dell'operatore, senza
sospendere aggiornamenti o storni dei movimenti già esistenti.

Il sync espone ora lo stato attivo per sede in `fattureInCloud.status` e può
essere fermato da Integrazioni anche dopo un refresh tramite `annullaSync`.
Ogni richiesta FiC scade dopo 30 secondi e l'intero giro viene interrotto dopo
10 minuti: il lock per sede viene sempre liberato nel `finally`. Il deploy di
questa versione riavvia inoltre il processo e libera eventuali lock della
versione precedente rimasti in memoria.

`/economia` ha ora quattro tab, in ordine di frequenza delle domande:
**Andamento**, **Da riconciliare**, **Costi fissi**, **Acquisti**. Andamento si
apre con una fascia di sintesi — fatturato, costi, differenza e cassa attesa —
che risponde a "com'è andata" prima di ogni dettaglio; sotto restano le bande
di composizione. Se ci sono fatture da riconciliare o costi dubbi, la fascia lo
dice invece di lasciar credere che i numeri siano definitivi.

### Costi fissi: una risposta sola, due sorgenti (28/08/2026)

Fino a questa versione «costo fisso» significava due cose che non si
parlavano, ed è la causa diretta delle due segnalazioni *«i costi fissi non
riesco a salvarli anche se li classifico»* e *«gli acquisti sono spariti»*:

1. la classificazione `fisso` sui documenti FiC, fatta nella scheda Acquisti;
2. il registro `costi_fissi_manuali`, riempito confermando una ricorrenza in
   un dialog.

`calcolaBreakEven` leggeva **solo** il secondo. Classificare venti fornitori
come fissi lasciava quindi il totale a zero e il pareggio a
`dati_insufficienti`: da fuori sembrava che la classificazione non si
salvasse. In più `candidatiFissiPerSede` escludeva soltanto i fornitori
dichiarati **non** fissi, quindi un candidato confermato **restava in coda per
sempre**.

Ora la somma si fa in un posto solo, `server/_core/costiFissiAzienda.ts`:

| sorgente | cosa contiene | come si mensilizza |
|---|---|---|
| **FiC** | documenti d'acquisto classificati `fisso`, raggruppati per fornitore, **ancora in forza** | totale ÷ (occorrenze × intervallo della sua cadenza) |
| **Dichiarato** | ciò che in FiC non passa: stipendi, contributi, tasse, affitti senza fattura passiva | `importo ÷ mesi della cadenza`, contato solo se la voce è valida alla fine del periodo |

**Classificare in Acquisti È la conferma.** Non esiste più una seconda
registrazione: `costiFissi.confermaDaFic` è stato rimosso, e i tre bottoni
della coda chiamano `ficCosti.spostaFornitore`. `fornitoriNonFissi` è
diventato `fornitoriGiaDecisi`: una ricorrenza è una domanda, e una domanda
con risposta non si rifà — qualunque sia la risposta.

**Precedenza, una regola sola:** se una voce dichiarata a mano nomina un
fornitore che FiC conosce già come fisso, vince la voce dichiarata e
l'aggregato FiC di quel fornitore sparisce. Chi scrive cadenza e validità sa
più di una media aritmetica, e sommarli sarebbe contare due volte lo stesso
affitto. La riga lo dichiara: «Sostituisce €X/mese di fatture FiC dello stesso
fornitore».

**Solo i costi ancora in forza (28/08/2026, seconda passata).** La prima
versione divideva il totale del fornitore per i mesi del periodo, e sbagliava
in due direzioni opposte: un canone acceso a maggio veniva spalmato su dodici
mesi (€1.500 spesi in tre diventavano €125 invece di €500) e **un canone
chiuso a ottobre 2025 continuava a pesare sul mese di oggi**, perché i suoi
documenti cadono comunque dentro la finestra. La segnalazione era esattamente
questa: «vengono conteggiati anche costi del 2025, ma se non ci sono più che
senso ha conteggiarli».

Ora ogni fornitore dichiara il proprio ritmo, misurato sui **mesi** in cui ha
fatturato (non sui documenti: chi fattura due linee lo stesso mese ha una
ricorrenza mensile, e contare i documenti ne dimezzava il peso; le note di
credito sono rettifiche, non occorrenze):

- `intervallo = round((ultimoMese − primoMese) / (occorrenze − 1))`, minimo 1;
- `mensile = totale / (occorrenze × intervallo)` — per un mensile è la media
  di sempre, per un trimestrale è finalmente un terzo;
- **in forza** se il silenzio dall'ultima fattura è ≤ `intervallo + 1`: un
  mensile tollera due mesi di ritardo, un trimestrale quattro. Una fattura in
  ritardo non è un contratto chiuso.

Chi resta fuori **non sparisce**: finisce in `fuoriTotale` con il motivo e
l'ultima data, in una sezione «Fuori dal totale» a bordo tratteggiato, e resta
riclassificabile. Un fornitore con **un documento solo** ci finisce anche lui:
un documento non stabilisce un ritmo, e indovinarlo è pericoloso in entrambe
le direzioni — un premio annuo da €12.000 letto come mensile gonfierebbe
l'obiettivo di dodici volte. Se il costo esiste davvero, va dichiarato a mano
con la sua cadenza, ed è per questo che la scheda lo dice riga per riga.

Una voce dichiarata **non** rimpiazza un fornitore già fuori dal totale:
`sostituisceFic` resta `null`, perché non c'era nessuna cifra da sottrarre.

**Periodo base unico.** `periodoBase()` restituisce gli ultimi dodici mesi
**chiusi** — il mese in corso resta fuori, perché è mezzo mese di documenti e
mediarlo abbassa il costo fisso proprio nei giorni in cui lo si guarda. Lo
usano sia il registro sia il pareggio: due finestre diverse davano due totali
diversi per la stessa azienda. `ficCosti.fissiPerFornitore` è stato rimosso
per lo stesso motivo — era una seconda aritmetica sullo stesso numero.

`calcolaBreakEven` non legge più i documenti per conto suo: riceve
`costiFissiMensili` già sommato, più le due quote (`costiFissiFicMensili`,
`costiFissiDichiaratiMensili`) che servono solo a spiegare il totale nel
pannello.

**Il totale resta provvisorio finché ci sono dubbi.** La scheda dichiara
quanti documenti del periodo non sono ancora classificati e per quanto: un
costo fisso calcolato mentre 265 documenti sono in sospeso può solo salire, e
tacerlo faceva sembrare definitiva una cifra che non lo era.

**Le voci manuali restano il modo di dichiarare ciò che FiC non conosce** e
non sono un ripiego: stipendi, contributi e tasse non passeranno mai da
Fatture in Cloud. Ogni voce ha importo, cadenza (mensile → annuale), validità
`dal`/`al`, categoria e fornitore facoltativo — quest'ultimo è ciò che
innesca la regola di precedenza.

**L'esclusione parte sempre dal nome come FiC lo scrive** (corretto il
28/08/2026). `fornitoriNonFissi` prendeva `regola.fornitoreNormalizzato` —
già passato per `normalizzaRegola`, che trasforma i punti in spazi — e gli
riapplicava la chiave larga, che sa togliere `srl` attaccato ma non `s r l`
spaziato. «ALD Automotive Italia S.r.l.» dava `ald automotive italia` dal
candidato e `ald automotive italia s r l` dalla regola: chiavi diverse,
esclusione che non aggancia, candidato classificato che **resta in coda**. Il
difetto toccava quasi tutti i fornitori veri, perché le ragioni sociali si
scrivono col punto; il test precedente usava «SRL» attaccato e non lo vedeva.
Ora l'insieme si costruisce dai costi, usando il nome grezzo su entrambi i
lati, e il test usa una forma puntata.

**Senza costi fissi non c'è un minimo da fatturare.** Con `daCoprireMensile` a
zero il pannello restituiva `stato: "disponibile"` e obiettivo zero, cioè
«obiettivo raggiunto» a chi non ha classificato un solo acquisto. Ora è
`dati_insufficienti` con il motivo che rimanda ad Acquisti e al registro.

La scheda **non usa tabelle**, e non è una preferenza estetica: la coda dei
candidati aveva cinque colonne con tre bottoni nell'ultima, misurati 1172px
contro i 1134px disponibili a 1440 con la sidebar. Il bottone «Straordinario»
finiva 21px oltre il bordo dello scroll orizzontale, e a 390px la parte
tagliata era di 816px — la coda si vedeva ma non si poteva smaltire, che è
esattamente il difetto segnalato. Ora sono righe flex che vanno a capo:
importo a destra, azioni su una riga propria, verificate a 1440x900 e 390x844
senza scroll orizzontale globale e con tutti i target ≥44px.

**La tolleranza della ricorrenza resta stretta di proposito** (rimisurata il
27/08/2026 sui dati reali, per non riaprire la questione ogni sei mesi):

| tolleranza | gruppi | €/mese | cosa entra |
|---|---|---|---|
| €0,50 (attuale) | 26 | 9.192 | solo documenti già `fisso` |
| 2% | 27 | 9.556 | + ALIAS (materiale di commessa) |
| 5% | 32 | 12.396 | + WND ×2 (materiale) |
| 10% | 40 | 19.487 | + SIMEONE, WND ×4 |

Allargarla fa entrare i fornitori di serramenti fra i costi fissi, e un costo
variabile contato come fisso sballa **sia** il pareggio **sia** il margine di
contribuzione — cioè entrambi i termini della divisione.

Togliere un fornitore richiede una sola azione, `ficCosti.spostaFornitore`, che
sposta **tutti** i suoi documenti (non solo i `dubbio`, come
`riclassificaFornitore`: SCIACCA ne aveva 11, TIM 72) e aggiorna la regola per
**ogni forma scritta** del nome presente nel gruppo — il raggruppamento usa la
chiave larga, le regole la forma scritta, e lasciarne una indietro faceva
rientrare i documenti nuovi.

**Acquisti è un registro, non una coda (28/08/2026).** Entrambe le viste
interrogavano solo i documenti `dubbio`. Classificare era quindi l'unico modo
di far sparire un acquisto dalla pagina: finito il lavoro **gli acquisti
sparivano tutti** e non restava un posto dove vederli — la segnalazione «gli
acquisti sono spariti» descriveva esattamente questo. Un registro non può
svuotarsi perché è in ordine.

Ora il perimetro è l'anno intero e la coda è uno dei filtri: `Da classificare`
(preselezionato, perché resta il lavoro da fare), `Fissi`, `Di commessa`,
`Straordinari`, `Tutti`, ognuno col proprio conteggio e col totale del filtro
attivo accanto. `ficCosti.daClassificarePerFornitore` è diventato
`ficCosti.perFornitore`, con `classificazione` opzionale.

Le due viste servono a due lavori diversi:

- **Per fornitore**: una riga per fornitore con documenti, totale, periodo e
  natura prevalente; i tre bottoni chiudono l'intero gruppo. Il raggruppamento
  e la selezione usano la stessa chiave larga di `costiRicorrenti`
  (`chiaveFornitore`, che ignora SRL/S.r.l.), così un bottone «×9» ne tocca
  davvero nove. Il bottone chiama `spostaFornitore` e non
  `riclassificaFornitore`: il secondo tocca solo i `dubbio`, e su un fornitore
  già classificato non faceva niente pur dichiarando ×N;
- **Documento per documento**: selezione multipla e
  `ficCosti.riclassificaMolti` per i casi sparsi — 82 fornitori con un solo
  documento non sono un gruppo, ma insieme si chiudono in un gesto;
- nessuna vista o azione associa gli acquisti alle commesse.

`ficCosti.arretrati` conta il sospeso di **ogni** anno; il badge della
linguetta e una barra dentro il tab portano all'anno arretrato con un click, e
il selettore dell'anno elenca tutti gli anni che hanno dati.

`CostoFic.commessaId` resta solo come campo legacy. Nessuna API o UI lo scrive,
e il margine della commessa legge esclusivamente il registro manuale della
commessa e la posa. Gli acquisti sono classificati `Variabile`, `Straordinario`
o proposti come fissi aziendali, senza attribuzione a un lavoro.

Ogni fattura emessa FiC non ignorata e non già collegata crea una commessa
propria. Dal 28/08/2026 l'azione ha un bottone suo,
`ficFatture.creaCommesseMancanti` («Crea le N commesse mancanti» nella scheda
Fatture): prima esisteva solo dentro `riconciliaOra`, il cui bottone si
mostrava **soltanto** se c'era almeno un collegamento automatico da fare —
quindi le fatture senza nemmeno un candidato non ottenevano mai una commessa.
Sta su un bottone separato e non dentro il riallineamento perché è l'unica
delle due azioni che scrive record nuovi. Il cliente viene riusato per P.IVA/CF o intestazione esatta; se manca
viene creato. `ficSourceRef = fic:<sedeId>:<fatturaId>` impedisce duplicati ai
sync successivi. Il codice commessa scritto esplicitamente in fattura continua
a prevalere; note di credito e identità ambigue non creano commesse.

**Il prospetto CRM è dell'anno, non all-time (28/08/2026).** `riepilogoCrm` è
diventato `riepilogoCommesse(sedeId, anno)` e cambia in due punti, entrambi
necessari per mettere questi numeri accanto a quelli FiC senza mentire: è
filtrato sull'anno (prima sommava tutte le commesse attive e il totale finiva
a fianco di un fatturato annuale — due perimetri diversi presentati come
confrontabili) e **include le archiviate** (una commessa chiusa a marzo è
lavoro dell'anno come una ancora aperta, e toglierla faceva calare il pattuito
mentre l'anno andava avanti).

Il pattuito è diviso per provenienza, perché è la differenza che la direzione
cerca: `pattuitoDaFattura` è la stessa cifra che sta in FiC, `pattuitoSoloCrm`
è il di più che solo il CRM conosce — lavoro concordato e non ancora
fatturato. La banda chiude dichiarando le unità: pattuito CRM **lordo**,
fatturato FiC **imponibile**; accostarli senza dirlo sembra uno scostamento da
spiegare.

L'anno di una commessa lo decide il server, `server/_core/annoCommessa.ts`:
data di apertura, poi il codice `COM-AAAA-`, poi `createdAt`. La pagina
Pagamenti se lo calcolava da sola con la stessa euristica scritta due volte, e
due copie divergono; ora `commesse.list` espone `anno`.

Le bande di composizione separano quattro perimetri: controllo incassi annuale,
Vendite FiC, Acquisti FiC e commesse CRM dell'anno. Il confronto annuale usa
`pagamenti[].data` nel CRM e `rate[].dataPagamento` in FiC, include anche le
commesse oggi archiviate e mostra `CRM - FiC`; i movimenti senza data restano
fuori dal periodo e sono esposti come anomalia, senza inventare un mese. Le
viste mensili `Competenza` e `Cassa` impediscono di confrontare data documento
e data pagamento come se fossero la stessa grandezza. In assenza di un mirror
FiC il confronto non mostra più `0 = 0` come allineamento: espone `Dati FiC
assenti` e invita a collegare o sincronizzare l'integrazione. Gli importi senza
data sono rilevati dai conteggi, quindi note di credito e fatture non possono
compensarsi nascondendo l'anomalia; la tolleranza di arrotondamento è fissa a
50 centesimi.

**«Incassi da registrare» era due cose** (28/08/2026). `da_riconciliare`
copriva sia «FiC dice pagato ma il CRM non ha l'acconto» sia «il cliente non
ha ancora pagato». La prima è lavoro — la commessa risulta a residuo pieno su
soldi già incassati, e Pagamenti mente; la seconda è il corso normale di una
fattura. Sotto la stessa etichetta la coda restava gonfia di righe su cui non
c'era niente da fare, e il badge di Economia insieme alla voce «Riconcilia»
della Dashboard restavano accesi per sempre.

Ora `statoFattura` distingue `attesa_incasso` (collegata, nessuna rata `paid`
in FiC) da `da_riconciliare` (almeno una rata `paid` senza acconto
corrispondente in commessa). L'ordine di valutazione è: `ignorata` →
`non_abbinabile` → `riconciliata` → `attesa_incasso` → `da_riconciliare`.
Il filtro è diventato due chip, e badge e Dashboard contano solo
`non_abbinabile` + `da_riconciliare`.

Fatturato e costi canonici sono imponibili al netto delle rispettive note di
credito; IVA, lordo, rate pagate e rate aperte sono valori distinti. La vecchia
azione `Ignora` è presentata come `Escludi dalla riconciliazione`: il documento
resta nei totali FiC e nel break-even, ma non compare nella coda operativa.
Il pannello del minimo da fatturare sta sia in `/pagamenti` sia in cima ad
`Andamento`: «come sta andando» senza la soglia sotto cui si perde è una
classifica senza linea del traguardo. Vale solo per l'anno corrente. I costi
`dubbio` restano esclusi da fissi e variabili, e il pannello dichiara quanti
sono.

**Il fatturato mostrato era di un altro mese** (28/08/2026). `economia.breakEven`
riceve `anno` e `mese` ma passava a `calcolaBreakEven` soltanto
`periodoDa`/`periodoA`. Senza `anno`/`mese`, `meseRiferimento` ripiegava sulla
**fine del periodo base** — cioè l'ultimo mese CHIUSO — mentre l'intestazione
del pannello usava l'orologio del browser. Ad agosto si leggeva «Agosto» in
testa e il fatturato di luglio sotto: la segnalazione «su già fatturato netto
non coincide con il vero fatturato netto di FiC» era esatta. Ora il mese viene
passato, e la risposta espone `meseFatturato`: il pannello etichetta la cifra
con **quel** mese, non con la data di oggi.

**La catena è una somma, non una divisione** (28/08/2026). Il pannello
scriveva «€18.337 ÷ 34% = €54.198», ma il 34% è arrotondato: chi rifaceva la
divisione sulla calcolatrice trovava €53.932 e smetteva di fidarsi
dell'intero pannello. Una divisione con la percentuale arrotondata non può
riprodurre il risultato esatto, quindi la catena è diventata additiva —
«per coprire €18.337 devi fatturare €54.198: €35.861 escono subito come
materiale e posa, il resto copre i costi fissi» — e i tre importi tornano
sempre, perché variabili + fissi = obiettivo per costruzione.

Sotto, in euro, da dove esce la percentuale: fatturato base meno acquisti di
commessa sui mesi coperti. Era l'unico numero della catena da prendere per
buono, ed è quello che sposta di più l'obiettivo. Se restano documenti
`dubbio` il pannello dichiara quanti e per quanto, e in che direzione
sbaglia: fuori dal conto dei variabili il margine risulta più alto del vero,
quindi l'obiettivo mostrato è più basso del vero.

**Il numero grande è la risposta, non la domanda** (28/08/2026). Il pannello
mostrava `daCoprireMensile` — il totale dei costi fissi — con sotto scritto
«da fatturare», e la riga di sintesi diceva «Fatturato da fare per coprire i
costi fissi = €18.337»: due grandezze diverse sotto la stessa etichetta.
Fatturare l'equivalente dei costi fissi non li paga, perché il 66% di ogni
euro esce subito come materiale e posa. Ora in evidenza c'è
`obiettivoMensile` (costi ÷ margine), con sotto quanto copre, e la voce
«Come viene calcolato» spiega le tre grandezze una per una.

**La catena è esplicita dal 27/08/2026.** Il pannello mostrava solo
l'obiettivo e, in piccolo, il margine usato: sembrava che dentro ci fosse un
utile deciso da qualcuno. Ora scrive la divisione per esteso — «€9.090 di costi
fissi ÷ 34% di margine = €26.868 da fatturare. Nessun utile dentro» — e
`daCoprireMensile` espone il costo di esistere anche quando l'obiettivo non è
calcolabile, dove prima la pagina restava muta.

Due leve, in `impostazioni_pareggio` (per sede, non per utente: due persone
davanti allo stesso obiettivo devono leggere lo stesso numero):

- **`margineManuale`** — il margine di contribuzione esce dagli ultimi dodici
  mesi, ma in quel periodo 265 costi erano ancora da classificare: una
  percentuale precisa su dati incompleti resta sbagliata. Vuoto = calcolato;
  un valore fuori da (0, 1] viene ignorato invece di produrre un obiettivo
  infinito. `margineCalcolato` resta sempre nella risposta;
- **`includiStraordinari`** — sui dati veri gli straordinari sono €110.963 in
  dodici mesi, **più dei costi fissi**, e non entravano né fra i fissi né fra
  i variabili: sparivano dal pareggio. Il pannello dichiara sempre quanto
  resta fuori; contarli porta l'obiettivo da €26.868 a €54.198. Se siano una
  tantum o struttura sotto un altro nome lo decide chi conosce l'azienda.

Dal 28/08/2026 nessun modello classifica i costi FiC: un documento nuovo entra
`dubbio` e si classifica in Acquisti. Le regole per fornitore confermate da un
operatore si applicano deterministicamente anche durante il sync; una
classificazione manuale non viene mai sovrascritta.

**WhatsApp: rinominare e collegare a mano** (28/08/2026). Due cose che
mancavano nella scheda `/messaggi/whatsapp`.

*Rinominare* esisteva ma era vietato su una conversazione già collegata a un
cliente, perché il nome veniva dal CRM. Era il contrario del bisogno: il
profilo WhatsApp dice «Mario», il CRM dice «Rossi Mario», e in elenco si vuole
leggere «Rossi — cantiere Via Verdi». La precedenza è ora
`alias → cliente CRM → profilo WhatsApp → numero`, il divieto è caduto e la
matita si vede sempre. Il nome del cliente resta scritto nel pannello
Contesto, quindi non si perde niente.

*Collegare* non esisteva affatto: `clienteId`/`commessaId` arrivavano solo dal
match automatico sui singoli messaggi, e quando quello sbagliava o non trovava
— un numero nuovo, il cliente che scrive dal telefono della moglie, una
commessa il cui codice non compare mai nei messaggi — la conversazione restava
senza contesto per sempre: niente appuntamenti, niente ticket. Ora
`mail.whatsapp.collegaConversazione` fa le due cose che servono insieme:

1. scrive un **override** nello store `whatsapp_conversation_aliases` (che da
   nome-soltanto è diventato nome + `clienteId` + `commessaId`, con i record
   vecchi leggibili e i campi nuovi a `null`). Vale anche per i messaggi che
   devono ancora arrivare: `registraMessaggio` lo consulta PRIMA del matcher,
   perché riscrivere solo lo storico aggancia il passato e alla prima risposta
   del cliente la conversazione tornava scollegata;
2. riscrive le righe `comunicazioni` già esistenti, perché Inbox e il resto
   del CRM leggono da lì — senza, la scheda WhatsApp avrebbe detto una cosa e
   il resto del CRM un'altra.

Collegare una commessa detta anche il cliente, preso dalla commessa: due
verità sulla stessa conversazione non servono a nessuno. Scollegare il cliente
scollega anche la commessa. Cliente e commessa di un'altra sede danno
`NOT_FOUND`, mai un errore che ne confermi l'esistenza. Il pannello Contesto
dichiara con un badge se il collegamento è «a mano» o «automatico»: il matcher
può sbagliare, una persona no, e chi legge deve sapere quale dei due sta
guardando.

**Azione produzione obbligatoria dopo il deploy:** ogni sede deve premere
`Ricollega e aggiorna permessi` in Integrazioni, completare OAuth e poi
`Sincronizza ora`. I token esistenti non acquisiscono automaticamente i nuovi
scope. Prima di considerare affidabile il pareggio, confrontare due mesi chiusi
e revisionare tutti i costi dubbi.

Il collegamento esplicito scarica il PDF ufficiale e lo archivia come
documento `fattura` della commessa **dopo** aver persistito il collegamento. Ogni sync ripara i collegamenti storici rimasti senza file:
controlla soltanto fatture con `commessaId`, deduplica per sorgente FiC,
continua sulle altre se un download fallisce e ritenta al giro successivo. Un
errore del PDF non annulla collegamento o riconciliazione economica e non crea
fallback base64; UI ed esito distinguono PDF archiviati e da ritentare. Per
forzare il recupero senza attendere il giro orario usare `Sincronizza ora` in
Integrazioni, oppure `Riallinea dalle fatture` quando basta rileggere i
documenti già scaricati.

## 6. Tars — stato corrente e registro storico

Il runtime Tars v2 è presente in `server/tars/`: orchestratore, profili
filtrati, strumenti L0-L3, memoria, briefing shadow e provider con governor.
La fonte corrente per capacità, limiti e lavoro residuo è
[`docs/tars/matrice-azioni-tars.md`](docs/tars/matrice-azioni-tars.md), con
la specifica in `docs/tars/architettura-tars-v2.md`. I comandi del modello
restano strumenti tipizzati: mai `force`, tRPC, SQL generico, provider fuori
governor o bypass di sede/capability/state machine.

### 6.1 Registro storico della rimozione del 28/08/2026

Il racconto seguente conserva la rimozione dell'agente precedente. Non è una
fotografia del presente e non autorizza a cancellare il runtime v2. Il resoconto
completo resta in [`docs/tars-rimosso-2026-08-28.md`](docs/tars-rimosso-2026-08-28.md).

**Il perimetro allora rimosso.** Via ~27.000 righe: loop, strumenti, prompt, proposte, chat,
Command Center `/tars`, smistamento, classificazione AI dei costi, planner,
contesto, ricerca, autonomia, evals, audit processi ed esperimenti.

**Cosa NON era l'agente**, pur vivendo in `server/tars/`, ed è stato spostato
in `server/comunicazioni/`: la tabella `comunicazioni`, IMAP, WhatsApp, le
caselle, il matcher deterministico cliente/commessa (**usato anche dalle
fatture FiC**) e le regole filtro. Cancellare la cartella avrebbe spento
Email, WhatsApp, Inbox e l'abbinamento fatture. La Conoscenza aziendale è
diventata `server/routers/conoscenza.ts`: è una scheda scritta da persone.

**Comportamenti spariti, di proposito:**

- le comunicazioni entrano col match deterministico e restano da lavorare:
  niente classificazione né collegamento automatico;
- le fatture FiC senza commessa non generano proposte: si collegano a mano o
  si crea la commessa col bottone «Crea le N commesse mancanti»;
- i costi FiC si classificano in Acquisti, non col modello;
- il Centro Azioni non ha più l'analisi automatica del caso;
- la diagnostica non espone più piani e workflow.

**I dati** sono stati esportati prima della rimozione in
`~/Downloads/tars-export-2026-08-28.json` (1.610 record) e poi cancellati da
`kv_store`. Le tabelle `tars_context_*` non esistevano in produzione: il
motore di contesto non era mai stato acceso.

**Cosa è rimasto in piedi apposta.** Le colonne `tars_*` su `comunicazioni`
(costano nulla, il prossimo agente probabilmente le rivuole) e le capability
`tars.*` in `authz/capabilities.ts`, perché `tars.manage_policy` governa i
permessi stessi: rinominarla vorrebbe dire migrare le regole salvate. Le altre
tre non compaiono più nella UI dei permessi.

## 7. Modifiche code-complete del 14/08/2026

> Registro storico per data. Le voci che citano Tars raccontano un sistema
> rimosso per intero il 28/08/2026 (§6): restano come cronaca di cosa è stato
> fatto e quando, non come comportamento corrente.

- Backup Drive corretto per file già migrati a `storageKey`.
- Probe storage, script di verifica e runbook Cloudflare R2.
- Bootstrap utenti senza password fisse; password nuove minimo 12 caratteri.
- OAuth FiC completo con refresh e fallback manuale.
- Tars con fascicolo compatto, profili tool e doppio livello di caching.
- Comunicazioni ridisegnata come inbox responsive con stato, anteprima,
  conteggi, filtri canale/casella e pannello lettura.
- Route-level code splitting e vendor chunking; runtime Manus/debug solo in
  sviluppo; Umami solo in produzione con URL validato.
- `.env.example` aggiornato senza valori sensibili.

Prima di pubblicare queste modifiche eseguire l'intera checklist di §10.

### Correzioni code-complete del 23/08/2026

- Parser storico WhatsApp allineato a `thread.id`, con test su outbound senza
  `to` e rifiuto delle conversazioni non determinabili.
- Ricollegamento WhatsApp allineato alla casella storica dello stesso numero,
  senza duplicare o separare le conversazioni gia presenti.
- Stato sync separato in richiesto, ultimo evento, progresso e completato;
  polling UI durante la consegna.
- Pulizia PostgreSQL una tantum degli outbound storici senza controparte.
- Gate di smistamento Tars osservabili per transizione, senza log ripetitivi.
- `cerca_comunicazioni` espone a Tars direzione, autore, controparte e campi
  `da`/`a`: gli outbound WhatsApp storici non possono più essere scambiati per
  parole del cliente durante la ricostruzione del contesto.
- PRD riallineato su worker periodici, riferimenti sezione, preventivatore
  Fivizzanese, `/economia`, `/conoscenza` e storico WhatsApp.

### Centro Azioni code-complete del 24/08/2026

- Motore deterministico dei segnali con deduplica per situazione e conservazione
  di tutte le evidenze correlate.
- Persistenza PostgreSQL sede-scoped, registro eventi e workflow
  `da_valutare`, `in_carico`, `rinviata`, `in_attesa`, `risolta`.
- Riconciliazione al boot e ogni minuto, con auto-risoluzione e riapertura solo
  quando cambia il fingerprint dei fatti rilevanti.
- Analisi Tars asincrona soltanto per casi nuovi o cambiati alti/critici, in
  lotti massimi da tre; errori del provider non nascondono il caso.
- Nuova vista `Oggi` con scope personale/sede, presa in carico, rinvio, attesa,
  chiusura e richiesta manuale di analisi Tars.
- Campanella compatta in modalità `active`; notifiche legacy preservate in
  `legacy` e `shadow` per un confronto produzione reversibile.

### Creazione cliente e commessa da Tars del 25/08/2026

- `proponi_nuovo_lead` accetta una richiesta esplicita in chat anche senza
  email o WhatsApp sorgente.
- Tars cerca prima anagrafiche e commesse, legge gli assegnatari e chiede solo
  i dati obbligatori mancanti; con un solo assegnatario evita domande inutili.
- La proposta non scrive dati. Dopo approvazione l'esecutore crea cliente e
  prima commessa in `preventivo` tramite le mutation applicative sede-scoped.
- I trigger automatici senza comunicazione restano bloccati; le proposte nate
  in chat usano nome, email e telefono nella chiave anti-duplicato.

### Allegati Email e WhatsApp operativi del 25/08/2026

- `proponi_archivia_allegato` riconosce un allegato operativo e propone tipo,
  nome canonico e commessa soltanto con un match univoco; contenuto e nome file
  restano dati esterni non fidati.
- L'approvazione rivalida comunicazione, canale, indice allegato, MIME, sede e
  commessa, poi legge i byte dalla casella IMAP o da Meta e crea un documento
  normale del fascicolo.
- `sourceRef = sedeId:comunicazioneId:allegatoIndex` e la chiave idempotente:
  retry e doppio click non duplicano il file.
- Il documento risultante usa lo storage standard ed e visibile, apribile e
  scaricabile dalla commessa come un upload manuale.
- Gli allegati WhatsApp in ingresso entrano nello smistamento automatico; Tars
  può proporne l'archiviazione solo con tipo e commessa verificati. Il percorso
  resta subordinato all'approvazione e non invia né modifica messaggi WhatsApp.
- Dalla chat si può chiedere “allega il file inviato dal numero/indirizzo …
  alla commessa …”: `cerca_comunicazioni` normalizza i numeri e restituisce
  categoria e indice reale di ogni allegato, `cerca_commesse` verifica il cliente
  e Tars classifica prima un WhatsApp ancora `da_classificare`, quindi
  chiede una scelta quando messaggio, file o commessa non sono univoci. Lo
  stesso percorso vale per Email.
- Per WhatsApp il server accetta solo messaggi in ingresso già classificati
  come lavoro. MIME e 10 MB vengono controllati prima del collegamento; media
  scaduto, storage non disponibile e retry non lasciano collegamenti parziali.
- Nel lettore Email il corpo precede allegati, proposte e istruzioni Tars; la
  lista mostra anteprima su due righe e badge testuali leggibili.

### Promemoria personali Tars del 26/08/2026

- In chat una richiesta che contiene già data e ora complete crea direttamente
  una sola proposta `promemoria`: la sua approvazione è l'unica conferma. Se
  manca la data o l'ora, Tars chiede soltanto il dato temporale mancante e poi
  crea la stessa proposta, senza una domanda preliminare di conferma.
- Il richiedente viene preso dalla sessione e non può essere scelto dal modello
  o da un altro utente. Il record effettivo nasce solo con l'approvazione dello
  stesso richiedente; risposta, approvazione e rifiuto di un altro utente
  restituiscono `NOT_FOUND`.
- PostgreSQL usa `promemoria` e `promemoria_eventi`, entrambe sede-scoped. Il
  worker esegue un giro subito al bootstrap e poi ogni 15 secondi, con claim
  concorrente, retry idempotente e proiezione nella notifica canonica.
- Nel CRM aperto il popup globale mostra una scadenza per volta e permette
  **Fatto**, **Posticipa** (15 minuti, un'ora, domani alle 9 o data libera),
  **Apri commessa** e chiusura. La chiusura nasconde solo il popup; la notifica
  resta nella campanella finché il promemoria non viene completato o rinviato.
- SSE invalida subito la coda; resta un polling di fallback ogni 15 secondi,
  sospeso quando la scheda è in background e aggiornato al focus. Cambio sede
  e logout cancellano prima la cache personale.
- API personali: `promemoria.due`, `dismissPopup`, `complete`, `snooze` e
  `cancel`. Gli id fuori sede o appartenenti a un altro utente non vengono
  rivelati. Fuso unico `Europe/Rome`, inclusi i controlli sui cambi ora legale.
- Limite attuale: nessun Web Push, email o avviso a CRM chiuso; la consegna
  visibile è garantita quando il CRM è aperto o torna in primo piano.

### Rollout piattaforma Tars del 25/08/2026

- Eventi, notifiche persistenti, capability, contesto, piani e indice sono
  disponibili per collaudo progressivo per sede.
- `shadow` non crea notifiche né invia push. Le notifiche nuove hanno effetti
  soltanto con `notificationMode=active`.
- `contextEngineMode=active`, `plannerMode=active` e
  `semanticSearchMode=active` sono rifiutati dal server finché, rispettivamente,
  non sono completi tutti i producer dominio, gli executor di produzione e la
  pipeline embedding. Eventuali valori legacy `active` tornano a `shadow` al
  bootstrap.
- L'indice corrente offre fallback lessicale ACL-aware in collaudo; Tars usa i
  reader CRM autorizzati nel percorso operativo.
- Le proposte sono visibili solo a direzione/amministrazione, autore del run o
  responsabile dell'entità. Le deleghe vengono rivalidate sul ruolo corrente
  del delegante.
- Il lock approvazione corrente copre doppi click nello stesso processo; prima
  di un rollout multi-istanza va aggiunto il claim PostgreSQL indicato nel
  checklist `docs/reports/tars-brain-rollout-checklist.md`.

### Slice 1 — «La verità torna una sola» (28/08/2026, sera)

Riconciliazione documentale e blindatura della state machine dopo la
rimozione di Tars, autorizzata dalla direzione sul Discovery Dossier
(`docs/discovery-dossier-2026-08-28.md`). Nessun cambiamento di comportamento
runtime, con tre eccezioni deliberate di solo testo/etichetta:

- il motivo preliminare delle comunicazioni nuove non promette più «la
  classificazione automatica di Tars» (dice «Da classificare a mano»);
- i messaggi di sistema in chat sono firmati «Sistema» invece di «Tars»; i
  canali diretti creati prima conservano il vecchio nome nel DB finché non si
  decide una migrazione;
- il copy di `/conoscenza` descrive la scheda per quello che è oggi.

Fatto:

- **PRD v5.1**: §51 e §53 riscritti sul comportamento corrente; §40.4-40.5
  allineati (segnalazioni tipizzate al posto delle proposte, regole costi
  deterministiche); nuova sezione §54 con la visione del futuro agente,
  marcata NON IMPLEMENTATA; correzioni minori (IMAP 5 min, route legacy).
- **handoff**: §5 ripulito dai flussi Tars al presente; §7 marcato registro
  storico; checklist §10 allineata; questo registro.
- **AGENTS.md / CLAUDE.md**: sezione «Tars» sostituita da «Agente AI»
  (non esiste; residui protetti; infrastruttura candidata).
- **Pulizia**: rimossi `tars:eval`/`tars:eval:live` da package.json e gli
  script rotti `run-tars-evals.ts` e `rebuild-tars-context.ts` (importavano
  `server/tars/*`, e `scripts/` era fuori dal typecheck); rimossa la pagina
  orfana `ComponentShowcase.tsx` (zero riferimenti); rimossi i due annunci
  chat senza chiamanti che linkavano `/tars`. Tutto recuperabile da git.
- **tsconfig**: `scripts/` incluso nel typecheck; aggiunto `target: ES2022`
  (prima il default ES5 rifiutava i top-level await degli script legittimi).
- **Annotazioni di compatibilità** (nessuna rimozione, decisione D5):
  colonne e funzioni `tars*` in `comunicazioni.ts`, `ficFatture.tarsAnalizzata`,
  capability `tars.*`, e header «infrastruttura candidata» su `_core/llm.ts`,
  `voiceTranscription.ts`, `imageGeneration.ts` (zero consumatori: la
  decisione spetta al design del nuovo agente).
- **Runbook**: `tars-eventi-notifiche.md` → `eventi-notifiche.md`;
  `tars-recovery.md` riscritto come `piattaforma-recovery.md` sul boot reale;
  il report `tars-brain-rollout-checklist.md` marcato storico.
- **Test nuovi** (`commesse.test.ts`, `crossSede.test.ts`, +12): proprietà
  della state machine su tutte le 110 coppie di stati (force non salta la
  sequenza), cleanup di rollback (consegna confermata, data chiusura), doc
  gate con `statoAtUpload`, blocco del pattuito fonte FiC, immutabilità dei
  movimenti `origine=fic`, negativi cross-sede su commesse/clienti/ticket.
  Verificato che il test della state machine fallisca davvero su una
  transizione allargata ad arte (mutation test, poi ripristinato).

Limiti documentati (non risolti qui, tracciati nel PRD §31 e nel dossier):
`platform.flags` è di sola lettura (flag congelati); WhatsApp non ha un
percorso di archiviazione allegati; `commesse.correggiPagamento` non ha UI.

Verifica: `pnpm check` (con `scripts/`), `pnpm test` 61 file / 501 test,
`pnpm build` — tutti verdi in locale.

### Slice 2 — dati economici dietro capability (28/08/2026, notte) — COMPLETATA

Chiude R4 e R5 del dossier secondo la matrice confermata dalla direzione
(`docs/reports/slice-2-authz-economia-proposta.md`, ora marcata
implementata). Contratto completo nel PRD §37.5. In sintesi:

- `commesse.byId`, `list`, `byPriorita` e le risposte di ogni mutation sono
  **sagomate**: registro `pagamenti[]` solo con `pagamento.read`, `costi[]` e
  `costoPosaStimato` solo con `economia.read`; campi omessi, mai errori. La
  sintesi della scheda (pattuito, incassato, residuo, piano rate,
  `nPagamenti`) resta per chi lavora la commessa. Liste e Board trasportano
  il solo booleano `daSaldare`.
- `addPagamento`/`updatePagamento`/`removePagamento`/`correggiPagamento` e
  `pagamentiRecenti` passano da `authorizeCoreOperation` con il nuovo regime
  `legacyAllowed: "capability"`: la decisione del motore (ruoli + override
  individuali) vale in OGNI `policyMode`, quindi un override su
  `pagamento.record` (creato da `permessi.updateOverride`, motivato e
  auditato) abilita il singolo utente anche oggi in `legacy`. Il ruolo
  commerciale NON riceve la capability.
- `/pagamenti` è riservata a `pagamento.read` (guardia pagina + voce sidebar
  via la nuova query `permessi.mie`); il chip «Da saldare» del Board è
  binario senza cifra per chiunque; il feed Dashboard mostra l'importo solo
  agli autorizzati.
- **Superfici condivise bonificate** (stessa classe di R4): il caso saldo del
  Centro Azioni e la notifica legacy dicono «Saldo residuo da incassare»
  senza cifre; id e fingerprint usano `versioneRegistroPagamenti`
  (conteggio+timestamp) così l'incasso parziale ri-notifica ma nessun importo
  è ricostruibile dal payload. Sweep sulle altre superfici (notifiche
  persistenti, chat, eventi, promemoria): nessun altro importo trovato.
- Test: `authzEconomia.test.ts`, 17 casi — shaping e leak-check sul
  serializzato, scritture negate/consentite, override con audit, deny che
  prevale sul ruolo, parità in `enforce`, cross-sede, superfici condivise
  (fingerprint che si risveglia a ogni incasso, notifica senza cifre che
  sparisce a saldo). Suite: 62 file / 518 test verdi; `pnpm check` e build ok.
- Verifica visiva su run demo: direzione con registro/comandi e /pagamenti
  completa; commerciale con sintesi senza registro, sidebar senza vista
  cassa, /pagamenti «Accesso riservato», Board binario, notifica saldo senza
  importo; controllo di rete della sessione non autorizzata: nessuna cifra
  nei payload, `pagamentiRecenti` 403.

Effetti visibili da comunicare alle sedi: il Board non mostra più l'importo
del saldo (la cifra sta in scheda e in /pagamenti); i ruoli operativi non
vedono più registro e costi via API; chi registrava acconti senza essere
amministrazione va censito e abilitato con un override individuale. Le
notifiche saldo esistenti cambiano id al primo ricalcolo (una ri-notifica una
tantum).

### D7 Document Intelligence — slice 1 (28/08/2026, notte) — code-complete, in revisione

Prima vertical slice della Document Intelligence decisa con D7 (PRD §54.6;
ricognizione, gap e piano in `docs/reports/d7-document-intelligence-piano.md`).
**Non ancora committata**: in attesa di revisione della direzione.

- `server/documenti/`: registro parser (`pdf-testo-nativo` su unpdf, testo
  PER PAGINA; scansioni, file corrotti e formati non supportati producono
  stati espliciti, mai errori muti), estrattore deterministico delle
  conferme d'ordine (riferimento ordine, codici commessa, fornitore, numero
  e data conferma, date/settimane di consegna, totale con letture
  alternative, riscontro righe per codice articolo — ogni valore con
  evidenza: pagina, frammento, metodo, confidenza), confronto con l'ordine
  fornitore (differenze tipizzate per gravità) e run persistiti in
  `documenti_analisi` (impronta SHA-256 dei byte + versioni parser/
  estrattore/confronto: idempotente, `forza` rielabora conservando lo
  storico).
- Router `analisiDocumenti` (direzione): `analizzaConferma` e `perOrdine`.
  Nessuna scrittura su commesse, ordini, date o importi: la slice produce
  solo letture verificabili — le azioni proposte con approval gateway sono
  la slice 3 del piano. I byte restano nelle fonti esistenti (storage/
  inline): nessuna seconda fonte di verità, nessuna migrazione.
- UI: pannello «Conferma d'ordine (PDF)» nella scheda ordine di
  `/fornitori` — scelta del PDF dal fascicolo della commessa dell'ordine,
  campi con evidenze citate, differenze con badge di gravità, rianalisi
  esplicita.
- Sicurezza: contenuti trattati come non fidati (nessun modello, testo
  inerte; un prompt injection nel PDF resta un frammento di evidenza),
  limiti di dimensione, cifrato/corrotto → `illeggibile` col motivo.
- Test (`server/documenti/analisiConferma.test.ts`, 6 scenari con PDF
  generati in-test): digitale multi-pagina con variazioni di consegna/
  totale/quantità e riga mancante; scansione senza testo; corrotto; formato
  non supportato; duplicato idempotente + `forza`; commessa incoerente vs
  doppia citazione; injection inerte con verifica «nessuna modifica
  critica»; authz (solo direzione, cross-sede NOT_FOUND, fascicolo
  coerente). Verifica visiva sul run demo: analisi dal pannello, campi ed
  evidenze a video, differenze ALTA/MEDIA, risultato persistito dopo il
  reload, console pulita.
- Limiti dichiarati della slice: **solo i PDF con testo nativo vengono
  analizzati**. Le scansioni vengono riconosciute e fermate con lo stato
  esplicito `scansione_senza_testo`: senza OCR il loro contenuto NON viene
  compreso, e la UI non le presenta mai come analisi riuscite (campi e
  confronto compaiono solo con stato `analizzata`). Righe best-effort a
  confidenza bassa.

**Slice 2 — collegamento assistito documento→ordine (28/08/2026, stessa
notte)**, contratto completo nel PRD §19.4:

- candidati deterministici su tutti gli ordini della sede con punteggio
  spiegabile (codice ordine 100 > commessa 60 > fornitore 40 > articoli
  15×3 > data 15 > totale 15), ogni segnale con evidenza pagina/frammento;
  stati espliciti certa/candidata/ambigua/assente e MAI un collegamento
  automatico — anche «certa» aspetta la conferma umana;
- store `documenti_collegamenti_ordini`: collegamento come dato separato
  (documento, ordine e commessa restano intatti), idempotente, con audit
  append-only di conferma/rifiuto/annullamento e rilevazione dei duplicati
  per impronta SHA-256; correzione = annulla + riconferma; un rifiuto toglie
  il candidato dal calcolo dello stato finché non viene riconfermato;
- authz via capability `commessa.manage_documents` col motore in ogni
  policyMode (direzione da ruolo, altri su commesse possedute/assegnate,
  override inclusi): nessun `requireDirezione` nuovo; sedi isolate;
- il documento collegato diventa analizzabile dall'ordine anche da un altro
  fascicolo (la decisione umana prevale sulla posizione del file);
- UI: azione «Collega a un ordine fornitore» sui PDF di «File e documenti»
  nella scheda commessa, dialog con candidati/punteggi/motivazioni/evidenze,
  rifiuto e annullamento con motivo;
- test: `server/documenti/collegamentoOrdine.test.ts`, 12 scenari (esatto,
  mancante, ambiguo, fornitore errato, commessa incoerente, omonimi
  cross-sede, duplicato, flusso completo con audit, cross-sede, capability
  senza ruoli, nessuna modifica ai dati autorevoli, ponte con l'analisi
  slice 1) + mutation test sul filtro di sede. Verifica funzionale sul demo:
  dialog con «Corrispondenza certa, punteggio 215» spiegato segnale per
  segnale, conferma e stato collegato, zero errori applicativi in console.

**Slice 3 — approval gateway delle proposte (29/08/2026)**, contratto nel
PRD §19.4:

- `server/proposte/gateway.ts`: fondazione GENERALE e tipizzata, separata
  dai router business (è la stessa su cui poggerà il futuro agente).
  Registro chiuso dei tipi di azione — oggi solo
  `ordine_fornitore.aggiorna_data_consegna` — store kv `proposte_azioni`,
  stati `proposta → approvata → applicata|fallita` più
  rifiutata/annullata/scaduta (30 giorni)/obsoleta, chiave d'idempotenza,
  cronologia append-only. La freschezza (valore corrente ≡ snapshot) è
  ricontrollata a ogni lettura e PRIMA di approvare/applicare;
- l'azione registrata (`azioni/ordineDataConsegna.ts`) applica SOLO la
  data di consegna prevista via `aggiornaDataConsegnaOrdine` di
  fornitori.ts (l'unico comando che la scrive dopo la creazione). La
  generazione (`generazione.ts`) parte dal run di analisi della slice 1 e
  fotografa evidenza, valore corrente e versioni; autore sempre `sistema`;
- doppia capability per approvare/applicare: `documento.approve_proposals`
  + `fornitore.manage_ordini` (nuove nel registro chiuso; default:
  direzione e ruolo `ordini`, override individuali per gli altri, motore
  in ogni policyMode). Router `proposte.*` sottile: valida, autorizza,
  invoca comandi tipizzati; sedi isolate NOT_FOUND;
- il conflitto con la posa NON viene risolto: segnale
  `consegna_fornitore` nel Centro Azioni (da proposte APPLICATE con
  valore ancora corrente, posa `pianificato` precedente alla consegna),
  priorità alta o critica se la posa è entro 7 giorni, caso «Rivedi la
  pianificazione della posa» che si auto-risolve quando il conflitto
  sparisce. Su decisione della direzione: nessuna nuova entità anomalia,
  nessun ciclo di contestazione al fornitore;
- UI: pannello «Proposte dall'analisi» nella scheda ordine (stato,
  evidenza, motivazione, effetto esatto, applica in due passi con
  conferma) + pulsante «Proponi l'aggiornamento della data di consegna»
  nel pannello analisi; dopo l'applicazione la lista ordini si aggiorna;
- test: `server/proposte/gateway.test.ts` (11: macchina a stati pura,
  fallimento reale d'applicazione) e `server/routers/proposte.test.ts`
  (12: generazione con evidenza, doppio requisito, metà requisito
  respinto, override che abilitano un non-ordini, applicazione che tocca
  SOLO la data con snapshot prima/dopo di commessa e interventi, doppia
  applicazione idempotente, obsoleta, scaduta, cross-sede, audit, caso
  Centro Azioni che nasce e si spegne). Mutation test: rimosso il secondo
  requisito di capability → il test dedicato fallisce. Verifica sul demo:
  flusso completo genera→approva→applica dalla UI, toast del conflitto
  posa, caso reale nel Centro Azioni via scheduler, mobile 375px senza
  scroll orizzontale, zero errori console.

**Slice 4 — OCR locale Tesseract 5 (29/08/2026)**, contratto nel PRD
§19.4:

- `server/documenti/ocr.ts`: pdftoppm rende le pagine in PNG (Tesseract
  non legge i PDF), tesseract le riconosce in TSV (pagina + confidenza per
  parola); `execFile` con argomenti fissi, MAI shell; tmpdir isolata
  sempre ripulita (anche su errore/timeout); una pipeline alla volta;
  cache in memoria per impronta+firma (solo testo). Limiti: 15 MB, 20
  pagine, 300 DPI, 30 s/pagina, 120 s totali;
- lingue via `OCR_LINGUE` (default `ita+eng`, `deu` predisposto):
  intersezione richieste∩installate con avvertenza per le mancanti;
  binario mancante / lingua mancante / timeout / rendering fallito /
  nessun testo riconosciuto = esiti ESPLICITI, il documento resta
  `scansione_senza_testo` col motivo — mai fallback silenziosi, mai
  «analizzato» senza testo riconosciuto;
- fallback dichiarato nel registro parser (`estraiTestoDocumento`):
  nativo prima, OCR solo su `scansione_senza_testo`; successo →
  `estratto` con parser `pdf-ocr`, avvertenze e confidenze; sotto soglia
  (media<80 o pagina<60) il run è «DA VERIFICARE» (UI: «Analizzata con
  OCR — DA VERIFICARE») e le proposte generate portano l'avvertenza in
  motivazione. Il collegamento assistito (slice 2) beneficia dello stesso
  fallback;
- idempotenza: `ocrFirma` (versione|lingue effettive|DPI, o «assente»)
  entra nella chiave dei run per scansioni e run OCR, con backfill
  `onLoad`: le scansioni ferme si rianalizzano quando l'OCR compare o
  cambia configurazione, senza perdere storico;
- deploy: `nixpacks.toml` + aptPkgs (tesseract-ocr, ita/eng/deu,
  poppler-utils), impatto immagine ~60-80 MB. In locale: `brew install
  tesseract poppler` (solo eng di default: l'italiano locale richiede
  `tesseract-lang`; in produzione apt installa ita+deu);
- test: `server/documenti/ocr.test.ts`, 10 scenari — binario mancante,
  troppe pagine, lingue effettive, soglie di revisione, firma «assente»,
  e con i binari reali (skip automatico se assenti): scansione vera
  riconosciuta via OCR con evidenze, lingua inesistente, timeout con
  pulizia tmpdir verificata, cache, scala completa dell'idempotenza
  (assente → disponibile → riuso).

**Slice 5 — framework di valutazione (29/08/2026)**, contratto nel PRD
§19.4:

- `server/documenti/eval/`: 16 fixture costruite in codice — PDF nativi
  (riferimento esatto, inglese, multipagina, tabella spezzata, valori
  discordanti, ambiguità, codici ordine/articolo simili, injection,
  duplicato, corrotto) e scansioni VERE (pulita, storta 3°, 75 DPI,
  multipagina, timeout OCR) prodotte con testo→pdftoppm→immagine;
- runner (`pnpm eval:documenti`) sulla STESSA pipeline di produzione;
  metriche separate: correttezza/copertura per campo, precisione
  collegamento con contatore «certa sbagliata» (deve restare 0),
  precisione differenze, falsi positivi, confidenza OCR, ms/pagina, % da
  rivedere. Report baseline: `docs/reports/d7-eval-2026-08-29.md`
  (16/16, campi 100% corretti sugli estratti, copertura 93% con le
  lacune dichiarate, 0 certa sbagliate, OCR ~91% conf media, ~465
  ms/pagina con lingue locali solo eng);
- `eval.test.ts` (8) inchioda solo il deterministico: nativo perfetto,
  injection inerte, ambigua mai «certa», codice esatto batte il simile,
  corrotto illeggibile, timeout esplicito, metriche OCR riportate SENZA
  soglie. Nessuna accuratezza produttiva dichiarata dai sintetici;
- casi reali anonimizzati: cartella `server/documenti/eval/casi-reali/`
  in `.gitignore` (PDF + `atteso.json`, caricamento automatico del
  runner); procedura e quantità minime nel report baseline;
- primo dividendo dell'eval: scoperto il match dei riferimenti SENZA
  confini (ORD-EV-10 riconosciuto dentro ORD-EV-100 → ambiguità finta;
  FIN-100 dentro FIN-1000 → riga citata finta), corretto con lookaround
  in `trovaRiferimentoTesto` e nel riscontro righe.

**Release hardening (29/08/2026)** — kill switch e rollout:

- tre interruttori env indipendenti (`server/platform/interruttori.ts`),
  SPENTI di default in produzione, accesi in dev/test:
  `FLAG_DOCUMENT_INTELLIGENCE`, `FLAG_PROPOSTE`, `FLAG_OCR`. Guardia
  `assicuraInterruttore` su TUTTI gli endpoint `analisiDocumenti.*` e
  `proposte.*` (PRECONDITION_FAILED, nessun ruolo lo aggira — test in
  `server/platform/interruttori.test.ts`); l'OCR spento lascia le
  scansioni in `scansione_senza_testo` con motivo `FLAG_OCR` e firma
  `assente` (rianalizzabili all'accensione);
- UI: `platform.interruttori` (query protetta) + superfici nascoste a
  flag spento (pannelli analisi/proposte, azione Collega);
- rollout progressivo in tre fasi e rollback via flag:
  `docs/runbooks/rollout-document-intelligence.md`, con checklist
  post-deploy e nota sulla ri-notifica saldo una tantum (fingerprint
  cambiati dalla slice 2 authz).

**Chiusura PR #1 (29/08/2026 sera)** — checklist read-only, CI, immagine:

- `pnpm storage:check` NON scrive più: sola configurazione + GET su chiave
  `_health/` inesistente (prova endpoint e credenziali). La sonda completa
  put/get/checksum/delete è `pnpm storage:probe-write --scrivi`, separata,
  fuori dalla checklist read-only; `server/_core/checklistReadOnly.test.ts`
  blocca regressioni (allowlist dei comandi citati dal runbook, sorgente
  dello script senza sonda di scrittura, prova comportamentale che la
  sonda read-only non chiama mai put/delete);
- prima CI GitHub in `.github/workflows/ci.yml`: job bloccante
  (install frozen, typecheck, test mirati DI/kill switch, suite completa,
  build, binari e lingue OCR verificati sul runner, working tree pulito) +
  job eval NON bloccante con report come artifact;
- immagine Nixpacks confrontata con la baseline di `main` costruita in
  locale: contenuto compresso 547 MB (main) → 771 MB (branch), ma l'unico
  layer di PRODUZIONE aggiunto è l'apt OCR da **163 MB unpacked (~+7%)**;
  il resto del delta locale è il layer COPY che in locale include
  `node_modules` (nixpacks non onora `.dockerignore`; su Railway il
  contesto è il checkout git ≈ 9 MB, come su main). Nessuna dipendenza
  npm nuova; devDependencies presenti in ENTRAMBE le immagini (status quo
  di main; prune possibile come ottimizzazione futura). Build locali:
  fredda ~15-20 min (VM), calda ~7 min; baseline calda 42 s con layer
  condivisi.

**Revisione indipendente (29/08/2026)** — quattro revisori sull'intero
diff `origin/main..slice-3-document-intelligence`; tutti i rilievi
Critical/Important corretti, più i minori a basso costo (dettaglio nel
changelog PRD v5.10). I più rilevanti: oracolo del totale chiuso
(segnale solo con `economia.read`), kill switch fail-closed e in base
procedure, `proposte.genera` con coerenza viva documento↔ordine,
confini su TUTTE le ricerche di riferimento, idempotenza dei run legata
anche al contenuto dell'ordine (storico max 10 run/coppia), motivo
per-proposta nella UI. Scelte consapevoli non cambiate: fingerprint
saldo (privacy slice 2), niente quattro-occhi oltre la doppia
capability, dedup `parseEuro`→`shared/` lasciato come candidato.

## 7-bis. Chat aziendale (26/08/2026)

Route `/chat`, voce di menu sotto **Messaggi**. È la comunicazione *interna*:
niente a che vedere con Email e WhatsApp, che parlano coi clienti.

Persistenza in tabelle PostgreSQL dedicate (`chat_canali`, `chat_messaggi`,
`chat_letture`), non in `kv_store`: una chat cresce a ogni messaggio e
riscrivere un blob JSONB ogni volta è la malattia già curata per le
comunicazioni. Senza `DATABASE_URL` degrada a un array in memoria con la
stessa API.

Tre tipi di canale:

- `generale` — uno per sede, non si lascia. Nato come registro leggibile delle
  azioni dell'agente; con Tars rimosso resta il canale di sede;
- `diretto` — fra due persone. La chiave è la coppia ordinata di id, quindi
  A→B e B→A sono la stessa conversazione. L'id 0 resta riservato al mittente
  di sistema: le assegnazioni arrivano lì;
- `commessa` — previsto nel modello, non ancora esposto in UI.

Le assegnazioni passano da `chat-assignment-v1`, consumer **separato** dal
proiettore delle notifiche: la campanella è dietro `notificationMode`, il
messaggio in chat deve arrivare comunque. Assegnarsi qualcosa da soli non
produce messaggio.

I messaggi di sistema hanno `autore_id IS NULL` e il client non può scriverli:
`autoreId` viene sempre dalla sessione.

Limiti attuali: refresh a polling ogni 5 secondi mentre la pagina è aperta
(nessun canale SSE dedicato), nessun allegato, nessuna modifica o cancellazione
di un messaggio, nessuna notifica push. Le suite locali esercitano il fallback
in memoria: le query PostgreSQL restano da verificare su Railway.

## 8. Sicurezza e credenziali

Il seed storico con password in chiaro è stato rimosso dal codice corrente. Al
primo avvio con store utenti vuoto viene creato un solo amministratore usando
`BOOTSTRAP_ADMIN_*`; in produzione la password è obbligatoria, in sviluppo può
essere generata una password monouso casuale.

Controlli eseguiti:

- nessun PAT GitHub riconoscibile trovato nei file correnti o nella scansione
  mirata della cronologia;
- l'autenticazione locale di `gh` risulta revocata/non valida;
- vecchie password seed restano raggiungibili nella cronologia Git.

Azioni operative da completare:

1. Ruotare le credenziali degli utenti seed eventualmente ancora usate in
   produzione.
2. Rifare `gh auth login` sul computer dell'operatore e revocare dal portale
   GitHub i token non riconosciuti.
3. Valutare un purge history con `git filter-repo` solo con finestra concordata:
   riscrive gli SHA e richiede riallineamento di tutti i clone.

## 9. Interfaccia e build

- Le pagine sono caricate con `React.lazy`; aprire il CRM non scarica più tutte
  le route.
- I chunk condivisi sono separati in React, UI, dati e grafici.
- Il build di verifica del 14/08/2026 non emette warning di chunk sopra soglia.
- `index.html` di produzione è circa 1,2 KB; il vecchio runtime di debug non è
  più incorporato nel documento di produzione.
- Umami viene installato soltanto quando `import.meta.env.PROD` è vero e sono
  presenti endpoint e website id validi.

### Timeline ordine e Board

Dal 25/08/2026 il completamento delle milestone della timeline avanza la
commessa usando `commesse.update`, quindi applica gli stessi permessi, la stessa
state machine a passo singolo e lo stesso doc gate del Board. La mappa è
1→`misure_esecutive`, 2→`aggiornamento_contratto`, 3→`fatture_pagamento`,
5→`da_ordinare`, 6→`produzione`, 10→`ordini_ultimazione`, 11→`attesa_posa`,
15→`finiture_saldo`, 17→`interventi_regolazioni`, 18→`archiviata`.

Dal 26/08/2026 vale anche il verso opposto: `commesse.update` chiama
`allineaTimelineAlBoard`, che completa ogni milestone il cui stato di
riferimento è stato raggiunto o superato dalla board. È solo in avanti e
idempotente — arretrare la commessa non riapre gli step, perché quel lavoro è
stato fatto davvero e riaprirlo cancellerebbe date e autore. Un errore qui
viene loggato e non annulla l'avanzamento già salvato.

Se il doc gate blocca il passaggio, lo step non viene salvato come completato e
il client propone "Procedi comunque". Date, note, step intermedi e riaperture
non cambiano la colonna; una commessa già più avanti non viene mai arretrata.
Subito dopo `bootstrapAll`, `reconcileTimelineBoardStates` corregge anche gli
arretrati storici usando la milestone completata più avanzata. È idempotente,
solo forward e scrive lo store commesse soltanto quando trova differenze; il
log `[timeline] board riallineato` riporta analizzate e aggiornate.

## 10. Checklist prima del deploy

```bash
pnpm check
pnpm test
pnpm build
```

Poi verificare nel browser, desktop e mobile:

- login, cambio sede e permessi direzione;
- Clienti e Commesse senza prima riga coperta o scroll orizzontale pagina;
- Comunicazioni (Email): code e conteggi, selezione multipla,
  esclusione/ripristino, classificazione manuale e collegamento manuale
  confermato (dal 28/08/2026 non esistono proposte né creazione lead
  assistita);
- WhatsApp: conversazioni raggruppate, direzione in/out, diagnostica
  `smb_message_echoes` dopo un invio dall'app primaria, rinomina di una
  conversazione già collegata a un cliente e collegamento a mano di cliente e
  commessa dal pannello Contesto;
- Integrazioni: stato Drive, storage e FiC;
- Email: archiviare un allegato e riaprirlo/scaricarlo dal fascicolo
  commessa; verificare inoltre vista affiancata a 1440 px, modalità
  focus, vista singola sotto 1280 px e a 390 px, e assenza di scroll
  orizzontale;
- FiC: collegare una fattura, verificare il PDF nel fascicolo, eliminare solo il
  documento di test e lanciare `Sincronizza ora` per controllare il recupero
  idempotente e il conteggio PDF nell'esito;
- Costi fissi: classificare un fornitore come «Fisso» in Acquisti e vederlo
  comparire nel registro, con il totale mensile che sale;
- Economia: confrontare incassi CRM/FiC sullo stesso anno, verificare gli avvisi
  sui pagamenti senza data, alternare Competenza/Cassa e controllare che una
  fattura esclusa dalla riconciliazione resti nei totali;
- Centro Azioni in `shadow`: confrontare conteggi aggregati, priorità,
  dedupliche e assegnazioni; passare ad `active` solo dopo il controllo;
- Pattuito: aprire una commessa con fattura FiC collegata e verificare che il
  totale sia in sola lettura con badge `da FiC` e il piano rate popolato;
  aprirne una senza fattura e inserire pattuito e due rate a mano;
- Chat aziendale: inviare un messaggio nel generale e in una diretta,
  assegnare una commessa a un altro utente e verificare che gli arrivi il
  messaggio;
- Documenti: caricare un documento d'identità e verificare che conservi il
  nome originale, poi rinominarlo e cambiargli tipo dalla scheda;
- Timeline e board: spostare una commessa sul Kanban e verificare che le
  milestone corrispondenti risultino completate.

Per lo storage cloud aggiungere, nell'ambiente Railway già configurato:

```bash
pnpm storage:check
pnpm storage:dry-run
```

## 11. Documenti collegati

| File | Contenuto |
|---|---|
| `documento_requisiti_infissi_ops.md` | PRD funzionale aggiornato |
| `PRD_infissi_ops_v4.pdf` | versione PDF del PRD |
| `docs/discovery-dossier-2026-08-28.md` | ricognizione Fase 0 post-rimozione: baseline, invarianti, contraddizioni, rischi, roadmap e registro decisioni D1-D6 |
| `docs/source-of-truth-matrix.md` | matrice viva delle fonti autorevoli e delle regole di conflitto |
| `docs/reports/slice-2-authz-economia-proposta.md` | spec approvata (D3) per capability su dati economici e pagamenti — da implementare |
| `docs/runbooks/verifica-produzione-readonly.md` | checklist di sola lettura per fotografare Railway (D4) |
| `docs/runbooks/eventi-notifiche.md` | rollout e recovery di eventi, notifiche, SSE e push |
| `docs/runbooks/piattaforma-recovery.md` | boot, guasti tipici e recovery del CRM |
| `docs/tars-rimosso-2026-08-28.md` | cosa era Tars, cosa resta, cosa decidere |
| `docs/storage-r2.md` | configurazione e migrazione R2 |
| `docs/design/modular-control/route-manifest.md` | stato di migrazione per ogni route Wouter, uno-a-uno con `App.tsx` |
| `docs/design/modular-control/verification-log.md` | registro append-only delle verifiche UI v2, con ciò che non è stato eseguito |
| `CLAUDE.md` | guida operativa per agenti di coding |
| `guida_pubblicazione.md` | pubblicazione e deploy |

## 11-ter. Base D7 in produzione e Tars v2 avviato (29/08/2026)

Merge PR #1 autorizzato ed eseguito (`84717e2`, merge commit, 31 commit
atomici conservati; CI verde su branch e su main). Produzione verificata
senza credenziali: nuovo build live (v. marcatore `platform.interruttori`
401 vs 404), 10 router sondati vivi (incluso `produzione.*` backend),
SPA e `/produzione/*` in fallback 200, `auth.login` con errore sanificato,
JWT_SECRET provato presente dal gate d'avvio production. **Tutti i flag
DI/OCR/proposte SPENTI** (fail-closed + nessuna FLAG_* su Railway). Da
pannello Railway (occhio umano, checklist read-only): commit distribuito,
log di build/avvio, nomi variabili, `tesseract --list-langs` nel
container. Rollout DI: separato, quando ci saranno conferme anonimizzate
e perimetro pilota (runbook dedicato).

Tars v2: branch `feature/tars-v2` da `84717e2`; contratti T0 in
`docs/tars/architettura-tars-v2.md`; PRD §54 ora progetto attivo. Regole
chiave: provider OpenAI dietro adapter con DI + fake deterministico
(NESSUNA chiamata reale fino al gate chiave/budget della direzione),
`FLAG_TARS*` fail-closed, riuso di gateway proposte/reminders/eventi/
Centro Azioni/DI, cache C0-C2 misurate in T1.

## 11-quater. Tars v2 — T1 runtime read-only (nucleo, 29/08/2026)

Su `feature/tars-v2`, contratti in `docs/tars/architettura-tars-v2.md`:

- `server/tars/`: provider con DI (`provider.ts`; adapter OpenAI
  Responses `openai/adapter.ts` con store:false, MAI istanziato di
  default — serve `TARS_PROVIDER=openai` oltre a FLAG_TARS e chiave;
  fake deterministico `openai/fake.ts` per test/dev), orchestratore con
  budget/retry singolo/circuit breaker/degradazione onesta, contesto
  autorizzato con capability fingerprint, profili strumenti filtrati
  (capability+direzione+interruttori, ordinati per C2), 7 strumenti L0
  (commesse, gate, ordini, analisi DI direzione-only, Centro Azioni,
  promemoria in scadenza) con {dati, evidenze, freschezza, omissioni},
  archivio conversazioni/turni/run su tabelle PG dedicate (fallback
  memoria), prompt v1 versionato, cache C0 (TTL breve per perimetro) e
  C1 (dedupe per run) MISURATE nei contatori; router `tars.*` dietro
  `FLAG_TARS` (base procedure); pagina `/tars` con evidenze/omissioni e
  voce menu dietro flag.
- Test: `server/tars/orchestratore.test.ts` (17) — kill switch non
  aggirabile, profili (mutation test sul filtro capability), loop con
  evidenze persistite, C0/C1 provate, degradazione e circuito, strumento
  fuori profilo = errore-dato, shaping economico, cross-sede NOT_FOUND su
  strumenti e conversazioni. Verifica sul demo: chat funzionante col
  provider finto, voce menu, mobile 375px, zero errori console.
- APERTO in T1: streaming della risposta; metriche C2 reali (arrivano col
  gate chiave/modello/budget della direzione: fino ad allora nessuna
  chiamata OpenAI); pannello contestuale (T3).

## 11-quinquies. Tars v2 — T2 promemoria personali L1 (30/08/2026)

Su `feature/tars-v2` (decisioni registrate PRIMA del codice nella spec
§20, commit `f74dd8b`; implementazione `844e371`):

- `server/tars/tempo.ts`: risoluzione deterministica delle espressioni
  temporali italiane («domani alle 9», «venerdì», «tra due ore», «lunedì
  mattina», «il 15 settembre», «tre giorni prima»+ancoraData). Due
  semantiche: calendario (convertito da `parseRomeLocalDateTime`
  esistente: DST inesistente/ambiguo RIFIUTATO) e durata esatta.
  Default dichiarati sempre restituiti come `assunzioni`.
- `server/tars/strumenti/promemoria.ts`: 4 strumenti L1
  (crea/sposta/annulla/completa) sul `ReminderService` ESISTENTE;
  destinatario = principal per costruzione (schema strict senza campo
  destinatario); idempotenza `canonicalKey` + catena `:dopo<id>` per
  ricreare dopo annullo; esiti `EsitoAzione` (stato, prima/dopo,
  auditId da `promemoria_eventi`, undo, avvertenze, assunzioni); errori
  temporali = esiti `non_eseguito` leggibili, mai eccezioni.
- Estensioni ADDITIVE a `server/reminders` (nessuno schema toccato):
  `repository.listPersonal` (memoria+PG), `service.listPersonal/get/
  listEvents`. Consegna: worker esistente (claim `FOR UPDATE SKIP
  LOCKED`), nessuno scheduler nuovo; replica singola documentata.
- Orchestratore: aggrega `azioni` nel run (anche in degradazione),
  le esclude da C0, le conta in telemetria; prompt `v2` (attrito: zero
  conferme su richiesta esplicita, max UNA precisazione); profilo
  `l1-v1` con gate per famiglia (readTools/reminders indipendenti).
- UI `/tars`: blocco azioni con esito, assunzioni e «Annulla» a un
  click su `promemoria.cancel` (zero passaggi dal modello); provider
  dimostrativo con copione «Ricordami <quando> di <cosa>» per il dev.
- Prove: 17 test integrazione (attrito misurato sui turni: 2 turni,
  nessuna conferma; duplicati 0; DST onesto; ownership e cross-sede
  NOT_FOUND; kill switch a TRE strati — famiglia, campo interruttore,
  guardia in-tool — con mutation test che mordono su ciascuno), 15 test
  parser, listPersonal provata nel repository. Suite 75 file/658 test,
  build ok, browser desktop+390x844 senza errori console.
- APERTO dopo T2: ricorrenze e promemoria event-driven («avvisami se
  slitta la consegna») → arrivano con la proattività (T4), sugli eventi
  esistenti; collegamento a ordini/documenti nel testo finché lo schema
  promemoria non li prevede (decisione §20.9).

## 11-sexies. Tars v2 — T3 fascicoli, C3/C4, pannello (30/08/2026)

Su `feature/tars-v2` (decisioni nella spec §21, commit `62cddce`;
implementazione `7acdc32`):

- `server/tars/fascicoli.ts`: fascicolo C3 della commessa al pavimento
  di capability (`commessa.read`) — SENZA economia e senza derivati
  direzione-only, quindi condivisibile a livello sede per costruzione
  (test anti-leak: il payload non contiene mai /importo|prezzo|residuo/;
  `daSaldare` booleano sanzionato c'è). Domande aperte deterministiche:
  gate mancante, ordine senza data prevista, consegna prevista DOPO la
  data confermata al cliente, ordine in ritardo.
- `server/tars/versioni.ts`: registro delle versioni correnti (commessa,
  ordine, registro pagamenti, liste con hash id+updatedAt — un'entità
  NUOVA invalida). `server/tars/cache/entries.ts`: `tars_cache_entries`
  su PG (ensureSchema additivo) + fallback memoria.
- Invalidazione = verifica versioni alla lettura; su errore di
  ricostruzione si serve l'ultima versione valida MARCATA stale (mai per
  azioni). C0 v2: riuso solo con TTL valido E versioni osservate ancora
  correnti; riferimenti non sondabili (promemoria, Centro Azioni,
  analisi) = riuso NEGATO.
- Strumento L0 `leggi_fascicolo_commessa` (profilo `l1-v2`); query
  `tars.fascicolo` + `TarsFascicoloCard` in CommessaDetail (zero run del
  modello; flag spenti → il pannello non esiste nel DOM).
- Prove: `server/tars/fascicoli.test.ts` (8) + mutation test su leak
  importi, versioni-sempre-valide e sede rimossa (tutti mordono). Suite
  76 file / 666 test; browser 1440x900 e 390x844, `tars.fascicolo` 200.
- Deciso e registrato (§21.18): NIENTE cache C4 sulle letture in-memory
  dei tool (microsecondi); il meccanismo C4 (chiavi+store+versioni) è
  attivo col fascicolo come primo consumatore.

## 11-septies. Tars v2 — T4 briefing e proattività shadow (30/08/2026)

Su `feature/tars-v2` (decisioni spec §22, commit `9819f43`;
implementazione `4a0a78a`): `server/tars/briefing.ts` compone a
richiesta — senza modello e senza scritture — promemoria di oggi, casi
mine e segnalazioni shadow (ordine in ritardo, conflitto consegna
prevista/confermata) agganciate ai casi APERTI del Centro Azioni per
commessa (mai duplicati, mai contenuti altrui); telemetria del rumore
come run `proattivita-shadow`. Endpoint `tars.briefing`
(tars+readTools; segnalazioni anche dietro tarsProactive), blocco
«Situazione di oggi» in `/tars`. 7 test + 2 mutation. APERTO: emissioni
reali (casi/notifiche/promemoria event-driven) SOLO dopo osservazione
shadow, sui canali esistenti (T8/T9); rilevatore gate fermi futuro.

## 11-octies. Tars v2 — T5 azioni L2 e gateway L3 (30/08/2026)

Su `feature/tars-v2` (decisioni spec §23, implementazione `06ee45c`):
L2 = `prendi_in_carico_caso`/`rinvia_caso` su `transitionActionCase`
esistente (zero conferme su richiesta esplicita, anti-stale, audit
negli eventi del caso; flag nuovo `FLAG_TARS_L2_ACTIONS`); L3 =
`proponi_data_consegna` genera la proposta INERTE via
`generaDaOrdineEDocumento` (coerenza estratta dal router, unica fonte)
e l'UNICA conferma umana è `proposte.approvaEApplica` (doppia
capability invariata, idempotente, freschezza→`obsoleta`); bottone
«Approva e applica» in chat; nessuno strumento di approvazione esposto
al modello. Prompt v3, profilo l3-v1, campo `interruttore` a lista
(tutti richiesti). 11 test + 3 mutation. APERTO: altri tipi di azione
nel registro del gateway (oggi solo data consegna ordine) quando il
dominio li definisce; L2 su ticket (`ticket.assign`) quando serve.

## 11-nonies. Tars v2 — T6 documenti e comunicazioni (30/08/2026)

Su `feature/tars-v2` (decisioni spec §24, implementazione `d7ace98`):
`analizza_conferma_ordine` (L2, direzione, tarsL2Actions+DI) sulla
nuova unica fonte `documenti/analisiOrdine.ts` (router refactorato,
contratto invariato); `leggi_comunicazioni` (L0, readTools+
communications) con estratti 240 char e confini sede/commessa/cliente;
NESSUN invio (decisione 30: il canale non esiste — gate direzione);
residui `tars_*` su comunicazioni congelati. 6 test + 3 mutation.
APERTO: invio L4 (SMTP/WhatsApp API + estensione registro gateway,
solo su decisione della direzione); bozze persistite nel dominio
comunicazioni (richiedono un concetto di bozza nello schema).

## 11-decies. Tars v2 — T7 memoria (30/08/2026)

Su `feature/tars-v2` (decisioni spec §25, implementazione `378635b`):
`server/tars/memoria.ts` (kv `tars_memoria`, tipi chiusi, invalidazione
senza cancellazione) + strumenti ricorda/dimentica/leggi_memorie dietro
`FLAG_TARS_MEMORY`; contesto iniettato in coda ai run (C2 intatta),
fingerprint memorie nella chiave C0; prompt v4 (regola 9: ricorda solo
esplicito, memorie ≠ verità CRM). C5 semantica differita al gate
chiave (spec §25.36). 8 test + 3 mutation. APERTO: retention formale
delle memorie (oggi invalidazione manuale; una policy di scadenza va
decisa), ricerca ibrida vera con embeddings (gate).

## 11-octodecies. Tars v2 — provider REALE acceso (31/08/2026)

La direzione ha impostato su Railway le tre variabili mancanti:
`TARS_PROVIDER=openai`, `TARS_MODEL_INTERACTIVE=gpt-5.6-sol`,
`TARS_REASONING_INTERACTIVE=high`. Verificate una a una (valori esatti,
nessun typo: un nome di modello sbagliato farebbe ricadere sul provider
finto in silenzio, perché il catalogo è fail-closed). `DATABASE_URL` e
`OPENAI_API_KEY` erano già presenti, quindi tutte e sei le condizioni
cumulative del confine sono soddisfatte: **Tars ragiona davvero, in
produzione, sulla chiave OpenAI condivisa esistente**.

Contestualmente ho confrontato il mapping dell'adapter con la
documentazione viva della Responses API, che non era mai stato fatto
(nei test la rete è bloccata di proposito). Il mapping delle richieste è
risultato CORRETTO in ogni campo: `tools` con `name` al livello
superiore e non annidato, `function_call`/`function_call_output` con
`call_id`, `max_output_tokens`, `store`, `prompt_cache_key`,
`reasoning.effort`; e l'usage su `input_tokens`,
`input_tokens_details.cached_tokens`, `output_tokens`,
`output_tokens_details.reasoning_tokens`.

Ma la stessa verifica ha fatto emergere un DIFETTO REALE del cost
hardening, corretto in `1834919`: su GPT-5.6 le scritture in cache
costano 1,25× l'input non cachato, e il catalogo non lo prevedeva. Il
ledger sotto-contabilizzava fino al 25% su ogni prompt nuovo. Il dato
`cache_write_tokens` era già letto, sommato e registrato in telemetria:
mancava solo il moltiplicatore. Vale come promemoria — un numero
raccolto non è un numero controllato.

Nessun test era rosso prima della correzione, il che era la vera
notizia: nessuno interrogava quella dimensione. Ora due mutazioni
mordono, e la seconda ha richiesto di misurare il soffitto della stima
SENZA margine, perché il margine 1,25 compensava per coincidenza il
moltiplicatore 1,25 e mascherava il difetto.

## 11-novodecies. Tars — T0 verità, contratti e guardrail (31/08/2026)

Il repository è stato ricognito prima di qualsiasi tranche operativa. La
matrice corrente è in `docs/tars/matrice-azioni-tars.md`: distingue i tool già
presenti (letture, promemoria, Centro Azioni, DI limitata, proposta data
consegna e memoria) dai percorsi CRM esistenti ma non esposti a Tars e dai gap.

Invarianti registrati: nessun tool accetta `force`, il modello non invoca tRPC,
non esistono SQL/raw mutation generiche né provider esterni al governor. T0 è
solo documentazione server-side: il delta non contiene `client/`.

Accettazione vincolante ma non ancora dichiarata implementata: regressione
Maccari (email/allegato→match certo→fascicolo→gate→transizione adiacente con
audit/Undo, e promemoria idempotente) e tutti e tre i livelli proattivi. Oggi
ci sono due detector L1 solo shadow; L2 e L3 restano lavoro esplicito.

## 11-vicies. Tars — T2 contesto conversazionale persistente (31/08/2026)

Le conversazioni Tars hanno ora un contesto JSONB additivo con versione
ottimistica: commessa, cliente, comunicazione/allegato, superficie, versioni
entità e candidati di una chiarificazione. Lo schema completo è in
`server/tars/conversazione/types.ts`; il DDL idempotente e il fallback memoria
sono in `server/tars/archivio.ts`. La forma iniziale della chiarificazione
viene backfillata eliminando domanda e testo utente grezzo; payload diversi o
malformati vengono scartati in blocco.

Il contesto è un hint sede/utente-scoped, mai una capability. Ogni riferimento
è riletto: comunicazioni e allegati derivano autorevolmente commessa/cliente,
gli invisibili sono omessi e la commessa porta stato per-campo
`assente | verificato | stale`. Il resolver usa il parser canonico dei codici
(`COM 2026 35`, `com_2026_035`, `COM-2026-035`), non usa forme societarie come
evidenza e produce soltanto `unico | ambiguo | non_trovato`. L'ambiguità chiede
sempre una sola domanda server-side e la risposta successiva non può uscire
dai candidati persistiti; un codice esplicito non trovato ferma il provider e
azzera il vecchio riferimento.

L'orchestratore carica il contesto prima del profilo e include la sua impronta
in C0/C2. C0 viene scritto sotto l'impronta finale se una lettura cambia il
contesto durante il run. Il catalogo con commessa attiva è contestuale. Il
backend restituisce il campo opzionale `statoOperativo`, derivato dagli esiti
reali con precedenza fail-closed: `Fatto | Preparato | Da confermare |
Non eseguito | Bloccato`. Il contratto prompt corrente è l'immutabile
`server/tars/prompt/v5.ts`; v4 non è stato riscritto.

Per `crea_promemoria`, l'hook tipizzato `materializzaInput` risolve e verifica
commessa/cliente prima della chiave R1 e della reservation. Tool e validazione
del riuso settled ricevono lo stesso input materializzato. Le richieste legacy
senza collegamenti mantengono la canonical key byte-identica. Dopo un effetto
settled, un guasto del solo apprendimento contesto viene registrato come
omissione e non può nascondere l'azione riuscita né renderla ritentabile.
Un esito `non_eseguito` successivo alla reservation chiude invece la generazione
append-only come `no_effect`: non viene riusato da R1/C1 e un retry apre una
nuova reservation, restando deduplicato rispetto ai retry concorrenti.

Contratti API compatibili: `tars.stato` continua ad accettare nessun input e
può ricevere opzionalmente `conversazioneId`; `contestoAttivo` e
`statoOperativo` sono campi additivi. Nessuna modifica UI è inclusa in T2.

## 11-septdecies. Tars v2 — potenziamento approvato (30/08/2026)

Indirizzo della direzione: «Tars va reso potente, non preoccuparti dei
costi». Commit `a347c8a`, decisioni 55-59 nella spec, tabella completa
in `docs/tars/gate-openai.md` §7.

In sintesi: modello `gpt-5.6-sol` (flagship) accanto a `gpt-5.6-terra`
nel catalogo tariffe, reasoning `high`, tetti a 2,00 / 20,00 / 200,00
USD (sanità 1.000), contesto 240.000 caratteri, 20 chiamate al modello,
4.000 token di risposta. Il governor NON cambia in nessuno dei suoi
meccanismi, e nessuna capability si allarga: è più cervello, non più
autorità.

Il numero da non toccare a cuor leggero è il tetto per-run. Vale 2,00 e
non 1,00 perché al contesto massimo una singola chiamata col flagship
prenota ≈0,72 USD: con un tetto da 1,00 il secondo passo di
ragionamento sarebbe stato impossibile e i venti passi dichiarati
sarebbero stati finzione. Il test «col FLAGSHIP, una chiamata al
contesto massimo resta sotto il tetto per-run» lega fra loro contesto,
output e tetto: se qualcuno alza il contesto senza guardare il tetto,
fallisce prima che se ne accorga un utente.

CONSEGUENZA APERTA sul progetto OpenAI: l'hard limit mensile da
impostare non è più 20 USD ma **250**. Un hard limit più basso del tetto
software non protegge: produce 429 a metà mese, che è un guasto
silenzioso.

DA FARE, non ancora fatto: le variabili che accendono il provider reale
(`TARS_PROVIDER`, `TARS_MODEL_INTERACTIVE`, `TARS_REASONING_INTERACTIVE`)
non sono impostate su Railway. Finché mancano, Tars gira col provider
finto: azioni vere, ragionamento no.

## 11-sexdecies. Tars v2 — ATTIVATO in produzione, provider finto (30/08/2026)

Su autorizzazione della direzione sono state impostate su Railway
(progetto `successful-playfulness`, servizio `Ruffino Flow`, ambiente
production) SETTE variabili, con un solo redeploy:

    FLAG_TARS, FLAG_TARS_READ_TOOLS, FLAG_TARS_REMINDERS,
    FLAG_TARS_MEMORY, FLAG_TARS_L2_ACTIONS, FLAG_TARS_PROACTIVE,
    FLAG_TARS_COMMUNICATIONS  = on

NON impostate (e da non impostare senza un gate esplicito):
`TARS_PROVIDER` (farebbe partire chiamate reali sulla chiave residua
ancora presente), `FLAG_TARS_PROPOSALS` (richiede il rollout DI, mai
avviato), `FLAG_TARS_SEMANTIC_SEARCH` (nessun codice), i flag DI/OCR.

Budget: nessuna variabile impostata, quindi valgono i default approvati
(0,10 / 2,00 / 20,00 USD). Il governor è attivo ma inerte: senza
provider reale non c'è spesa da contabilizzare.

**Cosa fa Tars adesso**: le AZIONI sono vere (promemoria, prese in
carico, rinvii, memoria, letture con capability e sede), ma il
"ragionamento" no — il provider è il FINTO, il cui copione dimostrativo
riconosce solo tre forme: «Ricordami <quando> di <cosa>», «Proponi la
consegna dell'ordine N», «Prendi in carico il caso N». A qualunque
altra frase risponde con un messaggio di servizio. È esattamente lo
scopo di questa fase: validare superfici, permessi, telemetria e
isolamento su dati veri a costo zero.

**Visibilità**: la voce /tars appare a TUTTI gli utenti della sede
(i flag sono per installazione). Le letture restano filtrate per
capability e sede.

Per spegnere tutto: rimuovere `FLAG_TARS` (basta il master) e
ridistribuire. Nessuna migrazione, nessun dato da ripulire.

## 11-quinquiesdecies. Tars v2 — MERGIATO e distribuito (30/08/2026)

PR #2 mergiata su autorizzazione della direzione: merge commit
`2096a43`, 34 commit atomici conservati, CI verde. Deploy verificato
senza credenziali: `tars.costi` e `tars.stato` sono passati da «No
procedure found» a `UNAUTHORIZED` (la procedura esiste = codice nuovo
distribuito); `auth.me` risponde, i router del CRM (commesse,
fornitori, promemoria, proposte, notifiche) rispondono UNAUTHORIZED
cioè sono vivi; SPA servita; `/produzione/*` risponde; `auth.login`
con credenziali inesistenti dà «Email o password non validi».

**Tutti i flag Tars restano SPENTI**: fail-closed per costruzione
(NODE_ENV=production ⇒ servono variabili esplicite su Railway) e
nessuna variabile è stata impostata. Il provider reale NON può nascere:
mancano `TARS_PROVIDER=openai` e la chiave dedicata.

ATTENZIONE per l'attivazione: la vecchia `OPENAI_API_KEY` è ancora su
Railway. Finché c'è, impostare `TARS_PROVIDER=openai` farebbe partire
chiamate reali su quella chiave. L'attivazione dei flag NON deve mai
includere `TARS_PROVIDER` prima del gate B (chiave dedicata + eval).

## 11-quaterdecies. Tars v2 — revisione del cost hardening (30/08/2026)

Due revisori indipendenti sul delta del governor; tutti i Critical e
Important corretti in `18441b9`. I due Critical valgono la lettura:
(1) il ledger PostgreSQL non avrebbe mai funzionato (`COALESCE(...)
FILTER (...)` è SQL invalido) — ora provato da 5 test su un database
vero, in CI con servizio dedicato; (2) senza `usage` plausibile il
costo reale sarebbe stato 0 e la prenotazione liberata — ora
`uncertain`, contato. Aggiunta la guardia di rete GLOBALE della suite
(`server/_core/testSetup.ts`): nessun test può uscire su Internet, e
lo si prova invocando davvero l'adapter reale. Matrice test/limiti in
`docs/tars/matrice-test-e-limiti.md`.

Terza revisione (conclusiva): nessun Critical, 4 Important corretti in
`13b0624` (dedup che ripeteva una risposta conclusa; tetto per-run che
rendeva irraggiungibili i limiti dichiarati e mentiva nel messaggio;
limiti del run letti senza validazione — NaN disattivava il tetto;
stessa cosa sulla Map della dedup).

Debito residuo DICHIARATO: (1) il tetto per-run consente 3-7 chiamate
al modello secondo il caching (misurato) — se gli eval reali fermassero
run legittimi si alza il per-run, non si allenta la stima; (2) la dedup
del doppio click e il rate limit sono in-process (replica singola,
vincolo già documentato §14); (3) `tars.costi` non ha ancora una UI: la
direzione legge la spesa dall'endpoint; (4) i totali di `tars.costi`
sono globali su tutte le sedi (il tetto è globale), dichiarato nel
payload; (5) la stima non è un soffitto stretto per input a densità
anomala (CJK, base64): la riconciliazione registra comunque il costo
vero, solo la singola prenotazione può essere superata una volta.

## 11-terdecies. Tars v2 — budget governor (30/08/2026)

Su `feature/tars-v2` (decisioni spec §27, implementazione `3bff928`):
`server/tars/costi/` — tariffe versionate in nanodollari interi
(`gpt-5.6-terra` unica attiva), ledger PostgreSQL con advisory lock
globale e stati `reserved/settled/released/expired/uncertain`, governor
che PRENOTA prima e riconcilia dopo, fabbrica unica
`creaProviderPerRun` (l'adapter grezzo è importabile solo da lì:
guardia strutturale in `costi/confine.test.ts`).

Numeri operativi: tetti 0,10 / 2,00 / 20,00 USD (default fail-closed);
prenotazione ≈0,03 USD per chiamata col catalogo attuale → 3-7 chiamate
per run secondo il caching (MISURATO in test, non stimato a parole).

Prerequisiti del provider reale, tutti verificati a ogni run:
`TARS_PROVIDER=openai` + `FLAG_TARS` + chiave + tariffa a catalogo +
budget valido + **`DATABASE_URL`** (senza ledger autorevole niente
provider reale). `tars.costi` (direzione) mostra spesa, residui e il
motivo di un'eventuale indisponibilità.

APERTO: il comando `eval:tars:reale` nasce insieme al gate B (piano dei
60 casi in `docs/tars/piano-eval-reali.md`); la rimozione della vecchia
`OPENAI_API_KEY` da Railway va fatta quando entra la chiave dedicata.

## 11-duodecies. Tars v2 — revisione indipendente chiusa (30/08/2026)

Quattro revisori sull'intero diff; TUTTI i Critical/Important corretti
in `b7a89ef` (cronologia ultimi-N, parser tempo senza risoluzioni
silenziosamente errate, C0 contestuale, C1 senza errori, fascicoli
invalidati da documenti e giorno, hash opaco registro pagamenti, rate
limit invia, guardia DATABASE_URL su eval, client gated sui flag).
Residuo DICHIARATO e accettato: lo stato «Annulla/Applicata» dei
bottoni in chat è di pagina — dopo un reload un secondo click è
possibile ma INNOCUO (entrambi gli endpoint idempotenti, esito onesto
nel toast). Proposta gate OpenAI: docs/tars/gate-openai.md.

## 11-undecies. Tars v2 — T8/T9 eval e rollout preparati (30/08/2026)

Su `feature/tars-v2` (decisioni spec §26, implementazione `11da34b`):
`pnpm eval:tars` (11 casi, rapporto in docs/reports/, soglie critiche
in CI via server/tars/eval/eval.test.ts); runbook
docs/runbooks/rollout-tars.md (fasi 0-4, osservazione, rollback =
spegnere il flag, owner = direzione). Il lavoro OFFLINE di Tars v2 è
CONCLUSO: restano i gate della direzione — (1) gate OpenAI
(modello/budget/limiti/eval reali), (2) accensione flag per fasi,
(3) invio L4 (nuova integrazione), (4) semantica C5 (embeddings).

## 11-septendecies. Tars operativo — T3 transizioni commessa (31/08/2026)

Sul `main` locale, senza push/deploy/flag/provider: la state machine che prima
viveva dentro `commesse.update` è stata estratta in
`server/commesse/transizioni.ts`. Router e Tars chiamano ora lo stesso comando
per adiacenza, doc gate, cleanup del rollback e Board→timeline; input/output
del router restano compatibili e il suo `force` storico resta confinato al
solo bypass del gate.

Catalogo Tars: 23 strumenti. Nuovi
`verifica_transizione_commessa` (R0/L0, `commessa.read`, sola preview) e
`transizione_adiacente_commessa` (R1/L2, doppia capability update+change,
richiesta esplicita legata dal server a commessa e target/direzione, nessun
`force`). Il comando
rilegge sede/stato/versione dopo l'authz; l'audit `commesse_transizioni`
conserva prima/dopo e snapshot cleanup. Undo è additivo via
`commesse.undoTransizione`, monouso, autore/direzione, e fallisce senza
effetti se stato/versione o gate non coincidono più. Prompt `v6`.

Limite dichiarato: `persistedStore` e optimistic lock assumono la replica
singola attuale; prima di più repliche serve compare-and-swap transazionale su
PostgreSQL per commessa+audit. Prossima tranche Maccari: comunicazione,
allegato, analisi/classificazione e archivio certo; non dichiarare ancora la
catena completa. Nessun file client/UI, cost governor, provider o flag è stato
toccato; nessuna operazione Railway/OpenAI.

## 11-vicies bis. Tars operativo T4–T10 — mandato completato (01/09/2026)

Su `main` locale, sette commit atomici (`276cf91`…`f6f0756` più il
finale docs): catena documentale Maccari con archiviazione R1 a
corrispondenza certa e transizione condizionale dal set chiuso di
condizioni verificabili; frontiera unica R2/R3 con anteprima hashata e
azioni dichiarate indisponibili; osservatore T6 che consuma il reconcile
del Centro Azioni (tabella additiva `tars_osservazioni`, shadow/active
via `TARS_OBSERVER_MODE`); pattern aziendali e Panorama direzione-only
(`FLAG_TARS_PATTERNS`); SafeProductCatalog e proposte di miglioramento
inerti con feedback che muove solo cooldown/ranking
(`FLAG_TARS_IMPROVEMENTS`); classi di costo nel ledger (`classe`,
`TARS_BUDGET_<CLASSE>_USD`, background a 0 di default) e diagnosi
dell'ultimo run degradato in `tars.stato` (direzione-only — è il punto
dove leggere il motivo del «modello non è al momento disponibile»).
Eval sintetico a 16 casi con soglie CI. Dettaglio nel PRD v5.28;
rollout: `docs/runbooks/rollout-tars.md`. Ledger di esecuzione:
`.superpowers/sdd/2026-08-31-tars-operativo-proattivo/progress.md`.

## 11-vicies ter. Tars in produzione — due cause del blocco e perimetro archiviate (01/09/2026)

Tars col provider reale non aveva MAI risposto: la `prompt_cache_key` C2
(71 caratteri) superava il limite OpenAI di 64 e ogni chiamata moriva con
400 — provato dal container Railway e dai run degradati in `tars_run`
(«Richiesta al provider rifiutata (400)»). Ora la chiave logica è
digestata (`tars-<sha256·48>`, 53 caratteri) con test di regressione sul
limite; il primo run reale riuscito è delle 08:05Z del 01/09
(`ok | openai+governor | gpt-5.6-sol`). Secondo blocco: rinomina/fissa/
archivia conversazione fallivano su PostgreSQL con 42P18 (parametro null
senza tipo in `$n IS NULL`, workbench 31/08; la suite PG `archivio.pg`
salta senza `DATABASE_URL`, CI inclusa — riprodotta su postgres:16 via
Docker). Fix con cast `::boolean`.

Perimetro commesse archiviate (segnalazione direzione): il briefing non
genera più segnalazioni sugli ordini di commesse archiviate (stesso
filtro dei detector del Centro Azioni), `cerca_commesse` le esclude di
default (entrano solo chiedendo esplicitamente stato «archiviata», con
omissione dichiarata) e il prompt v7 fissa la regola di ragionamento:
lavoro concluso ⇒ nessuna proposta, ripristino solo su comando esplicito
dell'utente.

## 11-vicies quater. Tars proattivo pieno — tetti di spesa eliminati (01/09/2026)

Decisione della direzione (registrata in `docs/tars/gate-openai.md` §8):
«non preoccuparti dei budget, eliminali tutti: un cervello operativo non
ha bisogno di budget». I tetti software (per run, giornaliero, mensile,
per classe) NON hanno più default: variabile assente = nessun tetto; un
valore impostato resta validato e applicato; sui budget di classe uno 0
ESPLICITO resta il kill switch della classe. La CONTABILITÀ è intatta:
ogni chiamata passa dal governor (prenota→riconcilia su ledger PG),
`tars.costi` mostra sempre la spesa reale; il circuit breaker sugli
errori e i limiti operativi del run (passi, chiamate, timeout, contesto)
non sono budget e restano. La card Agente mostra «nessun tetto» al posto
di barre e residui quando i limiti sono assenti.

Contestualmente accesi in produzione (Railway) i flag della proattività
completa: `FLAG_TARS_PATTERNS`, `FLAG_TARS_IMPROVEMENTS`,
`FLAG_TARS_PROPOSALS`, `FLAG_DOCUMENT_INTELLIGENCE`, `FLAG_PROPOSTE`,
`TARS_OBSERVER_MODE=active`. Unico tetto residuo: l'hard limit del
progetto OpenAI nel pannello della direzione (fuori dal codice).

Accesso ampliato (stessa decisione): nuovi strumenti L0 `cerca_clienti`
e `leggi_cliente` (`server/tars/strumenti/clienti.ts`, registro 1.9.0,
30 azioni) — anagrafica, contatti, referenti, pratiche e commesse
attive del cliente; archiviati/archiviate fuori dai quadri operativi
salvo richiesta esplicita, economia aggregata solo con
`pagamento.read`/`economia.read`, cross-sede NOT_FOUND. Matrice
aggiornata in `docs/tars/matrice-azioni-tars.md`.

Incidente emerso all'accensione dell'observer active e risolto in
giornata (bf85d50): tutte le scritture jsonb di Tars fuori da
executions/actionCenter usavano `JSON.stringify(...)::jsonb`, che con
postgres-js doppio-codifica (stringa jsonb in colonna — stesso incidente
della chat). Conseguenze reali: crash «Invalid time value» a ogni
reconcile dell'osservatore (append SQL su storico-stringa → array misto
→ Invalid Date), contesto conversazione MAI riletto su PG (continuità
cross-messaggio persa), payload turni invisibile al client, telemetria
run opaca. Fix: `sql.json` ovunque, migrazione one-time in ensureSchema
(spacchetta stringhe, ricostruisce gli array misti), letture tolleranti;
scoperto e corretto dal contratto anche l'upsert osservazioni con
guardia ottimistica a precisione piena (µs vs ms ⇒ ricorsione infinita):
ora confronto ai millisecondi e ritenti limitati. Contratto reale in
`server/tars/jsonb.pg.test.ts` (gira con DATABASE_URL; localmente via
Docker postgres:16).

## 11-vicies quinquies. Tars smistamento — le comunicazioni entrano nel cervello (02/09/2026)

Mandato direzione: «non propone, non analizza l'azienda, non analizza le
comunicazioni, non collega gli allegati alle commesse». Diagnosi in
produzione: 10.261 comunicazioni, 8.195 senza commessa, 2.466 allegati
orfani; proposte create 0; analisi documenti 0; ordini fornitore 0 (la
pipeline proposte/DI era ancorata a un modulo non usato); all'arrivo
scattava solo il match deterministico. Piano e decisioni D1–D6 in
`docs/superpowers/plans/2026-09-02-tars-smistamento.md`.

Costruito `server/tars/smistamento/`: registro `tars_smistamento`
(additivo, jsonb con `sql.json`), candidati deterministici
(`candidati.ts`: codice commessa, filo già collegato, mittente originale
degli inoltri interni, telefoni, cognomi/ragioni sociali — mai i cognomi
del personale, località di supporto), analisi col modello a output
strutturato (`analisi.ts`, prompt `smistamento-v1`, schema strict, id
verificati contro i candidati, importi scrubbati; fallback deterministico
senza provider), effetti (`applica.ts`: collegamento SOLO se certo e
senza toccare lo stato; archiviazione allegati solo su comunicazioni
collegate e documenti riconosciuti — D2; triage su
`categoria`/`tars_riepilogo`/`tars_istruzione`; proposta a un click per il
resto), worker ogni 60 s per sede (recenti prima, modello entro 90 gg,
storia oltre 365 gg esclusa), segnali `comunicazione_decisione` /
`comunicazione_risposta` nel reconcile del Centro Azioni, sezione
`smistamento` del briefing (da decidere / da rispondere / urgenti /
contatori), endpoint `tars.smistamentoStato|PerComunicazione|Proposte|
Decidi|Riesamina`. UI: banner Tars nel lettore email (riepilogo, urgenza,
categoria, proposta con Collega/No, allegati archiviati), liste nella
Situazione della Dashboard e nel pannello contesto di `/tars`.

Provider: `RichiestaProvider.formatoJson` → `text.format json_schema
strict` nell'adapter; classe di costo `smistamento`; flag
`FLAG_TARS_SMISTAMENTO` (fail-closed; richiede communications, proactive
e PostgreSQL). Deep link email: `/messaggi/email?messaggio=ID`.
Non fatto in questo taglio (piano §4, fase successiva): analisi azienda
su dati reali e sintesi giornaliera; Centro Azioni come pagina; UI di
osservazioni/panorama/miglioramenti.

Stesso giorno, dalla chat della direzione («crea un ticket per bertoli»
→ «Quale intendi…» → «096» ripetuto cinque volte): la risposta a una
domanda di chiarimento passava dal resolver generico, che riconosce solo
codici completi. Ora `conversazione/chiarimento.ts` legge la risposta
CONTRO i candidati (progressivo «096», «la commessa 096», codice,
ordinale «la seconda», nome «Bertoli») e dopo due risposte non
riconosciute la domanda decade (il messaggio va al modello). Bug latente
corretto: con più di quattro candidati il contesto persistito veniva
scartato alla rilettura (schema max 4) e la domanda spariva — ora si
salvano al massimo quattro. Aggiunto lo strumento R1 `crea_ticket`
(31 azioni a registro): fino ad allora Tars rispondeva «non ho uno
strumento per creare ticket».

## 11-vicies sexies. Cliente e prima commessa in un passo (02/09/2026)

Richiesta direzione: il dialog «Nuovo cliente» chiude con «Crea cliente e
commessa» e la prima commessa nasce da sola. Contratto nuovo
`clienti.createConCommessa` (stesso input di `clienti.create`, risposta
`{ cliente, commessa }`): verifica `commessa.create` PRIMA di scrivere, poi
crea il cliente e una commessa in `preventivo` con indirizzo di lavoro
(fallback residenza), telefono, email e assegnatario ereditati dal cliente.
Nessuna regola duplicata: `commesse.create` e `clienti.create` ora chiamano
le stesse funzioni `creaCommessa` (esportata da `commesse.ts`) e
`creaCliente`, con import lazy da `clienti.ts` come per
`syncClienteOnCommesse`. Non è una transazione atomica sui due store: un
cliente senza commessa resta uno stato valido e la commessa può fallire solo
sulla policy, che viene controllata prima. UI `ClientiList`: pulsante
primario «Crea cliente e commessa» solo con `commessa.create`, secondario
«Crea solo il cliente»; al successo si apre la commessa nuova. Senza la
capability il pulsante torna «Crea cliente». Test:
`server/routers/clienti.test.ts` e `modularRoutePresentation.test.ts`.

## 11-untricies. Via le pagine Fornitori e Garanzie (04/09/2026)

Richiesta direzione: «elimina le pagine fornitori e garanzie». Entrambe erano
superfici di sola direzione fuori dalla navigazione, raggiunte dall'hub
Impostazioni. `/fornitori` era già registrata qui sotto come «candidata alla
rimozione»: questa è la conferma.

Rimosso: `pages/FornitoriList.tsx`, `pages/GaranzieList.tsx` e
`components/fornitori/` (`AnalisiConfermaOrdine`, `ProposteOrdine`, montati
solo lì). Le due rotte restano registrate come **redirect** — `/garanzie` →
`/clienti`, `/fornitori` → `/commesse` — con lo stesso `LegacyRedirect` di
`/produzione` e `/comunicazioni`: notifiche e segnalibri già salvati non
devono atterrare su un 404 muto. Tolte le voci dall'hub Impostazioni e dalla
`shellPresentation`; il contratto di rotta passa a `kind: "redirect"` e le
guardie di direzione scendono da sei a quattro.

**I domini restano, e non è un dettaglio.** `fornitoriRouter` è dipendenza di
una quindicina di moduli server: il costo del margine che nasce dalla conferma
d'ordine (`commesse/costoDaConferma.ts`), l'intelligenza documentale D7
(`analisiOrdine`, `proposte`) e mezzo Tars (briefing, fascicoli, versioni,
strumenti). Toglierlo avrebbe rotto il margine, non una pagina. `garanzieRouter`
alimenta notifiche, Centro Azioni e backup Drive, e le garanzie restano
leggibili e registrabili dalla **scheda cliente**, che è dove stavano già.
In produzione il modulo fornitori conta comunque zero ordini, zero proposte e
zero analisi (diagnosi del 02/09), quindi la pagina non copriva lavoro vivo.

Link riportati dove il lavoro è rimasto: le notifiche di garanzia in scadenza
(`notifiche.ts`, `actionCenter/signals.ts`) e la Dashboard puntano alla scheda
del cliente ricavata dalla commessa, non più a `/garanzie`; i fallback Tars e
briefing che davano su `/fornitori` vanno a `/commesse`.

Residuo dichiarato: `warrantyExpiryTone` e `warrantyExpiryLabel` in
`client/src/lib/supportQueue.ts` restano senza consumatori (li usava solo la
pagina rimossa). Sono tenuti, non cancellati: la scheda cliente potrebbe
adottarli per dire le scadenze a parole invece che con una data secca.

## 11-tricies. Ordine e conferma: un tipo di documento solo (03/09/2026)

Seguito della fusione dei passi timeline: restavano due voci nel menu dei
tipi documento e due pastiglie nel gate di `da_ordinare`, una verde e una
arancione, che facevano sembrare mancante un documento già presente. In
realtà il gate usa `.some`: bastava uno dei due, e anche
`confermeMancanti.ts` accettava indifferentemente l'uno o l'altro. Erano già
sinonimi ovunque contasse.

Accorpati: `ordine` esce da `DOC_TIPI` e da `DOC_TIPO_LABEL`, il gate di
`da_ordinare` chiede solo `conferma_ordine`, la regola di classificazione
Tars per «ordine / purchase order / PO 123» confluisce nella conferma,
`TIPI_ARCHIVIABILI` e la cartella Drive «Ordini» seguono. Nuova
`migraTipiDocumento` in `preventiviContratti.ts`: i documenti già archiviati
come `ordine` passano a `conferma_ordine` al bootstrap, idempotente come le
altre migrazioni.

NON toccato: `confrontoOrdine.ts` confronta la conferma con l'**ordine
strutturato** del modulo Fornitori (codice, righe, importi), non col PDF di
tipo `ordine` — quella funzione resta intera. Nemmeno `versioni.ts`, dove
`"ordine"` è una chiave di cache degli ordini fornitore, non un tipo
documento.

Causa vera del «continuo a vederlo»: la lista dei tipi era **duplicata a
mano** in `CommessaDetail.tsx`, sotto un commento che dichiarava di
rispecchiare il server. Le due erano già divergenti («Conferma ordine» contro
«Conferma ordine fornitore»), e togliere il tipo dal router non cambiava il
menu. Ora la lista vive in `shared/docTipi.ts` — `DOC_TIPI`, `DOC_TIPO_LABEL`
e `docTipoLabel()` per i record storici con tipi fuori elenco — e il router la
re-esporta, così ogni import esistente continua a funzionare. Guardia in
`client/src/lib/docTipi.test.ts`: le etichette coprono esattamente i tipi e la
scheda commessa non può tornare a tenersi una copia.

## 11-undetricies. Ordine e conferma fornitore fusi in un passo (03/09/2026)

Richiesta direzione: «ordine fornitore e conferma ordine sono la stessa
identica cosa». Nel dominio non lo sono — il gate di `da_ordinare` chiede sia
`ordine` sia `conferma_ordine`, e dal 03/09 il costo imponibile del margine
esce dalla conferma allegata (v. `server/tars/documenti/confermeMancanti.ts`)
— ma come passi di checklist sono due spunte per un gesto solo. Decisione
presa in sessione: sopravvive **«Conferma Ordine Fornitore (allegato)»**, e
con lei si sposta la milestone verso `produzione`. La commessa avanza quando
il fornitore ha risposto, non quando l'ordine è partito. La timeline passa da
17 a 16 step; le milestone successive scalano (`8`, `9`, `13`, `15`, `16`) e
le fasce di fase diventano Vendita 1-4, Ordine 5-8, Consegna 9-13, Chiusura
14-16.

`migraStepRitirati` diventa `migraStepTimeline` e impara la **fusione**: dove
«Ordine Merce al Fornitore» era spuntato e la conferma no, la spunta si
travasa con data, esecutore e nota, così una commessa già ordinata non si
ritrova il passo riaperto; se erano spuntati entrambi vince la conferma e le
due note si uniscono. Poi come prima: rimozione dei ritirati, rinumerazione
1..n, idempotenza. Il gate documentale e la ricerca Tars delle conferme
mancanti non sono stati toccati: la conferma resta un documento a sé.

## 11-vicies octies. I ticket si vedono anche dalla commessa (02/09/2026)

Un ticket aperto su una commessa si leggeva solo dalla coda Post-vendita e
dalla scheda cliente. Ora la scheda commessa ha una linguetta «Ticket (n)»
accanto ad Anomalie, con categoria, priorità, stato, oggetto e descrizione,
e un pulsante che porta alla coda Post-vendita dove il ticket si lavora.

Il server non è cambiato: `ticket.list` accettava già `commessaId` e applica
lo scope di sede. Mancava solo la lettura lato scheda. La copertura sì:
`server/routers/ticket.test.ts` è nuovo e verifica che il filtro per commessa
escluda i ticket di altre commesse e quelli senza commessa, e che un'altra
sede non veda nulla nemmeno indovinando l'id della commessa.

## 11-vicies septies. Timeline ordine: via «Invio Fattura al Cliente» (02/09/2026)

Richiesta direzione: lo step era inutile, perché la fattura si manda nel
momento in cui la si emette, e restava aperto per sempre falsando la
percentuale di avanzamento. La timeline passa da 18 a 17 step; le milestone
dopo «Fatturazione» scalano di uno (`4` primo acconto → `da_ordinare`, `5`
ordine merce → `produzione`, `9`, `10`, `14`, `16`, `17`), e le fasce di fase
in `TimelineOrdine.tsx` seguono (Vendita 1-4, Ordine 5-9, Consegna 10-14,
Chiusura 15-17).

Le timeline già salvate vengono ripulite al bootstrap: la migrazione di
`onLoad` è stata estratta in `migraStepRitirati`, funzione pura esportata e
testata, che toglie gli step ritirati (il DDT finale di prima e ora l'invio
fattura) e rinumera 1..n gli step di ogni commessa. È idempotente, così uno
store già migrato non viene riscritto a ogni avvio. Conseguenza accettata: le
righe dello step rimosso spariscono, comprese eventuali date, note e
assegnatari registrati lì. Nessuna milestone era collegata a quello step,
quindi nessuno stato di board cambia. Test in `server/routers/timeline.test.ts`.
## 11-vicies novies. Tars libero — il modello decide, il dominio verifica (02/09/2026)

Mandato direzione, dopo la chat «crea un ticket per bertoli» finita in
loop: «Tars deve leggere tutto, capire tutto e poter fare tutto; quando
serve chiede autorizzazione, quando è sicuro fa da solo; se l'ha fatto
Tars viene segnalato; serve una sezione proposte sulla pagina Tars».
Piano e lacci trovati in `docs/superpowers/plans/2026-09-02-tars-libero.md`;
policy scritta in `CLAUDE.md` «Agente AI».

- **A. Nucleo libero** (commit `6a78cce`, in produzione dalle 16:48): il
  catalogo è tutto l'autorizzato per capability/sede/flag, senza potatura
  per superficie o intento (`azioni/policy.ts`); i classificatori
  deterministici che rispondevano al posto del modello sono spariti
  dall'orchestratore, le ambiguità arrivano come hint nel contesto e la
  risposta a un chiarimento è letta CONTRO i candidati (`chiarimento.ts`);
  nessuna autorità derivata dal testo: `transizione_commessa` e
  `archivia_allegato_comunicazione` verificano da soli (sede, archiviata,
  state machine, gate, versione, fingerprint); prompt v9 standalone
  (`prompt/v9.ts`: «collega esperto con pieni poteri entro i permessi
  dell'utente», agisce subito, chiede una cosa sola solo se cambia
  l'esito, mai «non ho lo strumento» se esiste).
- **B. Strumenti di scrittura** (`strumenti/scrittura.ts`, 13 tool R1,
  registro 1.10.0 = 44 azioni): crea/aggiorna cliente, crea/aggiorna/
  archivia/ripristina commessa, aggiorna/chiudi ticket, pianifica
  intervento, collega/classifica/segna gestita comunicazione, risolvi
  caso. Ogni tool esegue la STESSA procedura del router con il contesto
  server dell'utente (`strumenti/comune.callerPer`): stesse capability,
  stessa sede, stessa `authorizeCoreOperation`; esito con prima/dopo;
  nota «creato/archiviato da Tars». Test `scrittura.test.ts` (incluso il
  rifiuto in `policyMode: enforce` senza leak).
- **C. Visibilità**: pagina `/tars` con il selettore **Chat / Proposte /
  Registro** in testa (`TarsProposteBoard.tsx`, `TarsRegistro.tsx`; la sera
  stessa, su richiesta della direzione «migliora la UI/UX, soprattutto le
  proposte», Proposte e Registro hanno preso la vista centrale larga —
  seconda stesura dopo un nuovo «non va bene»: una CODA DI DECISIONI a
  righe a tutta larghezza (colonne laterali nascoste), per riga titolo,
  «Collega a <commessa>» in evidenza con chip sicuro/probabile/urgente e
  allegati, bottone grande Approva + Rifiuta, «Perché e cosa succede» a
  richiesta; filtri Tutte/Comunicazioni/Analisi/Documenti; registro a
  colonne. In sviluppo `/tars?demoProposte` mostra dati finti per
  guardarla piena).
  Proposte = smistamento (`tars.smistamentoProposte`) + gateway documentale
  (`tars.proposte`, nuovo) con Approva/Rifiuta a un click; Registro =
  `tars.registroAzioni` (nuovo) dal ledger R1: strumento, esito, «Tars per
  <utente>», quando, entità toccate cliccabili, annullabile.
- **Smistamento, stesso giorno sera** (mandato: «anche queste proposte
  sono inutili» su casi come «unica commessa attiva della cliente»):
  collegamento AUTOMATICO anche senza verdetto deterministico quando il
  modello indica una commessa con confidenza alta e quella commessa è
  l'unico candidato commessa (o stacca il secondo di ≥ 20 punti, punteggio
  ≥ 30, non archiviata) — `applica.collegamentoSicuroDalModello`; le
  ambiguità (due commesse dello stesso cliente) restano proposte.
  `VERSIONE_SMISTAMENTO` 1.2.0: il worker riesamina le proposte aperte
  vecchie. «Deve stare attento a non collegarli se sono già presenti»:
  `archiviaAllegatoComunicazione` non duplica più un file già nel
  fascicolo (checksum SHA-256; per i legacy senza checksum nome+dimensione,
  `trovaDuplicatoNelFascicolo`), vale per smistamento, strumento R1 e
  archiviazione manuale dal lettore mail; l'esito dice «già presente».
  Riesame in produzione dopo il deploy delle 20:52: prima proposta
  trasformata in collegamento automatico (Delle Cave), zero duplicati; ma
  due proposte nuove nascevano da «responsabilità limitata semplificata»
  (l'azienda stessa censita come cliente con la forma giuridica per
  esteso) e «La Spezia» candidava Comune e Polizia di Stato → forme
  giuridiche, enti e località nella stoplist dei candidati; un candidato
  SOLO cliente si propone soltanto a confidenza alta (Baldacci «media» era
  rumore). `VERSIONE_SMISTAMENTO` 1.3.0.

Non fatto: conferme pendenti nei turni dentro la sezione Proposte (restano
nel thread); Undo dal Registro (solo segnalato «annullabile»); analisi
azienda e sintesi giornaliera (fase successiva del piano smistamento).

## 11-vicies decies. Analisi azienda e sintesi giornaliera (02/09/2026, sera)

Fase successiva del piano smistamento, mandato direzione «non sta
analizzando l'azienda … deve proporre». Piano
`docs/superpowers/plans/2026-09-02-tars-analisi-azienda.md`, modulo
`server/tars/analisi/`.

- **Fotografia deterministica** (`fotografia.ts`): commesse attive per
  stato e ferme da più tempo, casi aperti del Centro Azioni, osservazioni
  aperte, pattern del periodo, smistamento (urgenti / da rispondere / da
  decidere, contatori di oggi), ticket aperti, interventi dei prossimi
  sette giorni, proposte documentali. Sede-scoped, senza importi, ogni
  fatto con i riferimenti delle entità e un link; una fonte che fallisce
  non azzera la fotografia.
- **Sintesi del modello** (`analisi.ts`, prompt `analisi-v1`, JSON strict,
  `TARS_MODEL_ANALISI` default `gpt-5.6-sol`, classe `analisi_azienda`):
  sintesi ≤ 700 caratteri, fino a 8 punti (rischio / anomalia / andamento
  / opportunità, con priorità), fino a 6 proposte con `richiestaPerTars`
  (la frase da dire a Tars per eseguirla), fino a 3 domande. Verifica
  deterministica: entità solo dalla fotografia, importi scrubbati,
  limiti. Senza provider: sintesi deterministica dai contatori.
- **Una al giorno per sede** (`worker.ts`, giro ogni 5 minuti, dalle
  06:00 ora di Roma), registro `tars_analisi_azienda` (unique sede+giorno,
  jsonb con `sql.json`, memoria senza PostgreSQL); un errore resta
  registrato e si ritenta da solo dopo mezz'ora, al massimo tre volte al
  giorno (colonna additiva `tentativi`); oltre, la direzione rigenera a
  mano. Prima analisi reale: sede 2 ok (34 fatti, 6 punti, 6 proposte,
  ~0,18 USD), sede 1 troncata a 2.500 token di output → tetto portato a
  8.000.
- **Endpoint** `tars.analisiAzienda` / `tars.analisiAziendaRigenera`
  (direzione + `commessa.read`), flag `FLAG_TARS_ANALISI_AZIENDA`
  (fail-closed, richiede `FLAG_TARS_PROACTIVE`).
- **UI /tars**: sezione «Analisi di oggi» nel pannello contesto (sintesi,
  punti cliccabili, domande, Rigenera; passata come slot così i render
  statici del pannello non toccano tRPC), sintesi nello stato vuoto della
  conversazione, gruppo «Dall'analisi dell'azienda» nella scheda Proposte
  con «Chiedi a Tars» che precompila la chat (su mobile chiude il foglio).
  Nessuna mutazione nasce dall'analisi: Tars esegue in chat con i suoi
  strumenti e l'effetto finisce nel Registro.

Test `server/tars/analisi/analisi.test.ts` (fotografia sede-scoped e
tollerante, verifica, provider finto, worker una-al-giorno / ora minima /
errore registrato). Fuori taglio: dati economici, invio della sintesi via
mail, storico fra giorni.

## 11-vicies undecies. «Tars consuma troppo crediti» — misura e tagli (02/09/2026, notte)

Ledger `tars_costi` del 02/09: 2.912 chiamate, 28,33 USD, di cui 27,23
dello smistamento (2.894 chiamate a `gpt-5.6-terra` per smaltire 90
giorni di arretrato, 5,5 M token d'ingresso, a tariffa doppia perché
`TARS_SERVICE_TIER=priority` — acceso per la latenza della chat — valeva
per tutte le classi). Chat: 0,48 USD; analisi azienda: 0,62 USD. Il
giorno prima: 0,48 USD in tutto.

Tagli (commit di questa sezione):
- **Profilo per classe** (`governor.profiloEsecuzione`, campo
  `esecuzione` della `RichiestaProvider`): solo `interactive` usa il tier
  dell'ambiente e `TARS_REASONING_INTERACTIVE`; ogni classe in background
  viaggia su tier normale con `TARS_REASONING_BACKGROUND` (default
  `low`). `tariffaDi(modello, tier)` scala per classe, così il ledger
  combacia con ciò che parte davvero.
- **Smistamento**: modello solo entro `TARS_SMISTAMENTO_GIORNI_MODELLO`
  (14, era 90); spam/marketing evidenti senza candidati smistati dal solo
  filtro; corpo a 3.500 caratteri (era 6.000), un allegato con testo da
  1.500 caratteri (erano due da 2.500).
- **Incidente collaterale**: la direzione aveva impostato
  `TARS_MODEL_INTERACTIVE=gpt-5.5`, fuori dal catalogo chiuso delle
  tariffe → il governor rifiuta e la chat scivola sul provider finto.
  Riportato a `gpt-5.6-terra` (approvato, 2,5× meno di sol). Un nuovo
  modello entra solo aggiungendo la tariffa di listino a
  `costi/tariffe.ts` (gate §4).

Atteso: smistamento a regime ≈ 50–80 chiamate/giorno × ~0,004 USD
(tier normale, prompt corto) ≈ 0,3 USD/giorno; analisi ≈ 0,3 USD/giorno;
chat secondo l'uso.

## 11-vicies duodecies. «Tars non fa quello che gli dico» — transizioni libere e niente proposte su lavoro morto (03/09/2026, notte)

Chat della direzione: «porta la commessa Da Pozzo come finita» → Tars
faceva UN passaggio (ordini ultimazione) e si fermava al gate «manca
saldo o fattura»; «portala a interventi» → «non eseguito, deve prima
passare da…». Poi: «tars continua a fare proposte su commesse vecchie
mesi o già gestite». Misura: 40 proposte di smistamento aperte, 32 su
mail più vecchie di 30 giorni, 12 oltre 120 (percorso deterministico
sull'arretrato).

- **Transizioni** (`strumenti/commesse.ts`, tool 1.1.0; dominio
  `commesse/transizioni.ts`): lo strumento accetta lo stato di ARRIVO,
  anche non adiacente, e fa i passaggi uno alla volta (ognuno registrato
  e annullabile, Undo dall'ultimo). Un gate documentale lo ferma e dice
  cosa manca (`transizione_parziale`); con `scavalcaGate: true` — che il
  modello passa SOLO quando l'utente ha chiesto esplicitamente lo stato o
  «procedi comunque» — scavalca come «Procedi comunque» dal board, con la
  stessa capability, registrato (`bypassGateDocumentale`) e dichiarato
  nelle avvertenze. Il dominio vieta il bypass solo all'Undo. Via anche il
  rifiuto «rileggi prima» sul contesto persistito (il lock ottimistico
  del dominio basta). Prompt v10: sinonimi «finita → finiture_saldo,
  interventi → interventi_regolazioni, chiusa → archiviata, indietro»;
  «non fermarti a metà di un compito».
- **Proposte di smistamento**: nessuna proposta su comunicazioni oltre
  `TARS_SMISTAMENTO_GIORNI_PROPOSTE` (30) o già gestite — i collegamenti
  CERTI si applicano comunque; a ogni giro il worker chiude come
  `scaduta` le proposte aperte su mail invecchiate, gestite o collegate a
  mano.
- **Analisi**: le commesse ferme da oltre 120 giorni sono «dormienti»,
  sezione a parte con i loro casi; il prompt (analisi-v2) non propone
  lavoro su di esse, al più una proposta unica di archiviazione.

Test: `azioni/commesse.test.ts` (percorso a più passaggi, gate, scavalco
registrato, Undo, all'indietro), `commesse/transizioni.test.ts` (bypass
vietato solo all'Undo), `smistamento/applica.test.ts` e `worker.test.ts`
(niente proposte su mail vecchie/gestite, scadenza), `analisi.test.ts`.

## 11-vicies semel. UI v2 Frame & Flow — Modular Control migrato (31/08/2026)

Branch `codex/modular-control-completion` (worktree
`.worktrees/codex-modular-control-completion`), **non pushato**: nessun deploy,
nessuna operazione Railway. Vale la regola nota — push su `main` = deploy
Railway automatico — quindi finché il branch non viene integrato la produzione
non cambia.

**Stato.** Tutte le route registrate in `client/src/App.tsx` sono migrate alla
grammatica Modular Control (`PageHeader`, `DataSurface`, `StatePanel`,
`StickyActionBar`, `ContextInspector`), tranne due esclusioni motivate:

- `/fornitori` — **rimossa il 04/09/2026** (la candidatura alla rimozione qui
  registrata è stata confermata dalla direzione). La rotta resta come redirect.
- `LoginPage` — fuori dalla shell e fuori dal flag, per il confine di
  autenticazione già documentato nel manifest.

I redirect (`/produzione/*?`, `/comunicazioni`) restano superfici senza pagina,
coperte dai test di redirect.

**Come è stato fatto.** Slice 03 (route operative) e 04 (supporto e
amministrazione) eseguite a batch, ognuno con revisione condotta da un revisore
separato dall'implementatore; round, decisioni e rilievi minori rimandati sono
nei ledger
`.superpowers/sdd/2026-08-31-modular-control-03-operational-routes/progress.md`
e
`.superpowers/sdd/2026-08-31-modular-control-04-support-admin-routes/progress.md`.
In coda al programma: avatar utente nella shell (footer e trigger profilo, con
test di guardia sulla dimensione dell'asset) e deep link delle viste del Centro
azioni (`/notifiche?view=mine|critical|resolved|impostazioni`, helper puro in
`client/src/lib/notificationView.ts`).

**Prove.** `docs/design/modular-control/route-manifest.md` (stato per route) e
`docs/design/modular-control/verification-log.md` (gate del 31/08: `pnpm
check`, `pnpm test` 1106 passati e 8 saltati, `pnpm build`, vitest mirati per
batch, spot-check browser 1440×900 e 390×844 su route campione, console senza
errori). **Non eseguita** la matrice completa di evidenze viewport × axe × zoom
per route: è una decisione registrata, non una dimenticanza, e le colonne
`evidence/...` del manifest restano destinazioni previste, non file esistenti.

**Follow-up aperti.**

1. Divergenza R6 — su `/pagamenti` il `BreakEvenPanel` resta gated sul ruolo
   (`requireDirezioneOAmministrazione`), fuori dal modello capability.
   Preesistente e fail-safe; cambiarlo richiede una decisione di prodotto.
2. Divergenza R7 — `/economia` apre lato client su `economia.read` mentre i
   router FiC richiedono ancora il ruolo direzione/amministrazione: chi ha la
   capability senza il ruolo vede pannelli di errore (fail-closed, nessuna
   cifra esposta). L'allineamento server è una decisione di prodotto separata.
3. `StickyActionBar`: lo slot di stato annuncia in `aria-live` a ogni ricalcolo
   del totale. Va risolto sul pattern condiviso, non nelle singole pagine.
4. Idea registrata: componente condiviso `<PersonAvatar name>` — le iniziali
   sono ancora inline in circa sette pagine.
5. I rilievi minori rimandati batch per batch sono elencati nei due ledger SDD
   sopra: è il backlog UI più onesto che esista oggi.

## 11-vicies terdecies. Contratto strutturato e computo limiti — piano 1 (03/09/2026)

Piano 1 di 3 (`docs/superpowers/plans/2026-09-03-contratto-e-computo-limiti.md`,
16 task) chiuso su `feature/limiti-fatturazione`, **su `main` dal merge
`9afaf4c` (04/09/2026)**.
Spec di riferimento:
`docs/superpowers/specs/2026-09-03-limiti-e-fatturazione-design.md` (§1-§13);
le formule del motore e il modello delle righe seguono invece
`docs/superpowers/specs/2026-09-03-limiti-analisi-fogli-reali.md`, che
**integra e prevale sulla spec dove divergono** — è la specifica scritta a
mano su tre commesse reali chiuse nel 2026 (fatture FiC 127, 129, 130) con
foglio «CALCOLO NUOVI LIMITI» compilato.

**Cosa esiste.**

- Contratto strutturato: `server/contratti/repository.ts` (tabelle
  `commessa_contratti`, `commessa_righe`; memoria senza `DATABASE_URL`,
  Postgres altrimenti), `server/contratti/hash.ts` (hash di righe e
  parametri), `server/contratti/servizio.ts` (`leggiContratto`,
  `salvaContratto`); router `contratti` (`get`, `salva`, `catalogo`) in
  `server/routers/contratti.ts`.
- Computo limiti: `server/computo/motore.ts` (CHECK1/CHECK2, verificato al
  centesimo sulle tre fatture reali in
  `server/computo/__fixtures__/casi-reali.json`), `server/computo/aggregati.ts`
  (aggregati per gruppo, ore tiro/posa), `server/computo/zone.ts` (zona
  climatica dal comune, Tabella A DPR 412/93), `server/computo/tariffe.ts`
  (caricatore del seed), `server/computo/repository.ts` (tabelle `computi`,
  `computo_voci`), `server/computo/servizio.ts` (`eseguiComputo`,
  `ultimoComputo`, `computoValido`); router `computo` (`ultimo`, `esegui`) in
  `server/routers/computo.ts`; router `tariffe` in `server/routers/tariffe.ts`.
- Dati condivisi: `shared/limiti/tipi.ts`, `shared/euroCent.ts`; seed
  `shared/limiti/tariffe-seed.json` (342 prodotti DEI, 74 accessori, 22
  controtelai, 19 opere; rigenerato da `scripts/estrai-tariffe-limiti.py`, il
  foglio sorgente **non entra mai nel repository**); `shared/limiti/comuni-zona.json`
  (8.104 comuni dal PDF DPR 412/93 — sigle provincia del 1993:
  LO/MB/PU/FM/BT/BI non aggiornate; la provincia disambigua solo gli
  omonimi, non cambia la zona).
- Interruttore `limiti` (env `FLAG_LIMITI`, fail-closed) in
  `server/platform/interruttori.ts`, **spento in produzione**. Capability
  nuove in `server/authz/capabilities.ts`: `contratto.read` (condivisa da
  tutti i ruoli), `contratto.manage` e `computo.run` (amministrazione,
  commerciale, direzione), `tariffe.manage` (solo direzione). Il client non
  duplica queste stringhe in `client/src/lib/roles.ts` (che resta solo
  helper di ruolo): legge il proprio set effettivo da `trpc.permessi.mie`
  in `client/src/contexts/OperationalContext.tsx`.
- Gate: `richiedeComputo` (`server/commesse/transizioni.ts`) blocca **solo**
  il passo `aggiornamento_contratto → fatture_pagamento`. Lo scavalco è lo
  stesso `bypassGateDocumentale` del dialog «Procedi comunque» del board,
  registrato come `gateScavalcato: "documentale" | "computo"` in
  `RegistroTransizione` (`null` quando non c'era un gate da scavalcare).
  Tars vede lo stesso gate: `verifica_transizione_commessa` chiede
  `computoValido` sul passo governato e restituisce `gate.computo`
  (`richiesto`/`valido`), quindi l'anteprima dichiara il blocco prima di
  muovere qualcosa; `transizione_adiacente_commessa` lo rivaluta a ogni
  tappa e senza scavalco si ferma dicendo che manca il **computo**, non un
  file, con l'istruzione `scavalcaGate: true`. Con lo scavalco — solo su
  richiesta esplicita dell'utente — il passaggio usa lo stesso
  `bypassGateDocumentale`, l'avvertenza nomina il gate del computo e il
  registro segna `gateScavalcato: "computo"`. `motivoSicuro`
  (`server/tars/strumenti/commesse.ts`) resta la rete per il caso TOCTOU in
  cui il gate cambia tra verifica ed effetto.
- UI: tab «Contratto» al posto di «Prodotti» quando il flag è acceso
  (`client/src/components/contratto/ContrattoTab.tsx`,
  `RigaContrattoEditor.tsx`), tab «Limiti»
  (`client/src/components/computo/LimitiTab.tsx`), riga di stato
  `ContrattoStatoBanner.tsx`, badge «da contratto · {pattuitoTipo}» accanto
  al pattuito nella card Pagamenti di `client/src/pages/CommessaDetail.tsx`,
  pannello Tariffe in sola lettura in Impostazioni
  (`client/src/components/computo/TariffeLimitiPanel.tsx`, dietro
  `tariffe.manage`).

**Come si usa.** Con `FLAG_LIMITI=on`: tab Contratto → si inseriscono le
righe (misura, codice prodotto del catalogo DEI, accessori, eventuale
oscurante abbinato) e i dati di testata (pattuito, tipo IVA, rate, opzioni
di computo) → Salva — `applicaPattuitoDaContratto` in
`server/routers/commesse.ts` allinea pattuito e piano rate della commessa
alle nuove righe, senza toccare le rate già incassate — → tab Limiti →
«Calcola i limiti» (richiede `computo.run`): il motore deriva la zona dal
comune, aggrega le righe, calcola CHECK1 e CHECK2 e mostra il limite
vincolante voce per voce, con `inclusa`/`inCheck2` per ciascuna. Avanzando
la commessa da «Aggiornamento contratto» a «Fatture pagamento»: se il
computo è valido (hash righe e parametri = correnti) il passaggio è
diretto; se il contratto manca o è stato modificato dopo l'ultimo computo
compare lo stesso dialog «Procedi comunque» dei gate documentali — «Il
computo dei limiti manca o non è aggiornato per lo stato "Aggiornamento
contratto": compila il contratto e calcola i limiti dalla tab Limiti.
Procedere comunque?» — e lo scavalco resta registrato.

**Cosa manca.**

- Fatturazione dal contratto (piano 2, `FLAG_FATTURAZIONE`): oggi il
  pattuito «da contratto» mostrato in Pagamenti è **solo uno specchio di
  UI** (commento esplicito in `CommessaDetail.tsx`); la riaffermazione lato
  server, la bozza fattura e l'emissione via FiC arrivano col piano 2.
- Lettura del contratto da PDF (piano 3, `FLAG_CONTRATTO_ESTRAZIONE`): oggi
  solo inserimento manuale delle righe, nessuna estrazione automatica.
- Tariffe modificabili con validità (decisione D10 della spec):
  `TariffeLimitiPanel` è sola lettura; il seed si aggiorna solo rigenerando
  `shared/limiti/tariffe-seed.json` da `scripts/estrai-tariffe-limiti.py`,
  non da UI.
- Fixture d'oro estesa dai fogli reali (05/09/2026, Ruling R22):
  `server/computo/__fixtures__/casi-reali.json` ha ora **20 casi** (i 3
  storici + 17 nuovi dai 19 fogli «CALCOLO NUOVI LIMITI» compilati nel 2026,
  mai entrati nel repository — solo misure, codici DEI e totali anonimi
  escono nel caso). **13 verdi al centesimo**, **7 saltati** con il motivo
  scritto nel campo `salta` di ciascun caso: non è tolleranza allargata, sono
  divergenze capite e dichiarate. Si rigenera un caso con
  `python3 scripts/harvest-fixture-limiti.py <foglio.xlsm> --nome <nome>
  --detrazione ecobonus|ristrutturazione` (stampa il caso JSON su stdout, i
  dubbi su stderr; mai il foglio, mai un nome di cliente entra nel
  repository). L'harvest ha trovato e corretto due bug del motore, già su
  questo branch: **H1**, la maggiorazione dell'avvolgibile abbinato aveva
  larghezza e altezza scambiate — i coefficienti del seed sono stati
  rinominati `avvolgibileExtraLarghezza`/`avvolgibileExtraAltezza` (prima
  `avvolgibileExtraL`/`avvolgibileExtraH`), stesso valore, dimensione giusta;
  **H2**, un cassonetto venduto insieme al serramento (blocco B del foglio)
  pesava nel massimale A invece che in B — nuova chiave `cassonettiB` in
  `aggregati.ts`. Restano parcheggiate, in attesa di una decisione di
  direzione o commercialista, quattro divergenze che i casi saltati
  dichiarano una per una: **H3** le veneziane del blocco D sono a pezzo nel
  foglio, a mq nel seed; **H4** cinque fogli vengono da un'edizione
  precedente del listino DEI (44 prezzi diversi dal seed, che è a versione
  unica); **H5** il foglio somma nei totali solo le opere davvero fatturate
  (colonna «Da fattura»), il motore un insieme fisso — `OpzioniComputo` non
  sa escludere una singola opera; **H6** lo stesso foglio prezza
  l'avvolgibile PVC standard a due prezzi diversi (111,11 €/mq nel primo
  blocco di «Calcolo Automatici B», 110,63 dal secondo in poi) — un settimo
  caso resta fuori per una riga senza prodotto oscurante scelto, fail-closed
  per progetto, nessuna decisione da prendere. **H7** invece è chiuso in
  questo giro: il form dichiara l'oscurante abbinato anche su una riga
  cassonetto (`RigaContrattoEditor`, stesso filtro `prodottiPerOscurante` dei
  serramenti) e le avvertenze «oscurante senza voce DEI» (servizio e
  `contrattoView`) non scattano più su un cassonetto abbinato senza una
  tipologia propria — la tapparella che ospita è già la voce DEI della riga
  del serramento, non una seconda voce di questa riga (stessa eccezione di
  `motore.ts`, spec §2.1). **H8** (re-review di H7, stesso giorno) restringe
  l'abbinamento: il form ammette solo la tapparella (mai persiana o scuro) e
  la tipologia dell'oscurante resta sempre vuota su un cassonetto, con
  `VALIDAZIONE` lato form (`erroriForm`) e servizio se la riga non rispetta
  la regola — il motore non cambia. Resta da raccogliere un foglio reale con
  serramenti in legno: nessuno dei 19 lo usa.
- Debito tecnico minore: i test di servizio di `server/contratti` e
  `server/computo` non possono forzare il repository in memoria quando
  `DATABASE_URL` è impostata — `getContrattiRepository`/`getComputiRepository`
  scelgono il driver da un singleton legato all'env al primo uso, non
  iniettabile dal test.

- Debito residuo dichiarato dalla review finale (04/09/2026), tutto
  rinviato a dopo il merge: (1) `applicaPattuitoDaContratto` mette il resto
  dell'arrotondamento sull'ultima rata, che può scendere sotto zero solo se
  lo split sfrutta la tolleranza di ±0,01 punti di `validaRate` (≤ 0,0001 ×
  totale, irraggiungibile dalla UI); (2) l'INSERT in blocco di
  `commessa_righe`/`computo_voci` ha il tetto PostgreSQL di 65 535
  parametri (~2 900 righe, ~4 600 voci per statement); (3) su uno step con
  gate computo Tars legge il computo due volte (pre-verifica più ricontrollo
  del dominio), una riga sola; (4) all'apertura di una commessa l'override
  di policy viene caricato due volte da `authorizeCoreOperation`; (5) in
  `RigaContrattoEditor` la quantità degli accessori non segue quella della
  riga e la numerazione delle righe è triplice (ordine, indice, id);
  (6) `TariffeLimitiPanel` restituisce null su errore invece di dirlo;
  (7) `immobile` null viene letto come «altro»; (8) i CHECK constraint
  delle tabelle non sono additivi (una categoria nuova richiede una
  migrazione); (9) la spec di design §4.1/4.2 descrive ancora il motore
  della prima stesura: prevale l'analisi dei fogli reali.

**Runbook di attivazione.** Per una sede di prova: 1) accendere
`FLAG_LIMITI=on` solo su quella sede/ambiente — `.claude/launch.json` ha
già la configurazione «Limiti demo (porta 5198)» con il flag acceso; 2) il
seed dei comuni (`shared/limiti/comuni-zona.json`) è un import statico
letto da `server/computo/zone.ts`: non serve nessun caricamento manuale,
solo il deploy del codice; 3) su una commessa reale già chiusa, compilare
il contratto con le stesse righe del foglio «CALCOLO NUOVI LIMITI»
compilato a mano, calcolare i limiti e confrontare CHECK1/CHECK2 **voce
per voce** con il foglio, non solo il totale; 4) solo dopo un confronto
pulito su almeno una commessa reale per sede, considerare il gate
affidabile per quella sede — resta comunque scavalcabile con «Procedi
comunque» e ogni scavalco resta nel registro.

**Verifica (03/09/2026).** `pnpm check` pulito (nessun errore); `pnpm test`
170 file passati e 6 saltati (176), 1586 test passati e 23 saltati (1609),
0 falliti — i saltati sono le suite `*.pg.test.ts` (incluse
`server/contratti/repository.pg.test.ts` e
`server/computo/repository.pg.test.ts`) che girano solo con `DATABASE_URL`:
il controller le ha eseguite a parte contro un PostgreSQL 16 locale, tutte
verdi; `pnpm build` completa (`dist/public` + `dist/index.js`) con un solo
avviso, esbuild che segnala `dist/index.js` a 2,6 MB — lo stesso avviso già
noto da `docs/design/modular-control/verification-log.md` (1,1 MB alla
baseline del 31/08, 1,3 MB al gate 03+04): cresce con ogni feature del
bundle server, non è stato introdotto da questo piano. Il percorso in
browser (commessa → tab Contratto → salva → Limiti → Calcola → avanzamento
a «Fatture pagamento» con e senza dialog, screenshot 1440×900 e 390×844,
console senza errori) è registrato nella verifica del controller, eseguita
in parallelo a questo task, non in questa sezione.

**Verifica (04/09/2026, dopo la review finale).** `pnpm check` pulito;
`pnpm test` 1591 passati e 23 saltati; le due suite pg 3/3 contro
PostgreSQL 16 locale; `pnpm build` ok. In browser sul demo (flag acceso):
da Commessa 360, con il file contratto caricato e nessun computo, «Avanza
a: Fatture / Pagamento» apre «Computo dei limiti non aggiornato» col
messaggio del server e «Procedi comunque» completa la transizione; senza
file contratto compare prima il dialogo documentale (precedenza corretta);
Impostazioni → «Limiti di spesa» mostra il pannello tariffe (seed
2026-09-04, sei tab) senza overflow orizzontale. Nota operativa: il server
demo va riavviato dopo ogni modifica server, `tsx` senza `watch` non
ricarica i router (un `tariffe.limiti` → 404 «No procedure found» è un
processo vecchio, non un bug).

## 11-vicies quaterdecies. Fatturazione dal contratto — piano 2 (04/09/2026)

Piano 2 di 3 (`docs/superpowers/plans/2026-09-04-fatturazione-dal-contratto.md`,
18 task) chiuso su `feature/fatturazione`, **su `main` dal push fast-forward
`4104e27` (04/09/2026)**. Spec
di riferimento: `docs/superpowers/specs/2026-09-03-limiti-e-fatturazione-design.md`
(§7-§13, allineata da questo task). Sopra il piano 1 (§11-vicies terdecies):
dal contratto strutturato e dal computo limiti nasce la bozza fattura, che il
CRM emette su Fatture in Cloud (FiC) con invio SdI in prova, archivia PDF/XML
e ne segue lo stato; nota di credito totale o parziale sulla stessa pipeline.
Le tre fatture reali del 2026 usate come fixture d'oro (127, 129, 130 —
`server/fatture/__fixtures__/fatture-reali.json`) sono le uniche citabili
qui: nessun nome cliente, indirizzo, CF o importo di fattura reale altrove
in questa sezione. I commit del ramo: `git log --oneline 9afaf4c..HEAD`.

**Cosa c'è.**

- Persistenza: 6 tabelle Postgres (`fatturazione_config`, `fatture`,
  `fattura_righe`, `fattura_riepilogo_iva`, `fattura_scadenze`,
  `fattura_eventi`) in `server/fatture/repository.ts` (memoria senza
  `DATABASE_URL`, Postgres altrimenti — `ensureSchema` memoizzato con ALTER
  additivi); blocco ottimistico su `revisione` in `aggiornaBozza` ed
  `emettiFattura`, più il lease dell'emissione (`aggiornaStato` con
  `atteso: { stato, revisione }`, compare-and-swap che incrementa la
  revisione, R35); ogni scrittura tocca un contatore in
  `server/fatture/versioni.ts`, letto da Tars.
- Motore puro: `server/fatture/risolutore.ts` (`risolvi` deriva prestazione,
  markup, storno e riepilogo IVA da G/B/N/S; `riequilibraBeni` con
  arrotondamento cumulativo), `server/fatture/generatore.ts` (`generaBozza`,
  righe da contratto+computo+config, pura), verificati al centesimo sulle
  tre fatture reali in `server/fatture/__fixtures__/fatture-reali.json`.
- Servizio: `server/fatture/servizio.ts` (`creaBozza`, `aggiornaBozza`,
  `rigeneraBozza`, `annullaBozza`, `verificaLimiti`, `validaPerEmissione`),
  `server/fatture/cliente.ts` (snapshot cliente con fallback per record
  legacy, commit 57ae726), `server/fatture/config.ts` (config per sede +
  `verificaScopeScrittura`, IBAN col modulo 97), `server/fatture/dryRun.ts`
  (`sdiDryRun`).
- Emissione: `server/fatture/emissione.ts` (`emettiFattura`, idempotente per
  passo: validazione → cliente_fic → documento_fic → confronto_totali → xml
  → invio → archivio → documento_fascicolo → timeline), `server/fic/emissione.ts`
  (client HTTP: clienti, documenti, XML, invio SdI) con fake a copione in
  `server/fic/fake.ts`; `server/fatture/sonda.ts` (`giroSonda`,
  `aggiornaStatoFattura`, `startSondaFattureWorker` ogni 15 minuti, avviato
  una volta sola da `server/_core/index.ts`); `server/fatture/notaCredito.ts`
  (`creaNotaCredito`, totale o parziale, stessa pipeline con
  `type: credit_note`).
- Router: `server/routers/fatture.ts` (`trpc.fatture`: perCommessa, byId,
  creaBozza, aggiornaBozza, rigeneraBozza, validazioni, emetti,
  aggiornaStato, notaCredito, annullaBozza, lista, documento — download
  PDF/XML) e
  `server/routers/fatturazioneConfig.ts` (`trpc.fatturazioneConfig`: get,
  salva, verificaScope) — dietro `FLAG_FATTURAZIONE` in middleware
  (`procedureConInterruttore`) e `FLAG_LIMITI` per handler
  (`assicuraInterruttore("limiti")`). Capability nuove in
  `server/authz/capabilities.ts`: `fattura.read` (amministrazione,
  commerciale, direzione), `fattura.draft`/`fattura.emit`/`fattura.credit_note`
  (amministrazione, direzione).
- UI: 7 componenti in `client/src/components/fattura/` (`FatturaTab`,
  `BozzaFatturaEditor`, `ScadenzeEditor`, `NotaCreditoDialog`,
  `FatturaEmessaView`, `FatturazioneConfigPanel`, `FattureEmesseSezione`),
  presentazione pura in `client/src/lib/fatturaView.ts`; montati nella
  commessa (tab «Fattura»), in Impostazioni → Contabilità (pannello
  Fatturazione, gate `isDirezione` come tutta la sezione) e in
  `/pagamenti` (Cassa, sezione «Fatture emesse dal CRM»). Solo gli helper
  di `client/src/lib/euro.ts`, nessun hex locale.
- Sync FiC esistente: `server/routers/ficFatture.ts` collega da sé un
  documento FiC il cui id combacia con `fatture.fic_document_id`
  (`commessaMatch: "crm"`, mai match automatico né secondo PDF; la mappa
  la costruisce `collegamentiCrmPerFic` in `fattureInCloud.ts` leggendo
  `perFicDocumentIds` — solo gli id del giro, nessun tetto di 200, R37);
  il worker
  di sync allegati (`server/routers/ficAllegati.ts`) salta il ridownload —
  il PDF è già nel fascicolo da `registraDocumentoFatturaCrm` all'emissione.
- Tars: nessuno strumento nuovo (v. `docs/tars/matrice-azioni-tars.md`).
  `leggi_fascicolo_commessa` (nome, capability e schema invariati;
  `descrizione` aggiornata dal Task 17) espone, col flag acceso, una riga
  per fattura/nota — MAI un importo — da `server/tars/fascicoli.ts`:
  bozza → `Fattura: bozza #<id>` (+ ` · scavalco limiti attivo`);
  emessa+ → `Fattura n. X del Y: <stato leggibile>[ · prova SdI][ ·
  avviso: esito SdI/FiC da verificare nella tab Fattura]` — la coda
  avviso è una frase fissa, mai il testo di `eiErrore`, che porta importi
  (R36);
  l'invalidazione passa da `server/fatture/versioni.ts` +
  `server/tars/versioni.ts` (chiavi `fatture-di-commessa:<id>` e
  `flag:fatturazione`, quest'ultima sempre presente per accorgersi anche di
  un flip a runtime del flag, non solo di una scrittura).

**Come si attiva.** `FLAG_FATTURAZIONE=on` per deployment/ambiente
(fail-closed, non un campo per sede) — richiede `FLAG_LIMITI=on` sullo
stesso ambiente, verificato da ogni handler dei due router. Poi, per sede:
Impostazioni → Contabilità (direzione) → riga «Permessi di scrittura
fatture» → «Ri-autorizza con permessi di scrittura» (bottone visibile solo
con OAuth client FiC configurato) rifà il consenso OAuth chiedendo anche la
scrittura; nel pannello Fatturazione, «Verifica permessi» chiama
`/issued_documents/info` e carica in cache le aliquote IVA 22/10, le
numerazioni, i conti e i metodi di pagamento — il conto si auto-assegna se
è l'unico e, dopo la verifica, entra nel modulo solo se il campo era vuoto
(un conto scelto a mano non si perde con un modulo sporco, Ruling R29).
Restano da compilare IBAN, banca, intestatario, metodo di pagamento,
numerazione FiC e spese di documentazione (default 150,00 € per sede).

**Runbook della prima fattura reale.**

1. Sede/ambiente di prova, `FLAG_LIMITI` e `FLAG_FATTURAZIONE` accesi lì
   soltanto; `FATTURAZIONE_SDI_DRY_RUN` resta al suo default (attivo:
   nessuna variabile da toccare).
2. Una commessa reale già fatturata a mano nel 2026: contratto strutturato
   + computo → «Genera bozza dai limiti» → confronto **riga per riga** col
   PDF della fattura reale — beni, servizi, markup, storno, riepilogo IVA,
   scadenze, spese di documentazione (22 %), dicitura straordinaria/pratica
   edilizia, scadenze 50/40/10 (0/60/75/90 giorni, il resto sull'ultima) —
   e «Riequilibra i beni» fino ai valori tenuti dalla commercialista.
3. **Prima di «Emetti»**, confermare nel pannello Fatturazione la
   numerazione FiC scelta col commercialista: `emissione.ts` manda
   `numeration` solo se `config.numerazioneFic` è valorizzata, e nessuna
   validazione la pretende — se resta «Numerazione predefinita», FiC
   numera con la propria serie e non lo segnala come errore.
4. «Emetti» in dry-run: FiC **numera davvero** il documento (non ha bozze).
   Usare la company di prova FiC consigliata dalla spec §11 (licenza trial
   dal supporto), oppure accettare il numero e stornarlo subito con una
   nota di credito. Un operatore, una scheda, e nessun retry finché la
   chiamata non risponde: due «Emetti» sovrapposti sulla stessa bozza
   danno `CONFLITTO` al secondo quando hanno letto la stessa revisione (il
   lease, R35); una chiamata API diretta avviata dopo il lease e prima che
   FiC risponda resta scoperta (R40, chiusura rinviata alla ricerca su FiC
   di R11): per questo la regola operativa resta aspettare.
5. XML scaricato dalla tab Fattura e verificato dal commercialista.
6. Solo dopo la conferma sull'XML: `FATTURAZIONE_SDI_DRY_RUN=off`. È una
   variabile Railway di **tutto il deployment**, non un campo per sede nel
   database — si spegne su un ambiente dedicato alla sede di prova, come
   già `FLAG_LIMITI` nel runbook del piano 1 (§11-vicies terdecies).

Con dry-run acceso l'invio è simulato: lo stato resta `emessa` (mai
`inviata`) con l'etichetta «Emessa (prova SdI)». La sonda
(`startSondaFattureWorker`) gira ogni 15 minuti in un solo processo e **non
ritenta l'invio**, solo la lettura dello stato SdI e l'archivio mancante.
Alla **prima nota di credito reale**: verificare sul PDF FiC il segno del
totale — il CRM manda righe positive speculari all'origine con
intestazione «Accredito su ns. fattura n. X del Y», le note reali del 2026
in mano alla commercialista stampano il totale in negativo; se FiC inverte
da sé il segno in output va bene così, altrimenti il generatore va
corretto prima della seconda nota (v. spec §7.6, «Aperto»).

**Decisioni prese in corso d'opera che cambiano un contratto (ruling R1–R41,
ledger completo in** `.superpowers/sdd/2026-09-04-fatturazione-dal-contratto/progress.md`
**, grep `Ruling R`; questi «R» sono numeri di ruling di questo piano, non i
livelli di rischio R0–R4 di Tars).**

- R1: `emettiFattura` confronta la revisione **chiesta dall'utente** solo
  alla partenza (`bozza`), prima di toccare il contesto FiC; da
  `in_emissione` in poi ogni ripresa è idempotente per stato e non la
  pretende più.
- R35: la corsa fra due giri sovrapposti la governa invece il **lease**:
  ogni run di `emettiFattura` apre con un compare-and-swap nel repository
  (`aggiornaStato` con `atteso: { stato, revisione }` → `UPDATE … WHERE
  stato = … AND revisione = …`, 0 righe → `CONFLITTO`), che incrementa la
  revisione. Due «Emetti» sovrapposti sulla stessa bozza: il secondo
  riceve CONFLITTO prima di toccare Fatture in Cloud, mai due numeri.
  Vale anche per le riprese; da `emessa`/`inviata` il lease non riporta
  indietro lo stato, serializza soltanto.
- R4: `riequilibraBeni` — arrotondamento cumulativo: somma sempre esatta al
  target, righe mai negative, scarto ≤ 1 centesimo a riga.
- R8: senza voci con limite, `verificaLimiti` dà avviso «limiti non
  verificati», mai un «ok» di comodo; `rigeneraBozza` azzera scavalco e
  motivo, tornando alla proposta di sistema.
- R11: `eiErrore` riscritto in fondo a ogni passaggio (emissione o sonda),
  mai lasciato appiccicato; XML riverificato a ogni ripresa finché non è
  `inviata`; un privato con un nome di una sola parola nasce su FiC come
  `company`, non `person` (FiC rifiuta una `person` senza nome proprio).
- R12: il riappaiamento `ficPaymentId` ↔ scadenza si ritenta a **ogni
  giro** finché ne resta una scollegata, non solo mentre la fattura è
  `in_emissione`.
- R14/R15: la nota di credito salta i controlli di computo/limiti e quelli
  di forma della detrazione (storna, non propone prestazioni nuove) ma
  mantiene cliente, configurazione FiC e scadenze.
- R16: `rigeneraBozza` rifiuta una nota di credito; una nota di credito non
  si storna con un'altra nota.
- R17: le spese di documentazione sono una riga **bene** al 22 % (non un
  servizio), configurabili per sede (`speseDocumentazioneCent`, default
  150,00 €), escluse sia dal blocco prodotti sia dal blocco servizi dei
  limiti.
- R18: righe manuali aggiungibili/rimovibili in bozza (max 20 per
  operazione, 300 caratteri di descrizione).
- R19: dicitura «manutenzione straordinaria» + template della pratica
  edilizia, con avviso `pratica_edilizia_incompleta` quando CILA/SCIA sono
  dichiarate ma il testo lascia segnaposto fra graffe da compilare a mano.
- R20: la nota di credito apre con una riga «Accredito su ns. fattura n. X
  del Y»; gli importi che il CRM manda a FiC restano positivi, speculari
  all'origine — segno da verificare alla prima nota reale (v. runbook).
- R21: IVA al 4 % e B2B senza contratto restano fuori ambito v1.
- R23: la mutation manuale di collegamento del sync FiC rifiuta di
  ricollegare una riga `commessaMatch: "crm"` a un'altra commessa: si
  corregge solo con una nota di credito.
- R24: con `FLAG_LIMITI` spento ogni mutation dei due router risponde
  `PRECONDITION_FAILED`, come tutti i router del repository — non
  `NOT_FOUND` come ipotizzato in una prima stesura del piano.
- R25/R26: i limiti si verificano per **tre blocchi separati** — prodotti
  (beni + markup) contro i massimali, servizi contro le opere proposte,
  imponibile contro il limite del computo — mai come un totale unico; un
  termine di paragone a zero è un avviso `limiti_non_verificati`, mai un
  errore né un «ok».
- R28: la lista delle diciture selezionabili in bozza
  (`DICITURE_SELEZIONABILI`) mostra solo quelle di piè di pagina, non le
  chiavi che il generatore stampa già come testo di riga.
- R29: dopo «Verifica permessi» il conto FiC auto-assegnato dal server
  entra nel modulo solo se il campo è vuoto — un conto scelto a mano non si
  perde con un modulo sporco.
- R30 (parcheggiato): il gate client del pannello Fatturazione resta
  `isDirezione`, come tutta la sezione Contabilità — non un pre-check
  isolato.
- R34: attivare lo scavalco dei limiti («Procedi comunque») da
  `fatture.aggiornaBozza` richiede una **seconda** autorizzazione con
  capability `fattura.emit` (endpoint `fatture.scavalcoLimiti`) e un
  motivo non vuoto, controllato nel servizio perché valga anche fuori dal
  router. Spegnerlo resta un'operazione da `fattura.draft`.
- R31: la riga fattura nel fascicolo Tars non porta **mai** un importo —
  il fascicolo vive dietro `commessa.read`, non dietro le capability
  economiche.
- R36: per lo stesso motivo la riga non stampa `eiErrore` verbatim (ci
  finiscono i totali FiC) ma la frase fissa « · avviso: esito SdI/FiC da
  verificare nella tab Fattura», e la bozza non porta un conteggio di
  controlli che senza un computo fresco non descriverebbe niente: dice
  solo l'id e, se c'è, lo scavalco dei limiti attivo.
- R32/R33: il fascicolo si invalida da solo a ogni scrittura sulla fattura
  (chiave `fatture-di-commessa:<id>`) e a ogni flip del flag
  `fatturazione` (chiave sintetica `flag:fatturazione`, sempre presente),
  mai per un cambio scollegato come il rollover di giornata.

**Debito e fuori ambito** (voce completa in «Debito aperto prioritario»
qui sotto). PEC, codice destinatario e `ficEntityId` del cliente sono campi
server (`clienti.update`) senza UI nel form cliente. Fatture libere,
acconti, IVA al 4 % e B2B senza contratto restano fuori ambito v1 (D3/D6
della spec, R21). I ~20 fogli «CALCOLO NUOVI LIMITI» reali raccolti il
04/09 (xlsm, Desktop, mai nel repository) diventano fixture d'oro del
motore computo in un task a parte, dopo questo piano (R22). Piano 3
(lettura del contratto PDF via
provider governato di Tars + OCR esistente):
`docs/superpowers/plans/2026-09-04-lettura-contratto.md`, non iniziato.
Aperti da confermare col commercialista: aliquote di detrazione 2025/2027
nel seed (piano 1), segno della nota di credito (v. runbook), company FiC
di prova per la prima emissione reale (la numerazione è reale, non
simulata).

**Verifica (04/09/2026, allineamento documentale).** `pnpm check` pulito
(nessun errore); `pnpm test` 210 file passati e 7 saltati (217), 2018 test
passati e 32 saltati (2050), 0 falliti — i saltati sono le suite
`*.pg.test.ts` (incluse quelle di `server/fatture` e `server/contratti`/`server/computo`)
che girano solo con `DATABASE_URL`, non eseguite da questo task documentale;
`pnpm build` completa (`dist/public` + `dist/index.js`) con l'unico avviso
noto, esbuild su `dist/index.js` a 2,9 MB (1,1 MB alla baseline del 31/08,
1,3 MB al gate piano 1 del 03-04/09): cresce con ogni feature del bundle
server, non introdotto da questo task che non tocca codice. La verifica
funzionale end-to-end del ramo (browser 1440×900 e 390×844, Postgres 16
reale, review finale con lente su aritmetica/idempotenza/sede/nota di
credito/sync/Tars) è quella descritta in
`.superpowers/sdd/2026-09-04-fatturazione-dal-contratto/final-review-brief.md`
e nel ledger `progress.md` dello stesso piano, non ripetuta in questa
sezione.

## 11-vicies quindecies. Lettura del contratto PDF — piano 3 (04-05/09/2026)

Piano 3 di 3 (`docs/superpowers/plans/2026-09-04-lettura-contratto.md`,
9 task) chiuso su `feature/lettura-contratto` (aperto da `4104e27`, main del
piano 2), **su `main` dal push fast-forward `d7e0ab5` (05/09/2026)**. Spec di
riferimento:
`docs/superpowers/specs/2026-09-03-limiti-e-fatturazione-design.md` §6
(allineata da questo task). Sopra il piano 1 (contratto strutturato, §11-vicies
terdecies): oggi le righe del contratto si compilano a mano, qui il modello
legge il PDF firmato e propone righe, pattuito, posa, rate e cantiere —
sempre come **proposta rivedibile**, mai un salvataggio automatico. Nessun
nome cliente, indirizzo, CF o importo di un contratto reale in questa
sezione: gli unici casi citabili sono i preventivi anonimi 127/129/130 già
usati come fixture d'oro altrove nel repository.

**Cosa c'è.**

- Schema e chiamata al modello (Task 2-3): `server/contratti/estrazione/schema.ts`
  (`EsitoModello`/`schemaEsitoModello` via zod `.strict()`, `SCHEMA_JSON_ESTRAZIONE`
  come sua proiezione JSON Schema — mai il contrario; nullable espresso come
  union con `null`, per lo strict mode della Responses API), `modello.ts`
  (`estraiConModello`, `costruisciInputModello` con pagine intere fra
  marcatori `<<<PAGINA n>>>`, troncamento dichiarato mai a metà pagina),
  `prompt.ts` (`PROMPT_ESTRAZIONE_CONTRATTO`, versione `1.0.0`). Il contenuto
  del PDF è input non fidato: nessuna istruzione al suo interno ha effetto
  (test di prompt injection incluso, come per D7).
- Mappatura deterministica (Task 4, il più delicato): `server/contratti/estrazione/mappa.ts`
  (`costruisciProposta`, `tipologiaDei`/`oscuranteDei` — un codice DEI esce
  SOLO dal catalogo tariffe, mai indovinato dal modello — `abbinaOscuranti`,
  `accessoriDaEtichette`, `costruisciControlli` esportata e riusabile) e
  `layoutWnd.ts` (`arricchisciDaLayoutWnd`, **facoltativo**: quando il testo
  porta le etichette esatte del configuratore WnD — riconoscimento su
  «Riepilogo Costi» e intestazione delle colonne; poi «Totale IVA Incl./Esc.»
  e «Termini di pagamento» per totali e rate — i
  numeri del layout riscrivono misure, quantità, prezzi, pattuito e rate con
  evidenza certa; su ogni altro contratto la proposta del modello resta
  intatta. Non è un parser per configuratore: un solo arricchimento
  deterministico, non un'architettura a parser-per-fornitore. Ogni valore
  proposto porta `{valore, evidenza, daVerificare, nota}` (`CampoProposto<T>`,
  `shared/contratti/estrazione.ts`); l'evidenza è verificata sul testo vero
  del PDF (`verificaEvidenza`, `server/contratti/estrazione/evidenze.ts`) —
  una citazione che non si trova nasce «da verificare», mai spacciata per
  letta.
- Repository e servizio (Task 5-6): `server/contratti/estrazione/repository.ts`
  (`EstrazioniRepository`: memoria senza `DATABASE_URL`, tabella Postgres
  altrimenti), `servizio.ts` (`eseguiEstrazioneContratto` fail-closed **da
  solo** — chiama `disponibilitaEstrazione()` prima di leggere qualunque
  cosa, non si fida solo del router — idempotente per documento e versione
  prompt, col riuso controllato PRIMA di estrarre il testo perché OCR e
  lettura visiva costano; `applicaEstrazione` scrive SOLO tramite
  `salvaContratto` — l'unico percorso — poi stato ed effetti collaterali
  (timeline) in try/catch: un loro fallimento diventa un'avvertenza, mai un
  contratto scomparso; `scartaEstrazione`, `disponibilitaEstrazione`,
  `ultimaEstrazione`). Il testo del documento non tocca mai la lettura
  visiva a pagamento da questo percorso: `estraiTestoDocumento` è chiamato
  senza opzione `visione`, quindi solo testo nativo e OCR locale — una
  scansione che l'OCR non legge resta un errore esplicito
  (`PRECONDIZIONE`), mai una spesa aggiuntiva silenziosa.
- Router (Task 7): `server/routers/estrazioniContratto.ts`
  (`trpc.estrazioniContratto`: `stato`, `esegui`, `applica`, `scarta`) dietro
  `FLAG_CONTRATTO_ESTRAZIONE` in middleware (`procedureConInterruttore`, kill
  switch della feature) **e** `FLAG_LIMITI` per handler
  (`assicuraInterruttore("limiti")` — la lettura automatica non ha senso
  senza il contratto strutturato). Nessuna capability nuova: riusa
  `contratto.read`/`contratto.manage` del piano 1.
- UI (Task 8): `client/src/components/contratto/LeggiContrattoDialog.tsx` —
  proposta con evidenza e nota per ogni campo, revisione inline riga per
  riga, applicazione verso il contratto strutturato esistente; «Compila a
  mano» resta sempre disponibile quando la lettura non è configurata.
- Eval e documentazione (Task 9, questo task): `server/contratti/eval/{casi.ts,runEval.ts,eval.test.ts}`
  — fixture sintetiche `casoWnd`/`casoWord`/`casoScansione` (PDF veri via
  jsPDF; la scansione è un'immagine reimpacchettata, letta via OCR locale
  quando i binari ci sono), `eseguiEvalContratti({ provider? })` esegue lo
  stesso `estraiTestoDocumento` della produzione e poi `costruisciProposta`
  su un **esito finto** (nessuna rete) — o sulla chiamata reale, SOLO con
  `EVAL_CONTRATTI_REALE=on` **e** `statoProvider(...).tipo === "openai"`,
  doppia condizione per difesa in profondità; script `pnpm eval:contratti`.
  `casoWnd` è la stessa fixture di `layoutWnd.test.ts`, importata da lì
  (un'unica definizione, Ruling P3-R8/P3-R26).
- Contratto strutturato (Task 1, esteso dal piano 1): `Contratto.estrazioneId`/
  `posaCent` opzionali; `salvaContratto` forza `posaCent = null` quando
  `posaInclusa` è falso (Ruling P3-R5), stesso pattern di `zonaClimatica`.

**Come si attiva.** `FLAG_CONTRATTO_ESTRAZIONE=on` **e** `FLAG_LIMITI=on`
sullo stesso ambiente, più un provider Tars reale utilizzabile:
`TARS_PROVIDER=openai`, `FLAG_TARS=on`, `OPENAI_API_KEY`, una tariffa attiva
per `TARS_MODEL_ESTRAZIONE_CONTRATTO` (default `gpt-5.6-terra`), budget
configurato e ledger PostgreSQL autorevole — le stesse sei condizioni
verificate da `statoProvider` (`server/tars/costi/providerGovernato.ts`).
Manca anche una sola condizione: `disponibilitaEstrazione()` dice il motivo
esatto e la UI mostra solo «Compila a mano», mai un pulsante che poi fallisce
in silenzio.

**Come si valuta.** `pnpm eval:contratti` sulle tre fixture sintetiche, di
default senza rete (esito finto, deterministico — è la parte coperta anche
da `pnpm test`). Report Markdown con accuratezza per campo in
`docs/reports/piano3-eval-contratti-<data>.md`. Per la misura vera servono
contratti reali **anonimizzati** in `server/contratti/eval/casi-reali/<nome>/{documento.pdf,atteso.json}`
(cartella in `.gitignore`, oggi vuota — nessun contratto reale nel
repository): stessa procedura di anonimizzazione di
`docs/reports/d7-eval-2026-08-29.md`. Senza un provider reale disponibile un
caso reale resta saltato — non esiste un «esito finto» per un documento
sconosciuto.

**Cosa NON fa (dichiarato).**

- Non applica nulla da sola: ogni proposta passa dalla revisione umana nel
  dialog prima di toccare il contratto strutturato.
- Non inventa codici DEI: solo dal catalogo tariffe: senza un candidato
  univoco la riga resta senza codice, mai un codice indovinato in silenzio.
- Non legge contratti che non siano PDF.
- Accessori riconosciuti solo da etichette note; un'etichetta libera del
  modello che non trova corrispondenza resta in nota come «da verificare»,
  mai un codice a caso.
- I cassonetti citati come righe autonome nel documento restano righe
  autonome: nessun abbinamento. Tapparelle, persiane e scuri autonomi
  invece l'abbinamento se lo prendono (D-E, `abbinaOscuranti`) quando
  trovano un serramento con le STESSE misure (±10 mm) e i pezzi bastano per
  tutta la riga serramento (P3-R14): la quota di prezzo si fonde nella riga
  del serramento — che nasce «da verificare» con la nota che dice quanto
  comprende (P3-R36) — e la riga oscurante si riduce o sparisce. Fuori da
  quelle condizioni restano righe a sé, con l'avvertenza che lo dichiara
  («quantità diversa dal serramento con le stesse misure»).
- Nessuno strumento Tars in v1 (v. `docs/tars/matrice-azioni-tars.md`): la
  lettura resta un'azione umana dal dialog «Leggi il contratto».
- Il costo del run si legge dal ledger Tars per `runId`
  (`contratto:<sede>:<documento>:<checksum8>:<timestamp>`, classe
  `document_intelligence`), non nella UI dell'estrazione.

**Runbook della prima lettura reale.**

1. Sede/ambiente di prova: `FLAG_CONTRATTO_ESTRAZIONE` e `FLAG_LIMITI`
   accesi lì soltanto; provider Tars reale configurato come sopra
   (`TARS_PROVIDER=openai`, `OPENAI_API_KEY`, `TARS_MODEL_ESTRAZIONE_CONTRATTO`
   con tariffa attiva, budget, PostgreSQL per il ledger).
2. **Prima** di accendere il flag in produzione: una chiamata di prova con
   `EVAL_CONTRATTI_REALE=on` sulle fixture sintetiche (`pnpm eval:contratti`).
   Serve perché il pattern nullable dello schema strict (`["tipo","null"]`,
   Ruling P3-R6) non è mai stato esercitato dal vivo contro l'API reale da
   questo codebase: se lo schema non torna valido, la chiamata fallisce con
   `PRECONDIZIONE` esplicita e non scrive nulla — meglio scoprirlo qui che
   sulla prima commessa vera.
3. Un contratto reale già inserito a mano nel CRM: «Leggi il contratto» →
   confronto **riga per riga** con il contratto strutturato esistente —
   misure, prezzi, pattuito, posa, rate, cantiere — prima di fidarsi della
   proposta su una commessa dove il contratto manca ancora.
4. Il costo del run è nel ledger Tars per `runId`, classe
   `document_intelligence` (prima consumatrice reale di questa classe, v.
   matrice azioni).

**Decisioni prese in corso d'opera che cambiano un contratto (ruling
P3-R1–P3-R42, ledger completo in**
`.superpowers/sdd/2026-09-04-lettura-contratto/progress.md`**, grep
`"Ruling P3-R"`; questi «R» sono numeri di ruling di questo piano, non i
livelli di rischio R0–R4 di Tars).**

- P3-R1: nel controllo `righe_vs_pattuito`, un pattuito lordo con
  `ivaDescrizione` a un'UNICA aliquota (10 % o 22 %) scorpora l'imponibile;
  IVA mista o non indicata → controllo saltato con avviso, mai un numero
  del contratto inventato.
- P3-R2: nessuna invalidazione esplicita del fascicolo Tars dalle funzioni
  di estrazione — l'invalidazione del fascicolo è a versioni e non dipende
  da contratti/estrazioni.
- P3-R3/P3-R4: la firma OCR nella `promptVersione` è `"1.0.0+ocr:" +
  firmaOcrCorrente()` (impronta della configurazione OCR di `documenti/ocr.ts`,
  non il nome del parser: la chiave di riuso cambia se cambia l'OCR); `ocr = parser !==
  "pdf-testo-nativo"`, vero anche per la lettura visiva del main.
- P3-R5: `salvaContratto` forza `posaCent = null` quando `posaInclusa` è
  falso, stesso pattern di `zonaClimatica` — l'invariante vive nel
  servizio, non nel widget.
- P3-R6: il pattern nullable strict resta (documentato da OpenAI); la
  verifica dal vivo entra nel runbook qui sopra.
- P3-R7: `beneSignificativoDefault.accessorio` → `false` nel seed (coprifili
  e maniglie sono «altri beni» nelle fatture reali, caso 127) — **cambio di
  default che tocca anche il seed del piano 1**, non solo questo piano.
- P3-R8: fixture WnD unica fra `layoutWnd.test.ts` e l'eval — chiusa da
  questo task (P3-R26).
- P3-R9-P3-R17 (mappatura, giro di fix del Task 4): controlli derivati
  ricalcolati dopo l'arricchimento WnD (`costruisciControlli` esportata);
  scorrevole/alzante/complanare deciso da descrizione **e** tipoProdotto
  insieme; materiale dell'oscurante letto solo nel segmento di testo dopo
  la sua parola; confronto cliente su token ≥ 3 caratteri con stoplist;
  `oscuranteDei` dichiara la scelta fra più candidati come `tipologiaDei`;
  un oscurante si abbina a una finestra solo se il residuo copre l'intera
  quantità della riga; tie-break fra codici DEI candidati (prima senza «>
  1,3», poi la famiglia coerente col materiale, poi il codice); la posa per
  parole chiave assorbe solo righe SENZA misure; minori (zona dal cliente
  segnalata, aliquota unica solo 4/10/22 %, coprifilo con confine di
  parola).
- P3-R18: il controllo di riuso avviene PRIMA di estrarre il testo del
  documento (prova entrambe le chiavi, con e senza firma OCR): OCR e
  lettura visiva costano, un riuso mancato al più ricalcola.
- P3-R19: `applicaEstrazione` accetta `actorNome` per la timeline.
- P3-R20: `eseguiEstrazioneContratto` è fail-closed **da solo**
  (`disponibilitaEstrazione()` prima di leggere il documento): il router —
  e domani un eventuale strumento Tars — non è l'unico confine.
- P3-R21: dopo un `salvaContratto` riuscito, l'aggiornamento di stato e
  timeline vivono in try/catch — un loro errore diventa un'avvertenza
  nell'esito, mai un contratto già scritto che sparisce.
- P3-R22: l'arricchimento WnD legge anche l'unica riga IVA del layout
  quando il modello non fornisce `ivaDescrizione`.
- P3-R23: flag spento → `PRECONDITION_FAILED` (convenzione del repository),
  non `NOT_FOUND` come ipotizzato in una prima stesura del piano.
- P3-R24/P3-R27 (natura scorrevole, due giri): la natura
  scorrevole/alzante/complanare conta per il serramento o per l'accessorio
  in base al sostantivo più VICINO che la precede (non al primo taglio
  della descrizione, che aveva una regressione su descrizioni invertite —
  R27 sostituisce R24 mantenendone l'intento). P3-R28: l'avvertenza di
  contrasto scatta solo per finestra e fisso, non per portafinestra (la
  portafinestra scorrevole è un prodotto ordinario).
- P3-R25: nel segmento di testo dell'oscurante vince il materiale che
  compare per POSIZIONE, non una precedenza fissa pvc>alluminio.
- P3-R26 (questo task): lo script eval è `eval:contratti` → `tsx
  server/contratti/eval/runEval.ts` (l'entry point vive nel runner, non in
  un `cli.ts` separato, come `server/documenti/eval` e `server/tars/eval`);
  la fixture WnD è unica.
- P3-R29 (FATTO, giro di fix del Task 8): `rigaDaProposta` tronca `note` a
  500 caratteri (limite dello schema del contratto) e il dialog mostra la
  nota del lettore — di riga e di testata — sotto le evidenze: quel che si
  salva è anche quel che si legge.
- P3-R30 (FATTO, stesso giro): `zonaPerRevisione` (in `contrattoView.ts`) dà
  al badge e al filtro del catalogo DEI la zona del contratto SALVATO solo
  se il comune proposto coincide con quello salvato (minuscolo, spazi
  collassati, entrambi presenti); altrimenti badge «zona calcolata
  all'applicazione» e nessun filtro per zona.
- P3-R31 (FATTO, stesso giro): con una proposta/applicata/scartata già
  presente, il pannello «lettura non disponibile» è una riga informativa
  senza il pulsante «Compila a mano», che resterebbe fuori posto sopra una
  proposta ancora applicabile.
- P3-R32 (FATTO, giro 4 della mappatura): «scorrevole» esce dai sostantivi
  di serramento — un qualificatore non è mai un'àncora. Prima, uno
  «scorrevole» già assorbito da un accessorio ancorava il «complanare» che
  lo seguiva e sulla portafinestra (che con «scorrevole» non è in
  contrasto, P3-R28) il codice cambiava in silenzio: «Portafinestra 2 ante
  in alluminio con zanzariera scorrevole complanare» in zona A dava
  C15042-b invece di C15038-e, senza avvertenza.
- P3-R33 (FATTO, giro di fix finale): `SOSTANTIVO_ACCESSORIO` si allarga
  (inferriata, grata, frangisole, veneziana, oscurante, scuretto) e una
  parola di apertura esplicita del serramento (battente, ribalta,
  oscillobattente, vasistas) prevale su uno scorrimento attribuito allo
  stesso serramento: voce a battente, avvertenza «descrizione a battente e
  scorrevole: verifica» e tipologia da verificare, anche su portafinestra.
- P3-R34 (FATTO, stesso giro): con più materiali citati nella riga il
  materiale dedotto è il PRIMO nominato (posizione, come P3-R25 dentro il
  segmento dell'oscurante), con avvertenza «più materiali citati: dedotto
  X» e `categoria.daVerificare`; un solo materiale citato → nessun avviso.
- P3-R35 (FATTO, stesso giro): «apertura», «anta/ante» e «battente» sono
  sostantivi del serramento — «… con zanzariera a scomparsa e apertura
  scorrevole» torna al serramento (C15043-a con il contrasto dichiarato).
- P3-R36 (FATTO, stesso giro): `RigaProposta.quotaOscuranteCent` conserva
  la quota dell'oscurante fuso da `abbinaOscuranti`; l'arricchimento dal
  layout WnD la risomma al prezzo riscritto invece di cancellarla.
- P3-R37 (FATTO, stesso giro): `scarta` prende anche `commessaId` (router:
  `commessaInSede` prima dell'autorizzazione; servizio: estrazione di
  un'altra commessa → NOT_FOUND), come `applica`.
- P3-R38 (FATTO, stesso giro): il testo di pagina neutralizza `<<<` e `>>>`
  (in `‹‹‹`/`›››`) prima dei marcatori: un documento non può fingere una
  pagina che non esiste.
- P3-R39 (FATTO, stesso giro): `campiDaVerificare` elenca solo campi
  mostrati dal dialog e salvati dal contratto — fuori `indirizzoCantiere`,
  `riferimento` e `clienteCitato`.
- P3-R40 (FATTO, fix post-review): «anta/ante» esce da `SOSTANTIVO_SERRAMENTO`
  — la propria «ante» di un oscurante elencato nella stessa frase («…con
  persiana a 2 ante scorrevoli») faceva risalire lo scorrimento alla
  portafinestra invece di restare sull'oscurante, e portafinestra +
  scorrevole non è in contrasto (P3-R28): il foglio cambiava in silenzio.
- P3-R41 (FATTO, fix post-review): `abbinaOscuranti` scrive
  `quotaOscuranteCent` solo quando l'oscurante si consuma DEL TUTTO (la
  riga sparisce); con un abbinamento parziale la riga sopravvive e il suo
  stesso blocco del layout WnD la riporta già a pezzi e prezzo pieni —
  sommarci anche la quota sul serramento la contava due volte.
- P3-R42 (FATTO, fix post-review): debito dichiarato per i residui
  silenziosi restanti (accessori fuori lista, materiale composto,
  intestazione del prompt) invece di tacerli — v. «Debito e fuori ambito»
  qui sotto.

**Debito e fuori ambito.**

- Residuo dichiarato di P3-R35: un qualificatore di scorrimento che segue
  un accessorio SENZA nessun sostantivo di serramento in mezzo resta
  dell'accessorio («Portafinestra con zanzariera scorrevole»: corretto), ma
  se in mezzo c'è una delle parole nuove («… con zanzariera a scomparsa e
  apertura scorrevole») torna al serramento. È la regola voluta; la lista
  dei sostantivi resta chiusa e ogni parola che manca è un accessorio che
  si prende il serramento — la rete è P3-R33 (l'apertura esplicita vince e
  lo dichiara), non l'assenza di casi.
- Residuo dichiarato di P3-R40 (P3-R42): un sostantivo di accessorio ancora
  fuori dalla lista chiusa (`SOSTANTIVO_ACCESSORIO`) — griglia, veletta,
  cancelletto, soglia… — su una portafinestra SENZA una parola di apertura
  esplicita nel testo prende ancora lo scorrevole in silenzio: la rete di
  P3-R33 scatta solo quando il testo ha ANCHE una parola di apertura
  esplicita, e portafinestra + scorrevole non è in contrasto (P3-R28).
- Una sola menzione di un materiale composto («legno-alluminio») è dedotta
  come materiale unico senza alcuna avvertenza: `materialeRiga` marca
  `piuMateriali` solo quando il testo cita PIÙ materiali distinti, e una
  citazione composta da sola conta come una (P3-R42).
- L'intestazione del prompt (`costruisciInputModello`, `COMMESSA`/
  `CLIENTE CRM`) non passa da `neutralizzaMarcatori` (P3-R38): solo le
  pagine del documento lo fanno. Una commessa o un cliente CRM con
  `<<<`/`>>>` nel nome forgerebbe un marcatore di pagina prima ancora che
  inizi la prima pagina vera (P3-R42).
- M3 (review finale, non toccato): in `misuraValida` il ramo che scarta una
  misura fuori intervallo non è raggiungibile dallo schema del modello
  (`larghezzaMm`/`altezzaMm` già vincolati): resta come difesa in
  profondità, non come comportamento provato dai test.
- M4 (review finale, non toccato): `posaCent` della proposta non ha ancora
  un consumatore a valle oltre al contratto salvato — lo consumerà il piano
  4 delle fatture, o va tolto quando quella decisione sarà presa.
- **Task 8 fix round 1 (P3-R29/P3-R30/P3-R31 + minori): SCRITTO nel codice**
  (05/09/2026, stesso branch, insieme al giro 4 della mappatura P3-R32):
  zona e filtro DEI dal contratto salvato solo a parità di comune, note del
  lettore (riga e testata) mostrate nel dialog, pannello «non disponibile»
  ridotto a riga informativa quando una lettura esiste già, `centToEuro` al
  posto delle divisioni `/100`, «Prezzo della posa» fuori dai «da
  verificare» quando la posa non è inclusa, `maxLength` 300 sul motivo
  dello scarto. Resta il solo minore non toccato: l'editor delle rate è
  duplicato fra `LeggiContrattoDialog.tsx` e la tab Contratto.
- `server/contratti/eval/casi-reali/` è vuota: nessun contratto reale
  anonimizzato ancora raccolto — i tre contratti reali citati nel piano
  stanno solo sul Desktop del controller, mai nel repository. Finché resta
  vuota, l'eval misura solo la tenuta di parser e mappatura su fixture
  controllate, non l'accuratezza reale del modello.
- Il pattern nullable dello schema strict (P3-R6) non è mai stato
  esercitato dal vivo contro l'API OpenAI reale da questo codebase: la
  prima chiamata reale del runbook qui sopra è la prima prova.
- Come i piani 1 e 2, `feature/lettura-contratto` è ora su `main`: push
  fast-forward `d7e0ab5` (05/09/2026).

**Verifica (05/09/2026).** `pnpm check` pulito (nessun errore); `pnpm test`
234 file passati e 9 saltati (243), 2304 test passati e 43 saltati (2347), 0
falliti — gli unici saltati sono le suite `*.pg.test.ts` che girano solo con
`DATABASE_URL`, non eseguite da questo task documentale; il test della
scansione (`server/contratti/eval/eval.test.ts`) non è fra questi, è un test
normale con un ramo tollerante — in questo ambiente (pdftoppm/tesseract
presenti, ma solo la lingua inglese installata) `pnpm eval:contratti` mostra
che il caso gira per davvero e il testo OCR di un documento italiano risulta
insufficiente (`scansione_senza_testo`, mai un'analisi su testo sbagliato),
coerente con `brew install tesseract-lang` già citato altrove come debito
noto, non un difetto introdotto da questo task; `pnpm build` completa
(`dist/public` + `dist/index.js`) con l'unico avviso noto, esbuild su
`dist/index.js` a 3,1 MB (2,9 MB al gate del piano 2 del 04/09): cresce col
resto del branch (Task 4 giro 3, Task 8), non con questo task, che aggiunge
solo script eval fuori dal bundle server (mai importati da
`server/_core/index.ts`). La verifica funzionale end-to-end (browser
1440×900 e 390×844, Postgres 16 reale, review finale con lente su schema
strict/evidenze/riuso/sede) resta a carico del controller, come per i piani 1
e 2, e non è ripetuta in questa sezione.

**Verifica del giro di fix (05/09/2026, P3-R29/P3-R30/P3-R31 + P3-R32).**
`pnpm check` pulito; `pnpm test` 234 file passati e 9 saltati (243), 2311
test passati e 43 saltati (2354), 0 falliti; `pnpm build` completo con lo
stesso unico avviso noto (`dist/index.js` 3,1 MB). Il controllo nel browser
del dialog «Leggi il contratto» dopo queste modifiche (badge della zona,
note del lettore, pannello «non disponibile») resta al controller.

**Verifica del giro di fix finale (05/09/2026, P3-R33–P3-R39).** `pnpm
check` pulito; `pnpm test` 234 file passati e 9 saltati (243), 2332 test
passati e 43 saltati (2375), 0 falliti; `pnpm build` completo con lo stesso
unico avviso noto (`dist/index.js` 3,1 MB). La sonda di raggiungibilità del
catalogo resta a 116 voci serramento con le 16 duplicate dichiarate: le
regole nuove non hanno reso irraggiungibile nessuna voce. Il controllo nel
browser del dialog «Leggi il contratto» (il pulsante «Scarta» ora manda
anche la commessa) resta al controller.

## 11-vicies sedecies. Fatturazione guidata — piano 4 (05/09/2026)

Piano 4 (`docs/superpowers/plans/2026-09-05-fatturazione-guidata.md`, 7
task) su `feature/fatturazione-guidata`, aperto da `f3b551b` (main con i
piani 1-3, harvest, PRD 5.40). Task 1-7 chiusi, review finale del ramo
fatta (opus, `.superpowers/sdd/2026-09-05-fatturazione-guidata/final-review.md`,
Needs fixes) e il suo giro di fix 3 chiuso: 16 commit, 40 file,
+4757/−602 (`git diff --stat f3b551b..340f955`); HEAD del ramo `03dd384`
(docs), dopo `3e8192e` server + `340f955` client del giro 3 e `f7bcef0`
del giro 2 (descritti sotto; i numeri qui sopra li includono tutti). **Su `main` dal 05/09/2026 sera** (push fast-forward da `f3b551b` su
istruzione esplicita dell'utente: «fai push sul main senza controllare,
lo faremo dopo»; la verifica browser resta quindi in sospeso e va fatta
su `main`, flag spenti in produzione). Spec di riferimento:
`docs/superpowers/specs/2026-09-05-fatturazione-guidata-design.md`. Sopra
il contratto strutturato (piano 1, §11-vicies terdecies), la fatturazione
dal contratto (piano 2, §11-vicies quaterdecies) e la lettura del
contratto PDF (piano 3, §11-vicies quindecies): oggi contratto, limiti e
fattura vivevano in tre tab della pagina commessa senza un ordine né un
«cosa manca»; qui nasce un ingresso unico — l'elenco delle commesse da
fatturare e, per ciascuna, un percorso in quattro passi.

**Cosa c'è.**

- Router `fatturazioneGuidata` (`server/routers/fatturazioneGuidata.ts`)
  dietro `procedureConInterruttore("limiti")`: `daFare` (elenco della
  sede, esclude anche le commesse archiviate — soft-archive o
  `stato === "archiviata"`, Ruling P4-R13) e `passi({commessaId})` (stesso
  record per una commessa), entrambi dietro `contratto.read`
  (`authorizeCoreOperation`). Letture al minimo indispensabile dal giro di
  fix 3 (Ruling P4-R15), **non** «una lettura per store» come dichiarato
  dai Task 1-6 e smentito dalla review finale (I3): 3 query per commessa
  candidata (contratto, righe, intestazione del computo via il nuovo
  `statoComputoLeggero`) più UNA query in blocco per le fatture di tutte
  le candidate (nuovo `FattureRepository.perCommesse`, sul modello di
  `perFicDocumentIds`) — contro le 7-10 per commessa di prima. Le letture
  di contratto e computo restano una per commessa, non ancora in blocco
  per l'elenco intero: debito dichiarato, v. §12 voce 17. Nessuna mutation
  nuova: ogni passo lavora con le procedure già esistenti (`contratti.*`,
  `computo.*`, `fatture.*`, `estrazioniContratto.*`).
- Stato dei quattro passi come funzione pura (`server/fatturazione/passi.ts`,
  `calcolaPassi`) — nessuno store, nessun I/O — con i tipi condivisi in
  `shared/fatturazione/passi.ts` (`PassoFatturazione`, `EsitoPasso`,
  `ORDINE_PASSI`, `ETICHETTA_PASSO`, `CommessaDaFatturare`,
  `StatoDaFatturare`). Testata da sola in `server/fatturazione/passi.test.ts`.
- Pagina `/fatturazione` (`client/src/pages/Fatturazione.tsx`): card per
  commessa, filtro per stato (tutti/aggiornamento contratto/fatture
  pagamento), ricerca libera su cliente/codice, ordinamento server-side
  per giorni nello stato decrescente. Dietro il kill switch client
  `interruttori.limiti` (il server rifiuterebbe comunque la query).
- Pagina `/fatturazione/:id` (`client/src/pages/FatturazioneCommessa.tsx`):
  percorso a quattro passi — Documenti, Contratto, Limiti, Fattura — con
  stepper (`PassiFatturazione`), riepilogo dei passi già chiusi in testa,
  «Avanti»/«Indietro» in coda (Documenti porta il proprio piede: mai due
  controlli di avanzamento sulla stessa schermata). Il passo vive nella
  query `?passo=`, bloccata dai prerequisiti (`passoRaggiungibile`, letta
  tramite `passoIniziale` in `client/src/lib/fatturazioneView.ts`): il
  richiesto se raggiungibile, altrimenti il prossimo passo del server,
  altrimenti «fattura» a percorso concluso; l'URL si riscrive da solo con
  `replace`. Un contratto con modifiche non salvate blocca «Avanti», e
  stepper/«Indietro» aprono `ConfirmDialog` «Modifiche non salvate» (Esci
  senza salvare / Resta) invece di navigare — mai un salvataggio forzato.
- `ElencoDocumentiCommessa.tsx` e `CaricaDocumentoDialog.tsx`
  (`client/src/components/documenti/`) estratti da `CommessaDetail.tsx`
  come componenti riusabili (sostituzione pura, −471/+30 righe nella
  pagina commessa). `CaricaDocumentoDialog` non era previsto dal brief del
  Task 4 ed è nato componente a sé perché il pulsante del banner del gate
  documentale — fuori dalle tab, sempre montato — apriva lo stesso dialog
  che prima viveva solo dentro la tab «File e documenti» (smontata da
  Radix quando non è attiva): oggi sono due istanze dello stesso
  componente, una per il banner e una per l'elenco. `PassoDocumenti.tsx`
  (`client/src/components/fatturazione/`) è il passo 1: la stessa
  `ElencoDocumentiCommessa` in versione compatta, «Leggi il contratto»
  quando `contrattoEstrazione && limiti`, «Avanti» attivo solo a passo
  fatto.
- Prop `modalita: "guidata" | "lettura"` su `ContrattoTab`, `LimitiTab`,
  `FatturaTab` (nessun consumatore resta senza `modalita`, ma il ramo di
  comportamento invariato è ancora lì): `"guidata"` aggiunge
  `onAvanti`/`onCambiato` (e `onSporco` per Contratto) dentro il percorso
  a passi; `"lettura"` sostituisce l'editor con un riassunto (righe,
  pattuito e tipo, cantiere, data firma per Contratto; limite, CHECK1,
  CHECK2, esito per Limiti; stato, numero, totale per Fattura) e un solo
  pulsante «Apri fatturazione» verso `/fatturazione/:id?passo=<passo>`.
  `CommessaDetail.tsx` usa `"lettura"` sui tre tab — tre righe toccate,
  nient'altro nella pagina.
- `ContrattoStatoBanner`: i tre pulsanti ghost «Contratto»/«Limiti»/
  «Fattura» diventano un solo «Apri fatturazione» (`min-h-11`) verso
  `/fatturazione/:id` **senza** `?passo=` quando il flag `limiti` è
  acceso — la pagina a passi atterra da sola sul prossimo passo del
  server. «Leggi il contratto» resta un'azione separata quando il PDF non
  è ancora stato letto.
- Voce di menu «Fatturazione» in Economia (`client/src/lib/navigation.ts`),
  `requiredCapabilities: ["contratto.read"]`, `featureFlag: "limiti"`
  (`MenuItem.featureFlag` esteso da solo `"tars"` a `"tars" | "limiti"`),
  `loadingFallbackRoles: ["direzione", "amministrazione"]`; ultima
  candidata al quarto slot del dock mobile, dopo Clienti e Commesse. Rotte
  in `routeContract.ts` (`migrationStatus: "migrata"`; `/fatturazione`
  navigazione «primary»; `/fatturazione/:id` «hidden») e
  `shellPresentation.ts` (sezione Economia per entrambe; il breadcrumb di
  `/fatturazione/:id` collassa su `/fatturazione`); il manifest
  (`docs/design/modular-control/route-manifest.md`) è stato aggiornato
  nello stesso giro, fuori dal perimetro di questo task — non toccato qui.

**Come si usa.** Economia → **Fatturazione** (`/fatturazione`): elenco a
card delle commesse senza fattura, filtro per stato e ricerca, ordinate
per giorni nello stato. Card → «Inizia fatturazione» (nessun passo
toccato) o «Continua» → `/fatturazione/:id`: quattro passi in sequenza,
uno stepper che lascia saltare solo su quelli già toccati o sul prossimo,
«Avanti» attivo solo a passo fatto (mai muto: la riga sotto dice cosa
manca). Chi non ha la capability di modifica di un passo lo vede
comunque — nessun redirect — ma i controlli si disattivano dai `puo*` già
restituiti dai router esistenti, esattamente come nei tab di oggi: nessun
mirror di capability introdotto da questo piano. Dalla scheda commessa
(`/commesse/:id`) i tab Contratto/Limiti/Fattura sono riassunti in sola
lettura con «Apri fatturazione»: si lavora in un posto solo, la scheda
commessa resta il punto d'osservazione.

**Regole dei passi (spec §4.1, `calcolaPassi`).** `documenti`: fatto se
esiste un contratto strutturato o almeno un documento di tipo `contratto`
nel fascicolo, altrimenti da fare (nessuno stato «in corso» possibile per
questo passo). `contratto`: fatto con almeno una riga, in corso se il
contratto esiste ma è ancora vuoto. `limiti`: non disponibile a flag
`limiti` spento (controllato prima di ogni altra condizione), fatto se il
computo esiste, è coerente col contratto corrente (hash parametri/righe)
ed esito `ok`, in corso se esiste ma stantio o incompleto. `fattura`: non
disponibile a flag `fatturazione` spento, fatto da una fattura
`tipo === "fattura"` arrivata a `emessa|inviata|consegnata|mancata_consegna`
(mai `scartata`/`rifiutata`: vanno corrette, non sono un traguardo), in
corso con qualunque fattura non annullata. `prossimoPasso` = il primo
passo non fatto e non non-disponibile nell'ordine. Importi (§4.3):
`fatturaPrevistaCent` prende il totale di una bozza/in-emissione se esiste
(importo vero, non stima), altrimenti il pattuito lordo (vero) o il
pattuito imponibile ×1,10 (dichiarato «stima»); `null` senza contratto.

**Filtro «senza fattura» (§4.2).** Elenco = commesse della sede in
`aggiornamento_contratto` o `fatture_pagamento`, escluse quelle con una
fattura FiC collegata (`ficFatture` per `sedeId`+`commessaId`, qualunque
stato) o con una fattura CRM `tipo === "fattura"` in
`emessa|inviata|consegnata|mancata_consegna`. Una bozza CRM (`bozza` o
`in_emissione`) non esclude: la commessa resta in elenco con «Continua».

**Permessi, sede, flag (§7).** Elenco e passi dietro `contratto.read`,
filtrati per `sedeId` in ogni query; commessa di un'altra sede →
`NOT_FOUND` (`commessaInSede`), mai un dato che permetta di enumerarla.
Importi (`pattuitoCent`, `pattuitoTipo`, `fatturaPrevistaCent`,
`fatturaPrevistaStima`) solo con `economia.read` (`effectiveCapabilitySet`),
altrimenti `null` e la card non mostra la riga degli importi. Nessuna
variabile d'ambiente nuova: verificato `.claude/launch.json`, il profilo
«Limiti demo (porta 5198)» ha già i tre flag che bastano — `FLAG_LIMITI`
(pagina e router, kill switch), `FLAG_FATTURAZIONE` (passo Fattura) e
`FLAG_CONTRATTO_ESTRAZIONE` (pulsante «Leggi il contratto» dentro
Documenti).

**Decisioni prese in corso d'opera (ruling P4-R1–P4-R11, ledger completo in**
`.superpowers/sdd/2026-09-05-fatturazione-guidata/progress.md`**, grep
`"Ruling P4-R"`).**

- P4-R1: la rotta `/fatturazione/:id` si registra nel Task 5 (non nel
  Task 3): nessuna rotta punta a un componente inesistente nel frattempo.
- P4-R2: `fatturaPrevistaCent`/`fatturaStato` guardano solo le fatture
  `tipo === "fattura"` (una nota di credito non conta), passate al
  calcolo in ordine cronologico crescente.
- P4-R3: `statoDal` = data dell'ultimo passo completato della timeline
  (proxy già usato da `server/commesse/attivita.ts`), fallback
  `updatedAt`; può restare stantio dopo un ritorno indietro manuale sulla
  board (limite preesistente, mai un dato di dominio sbagliato).
- P4-R4: `giorniTra` converte entrambi i lati con `istanteComeLocale`
  (Europe/Rome) prima di tagliare il giorno — altrimenti fra le 22 e le
  24 UTC il conteggio sballa di ±1.
- P4-R5: voce di menu con `featureFlag: "limiti"`; «Inizia fatturazione»
  quando nessun passo è in corso o fatto (i «non disponibili» contano
  come non iniziati); «Fatturata» resta quando il passo fattura è fatto;
  `/fatturazione` ultima candidata al quarto slot del dock mobile, dopo
  Clienti e Commesse.
- P4-R6: un solo «Avanti» per schermata — Documenti porta il proprio, gli
  altri passi usano il piede della pagina; «Salva e avanti» dentro il
  contratto solo con modifiche non salvate.
- P4-R7 (versione finale, giro di fix del Task 5): «Avanti» del piede
  spento col contratto sporco; stepper e «Indietro» col contratto sporco
  aprono `ConfirmDialog` «Modifiche non salvate» (Esci senza salvare /
  Resta) invece di navigare subito.
- P4-R8: `?passo=` bloccato da `passoRaggiungibile` tramite `passoIniziale`
  (il richiesto se raggiungibile, altrimenti il prossimo passo del
  server, altrimenti «fattura» a percorso concluso); URL riscritto con
  `replace`.
- P4-R9 (versione finale, giro di fix del Task 6): il banner rimanda a
  `/fatturazione/:id` **senza** `?passo=`; niente specchio client dei
  criteri «fatto» di `calcolaPassi` — `passoSuggerito` e
  `fatturazioneAttiva` eliminati dal banner (sbagliavano in due casi
  reali: fascicolo vuoto → editor del contratto vuoto invece del passo
  Documenti; percorso già concluso → passo Limiti invece di Fattura).
- P4-R10: nel banner e nei tab il pulsante si chiama «Apri fatturazione»
  in entrambi i casi (stessa pagina; il tab aggiunge solo il passo
  nell'URL); la data della fattura resta `YYYY-MM-DD` (convenzione della
  famiglia fattura), la data firma del contratto diventa gg/mm/aaaa
  (`dataItaliana`, split di stringa, mai `new Date("YYYY-MM-DD")`).
- P4-R11: `ContrattoTab` in lettura tiene in piedi hook e query del form
  (catalogo DEI, mutation `salva`): gli hook non si saltano e le query
  restano condivise in cache con la pagina a passi.
- **Nota debito (review Task 6, preesistente al piano 4):** `contratti.get`
  è dietro `contratto.read` — condivisa da tutti i ruoli, `squadra_posa` e
  `tecnico_rilievi` inclusi — e restituisce `pattuitoCent` a chiunque,
  mentre `/fatturazione` lo nasconde senza `economia.read`. Lo stesso
  valore era già leggibile in un `<Input>` disabilitato nella tab piena:
  decisione a sé con matrice campo→consumer, v. §12.
- P4-R13 (review finale, I1): le commesse archiviate (`archivedAt`
  valorizzato o `stato === "archiviata"`) non entrano più in `daFare` —
  stessa convenzione di `commesse.list` e del board — costo se sbagliato:
  una commessa da fatturare nascosta, visibile riattivandola.
- P4-R14 (review finale, I2): `documenti` non blocca mai `contratto` —
  il contratto si può ancora scrivere a mano anche a fascicolo vuoto,
  capacità che esisteva su `main` prima di questo piano; `limiti` e
  `fattura` restano bloccati finché `contratto` non è `fatto` — costo:
  nessuno.
- P4-R15 (review finale, I3): l'N+1 chiuso al minimo indispensabile, non
  riscritto per intero — 3 query per commessa candidata (contratto,
  righe, intestazione del computo) più UNA query in blocco per le fatture
  di tutte le candidate, niente `computo_voci` né righe/riepilogo/scadenze
  delle fatture per un elenco — costo se sbagliato: latenza dell'elenco
  con molte commesse (letture di contratto e computo ancora una per
  commessa: debito, v. §12 voce 17).
- P4-R16 (review finale, test mancante 7): `giorniNelloStato` mai
  negativo — una `statoDal` nel futuro (orologio indietro, dato di
  migrazione anomalo) dà `0`, mai un numero assurdo che manderebbe la
  commessa in fondo all'ordinamento — costo: nessuno.

**Giro di fix 2 (05/09/2026, `f7bcef0`, dopo la re-review del giro 1).**
Due difetti della pagina a passi: «Salva e avanti» rimbalzava su Contratto
perché navigava con i passi ancora stantii in cache (ora `onAvanti` attende
l'invalidazione di `fatturazioneGuidata.passi` e l'effetto che riscrive
l'URL resta fermo mentre `passiQ.isFetching`); il click sul pallino del
passo attivo apriva a vuoto il dialogo «Modifiche non salvate» e poteva
azzerare `contrattoSporco` col form ancora sporco (ora `vai` ignora il
passo corrente). Ruling P4-R12: la re-review del giro 2 è assorbita dalla
review finale del ramo.

**Giro di fix 3 (05/09/2026, dopo la review finale del ramo).** Brief
`.superpowers/sdd/2026-09-05-fatturazione-guidata/fix3-brief.md`, punti
A–K; commit `3e8192e` (server) e `340f955` (client), più questo stesso
commit docs. Uno per punto:

- **A** (I4): `fatturaPrevistaStima` ora dietro `economia.read` come le
  altre tre righe di importi.
- **B** (I1, P4-R13): `daFare` esclude le commesse archiviate.
- **C** (I3, P4-R15): nuovo `FattureRepository.perCommesse` (una query in
  blocco per le fatture di tutte le candidate) e nuovo
  `statoComputoLeggero` (riusa il contratto già letto, mai una seconda
  `leggiContratto`, mai `computo_voci`).
- **D** (I2, P4-R14): `passoRaggiungibile` non lascia più che `documenti`
  blocchi `contratto`.
- **E** (Minor 1): `Fatturazione.tsx` mostra `kind: "permission"` su un
  `FORBIDDEN`, senza «Riprova».
- **F** (Minor 5): il pulsante «Azzera» a `min-h-11`.
- **G** (Minor 7): `onApplicato` di `LeggiContrattoDialog` in
  `CommessaDetail.tsx` naviga a `/fatturazione/:id?passo=contratto`
  invece del tab «Prodotti» (ora un riepilogo in sola lettura); copy del
  dialogo aggiornata.
- **H** (test mancanti 1-2): capability negata (contesto senza ruoli) e
  `FLAG_LIMITI` spento su `passi`, non solo su `daFare`.
- **I** (P4-R16): `giorniTra` con `Math.max(0, …)`.
- **J**: id DOM di `CaricaDocumentoDialog` con `useId()` (due istanze
  possono montarsi insieme su `/commesse/:id`).

**Test.** `server/fatturazione/passi.test.ts`: 23 casi (invariato dal
Task 6), una riga per combinazione di flag/documenti/righe/computo/
fatture. `server/routers/fatturazioneGuidata.test.ts`: **15 casi** (7 al
Task 2, cresciuto nei due giri di fix precedenti e nel giro di fix 3 con
capability negata, `FLAG_LIMITI` su `passi`, commessa archiviata,
raggruppamento di `perCommesse` con fatture miste su due commesse, gating
completo di `fatturaPrevistaStima`, giorni mai negativi): filtro stati,
esclusione con fattura FiC collegata e con fattura CRM emessa (bozza
resta), sede, importi nascosti senza `economia.read`, `NOT_FOUND` altra
sede, flag spento. `server/fatture/repository.test.ts`: **12 casi**
(nuovo `perCommesse`: più commesse in una query, senza righe, isolando
la sede). `client/src/lib/fatturazioneView.test.ts`: **30 casi**,
cresciuto nei tre giri di fix con `passoRaggiungibile` (ora anche
P4-R14), `passoDallaQuery`, `passoIniziale`.

**Verifica.** Gate completo rieseguito per intero al termine del giro di
fix 3, sul codice dei commit `3e8192e` + `340f955` (prima del commit
docs): `pnpm check` pulito (`tsc --noEmit`, nessun errore); `pnpm test`
**237 file passati e 9 saltati** (senza `DATABASE_URL`, come da
convenzione del progetto), **2428 test passati e 50 saltati, zero
falliti**; `pnpm build` verde (`vite build`, 3214 moduli trasformati, poi
`esbuild` del bundle server — solo l'avviso informativo sulla dimensione
di `dist/index.js`, nessun errore). Sostituisce la dichiarazione
precedente: dopo `357b50e` (Task 6) i due giri di fix successivi avevano
rieseguito solo `pnpm check` e `pnpm vitest run client/src/lib`, mai un
`pnpm test`/`pnpm build` per intero — ora rieseguiti entrambi, verdi.

**Verifica browser: IN SOSPESO.** Nessuno dei task di implementazione né
dei tre giri di fix (incluso questo) ha avviato server o browser (mandato
esplicito di ogni brief); resta al controller, login demo, 1440×900 e
390×844:

1. `/fatturazione`: elenco a card, filtro stato, ricerca, ordinamento per
   giorni nello stato, riga degli importi presente/assente secondo
   `economia.read`, stati vuoto/errore/caricamento.
2. `/fatturazione/:id`: i quattro passi (Documenti col fascicolo e «Leggi
   il contratto»; Contratto/Limiti/Fattura in modalità guidata), stepper
   cliccabile solo sui passi raggiungibili, «Avanti» disattivato col
   motivo quando il passo non è fatto.
3. Dialog «Modifiche non salvate» uscendo dal passo Contratto sporco
   (stepper, «Indietro»); verificare che «Salva e avanti» non lo apra mai.
4. `?passo=` che chiede un passo non ancora raggiungibile: l'URL si
   riscrive da solo sul passo giusto, senza sobbalzi visibili.
5. `/commesse/:id`: i tre tab in sola lettura (nessun campo, nessun
   pulsante di modifica) e il banner con un solo «Apri fatturazione»
   (44 px, destinazione coerente col prossimo passo); il percorso guidato
   resta invariato.
6. Flag `limiti`/`fatturazione`/`contrattoEstrazione` spenti uno alla
   volta: pagina nascosta, passo Fattura nascosto, «Leggi il contratto»
   nascosto.
7. Console pulita in ogni schermata, nessuno scroll orizzontale a 390.

**Debito.** Minori differiti, tutti dichiarati nei report dei singoli
task: prop `stato` non passata a `PassoDocumenti` dalla pagina che già la
possiede (il componente rilegge `commesse.byId` per conto proprio — stessa
chiave di cache, nessuna richiesta di rete in più, solo una query
duplicata nel codice); predicato `estrazioneAttiva` duplicato identico fra
`ElencoDocumentiCommessa.tsx` e `PassoDocumenti.tsx`; pulsanti icona da
28 px (`h-7 w-7`) preesistenti nel fascicolo, mai portati a 44 px da
questo piano; «chi ha caricato» il documento non è mostrato (il campo non
esiste nello schema attuale). (`CaricaDocumentoDialog` con id DOM statici
invece di `useId()`: risolto nel giro di fix 3, punto J.) `contratti.get`
e gli importi senza filtro `economia.read`: nota debito sopra, v. §12. M4
della review del Task 6 (due pulsanti «Apri fatturazione» identici, uno
nel banner e uno nel tab, con destinazioni diverse sulla stessa schermata
a 1440) è stato ratificato come comportamento voluto, non un difetto:
P4-R10.

**Provincia del cliente a menu (05/09/2026 sera, dopo il primo test dal
vivo della bozza fattura).** Il controllo «Provincia del cliente mancante»
ricavava la sigla solo dalla convenzione «Città (TO)». Ora l'anagrafica ha
il campo `provincia` (sigla di due lettere, elenco `shared/province.ts`,
107 province e città metropolitane, SU al posto di CI/VS): menu a tendina
«Provincia» in Nuovo cliente, Modifica cliente e nel pannello cliente della
commessa (`client/src/components/clienti/ProvinciaSelect.tsx`); zod
`provinciaSchema` su create/update (`null` svuota); backfill in `onLoad`
dalla città «(TO)» per i record vecchi; `snapshotCliente` preferisce il
campo e tiene la città come fallback; import CSV (colonna «provincia») e
sync FiC popolano il campo; Tars lo espone accanto alla città. Verifica
browser del menu: in sospeso (login demo).

**Stampa della fattura, anche in bozza (05/09/2026 sera).** Pagina
`/fatture/:id/stampa` (`client/src/pages/FatturaStampa.tsx`) registrata in
`App.tsx` FUORI dalla shell (prima voce del route contract e del manifest),
aperta in una scheda nuova dal pulsante «Stampa» della bozza
(`BozzaFatturaEditor`) e della fattura emessa (`FatturaEmessaView`, accanto a
«Scarica PDF»): intestazione sede/`intestatario`, cliente dallo snapshot,
cantiere, righe nell'ordine del documento (`righeStampa`), riepilogo IVA,
totali, scadenze con IBAN/banca della configurazione, diciture e note;
filigrana «BOZZA» e nota «non valida ai fini fiscali» finché la fattura non
è emessa; `@page A4`, pulsanti nascosti in stampa. Helper puri e test in
`client/src/lib/fatturaStampaView.ts`. Le query restano quelle protette
(`fatture.byId`, `fatturazioneConfig.get`, `sedi.active`): senza sessione la
pagina rimanda al gestionale. Il PDF ufficiale di Fatture in Cloud resta
quello nel fascicolo; questa è la copia di lavoro. Verifica browser in
sospeso (login demo).

**Studio delle fatture reali e bozza «come la commercialista» (05/09/2026
sera).** Su mandato della direzione: 131 fatture FiC 2026 con righe (API,
sola lettura), 18 fogli limiti con la colonna «Da fattura», 23 PDF, i 3
contratti del CRM; replay di motore e risolutore su 19 lavori contro la
fattura vera. Regole trovate, differenze e modifiche in
`docs/superpowers/specs/2026-09-05-studio-fatture-reali.md`. In codice:
`bilancia` nel generatore (servizi in proporzione fino al 40 % dei limiti,
poi beni significativi, markup mai negativo; seam `bilanciaBozza: false`
per i test sulla proposta grezza), beni non significativi al 10 % sulla
riga, `beneSignificativoDefault` ristretto ai serramenti/porte, ricerca
cliente FiC con `tax_code = '…'` (prima HTTP 422 e fattura ferma in «in
emissione»), pulsante «Riprendi emissione», piè di pagina della stampa non
duplicato. Dati grezzi con nomi dei clienti solo nello scratchpad di
sessione, mai nel repo. Verifica browser: in sospeso.

## 12. Debito aperto prioritario

1. Configurazione R2 e migrazione reale dei file Railway.
2. Rotazione credenziali esterne e decisione sul purge Git history.
3. Attivazione OAuth FiC per ogni sede.
4. Miglioramento della copertura dati storici di commesse, costi e squadre.
5. Tars operativo T3–T10 COMPLETATI (01/09/2026): catena Maccari chiusa
   (lettura → classificazione → archivio R1 → transizione condizionale),
   frontiera unica R2/R3 con anteprima hashata, osservatore per commessa,
   pattern/Panorama, miglioramenti CRM inerti, classi di costo e flag
   granulari (`FLAG_TARS_PATTERNS`, `FLAG_TARS_IMPROVEMENTS`,
   `TARS_OBSERVER_MODE`). Restano: rollout per fasi dal runbook (flag
   spenti di default), eval REALI con conferme anonimizzate, ed eventuale
   sintesi a budget di classe. Non usare la rimozione storica come roadmap
   del runtime corrente.
6. Verifica del log della pulizia WhatsApp, poi nuovo onboarding coexistence
   per reimportare lo storico outbound con la controparte corretta.
7. Osservazione del Centro Azioni in `shadow` su Railway e attivazione graduale
   per sede dopo confronto con le notifiche legacy.
8. **Reset pattuiti: usare l'interfaccia, non lo script.** Impostazioni →
   `Reset pattuito e pagamenti manuali` (`commesse.resetPattuiti`, direzione
   soltanto): Simula, controlla i numeri, poi Esegui. Azzera `importoTotale` e
   `pianoRate` ed **elimina** i pagamenti `origine="manuale"` — eliminati, non
   stornati, recuperabili solo dal backup Drive, che viene verificato prima di
   procedere. Dopo il reset serve `Sincronizza ora` per ogni sede.

   Il 26/08/2026 il reset è stato eseguito con `scripts/reset-pattuiti.ts` via
   `railway run` ed è stato **annullato entro poche ore**: `persistedStore`
   tiene le raccolte in memoria e `save()` riscrive l'intera riga JSONB, quindi
   il primo salvataggio del server vivo — il sync FiC ne fa uno a ogni giro
   automatico — ha sovrascritto le modifiche fatte da fuori con la sua copia
   precedente. Lo
   script resta valido solo a servizio fermo. Vale per qualunque manutenzione
   futura sui dati: contro un'istanza attiva si passa dal processo, mai dal
   database.
9. Verifica su Railway delle query PostgreSQL della chat aziendale: le suite
   locali esercitano solo il fallback in memoria.
10. ~~Slice 2 authz (R4/R5)~~ **COMPLETATA il 28/08/2026** (v. §7, «Slice 2 —
    dati economici dietro capability»). Resta l'azione operativa: censire chi
    registrava acconti senza essere amministrazione e creare gli override
    individuali da Permessi.
11. Fotografia read-only della produzione secondo
    `docs/runbooks/verifica-produzione-readonly.md` (nessuna modifica senza
    autorizzazione esplicita).
12. ~~Document Intelligence (decisione D7 del 28/08/2026)~~ **COMPLETATA
    il 29/08/2026** — tutte e cinque le slice del piano (analisi conferme,
    collegamento assistito, approval gateway, OCR locale, eval): v. §7 e
    PRD §19.4. Restano operativi: raccolta di ~20+ conferme reali
    anonimizzate per `server/documenti/eval/casi-reali/` (misura vera
    dell'accuratezza) e, volendo l'italiano OCR anche in locale,
    `brew install tesseract-lang` (in produzione l'apt lo installa già).
13. **Router `produzione` (BOM/fasi/NC) candidato a bonifica**: la pagina
    UI è stata rimossa il 29/08/2026 (release hardening, PRD §20) e il
    router non ha più consumatori, ma gli store kv possono contenere dati
    reali. Prima di rimuoverlo servono: decisione registrata, matrice
    campo→consumer, sorte dei dati. Annotazione in
    `server/routers/produzione.ts`; la vecchia route reindirizza a
    `/kanban` (test in `server/routers/produzionePagina.test.ts`).
14. **Fixture d'oro del computo**: harvest chiuso il 05/09/2026 (Ruling
    R22) — `server/computo/__fixtures__/casi-reali.json` è passato da 3 a
    **20 casi** (13 verdi al centesimo); tapparelle, persiane, scuri e
    cassonetti sono ora coperti, resta solo un foglio reale con serramenti
    in legno (v. §11-vicies terdecies). Restano parcheggiate, in attesa di
    una decisione di direzione o commercialista, le quattro divergenze
    H3-H6 dello stesso harvest (veneziane a pezzo o a mq, cinque fogli su
    un'edizione precedente del listino DEI, l'inclusione «solo fatturato»
    che `OpzioniComputo` non sa rappresentare, il doppio prezzo
    dell'avvolgibile PVC standard nello stesso foglio): finché non
    arrivano, i casi che le toccano restano `salta` in fixture.
15. **Fatturazione dal contratto (piano 2, 04/09/2026)**: PEC, codice
    destinatario e `ficEntityId` del cliente sono campi server
    (`clienti.update`) senza UI nel form cliente — verificato, nessun
    riferimento in `client/src`; restano da esporre in un'estensione
    operativa successiva. Fatture libere e acconti restano fuori ambito
    (D3/D6 della spec); IVA al 4 % e B2B senza contratto pure (Ruling
    R21). Gli ~20 fogli «CALCOLO NUOVI LIMITI» reali raccolti il 04/09
    (xlsm, Desktop, mai nel repository) sono il materiale che può chiudere
    il punto 14 qui sopra (fixture d'oro del motore computo), in un task a
    parte dopo questo piano (Ruling R22). `tsconfig` esclude `*.test.ts`
    da `tsc`: i test restano controllati solo da vitest a runtime, non dal
    type-check di `pnpm check`. Piano 3 (lettura del contratto PDF):
    completato e su `main` dal 05/09/2026 (v. §11-vicies quindecies e punto
    16 qui sotto). Aperti
    da confermare col commercialista: aliquote di detrazione 2025/2027 nel
    seed (piano 1); segno con cui Fatture in Cloud stampa il totale di una
    nota di credito; company FiC di prova per la prima emissione reale (la
    numerazione è reale, non simulata).
16. **Lettura del contratto PDF (piano 3, 04-05/09/2026)**: 9 task
    completati su `feature/lettura-contratto`, **su `main` dal push
    fast-forward `d7e0ab5` (05/09/2026)** (v. §11-vicies quindecies). Il
    giro di fix del Task 8 (Ruling
    P3-R29/P3-R30/P3-R31 + minori) e il giro 4 della mappatura (Ruling
    P3-R32) sono scritti nel codice il 05/09. Restano aperti: (1) resta
    da verificare nel browser (1440×900 e 390×844) il dialog «Leggi il
    contratto» dopo quel giro, e resta duplicato l'editor delle rate fra
    dialog e tab Contratto; (2)
    `server/contratti/eval/casi-reali/` è vuota, nessun contratto reale
    anonimizzato ancora raccolto; (3) il pattern nullable dello schema
    strict (Ruling P3-R6) non è mai stato esercitato dal vivo contro l'API
    OpenAI reale — la prima chiamata reale segue il runbook del §11-vicies
    quindecies.
17. **Fatturazione guidata (piano 4, 05/09/2026)**: 7 task completati,
    review finale del ramo fatta e il suo giro di fix 3 chiuso su
    `feature/fatturazione-guidata` (base `f3b551b`, HEAD reale `340f955`
    più il commit docs di questo stesso giro), **non ancora su `main`**
    (v. §11-vicies sedecies). Aperti: (1) verifica browser (1440×900 e
    390×844) mai eseguita, in nessuno dei tre giri di fix — elenco,
    percorso a passi, dialog contratto sporco, `?passo=` bloccato dai
    prerequisiti, tab in lettura e banner della scheda commessa, flag
    spenti, console pulita: lista completa in §11-vicies sedecies; (2)
    minori differiti (prop `stato` a `PassoDocumenti`, predicato
    `estrazioneAttiva` duplicato, pulsanti icona 28 px preesistenti nel
    fascicolo, «chi l'ha caricato» non mostrato — l'id DOM di
    `CaricaDocumentoDialog` è stato risolto nel giro di fix 3); (3)
    `contratti.get` restituisce `pattuitoCent` a chiunque abbia
    `contratto.read` (tutti i ruoli) mentre `/fatturazione` lo nasconde
    senza `economia.read` — preesistente al piano, decisione a sé con
    matrice campo→consumer; (4) nessuna transizione di stato automatica
    della commessa: la fattura emessa toglie la commessa dall'elenco, ma
    il passaggio dello stato `fatture_pagamento` al successivo resta un
    gesto umano, fuori ambito dichiarato (spec §9); (5) **letture in
    blocco non completate** (I3 chiuso solo al minimo, Ruling P4-R15):
    contratto e intestazione del computo restano una lettura per
    commessa candidata (3 query × N), mai raggruppate come le fatture
    (1 query per tutte le N); la riscrittura a «una lettura per store»
    resta il bersaglio della spec §5; (6) **tipo `stato` più stretto di
    quanto `passi` restituisce**: `CommessaDaFatturare.stato` è tipato
    `StatoDaFatturare` (solo `aggiornamento_contratto` o
    `fatture_pagamento`), ma la procedura `passi` non filtra per stato —
    una commessa in un altro stato (es. `produzione`) torna comunque il
    suo `stato` vero sotto un tipo che lo esclude; oggi nessun consumer
    lo usa per una commessa fuori dai due stati, quindi non si rompe
    nulla, ma il tipo mente (Minor della review finale, mai scelto se
    allargare il tipo o restringere la procedura).

## 13. Cosa resta della piattaforma

Eventi, notifiche realtime, SSE, Web Push, policy e Centro Azioni restano e
funzionano: non erano l'agente, erano l'infrastruttura sotto. I flag di
piattaforma vivono ora in `platform.flags` (`server/routers/platform.ts`);
prima uscivano da `tars.config.get`, e con Tars sarebbe sparito anche lo
stream SSE delle notifiche.

**Limite noto:** `platform.flags` è di sola lettura. L'unico endpoint di
scrittura (`tars.config.setPlatformFlags`) è stato rimosso con l'agente,
quindi i flag sono congelati ai valori salvati per sede finché non verrà
reintrodotto un endpoint direzione con motivazione e audit. Un cambio urgente
richiede una finestra a servizio fermo — mai scritture sul DB con l'istanza
viva (§12.8).

Alcuni flag non hanno più un consumer — `contextEngineMode`, `plannerMode`,
`semanticSearchMode`, `autonomyCapabilities` — e sono rimasti nel tipo perché
toglierli tocca le righe salvate senza guadagnare niente. Il prossimo agente
decida se rivuole quei nomi.
