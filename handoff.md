# Handoff - Ruffino Flow (`infissi-ops-app`)

> Stato tecnico e operativo del CRM. Questo documento è pensato per chi entra
> nel progetto senza il contesto delle sessioni precedenti.

**Aggiornato:** 23/08/2026<br>
**Base Git descritta:** `main` a `b8eea4f` (correzione storico WhatsApp, stato
sync reale e osservabilità dei gate Tars)<br>
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

client/src/
  App.tsx                   rotte lazy e boundary di caricamento
  index.css                 design tokens light/dark
  pages/messaggi/EmailPage.tsx     inbox operativa Email
  pages/messaggi/WhatsAppPage.tsx  workspace conversazioni WhatsApp
  pages/Integrazioni.tsx    Drive, FiC, storage e altre integrazioni
  pages/TarsCommandCenter.tsx      cabina operativa Tars
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
- scopes read-only `entity.clients:r issued_documents.invoices:r`;
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

## 6. Tars e caching

Tars usa ora profili strumenti diversi per trigger, invece di inviare sempre
l'intero catalogo:

- `riconciliazione_fatture`: set minimo per FiC e pagamenti;
- `smistamento`: 7 strumenti per classificazione, ricerca e collegamento
  verificato; le azioni profonde restano nel flusso puntuale;
- `gestione_comunicazione`: analisi puntuale della mail, allegati, nuovo lead,
  ticket e bozza risposta;
- `on_demand`: profilo operativo mirato;
- `audit_processi`: quadro aggregato e miglioramenti di processo;
- chat/seguito: catalogo completo quando serve esplorazione libera.

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
solo sicurezza, regole di classificazione e collegamento. Insieme al profilo da
7 strumenti porta il prefisso fisso stimato da circa 6.393 a 1.379 token per
lotto (-78%), mantenendolo sopra la soglia utile al prompt caching. Le decisioni
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
Il context engine persistente e incrementale descritto nei piani resta debito
aperto: il codice corrente aggrega fonti già correlate nelle proposte, non
costruisce ancora fascicoli trasversali persistenti per entità.

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
può essere eseguito al massimo una volta ogni circa 24 ore; produce solo
proposte misurabili e mai modifiche autonome.

La deduplica delle proposte usa una chiave d'azione canonica per tipo e target,
con un controllo di similarità sul titolo come rete aggiuntiva. Sono bloccate
sia le proposte già pendenti o rifiutate sia quelle approvate, risposte o già
gestite. Il contatore dei duplicati evitati è visibile nella Inbox Tars.

### Comunicazioni operative e filtro anti-rumore

La tabella `comunicazioni` persiste categoria, score, motivo e fonte della
classificazione. Per ogni nuova email in ingresso il filtro locale legge header
spam/lista, mittente, contenuto, allegati e match CRM, ma produce soltanto una
pre-analisi: la riga nasce `da_classificare` e rimane nella coda finche Tars non
chiama `classifica_comunicazione`. Solo Tars puo assegnare automaticamente la
categoria definitiva; `spam` e `offerta_marketing` richiedono confidenza alta e
assenza di dubbi. In caso contrario il tool forza `da_classificare` e salva una
motivazione leggibile dall'operatore. Una classificazione manuale ha precedenza
e non viene sovrascritta.

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

Il run automatico si limita a classificare tutte le mail e, quando la
corrispondenza è verificata, a proporre il collegamento a una commessa. Nuovo
lead, assegnatario, ticket, pagamento, allegati e bozza risposta vengono gestiti
nel flusso `gestione_comunicazione` avviato dall'operatore: evita di caricare 23
schemi di strumenti su ogni lotto senza perdere le capacità operative.

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

Il workspace WhatsApp e di sola lettura: non invia messaggi ne media. Media e
allegati mostrano metadati ispezionabili; l'eventuale download resta vincolato
alla fonte e alle integrazioni future. Email mantiene invece il lettore e le
azioni operative: dopo il collegamento alla stessa commessa, un allegato puo
essere letto dalla casella sorgente e archiviato nel fascicolo. Eliminare una
comunicazione dal CRM non modifica la casella: il tombstone evita la
re-importazione.

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
- WhatsApp: conversazioni raggruppate, direzione in/out e diagnostica
  `smb_message_echoes` dopo un invio dall'app primaria;
- Integrazioni: stato Drive, storage e FiC;
- Tars: Command Center `Oggi`, fonti raggiungibili, proposta approvabile e
  nessuna azione automatica inattesa.

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
6. Context engine Tars persistente e incrementale per cliente/commessa, con
   fingerprint, coda eventi e fascicoli separati per visibility scope.
7. Verifica del log della pulizia WhatsApp, poi nuovo onboarding coexistence
   per reimportare lo storico outbound con la controparte corretta.
