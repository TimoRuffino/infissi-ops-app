# Handoff - Ruffino Flow (`infissi-ops-app`)

> Stato tecnico e operativo del CRM. Questo documento è pensato per chi entra
> nel progetto senza il contesto delle sessioni precedenti.

**Aggiornato:** 28/08/2026<br>
**Base Git descritta:** `main`, inclusi i flussi Tars operativi del 25/08/2026 e gate active ancora chiusi<br>
**Produzione:** https://crm-ruffinogroup.up.railway.app<br>
**Deploy:** Railway segue `main`

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
| AI | OpenAI Responses API con function calling, proposta con approvazione umana |
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
- Tars propone; non esegue modifiche senza approvazione. Le azioni approvate
  passano dalle stesse mutation tRPC dell'interfaccia.
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

server/tars/
  loop.ts                   ciclo agentico e preload fascicolo
  openai.ts                 OpenAI Responses API e prompt caching
  tools.ts                  profili strumenti, fascicolo e cache per run
  stores.ts                 esecuzioni, proposte, budget e audit
  commandCenter.ts          ranking e brief deterministici, senza chiamata AI
  comunicazioni.ts          tabella messaggi e statistiche
  planner/                  piani tipizzati, resume e recovery idempotente
  workflows/                workflow cliente/commessa e flussi operativi
  context/                  fascicoli materializzati e cache per scope
  search/                   indice testuale/semantico ACL-aware
  learning/                 esiti strutturati per capability
  autonomy/                 gate puro; autonomia negata per default
  processMetrics.ts         indicatori compatti e direzione del miglioramento
  processExperiments.ts     baseline ed esperimenti persistiti per sede
  processExperimentReview.ts verifica automatica alla scadenza

server/events/              registro eventi, consumer e recovery lease
server/notifications/       repository, proiettore, SSE e Web Push
server/observability/       metriche aggregate privacy-safe

server/actionCenter/
  signals.ts                regole pure, priorità e deduplica
  repository.ts             PostgreSQL/memory e audit eventi
  reconcile.ts              ciclo di vita e auto-risoluzione
  scheduler.ts              modalità legacy/shadow/active e recupero
  tars.ts                   coda asincrona di analisi Tars

client/src/
  App.tsx                   rotte lazy e boundary di caricamento
  index.css                 design tokens light/dark
  pages/messaggi/EmailPage.tsx     inbox operativa Email
  pages/messaggi/WhatsAppPage.tsx  workspace conversazioni WhatsApp
  pages/Integrazioni.tsx    Drive, FiC, storage e altre integrazioni
  pages/TarsCommandCenter.tsx      cabina operativa Tars
  components/ActionCenter.tsx      coda personale/sede e transizioni
  pages/TarsInbox.tsx       viste legacy riusate per proposte e registro
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
- la fattura torna in coda a Tars (`tarsAnalizzata = false`).

**Tars sulle fatture orfane.** Il trigger `riconciliazione_fatture` riceve ora
i candidati scartati dal match con il dubbio scritto, i contatti in fattura e
l'elenco delle commesse già rifiutate. Il prompt gli chiede di collegare solo
quando è sicuro, di usare `chiedi_chiarimento` quando il dato non torna invece
di scegliere la commessa più somigliante, e — se il cliente fatturato non ha
nessuna commessa nel CRM — di usare `proponi_nuovo_lead` con `ficId`:
all'approvazione nascono cliente e commessa e la fattura ci si attacca da
sola. Il profilo strumenti include perciò `leggi_assegnatari` e
`proponi_nuovo_lead`; la chiave d'azione di `crea_lead` nato da fattura è il
`ficId`, per non produrre due proposte per lo stesso documento.

Il resto del contratto resta invariato:

- fatture, rate, importi incassati, date e storni hanno FiC come fonte
  autorevole;
- il sync scrive e aggiorna automaticamente soltanto movimenti con
  `origine = fic`, usando una chiave sorgente stabile e senza duplicarli;
- i pagamenti manuali non vengono mai mutati dal sync: una discordanza produce
  una proposta Tars `correzione_pagamento` da approvare;
- un movimento FiC annullato resta nel registro come `stornato`, conserva
  l'audit e non alimenta `importoIncassato`;
- snapshot FiC incompleti non stornano movimenti assenti dalla risposta.

Le proposte di correzione usano una chiave d'azione canonica. Se più pagamenti
manuali sono compatibili, l'operatore deve scegliere la riga prima di poter
approvare. Una proposta già soddisfatta o sostituita diventa `superata` e non
espone più azioni decisionali; fingerprint e guardie no-op impediscono di
applicare una correzione su dati cambiati nel frattempo.

