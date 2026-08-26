# Handoff - Ruffino Flow (`infissi-ops-app`)

> Stato tecnico e operativo del CRM. Questo documento è pensato per chi entra
> nel progetto senza il contesto delle sessioni precedenti.

**Aggiornato:** 26/08/2026<br>
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
  quando l'ultima fattura viene scollegata. Scollegare NON azzera il pattuito:
  lo rende di nuovo scrivibile;
- le note di credito abbattono il pattuito e non generano rate in attesa;
- il punto unico è `sincronizzaPattuitoDaFic(sedeId)` in `ficFatture.ts`,
  chiamato dal sync, da `collega` e dallo scollegamento. È idempotente.

Il match fattura → commessa è stato riscritto (`server/routers/ficMatch.ts`).
La regola voluta: **basta un solo segnale in comune** fra telefono, email,
nome e cognome, indirizzo o identità fiscale perché la fattura venga allegata.
Il codice commessa citato nell'oggetto vince su tutto. L'unico caso non deciso
è la parità: due commesse con lo stesso punteggio lasciano la fattura in coda
con i candidati esposti. Il sync legge ora anche `email`, `phone`,
`address_street`, `address_city`, `address_postal_code` e
`subject/visible_subject` dall'entity FiC — prima scartava tutto tranne nome,
partita IVA e codice fiscale, ed è per questo che i privati non agganciavano.

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

I **costi fissi** sono ora calcolati da una regola deterministica
(`server/_core/costiRicorrenti.ts`), non da un modello: un costo è fisso se
compare per almeno **tre mesi consecutivi** con lo stesso importo (tolleranza
50 centesimi) dallo stesso fornitore, normalizzando la forma societaria. Le
note di credito passive restano fuori. La regola gira dentro `upsertCostiFic` e
prevale su Tars, mai su una classificazione fatta da una persona; i costi che
riclassifica escono dalla coda `idsDaClassificare`, quindi non consumano token.
`ficCosti.ricorrenti` espone l'elenco con fornitore, importo e periodo — la
domanda "quali sono?" prima non aveva risposta.

Le bande di composizione separano quattro perimetri: controllo incassi annuale,
Vendite FiC, Acquisti FiC e portafoglio CRM attivo all-time. Il confronto annuale usa
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

Fatturato e costi canonici sono imponibili al netto delle rispettive note di
credito; IVA, lordo, rate pagate e rate aperte sono valori distinti. La vecchia
azione `Ignora` è presentata come `Escludi dalla riconciliazione`: il documento
resta nei totali FiC e nel break-even, ma non compare nella coda operativa.
`/pagamenti` mostra Copertura costi fissi: obiettivo netto mensile calcolato dal
margine di contribuzione e dai costi fissi FiC degli ultimi 12 mesi. I costi
dubbi sono esclusi e si revisionano nel tab Acquisti.

Tars classifica in batch i nuovi costi FiC con output strutturato e cache key
per sede/modello. Le correzioni utente e le regole esplicite prevalgono. Errori
OpenAI o bassa confidenza lasciano il record `dubbio` senza bloccare il sync.
`leggi_economia` usa gli stessi totali FiC e restituisce a Tars soltanto fonte,
criteri separati di competenza/cassa, confronto incassi, aggregati mensili e
affidabilità, senza documenti contabili completi.

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
forzare il recupero senza attendere le 6 ore usare `Sincronizza ora` in
Integrazioni.

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
9. **Reset pattuiti da eseguire in produzione.** `pnpm pattuiti:dry-run` e poi
   `pnpm pattuiti:reset` (`scripts/reset-pattuiti.ts`). È DISTRUTTIVO: azzera
   `importoTotale`, `pianoRate` e **elimina** i pagamenti con
   `origine="manuale"` — eliminati, non stornati, quindi recuperabili solo dal
   backup Drive. Lo script si rifiuta di partire senza un backup Drive riuscito
   nelle ultime 24 ore, come `storage:migrate`. Dopo il reset serve
   `Sincronizza ora` per ogni sede: il pattuito si ricostruisce dalle fatture.
   **Non ancora eseguito su Railway.**
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
