# Handoff - Ruffino Flow (`infissi-ops-app`)

> Stato tecnico e operativo del CRM. Questo documento è pensato per chi entra
> nel progetto senza il contesto delle sessioni precedenti.

**Aggiornato:** 28/08/2026<br>
**Base Git descritta:** `main`, senza agente: Tars è stato rimosso il 28/08/2026<br>
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
| AI | nessuna: agente rimosso il 28/08/2026 (§6); ogni automatismo è deterministico |
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
- Non c'è nessun agente AI. Ogni automatismo è deterministico: match, regole
  e aritmetica. Tars è stato rimosso il 28/08/2026 (§6).
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

## 6. Tars — rimosso il 28/08/2026

Tolto per intero su decisione della direzione: va rifatto da zero. Il racconto
completo — cosa c'era, cosa è sopravvissuto, dove sono i dati e cosa resta da
decidere — sta in [`docs/tars-rimosso-2026-08-28.md`](docs/tars-rimosso-2026-08-28.md).
Qui il minimo che serve a chi tocca il codice adesso.

**Il perimetro.** Via ~27.000 righe: loop, strumenti, prompt, proposte, chat,
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

Debito residuo dichiarato: il tetto per-run consente 3-7 chiamate al
modello secondo il caching (misurato); se gli eval reali mostrassero
run legittimi fermati, si alza il per-run — non si allenta la prudenza
della stima. La dedup del doppio click è in-process (replica singola,
vincolo già documentato §14).

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

## 12. Debito aperto prioritario

1. Configurazione R2 e migrazione reale dei file Railway.
2. Rotazione credenziali esterne e decisione sul purge Git history.
3. Attivazione OAuth FiC per ogni sede.
4. Miglioramento della copertura dati storici di commesse, costi e squadre.
5. Progettazione del nuovo agente: prima cosa deve fare, poi come. Le domande
   aperte stanno in `docs/tars-rimosso-2026-08-28.md`; la visione approvata è
   nel PRD §54 e la sequenza decisa (D1) nel dossier §11: prima contratti
   dati/eventi, poi il workstream agente in parallelo agli altri domini.
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