Il vincolo di riconciliazione e ora uno-a-uno in entrambe le direzioni: un
pagamento manuale non puo essere riutilizzato per due rate FiC. Il sync ripara
anche i vecchi link duplicati conservando quello compatibile con importo/data e
creando, quando necessario, un movimento FiC distinto per la rata restante.
La scelta resta deterministica anche se FiC restituisce le rate in ordine
diverso e copre i link duplicati tra fatture; un movimento FiC persistito senza
link viene recuperato senza duplicarlo. Se più link puntano alla stessa rata,
il movimento FiC perdente viene stornato; un manuale perdente genera invece una
proposta di neutralizzazione che non sposta il link canonico. Una nota FiC
multirata incompatibile con tutte le rate sospende i nuovi importi di quella
fattura fino alla decisione dell'operatore, senza sospendere aggiornamenti o
storni dei movimenti già esistenti. L'approvazione rivalida la rata FiC
viva, la source key, il link e il pagamento prima di qualsiasi scrittura: una
proposta vecchia diventa `superata`, senza errore né modifica. La card Tars
confronta `Nel CRM ora` con `FiC propone`, dichiara l'effetto sull'incassato e
nasconde il comando quando i dati di confronto non sono leggibili.

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
`non_abbinabile` → `riconciliata` → `proposta` → `attesa_incasso` →
`da_riconciliare`; una proposta Tars pendente vince sull'attesa, perché quella
è lavoro. Il filtro è diventato due chip, e badge e Dashboard contano solo
`non_abbinabile` + `da_riconciliare`. Lo strumento Tars `leggi_fatture_cloud`
con `soloNonRiconciliate` tiene invece dentro anche `attesa_incasso`: per una
lettura una fattura non pagata è pertinente, per una coda operativa no.

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

Tars classifica in batch i nuovi costi FiC con output strutturato e cache key
per sede/modello. Le correzioni utente e le regole esplicite prevalgono. Errori
OpenAI o bassa confidenza lasciano il record `dubbio` senza bloccare il sync.
`leggi_economia` usa gli stessi totali FiC e restituisce a Tars soltanto fonte,
criteri separati di competenza/cassa, confronto incassi, aggregati mensili e
affidabilità, senza documenti contabili completi.

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
senza contesto per sempre: niente appuntamenti, niente ticket, niente proposte
Tars. Ora `mail.whatsapp.collegaConversazione` fa le due cose che servono
insieme:

1. scrive un **override** nello store `whatsapp_conversation_aliases` (che da
   nome-soltanto è diventato nome + `clienteId` + `commessaId`, con i record
   vecchi leggibili e i campi nuovi a `null`). Vale anche per i messaggi che
   devono ancora arrivare: `registraMessaggio` lo consulta PRIMA del matcher,
   perché riscrivere solo lo storico aggancia il passato e alla prima risposta
   del cliente la conversazione tornava scollegata;
2. riscrive le righe `comunicazioni` già esistenti, perché Inbox, Tars e le
   proposte leggono da lì — senza, la scheda WhatsApp avrebbe detto una cosa e
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

Il collegamento esplicito o approvato da Tars scarica il PDF ufficiale e lo
archivia come documento `fattura` della commessa **dopo** aver persistito il
collegamento. Ogni sync ripara i collegamenti storici rimasti senza file:
controlla soltanto fatture con `commessaId`, deduplica per sorgente FiC,
continua sulle altre se un download fallisce e ritenta al giro successivo. Un
errore del PDF non annulla collegamento o riconciliazione economica e non crea
fallback base64; UI ed esito distinguono PDF archiviati e da ritentare. Per
forzare il recupero senza attendere il giro orario usare `Sincronizza ora` in
Integrazioni, oppure `Riallinea dalle fatture` quando basta rileggere i
documenti già scaricati.

## 6. Tars e caching

### Autonomia operativa (26/08/2026)

Il principio "propone, non esegue" è ora **configurabile per sede**, su
decisione esplicita della direzione. Prima l'unico modo di far accadere
qualcosa era un click, e il costo non era la sicurezza ma l'attesa: decine di
approvazioni al giorno su azioni che venivano approvate comunque.

`agente_config.autonomia` porta quattro campi: `attiva`, `killSwitch`,
`tipiConsentiti[]` e `principalUserId`. Con l'autonomia attiva, alla fine di
ogni run `loop.ts` chiama `eseguiProposteAutonome` che approva le proposte dei
tipi consentiti passando dalla **stessa** `approveProposalSerialized` di un
click umano — quindi stesse guardie, stesso doc gate, stessi permessi.

Tre confini non sono negoziabili da configurazione:

1. `TIPI_IRREVERSIBILI` (`chiudi_commessa`, `domanda`) non entra mai in
   whitelist: il filtro è applicato sia in `onLoad` dello store sia nel
   runner sia nell'endpoint, di proposito ridondante;
2. l'esecuzione è attribuita a un **utente reale** della sede (`principalUserId`,
   validato con `requireAssignableUser`) e usa i suoi permessi. Senza
   responsabile configurato l'autonomia non parte;
3. ogni esecuzione viene annunciata nella chat aziendale. Un annuncio fallito
   viene loggato e non annulla le scritture, ma senza canale l'autonomia
   perde la sua reversibilità pratica.

Il prompt cambia di conseguenza (`prompt-v5`, `tools-v5`): Tars non chiede più
il permesso di proporre, e con l'autonomia attiva riceve un blocco che gli dice
di scrivere titolo e motivazione come RESOCONTO, non come richiesta. Il blocco
sta nel system e cambia solo quando la direzione tocca la configurazione, così
non invalida il prefisso di cache.

Il pannello è in Impostazioni → Tars, direzione-only. `killSwitch` nega tutto
senza perdere la lista dei tipi.

### Intake dei file (26/08/2026)

`server/tars/intakeAllegati.ts` legge nome file e oggetto **prima** del
modello: `analizzaAllegato` restituisce tipo probabile, nomi candidati, codice
commessa citato e — soprattutto — `richiedeLettura`, che distingue "non lo so
ancora" da "non c'è niente da sapere nel nome".

La riga `Allegati:` del blocco smistamento porta ora quella pre-analisi
(`[0] misure Rossi.pdf — tipo probabile "misure", riferimento a rossi`).
Costa una regex invece di un giro di strumenti. Su un nome muto
("IMG_4821.jpg", "scan0003.pdf", "WhatsApp Image …") la riga dice
esplicitamente `→ apri il file con leggi_allegato`: da un nome muto il tipo
NON viene dedotto, perché le sue stesse parole sono rumore.

I profili strumenti sono stati allargati: `smistamento` e
`gestione_comunicazione` hanno ora `leggi_magazzino` e
`proponi_aggiornamento_magazzino` — una data di consegna che arriva in una
mail del fornitore è il dato più fresco che esista e passava da un secondo
giro manuale. `on_demand` ha i lettori trasversali (`leggi_quadro_azienda`,
`leggi_organizzazione`, `ricerca_ibrida`, `cerca_clienti`).

`DOC_TIPI` si è allargato con `documento_identita`, `visura`, `planimetria` e
`certificazione`; per quei tipi (più `foto` e `altro`) l'upload NON applica
l'auto-rename `{Tipo} {cliente}.ext`, che su tre documenti d'identità della
stessa commessa produceva `… (2)` e `… (3)` indistinguibili. La scheda commessa
ha ora un comando **Rinomina** che cambia nome e tipo.

### Profili strumenti

Tars usa profili strumenti diversi per trigger, invece di inviare sempre
l'intero catalogo:

- `riconciliazione_fatture`: set minimo per FiC e pagamenti;
- `smistamento`: 9 strumenti per classificazione, ricerca, collegamento
  verificato e proposta di archiviazione degli allegati operativi;
- `gestione_comunicazione`: analisi puntuale della comunicazione, allegati, nuovo lead,
  ticket e bozza risposta;
- `on_demand`: profilo operativo mirato;
- `audit_processi`: quadro aggregato e miglioramenti di processo;
- `centro_azioni`: fascicolo e sole letture/proposte necessarie per
  approfondire un caso persistente;
- chat/seguito: catalogo completo quando serve esplorazione libera.

L'audit processi non genera piu consigli liberi. Salva una fotografia giornaliera
compatta in `tars_process_snapshots` e puo proporre al massimo un esperimento
fondato su una delle metriche server (`commesse_ferme_10g`, non assegnate,
clienti senza contatti, interventi senza squadra, merce in ritardo o tasso
errori Tars). Il tool verifica baseline, denominatore, campione, target,
responsabile e data tra 7 e 90 giorni. L'approvazione crea
`tars_process_experiments` e un caso assegnato nel Centro Azioni; uno scheduler
orario rilegge il quadro alla scadenza e registra `migliorato`, `invariato` o
`peggiorato`. La misurazione non chiama OpenAI e non modifica workflow o regole.

Le proposte `miglioramento_processo` pendenti sono correggibili nella stessa
card. L'operatore può cambiare azione, target, responsabile e data, ma deve
spiegare cosa Tars ha sbagliato; metrica e baseline restano bloccate. La route
`tars.proposte.correggiEsperimento` rivalida dati, sede e scadenza, registra un
audit prima/dopo in `Proposta.correzioni` e produce un outcome `modified`.
L'approvazione crea esperimento e caso Centro Azioni con i valori corretti. Le
ultime correzioni entrano nel blocco decisionale dinamico dei run Tars, mai nel
prefisso cache o nello smistamento, e non diventano regole aziendali.

La chat e il suo seguito possono usare `proponi_nuovo_lead` senza
`comunicazioneId` quando l'operatore chiede esplicitamente di creare cliente e
prima commessa. Il tool cerca il contesto, valida l'assegnatario e crea una sola
proposta; l'esecutore chiama le mutation reali soltanto dopo approvazione. I
trigger automatici senza comunicazione vengono rifiutati lato server.

Le proposte figlie e gli esiti di un seguito vengono idratati ricorsivamente
nello stesso messaggio chat che ha originato la richiesta. Il client aggiorna
la conversazione a 1, 2, 4, 8 e 15 secondi finche una domanda risposta o una
proposta approvata ha ricevuto il proprio seguito: non e piu necessario aprire
la tab Proposte per completare un flusso iniziato in chat.

Le proposte pendenti (`pendente`, incluse le domande) e fallite (`errore`)
espongono anche `Elimina`. La route
`tars.proposte.rimuovi` applica sede, ACL e stato, poi aggiunge l'utente a
`hiddenForUserIds`: la proposta sparisce per lui da chat, Centro Azioni e
commessa, ma resta persistita per audit, deduplica e per gli altri utenti
autorizzati. Non è una cancellazione fisica e non si applica alle proposte già
approvate, rifiutate, risposte o superate.

Per richieste come "il lavoro e finito", Tars usa
`verifica_chiusura_commessa`: saldo, gruppi documentali obbligatori, step in
corso, ticket e interventi aperti vengono controllati insieme. Se non esistono
blocchi propone una sola `chiudi_commessa`; dopo approvazione l'esecutore
rivalida il fingerprint e porta la commessa fino ad `archiviata` rispettando la
state machine. Non propone avanzamenti intermedi.

`leggi_fascicolo_commessa` raccoglie in parallelo commessa, timeline, documenti,
ordini, magazzino, ticket, interventi e garanzie. Se il run conosce già la
commessa, il fascicolo viene precaricato nel primo messaggio, evitando un giro
modello-strumento.

Il modello principale predefinito è `gpt-5.6-sol`; i trigger automatici usano
`gpt-5.6-terra`, più economico. `gpt-5.6-luna` è disponibile come opzione ad
alto volume, ma va selezionato solo dopo una verifica su un campione reale. La richiesta usa la Responses API con
`store=false`, function calling e ragionamento `low` sugli automatismi e
`medium` sulle richieste umane, contesto reasoning `all_turns` sui modelli 5.6
e verbosity bassa. Gli item `reasoning.encrypted_content` vengono
restituiti al provider tra i turni, mantenendo stateless il loop. Raggiunto il limite strumenti, Tars riceve un
solo turno finale senza tool: il run non può proseguire indefinitamente.

La cache è su due livelli:

1. OpenAI prompt caching sul prefisso stabile della richiesta: i modelli
   GPT-5.6 ricevono un breakpoint esplicito dopo le istruzioni developer,
   modalità `explicit` con TTL 30 minuti e un `prompt_cache_key` deterministico
   per sede, profilo e modello. `gpt-5.4-mini` mantiene il caching implicito perché
   non supporta i breakpoint espliciti.
2. Cache in-run per strumenti `leggi_*` e `cerca_*`, compresa la deduplica delle
   richieste contemporanee identiche.

Il prompt automatico dello smistamento è separato da quello generale e contiene
solo sicurezza, regole di classificazione, collegamento e allegati operativi.
Il profilo da 9 strumenti resta molto più compatto del catalogo completo e
mantiene il prefisso sopra la soglia utile al prompt caching. Le decisioni
recenti non vengono aggiunte ai run di smistamento perché non informano la
classificazione e cambierebbero inutilmente il suffisso.

Ogni esecuzione registra profilo, numero di strumenti esposti, cache hit e
preload fascicolo, token letti dalla cache e token scritti, anche quando la
risposta del provider è incompleta o fallisce dopo aver consumato token. I campi storici
`cache write 5m/1h` restano per retrocompatibilità; le scritture cache OpenAI
sono registrate nel bucket con moltiplicatore 1,25. Questi dati sono visibili
nel Registro Tars, che mostra modello, token totali processati, quota letta dalla
cache, scritture e costo stimato. Errori di caricamento del registro hanno uno
stato esplicito e non vengono confusi con un registro vuoto. La cache non
attraversa utenti o run e non conserva risultati mutabili oltre l'esecuzione.

`/tars` apre ora il Command Center sulla tab `Oggi`, seguito da `Proposte`,
`Analisi`, `Chat` e `Registro` (quest'ultimo solo direzione). L'endpoint
`tars.commandCenter.get` combina proposte pendenti ed esecuzioni degli ultimi 30
giorni, applica scope sede e ordina le priorità con ranking deterministico di
urgenza, impatto e confidenza. Ogni priorità priva di una prova viene esclusa e
la chiave d'azione canonica impedisce doppioni nella vista. Il brief viene
costruito senza chiamare OpenAI: aprire o aggiornare la pagina non consuma token.
Il Centro Azioni persiste ora il contesto operativo minimo per situazione:
fingerprint, evidenze, assegnatario, scadenza, prossima azione, analisi Tars e
registro eventi. Non è ancora una memoria semantica generale per cliente o
commessa: ricerca pgvector e riassunti storici incrementali restano roadmap.

### Centro Azioni e rollout

- `ACTION_CENTER_MODE=legacy`: solo notifiche v2 read/unread.
- `ACTION_CENTER_MODE=shadow` o variabile assente: il nuovo motore riconcilia
  ogni minuto e la pagina Tars mostra i casi, ma la campanella resta legacy.
- `ACTION_CENTER_MODE=active`: campanella personale con massimo tre righe e
  badge `9+`; la coda completa resta in Tars `Oggi`.
- I casi alti/critici nuovi o cambiati accodano Tars in lotti da tre. La pagina,
  il badge e le query lista non chiamano OpenAI.
- Prima di attivare in produzione confrontare per sede `signals`, `cases`,
  `suppressedDuplicates`, criticità mancanti ed errori schema nei log.

In produzione è obbligatoria `OPENAI_API_KEY`. `ANTHROPIC_API_KEY` non viene più
letta dal codice e può essere rimossa da Railway dopo un deploy verificato.
Gli errori HTTP del provider sono sanitizzati prima di log e registro. Al check
del 19/08/2026 Railway vedeva la variabile ma OpenAI rispondeva `401
invalid_api_key`: sostituire la variabile con una project API key valida, senza
virgolette o spazi, ridistribuire e verificare una classificazione reale.

L'analisi che l'operatore lancia dal banner della commessa (trigger `on_demand`)
non può più chiudersi in silenzio: o propone, o chiede con `chiedi_chiarimento`
e le opzioni, o chiude con `nessuna_azione` motivata. Il vincolo è esigibile,
non solo scritto nel prompt: `nessuna_azione` con motivo sotto i 40 caratteri
viene rifiutata e l'errore torna al modello. Serve perché `loop.ts` usa quel
motivo come riepilogo mostrato sulla commessa, e un motivo vuoto produceva un
referto bianco indistinguibile da un'analisi mai fatta. Il vincolo è legato al
solo trigger `on_demand`: lo smistamento chiude i lotti senza motivo e deve
poterlo fare.

Dal 18/08/2026 Tars dispone inoltre di letture trasversali per quadro aziendale,
organizzazione, produzione, qualità e contenuto documentale. I dati restano
sempre sede-scoped e le informazioni di direzione sono esposte solo ai ruoli
autorizzati. L'audit processi viene controllato ogni sei ore e, per ogni sede,
può essere eseguito al massimo una volta ogni circa 24 ore; produce al massimo
un esperimento misurabile e mai modifiche autonome. La card mostra baseline,
obiettivo, responsabile, data e azione da provare invece del testo generico
"Tars migliora il processo".

La deduplica delle proposte usa una chiave d'azione canonica per tipo e target,
con un controllo di similarità sul titolo come rete aggiuntiva. Sono bloccate
sia le proposte già pendenti o rifiutate sia quelle approvate, risposte o già
gestite. Il contatore dei duplicati evitati è visibile nella Inbox Tars.

### Comunicazioni operative e filtro anti-rumore

La tabella `comunicazioni` persiste categoria, score, motivo e fonte della
classificazione. Per ogni nuova Email e ogni WhatsApp in ingresso non triviale il filtro locale legge
mittente, contenuto, allegati e match CRM — e per Email anche gli header
spam/lista — ma produce soltanto una
pre-analisi: la riga nasce `da_classificare` e rimane nella coda finche Tars non
chiama `classifica_comunicazione`. Solo Tars puo assegnare automaticamente la
categoria definitiva; `spam` e `offerta_marketing` richiedono confidenza alta e
assenza di dubbi. In caso contrario il tool forza `da_classificare` e salva una
motivazione leggibile dall'operatore. Una classificazione manuale ha precedenza
e non viene sovrascritta.

Un breve WhatsApp di cortesia già collegato con certezza e privo di allegati
può essere marcato analizzato senza un run; è l'unica eccezione anti-rumore. Un
messaggio con almeno un allegato non è mai triviale e passa sempre da Tars.

Le categorie escluse non entrano nei conteggi operativi, ma restano recuperabili
nella vista Escluse. Se Tars e spento, non configurato, oltre budget o salta una
mail nel lotto, la comunicazione resta visibile e non analizzata. Una risposta
incompleta viene ritentata dopo un minuto; un errore API dopo la pausa di sicurezza
di 15 minuti. Il filtro fallisce in apertura, mai nascondendo messaggi.

I tre gate automatici (`disattivato`, chiave OpenAI mancante, budget esaurito)
producono un warning quando cambia la causa del blocco e un log quando il
worker riparte. Lo stesso stato non viene ripetuto a ogni recupero minuto per
minuto; la coda resta sempre conservata.

Una richiesta di preventivo, sopralluogo o contatto commerciale concreto ha
precedenza su header spam, segnali newsletter e regole persistenti del mittente.
Se porta lavoro rimane visibile come `nuovo_lead` (o `operativa` per un cliente
già riconosciuto), anche quando proviene da un'azienda o da un portale che usa lo
stesso indirizzo per campagne e richieste.

Lo smistamento automatico usa lotti da 10. Il primo trigger parte dopo circa 5
secondi; un lotto completo con altra coda prosegue dopo circa 500 ms. Se il
modello salta un id il retry è dopo un minuto, mentre un errore API applica una
pausa di 15 minuti. I trigger arrivati durante un run o una pausa non annullano
più il risveglio successivo. `avviaRecuperoSmistamento()` controlla le code dopo
5 secondi dal bootstrap e poi ogni minuto, quindi recupera anche mail rimaste
pendenti dopo un deploy senza aspettare nuovi messaggi. Riattivazione di Tars e
variazione del budget risvegliano subito la coda.

Il run automatico classifica tutte le comunicazioni e, quando la corrispondenza
è verificata, può proporre il collegamento a una commessa e l'archiviazione di
un allegato operativo. Nuovo lead, assegnatario, ticket, pagamento e bozza
risposta restano nel flusso `gestione_comunicazione` avviato dall'operatore.

Collegare una comunicazione a una commessa la porta in Gestite. Il punto unico è
`setMatchComunicazione`, quindi vale per il collegamento manuale e per le
proposte Tars approvate (`collega_comunicazione`, `crea_lead`), mai per il match
automatico dell'ingestione, che passa da `insertComunicazione` e deve restare
leggibile in coda. Scollegare riporta a `vista`; le categorie escluse restano
gestite. Al primo boot un backfill una tantum, protetto dal marker
`comunicazioni_migrazioni`, porta in Gestite le collegate già `vista` — le
`nuova` non vengono toccate perché nessuno le ha ancora aperte.

La pagina espone cinque code, selezione multipla, classificazione manuale,
regole esatte per mittente riservate alla direzione e collegamento commessa con
conferma. I badge distinguono `In attesa di Tars` e `Dubbio Tars`; nel lettore
sono visibili fonte, confidenza e motivo. Una fascia di stato mostra conteggio,
anzianità della coda, elaborazione o ripresa e spiega se Tars è spento, senza
chiave, oltre budget o in pausa API. L'operatore può inoltre istruire Tars
sulla singola comunicazione. Se
non esiste una commessa, la proposta `crea_lead`, dopo approvazione, crea cliente
e commessa in preventivo e collega la mail. Prima della proposta Tars legge gli
utenti attivi della sede e chiede obbligatoriamente a chi assegnare il lavoro; il
seguito conserva il contenuto della comunicazione e applica la scelta sia al
cliente sia alla commessa. `comunicazioneId` entra nella chiave canonica, quindi
la stessa azione non viene riproposta.

### Messaggi: route, API e limiti di canale

Le route canoniche sono `/messaggi/email`, `/messaggi/whatsapp` e `/tars`.
`/comunicazioni` e `/inbox` restano esclusivamente deep link legacy: usano un
redirect `replace` rispettivamente verso Email e Tars. Il primo conserva solo
`view` tra le viste Email riconosciute e `messaggio` numerico positivo; il
secondo conserva le tab correnti `oggi`, `proposte`, `analisi`, `chat` e
`registro`, oltre alle legacy `pendenti` e `decise`, normalizzate a `proposte`.

Il router `mail` espone le API specifiche `mail.email.list`, `byId`, `stats`,
`segnaTutteViste` e `archiviaAllegato`; tutte sono forzate sul canale Email e
sulla sede attiva. `mail.whatsapp.conversazioni` e `thread` sono letture
sede-scoped; `segnaVista` aggiorna solo i messaggi in ingresso della stessa
sede, account e controparte, mentre `rinominaConversazione` puo cambiare solo
l'alias di una chat non collegata a un cliente CRM. Il contesto mostra proposte
Tars soltanto quando `comunicazioneIds` ne prova il legame con i messaggi
caricati. Il router storico `mail.comunicazioni.*` rimane per le mutation
condivise e i consumatori esistenti.

Una conversazione WhatsApp e una riga per account e controparte normalizzata,
con chiave client `wa:<casellaId>:<numero-normalizzato>`; `sedeId` non entra
nella chiave ma e sempre applicata dal server. Il nome visualizzato segue la
priorita cliente CRM, alias dell'operatore, profilo Meta, numero normalizzato.
L'alias e persistito per sede, account e numero e non puo sovrascrivere un nome
CRM.

Scollegare una configurazione WhatsApp non elimina le chat. Quando lo stesso
numero aziendale viene ricollegato con Embedded Signup, il server riconosce la
vecchia casella dai destinatari dei messaggi e ne riusa l'id interno. In questo
modo storico, alias e collegamenti non vengono separati dai nuovi messaggi.

Il workspace WhatsApp e di sola lettura: non invia messaggi ne media e non
modifica la fonte. Tars può però proporre l'archiviazione di un allegato in
ingresso: dopo approvazione lo legge da Meta e lo salva nel fascicolo con gli
stessi controlli usati per Email. Se il media non è più disponibile su Meta,
l'operazione fallisce esplicitamente senza creare documenti parziali. Eliminare una
comunicazione dal CRM non modifica la casella: il tombstone evita la
re-importazione.

Il workspace Email usa una lista stabile da circa 18-21 rem e un lettore
elastico sui desktop da 1280 px. Il pulsante nell'intestazione entra in modalità
focus nascondendo la lista; sotto 1280 px lista e lettore diventano viste
separate, così il contenuto non viene schiacciato. Il corpo mantiene una misura
tipografica leggibile, mentre allegati e azioni Tars possono usare una larghezza
maggiore. Il lettore entra automaticamente in focus quando l'operatore avvia
un'analisi Tars o quando la mail contiene proposte pendenti; il comando in
intestazione permette sempre di ripristinare l'elenco. Nel dettaglio mittente,
indirizzi, collegamenti, nomi allegato, riepiloghi e proposte vanno a capo e non
vengono troncati.

La configurazione WhatsApp espone una diagnostica webhook privacy-safe:
ultimo campo e orario ricevuti, ultimo `smb_message_echoes`, eventi echo,
messaggi echo consegnati e registrati. Non salva corpi, numeri, nomi o message
id. Serve a distinguere con certezza «Meta non ha consegnato l'echo» da
«l'echo è arrivato ma era già presente». Il parser gestisce `messages`,
`history` e `value.message_echoes` sotto il campo `smb_message_echoes`.

Per lo storico coexistence la controparte canonica è
`history[].threads[].id`: i messaggi outbound storici non dipendono più da un
campo `to` che Meta riserva agli echo. Gli echo live continuano a usare
`to`/`recipient_id`; un messaggio senza controparte normalizzabile viene
rifiutato senza loggare id, numero o contenuto. La richiesta accettata da Meta
imposta `storicoRichiestoAt`, i webhook aggiornano progresso e ultimo evento,
e soltanto il progresso 100 imposta il completamento. La card aggiorna lo stato
ogni 5 secondi mentre la consegna è in corso.

Verifica produzione del 23/08/2026: configurazione `1/1` attiva, storico
completato, `195` messaggi totali, echo live `1/1` registrato e outbound
precedenti al ricollegamento visibili con etichetta `Tu:` (campione verificato
del 18/08). Le chat già presenti sono rimaste nella stessa conversazione dopo
il nuovo onboarding.

Durante il ricollegamento Meta generava QR e codici validi lato web, ma
WhatsApp Business li rifiutava sul telefono. La procedura riuscita è stata:
backup chat verificato nell'app, disinstallazione e reinstallazione di
WhatsApp Business, ripristino del backup, quindi nuovo Embedded Signup con
`Collega l'app WhatsApp Business` e condivisione dello storico. Questa è una
misura di recupero dello stato locale dell'app, non il primo tentativo: non
eliminare WABA, numero Meta o comunicazioni CRM per risolvere lo stesso errore.

Al primo boot PostgreSQL dopo il deploy, la migrazione
`pulizia_whatsapp_outbound_senza_controparte_v1` elimina fisicamente soltanto
gli outbound WhatsApp legacy con `mittente` vuoto. È intenzionale: libera i
`message_id` che altrimenti bloccherebbero la reimportazione corretta. Dopo il
deploy va verificato il conteggio nel log e solo allora rifatto l'onboarding
coexistence per richiedere nuovamente lo storico.

Le suite locali esercitano il fallback in memoria quando manca `DATABASE_URL`;
non dimostrano le query PostgreSQL, le configurazioni dei canali o i dati di
Railway. Prima del deploy verificare le route e i deep link, l'accesso
sede-scoped, una casella Email, una configurazione WhatsApp e i relativi
allegati nell'ambiente Railway. Nessun controllo esterno e nessuna mutation
verso Railway e stato eseguito da questa modifica documentale.

## 7. Modifiche code-complete del 14/08/2026

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

## 7-bis. Chat aziendale (26/08/2026)

Route `/chat`, voce di menu sotto **Messaggi**. È la comunicazione *interna*:
niente a che vedere con Email e WhatsApp, che parlano coi clienti.

Persistenza in tabelle PostgreSQL dedicate (`chat_canali`, `chat_messaggi`,
`chat_letture`), non in `kv_store`: una chat cresce a ogni messaggio e
riscrivere un blob JSONB ogni volta è la malattia già curata per le
comunicazioni. Senza `DATABASE_URL` degrada a un array in memoria con la
stessa API.

Tre tipi di canale:

- `generale` — uno per sede, non si lascia. Ci finiscono le azioni che Tars
  esegue in autonomia e **tutte** le decisioni degli operatori sulle proposte
  (approvate e rifiutate, con chi ha deciso). È il registro leggibile che
  rende l'autonomia accettabile;
- `diretto` — fra due persone. La chiave è la coppia ordinata di id, quindi
  A→B e B→A sono la stessa conversazione. L'id 0 è riservato a Tars: le
  assegnazioni arrivano lì;
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
- Comunicazioni: cinque code, selezione multipla, esclusione/ripristino,
  collegamento confermato, preventivi sempre visibili, scelta assegnatario e
  creazione lead approvata;
- WhatsApp: conversazioni raggruppate, direzione in/out, diagnostica
  `smb_message_echoes` dopo un invio dall'app primaria e archiviazione di un
  allegato in ingresso approvato da Tars nel fascicolo commessa;
- Integrazioni: stato Drive, storage e FiC;
- Tars: Command Center `Oggi`, fonti raggiungibili, proposta approvabile e
  nessuna azione automatica inattesa; verificare anche una proposta esperimento
  con baseline/target/responsabile, correggere assegnatario e feedback nella
  card, quindi verificare il caso corrispondente nel Centro Azioni;
- Email: archiviare un allegato approvato da Tars e riaprirlo/scaricarlo dal
  fascicolo commessa; verificare inoltre vista affiancata a 1440 px, modalità
  focus, vista singola sotto 1280 px e a 390 px, e assenza di scroll
  orizzontale;
- FiC: collegare una fattura, verificare il PDF nel fascicolo, eliminare solo il
  documento di test e lanciare `Sincronizza ora` per controllare il recupero
  idempotente e il conteggio PDF nell'esito;
- Economia: confrontare incassi CRM/FiC sullo stesso anno, verificare gli avvisi
  sui pagamenti senza data, alternare Competenza/Cassa e controllare che una
  fattura esclusa dalla riconciliazione resti nei totali;
- Chat Tars: approvare una proposta figlia senza lasciare la conversazione e
  verificare che il relativo esito compaia nello stesso thread;
- Centro Azioni in `shadow`: confrontare conteggi aggregati, priorità,
  dedupliche e assegnazioni; passare ad `active` solo dopo il controllo;
- Pattuito: aprire una commessa con fattura FiC collegata e verificare che il
  totale sia in sola lettura con badge `da FiC` e il piano rate popolato;
  aprirne una senza fattura e inserire pattuito e due rate a mano;
- Chat aziendale: inviare un messaggio nel generale e in una diretta,
  assegnare una commessa a un altro utente e verificare che gli arrivi il
  messaggio, approvare una proposta e ritrovarla nel generale;
- Autonomia: accendere un solo tipo a basso rischio, verificare che l'azione
  compaia nel generale e nel Registro Tars, poi provare il blocco d'emergenza;
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
| `Agente_Ruffino_Ops.md` | architettura e policy di Tars |
| `docs/storage-r2.md` | configurazione e migrazione R2 |
| `CLAUDE.md` | guida operativa per agenti di coding |
| `guida_pubblicazione.md` | pubblicazione e deploy |

## 12. Debito aperto prioritario

1. Configurazione R2 e migrazione reale dei file Railway.
2. Rotazione credenziali esterne e decisione sul purge Git history.
3. Attivazione OAuth FiC per ogni sede.
4. Miglioramento della copertura dati storici di commesse, costi e squadre.
5. QA di `OPENAI_API_KEY` su dati reali dopo il deploy e monitoraggio errori,
   latenza, cache e costi Tars.
6. Attivazione progressiva per sede di context, planner e ricerca: l'indice
   testuale e implementato; il vettoriale resta `off` quando `pgvector` non e
   disponibile e non tenta installazioni automatiche.
7. Verifica del log della pulizia WhatsApp, poi nuovo onboarding coexistence
   per reimportare lo storico outbound con la controparte corretta.
8. Osservazione del Centro Azioni in `shadow` su Railway e attivazione graduale
   per sede dopo confronto con le notifiche legacy.
9. **Reset pattuiti: usare l'interfaccia, non lo script.** Impostazioni →
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
10. Autonomia Tars da accendere per sede in Impostazioni: scegliere il
    responsabile e i tipi consentiti, poi osservare la chat generale per
    qualche giorno prima di allargare l'elenco.
11. Verifica su Railway delle query PostgreSQL della chat aziendale: le suite
    locali esercitano solo il fallback in memoria.

## 13. Piattaforma Tars corrente

- Gli eventi business hanno deduplica, processing per consumer, retry,
  dead-letter e recupero dei lease stale.
- Le assegnazioni generano notifiche sede-scoped; SSE usa replay e polling di
  fallback. Tars riunisce priorita, piani, domande, approvazioni ed evidenze nel
  Command Center.
- Il planner esegue workflow registrati e riprendibili. Cliente + prima
  commessa usa una saga persistente idempotente; un errore parziale non duplica
  il cliente al retry.
- `ricerca_ibrida` combina testo, identificatori, riferimenti strutturati e,
  quando disponibile, embedding. Applica ACL prima e dopo il ranking e
  restituisce massimo otto frammenti con evidence ref.
- Gli esiti sono aggregati per capability e non entrano automaticamente nei
  prompt. Autonomia resta non qualificata: whitelist iniziale vuota, minimo 6
  settimane, 100 esiti, 98% accuratezza, eval allegato, undo e principal
  minimo; rischio alto, irreversibilita, incidenti o cambio versione negano.
- `diagnostica.snapshot` e direzione-only e mostra code eventi, dead-letter,
  notifiche, connessioni SSE, piani, cache e token per workflow senza contenuti
  cliente. Runbook: `docs/runbooks/tars-eventi-notifiche.md` e
  `docs/runbooks/tars-recovery.md`.
