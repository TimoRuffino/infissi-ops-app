# Runbook multi-azienda (WS1 fondazione tenant + WS2 archivi per tenant + WS3 file, backup, credenziali e guasti + WS4 abbonamenti + WS6 pannello piattaforma)

Spec: `docs/superpowers/specs/2026-09-06-ws1-fondazione-tenant-design.md`,
`docs/superpowers/specs/2026-09-07-ws2-porta-aperta-design.md`,
`docs/superpowers/specs/2026-09-08-ws3-file-integrazioni-design.md`,
`docs/superpowers/specs/2026-09-08-ws4-abbonamenti-design.md` e
`docs/superpowers/specs/2026-09-09-ws6-pannello-piattaforma-design.md` (le
decisioni prese durante l'esecuzione di WS2, WS3, WS4 e WS6 sono nelle
rispettive §2-bis). Moduli: `server/tenants/`, `server/piattaforma/`.
Interruttore: `FLAG_MULTI_AZIENDA` (fail-closed).

## Cosa fa, in una riga
Il tenant (azienda) esiste, è nel contesto di ogni richiesta, ha guardie e un
ruolo Proprietario (WS1); ogni store JSONB ha un archivio per azienda e le
tabelle SQL portano `tenant_id` (WS2); i file, il backup sul Drive, le
credenziali OAuth e i guasti dei worker sono per azienda, e il ripristino
degli archivi è un comando provato (WS3); ogni azienda ha un
abbonamento — prova di 30 giorni, omaggio, insoluto, sola lettura — e le due
risorse misurate, spazio e Tars, dopo la tolleranza smettono di funzionare
invece di limitarsi ad avvisare (WS4); dal pannello piattaforma si creano,
si sospendono e si invitano le aziende senza toccare la riga di comando
(WS6, su branch). Ruffino Group è il tenant 1 e tiene le chiavi di sempre.

> **Stato al 09/09/2026:** WS1, WS2, WS3 e WS4 sono su `main` (PR #3, #5 e
> #8 — quest'ultima porta WS3 e WS4 insieme, merge `37c1889`) e quindi
> distribuiti: Railway segue `main`. `FLAG_MULTI_AZIENDA` è **acceso in
> produzione dalle 09:54 del 09/09/2026**: le sezioni che dicono «in che
> ordine si accende» restano come storia della procedura, non come lavoro da
> fare. Il **WS6** (pannello piattaforma) è su
> `feature/ws6-pannello-piattaforma` e **non è su `main`**: la sua sezione
> vale dal momento in cui quel branch viene distribuito.

## Interruttore
- `FLAG_MULTI_AZIENDA=off` (default in produzione): il CRM di oggi. Tabelle,
  campi `tenantId` e cache esistono ma non guardano nessuno; i comandi
  restano in attesa; il ruolo `proprietario` non si aggiunge.
- `FLAG_MULTI_AZIENDA=on`: contesto con tenant, sola lettura
  per i tenant sospesi, sede attiva obbligatoria, proprietario assegnabile
  dai proprietari, comandi eseguiti al boot e ogni 30 s. Col WS2 in più: un
  archivio per azienda su ogni store, guardia anche sulle rotte Express
  (412), worker che girano per tenant. **La «porta chiusa» non esiste più**:
  un tenant diverso da 1 entra e vede i propri dati.
- Rollback: **ammesso solo finché l'unica azienda è il tenant 1.** Rimetti
  `off` e riavvia: nessun dato da toccare. Con una seconda azienda a terra il
  flag NON è più un rollback — a interruttore spento il contesto fissa
  `tenantId = 1` per chiunque, quindi la porta si chiude in faccia agli utenti
  delle altre aziende (vedi il punto qui sotto). Per fermare **una** azienda
  si usa `pnpm tenant stato --slug=<slug> --sospendi --motivo="…" --scrivi`
  (o il pannello piattaforma), che la mette in sola lettura senza toccare le
  altre.
- **Porta chiusa a interruttore spento** (WS6, ruling R10): a `off` un utente
  il cui record dice un'azienda diversa da 1 non entra. `auth.login` risponde
  `PRECONDITION_FAILED` «Accesso non disponibile: il multi-azienda della
  piattaforma è spento.» (dopo la verifica della password: senza credenziali
  giuste non si scopre quali email appartengono a un'altra azienda) e
  `createContext` tratta la sua sessione come inesistente, con una riga di log
  `[tenants] sessione rifiutata a interruttore spento (tenant <id>)`. Anche
  `inviti.anteprima` e `inviti.accetta` rifiutano con `PRECONDITION_FAILED`,
  senza consumare il token: riacceso l'interruttore l'invito vale ancora.
  Gli utenti di Ruffino Group entrano come sempre.
- Recupero — un'azienda resta senza sedi attive (dati manipolati fuori
  dall'app, non dalla guardia sull'ultima sede attiva introdotta col WS1):
  finché l'unica azienda è il tenant 1, `FLAG_MULTI_AZIENDA=off`, riavvio,
  riattiva una sede, poi `on`. Con più aziende NON spegnere l'interruttore
  (chiuderesti fuori gli utenti di tutte le altre): sospendi solo l'azienda
  colpita — `pnpm tenant stato --slug=<slug> --sospendi --motivo="…" --scrivi`
  — rimetti attiva una sua sede lavorando sul suo archivio (sezione «Script di
  manutenzione: `--tenant`»), poi `--riattiva`.

## Boot (log `[tenants]`)
Dal WS2 l'avvio del modulo è in due tempi attorno a `bootstrapAll()`:
`preparaTenants()` prima (schema di `tenants`, `tenant_eventi` append-only
con trigger, `tenant_comandi`; cache; seed della riga del tenant 1) e
`completaTenants()` dopo (specchio delle sedi sempre; con l'interruttore
acceso proprietario di ripiego — la prima direzione attiva con meno di 3
ruoli — e comandi in attesa). Riga attesa, a interruttore acceso:
`[tenants] tenant 1 (ruffino-group) pronto: N utenti, M sedi`. L'ordine
completo del boot è nella sezione «WS2 — archivi per tenant».

## Comandi dell'operatore (`pnpm tenant …`)
Lo script parla solo col database e accoda comandi; il server li esegue.
Mai scritture sugli store con l'istanza viva.

    pnpm tenant elenco
    pnpm tenant crea --slug=acme --nome="Acme Infissi" --email=titolare@acme.it \
         --nome-utente=Mario --cognome=Rossi --scrivi --attendi
    pnpm tenant stato --slug=acme --sospendi --motivo="insoluto" --scrivi --attendi
    pnpm tenant stato --slug=acme --riattiva --motivo="verifica conclusa" --scrivi
    pnpm tenant proprietario --slug=acme --email=m.rossi@acme.it --assegna --scrivi

- Senza `--scrivi`: anteprima, nessuna scrittura. `--attendi`: aspetta l'esito fino a 90 s.
- Nessun DDL dallo script, nemmeno per `elenco`: se le tabelle del control plane mancano si ferma con «Tabelle del control plane del tenant assenti…»; le crea il server al primo avvio con questa versione (deploy prima, script poi). Unica eccezione: `verifica`, che gira lo stesso su un database senza control plane e lo dichiara nel rapporto (serve prima del deploy).
- **Dal WS2 la sonda dello script chiede quattro tabelle, non tre**: a
  `tenants`, `tenant_eventi` e `tenant_comandi` si è aggiunta `tenant_sedi`
  (`verificaSchema`, `server/tenants/repository.ts`). Su un database dove
  gira il WS1 ma il WS2 non ha ancora fatto boot, `elenco`, `crea`, `stato` e
  `proprietario` dicono quindi «Tabelle del control plane del tenant
  assenti…» anche se il control plane del WS1 c'è: non è un guasto, manca
  solo lo specchio, che `completaTenants()` crea al primo boot del WS2.
  Deploy prima, script poi — anche fra WS1 e WS2.
- Password del proprietario: `TENANT_PROPRIETARIO_PASSWORD` nell'env o prompt nascosto; hashata prima di accodare.
- Un comando fallito resta `errore` con il motivo in `esito` e un evento `comando_fallito`: correggi e riaccoda. Nessun retry automatico.
- Su Railway: `railway run pnpm tenant …`. Sospendere il tenant 1 richiede `--anche-tenant-1`.

## WS2 — archivi per tenant

### Cosa fa il boot, in ordine

Con o senza interruttore, il boot del server fa queste cose in quest'ordine
(`server/_core/index.ts`, `server/tenants/boot.ts`):

1. `impostaResolverTenant` — chi risponde alla domanda «di che azienda è la
   richiesta in corso».
2. `preparaTenants()` — schema del control plane, cache, **seed della riga
   `tenants` del tenant 1 anche a interruttore spento**. Senza quella riga lo
   specchio resterebbe vuoto e `tenant_id` a NULL: cioè la migrazione non
   sarebbe verificabile nel deploy spento.
3. `bootstrapAll({ tenantIds, backfill: true })` — carica gli archivi:
   quelli globali una volta, gli altri una volta per azienda. Chi ha record
   senza `tenantId` li riceve qui e viene risalvato:
   `[persistence] backfill tenantId <chiave>: N record`. Solo il **server**
   passa `backfill: true`: gli script (`pnpm tenant`, i dry-run) leggono e
   non riscrivono mai.
4. `completaTenants()` — specchio `tenant_sedi` allineato dallo store `sedi`
   (sempre); poi, solo a interruttore acceso, proprietario di ripiego,
   comandi in attesa, ciclo ogni 30 s.
5. Gli `ensureSchema()` dei repository SQL, poi
   `applicaSchemaTabelleTenant()` — colonna `tenant_id`, indice e trigger
   sulle 33 tabelle con `sede_id`. **Solo DDL**, con un `lock_timeout` per
   tabella. Riga di log attesa, **prima** che la porta si apra:

       [tenants] tabelle: 33 applicate, 0 assenti, 0 rinviate, specchio 4 sedi

6. `server.listen` — il servizio è su.
7. **Dopo** il `listen`, in sottofondo, il backfill delle righe già a terra,
   a lotti da 5000. Riga di log attesa, da qualche secondo a qualche minuto
   dopo l'avvio:

       [tenants] backfill tenant_id: 128431 righe in 41250 ms (comunicazioni: 90210/28100 ms, business_events: 38221/13150 ms)

   Con `0 righe` il backfill non ha trovato nulla da riempire: è la
   condizione normale da tutti i boot successivi al primo.

**La verifica va fatta dopo aver visto la riga del punto 7**, non subito
dopo l'avvio: prima di quel momento `tenant_id` è legittimamente a NULL.

### `pnpm tenant verifica` (sola lettura, nessun DDL)

    pnpm tenant verifica                          # rapporto leggibile
    pnpm --silent tenant verifica --json          # per l'automazione
    npx tsx scripts/tenant.ts verifica --json     # idem, senza passare da pnpm

Il `--silent` non è un vezzo: senza, pnpm scrive il proprio banner **prima**
del `{` e, quando l'exit è 1, la riga `ELIFECYCLE` **dopo** — lo stdout non è
JSON valido. Su Railway: `railway run pnpm --silent tenant verifica --json`.

Exit code: **0** nessuna anomalia · **1** almeno un'anomalia (il rapporto
resta stampato) · **2** uso errato o `DATABASE_URL` mancante. L'exit 1 arriva
anche con `--silent`: sotto `set -e` va gestito (`|| true` e poi `$?`).

Che cosa conta come anomalia:

| Sugli store (`kv_store`) | Sulle tabelle per sede |
|---|---|
| `senzaTenant` — record senza `tenantId` | `sedeSconosciuta` — `sede_id` che non è in `tenant_sedi` |
| `tenantDiscorde` — `tenantId` diverso da quello della chiave | `tenantNullo` — `tenant_id` a NULL |
| `sedeSconosciuta` — `sedeId` assente o non in `sedi` | `tenantDiscorde` — `tenant_id` diverso dal tenant della sede |
| `idDoppi` — due record con lo stesso `id` | |
| `blobNonValido` — la riga esiste ma il JSON non è un array (vale 1) | |

Store esenti da parte dei controlli, per costruzione: `sedi`, `utenti`,
`backup_config`, `backup_log`, `backup_oauth` (globali, nessun tenant né
sede confrontabili); `platform_feature_flags` e
`platform_feature_flag_audit` (globali ma con una sede vera: esenti solo dai
controlli sul tenant).

**Cosa deve dire prima del deploy.** Molti `senzaTenant`: è il rapporto di
partenza atteso, nessuno ha ancora timbrato niente. Ogni record legacy conta
come `senzaTenant`, quindi **il comando esce 1**: prima del deploy l'exit 1 è
il risultato giusto, non un guasto — sotto `set -e` va gestito
(`|| true` e poi `$?`). Le tabelle possono non esistere. Se il database non ha
mai visto il control plane del tenant, lo strumento lo dichiara e va avanti lo
stesso:

    [tenant verifica] tenant_sedi assente (control plane del tenant mai creato
    su questo database): sedeSconosciuta/tenantNullo/tenantDiscorde non
    calcolabili sulle tabelle per sede, righe contate lo stesso.

**Cosa deve dire dopo il deploy a interruttore spento** (e dopo la riga di
log del backfill). Devono essere **zero**: `tenantDiscorde`, `idDoppi`,
`blobNonValido` sugli store, `tenantNullo` e `sedeSconosciuta` sulle tabelle
esistenti. Sono le anomalie vere: un archivio che si contraddice.

`senzaTenant` invece **non è tenuto a essere zero**, ed è la sorpresa da
mettere in conto. `tenantId` si timbra al CARICAMENTO dello store, non alla
scrittura (Ruling R3): ogni record creato dall'app **dopo** il boot nasce
senza timbro e compare nel rapporto. Quindi:

- un conteggio **piccolo** (decine, non migliaia) e **decrescente rispetto al
  rapporto di partenza**, concentrato negli store che il CRM scrive di
  continuo (comunicazioni, commesse, documenti), è **atteso**;
- si azzera **da solo al riavvio successivo**, che li carica e li timbra;
- un conteggio che resta dell'ordine di grandezza del rapporto di partenza
  significa che il backfill non è passato: torna ai log del **passo 3**
  (`[persistence] backfill tenantId <chiave>: N record` — è il backfill
  degli store, non quello delle tabelle del passo 7, che ha un prefisso e un
  formato diversi).

Il modo pulito di leggerlo: fai `verifica` **subito dopo** la riga di log del
backfill, quando l'istanza ha appena caricato tutto e non ha ancora scritto
molto.

> **Specchio stantio.** `sedeSconosciuta` lato **tabelle** si misura su
> `tenant_sedi`, lato **store** sul blob `sedi`. Se lo specchio non è
> allineato (una sede creata fuori dall'app, un database di prova riusato),
> il rapporto mostra anomalie di tabella pur avendo il blob `sedi`
> perfettamente coerente. Prima di dare la colpa ai dati: riavvia il server
> (`completaTenants` riallinea lo specchio a ogni boot) e rilancia la
> verifica.

### Script di manutenzione: `--tenant=<id>`

Gli script che leggono o scrivono uno store per tenant devono dire su quale
azienda lavorano — il Proxy di `persistedStore` non lo indovina:

    pnpm pattuiti:dry-run --tenant=2
    pnpm pattuiti:reset --tenant=2 --sede=7
    npx tsx scripts/importa-clienti.ts clienti.csv --apply --tenant=2

- Default `--tenant=1` (Ruffino Group): il comportamento di sempre, chi non
  passa nulla non cambia nulla.
- Deve essere un intero positivo: altrimenti lo script si ferma prima di
  toccare qualsiasi cosa.
- Il tenant scelto compare nella riga d'avvio e nell'intestazione del
  rapporto (`Tenant: 2`). **Leggerlo prima di dare `--apply`**: con il numero
  sbagliato si azzererebbero i pattuiti — o si importerebbe l'anagrafica — di
  un'altra azienda.
- Restano tutti gli avvisi di prima: **mai contro un'istanza in esecuzione**,
  e `pattuiti:reset` pretende un backup Drive fresco. `--tenant` non cambia
  nulla di questo. Nessuno di questi script fa il backfill di `tenantId`:
  chiamano `bootstrapAll()` senza `backfill` (lo timbra solo il server).

### Test su Postgres

I file `*.pg.test.ts` condividono un solo database di prova: lanciati
insieme e in parallelo (comportamento di default di `vitest`) scoprono una
corsa preesistente su `tenant_sedi` — un file la elimina in `afterAll`
mentre un altro vi inserisce nel frattempo, e i tre test falliscono con
`relation "tenant_sedi" does not exist`. Non è una regressione del codice:
lanciarli in sequenza è verde.

    DATABASE_URL=postgres://… npx vitest run --no-file-parallelism \
      $(git ls-files 'server/**/*.pg.test.ts')

Il gemello PDF del PRD (`PRD_infissi_ops_v4.pdf`, generato da
`scripts/build-prd-pdf.sh`, richiede Chrome e rete) non si rigenera da qui:
resta un passo della direzione, non dell'agente.

### Produzione, in ordine (WS2)

1. **Backup Drive riuscito nelle 24 ore precedenti.** Prima del deploy, non
   solo prima dell'accensione: al primo boot il codice timbra `tenantId` sui
   record e scrive `tenant_id` sulle tabelle, a interruttore spento.
2. **Finestra tranquilla, e niente sostituzione a caldo.** Il primo boot del
   WS2 non aggiunge una colonna: **riscrive ogni blob per tenant** di
   `kv_store` (il backfill di `tenantId`). Un rolling deploy su Railway tiene
   viva l'istanza VECCHIA mentre la nuova riscrive: ogni salvataggio della
   vecchia — e il sync FiC ne fa uno da solo — riparte dalla sua copia in
   memoria e cancella il timbro appena scritto, sull'intero blob. È lo stesso
   motivo per cui `pattuiti:reset` non si lancia contro un'istanza viva.
   Quindi: scegli un momento senza traffico e fai **fermare la vecchia
   istanza prima che la nuova parta** (riavvio, non scambio a caldo). Se il
   deploy è comunque avvenuto in rolling, non c'è danno ai dati: rilancia un
   **riavvio semplice** a traffico fermo e il backfill ripassa.
3. `pnpm --silent tenant verifica --json` **di partenza**, salvato: è il
   metro di paragone. `senzaTenant` ovunque è atteso, exit 1 compreso.
4. **Deploy a interruttore spento.** Guarda i log in quest'ordine: seed del
   tenant 1, `[tenants] tabelle: …` (prima del listen), il servizio che
   risponde, `[tenants] backfill tenant_id: …` (dopo). Nessun errore
   `[tenants]` o `[persistence]`.
5. `pnpm --silent tenant verifica --json` **dopo**, appena vista quella riga:
   zero `tenantDiscorde`, `idDoppi`, `blobNonValido`, `tenantNullo` e
   `sedeSconosciuta`. Un `senzaTenant` piccolo e in calo è atteso (v. sopra:
   il timbro si mette al caricamento) e sparisce al riavvio successivo.
   Confronta i conteggi dei record con il rapporto del passo 3: devono
   coincidere (la migrazione è additiva, non sposta nulla).
6. **Accensione** — `FLAG_MULTI_AZIENDA=on` e riavvio; già fatta se il WS1
   era acceso. Poi **un nuovo login**: il contesto del tenant si costruisce
   alla sessione.
7. **Un tenant 2 in produzione solo dopo il WS3**, che separa storage,
   backup e credenziali: con il solo WS2 la regola resta «nessun tenant 2 in
   produzione» — è una regola di runbook, non un blocco del codice. Con il
   WS3 distribuito il divieto decade e la seconda azienda si crea seguendo
   «Produzione, in ordine (WS3)»; il primo tenant 2 nasce comunque **in
   staging**, con `pnpm tenant crea`.

**Rollback = redeploy del build precedente.** Non c'è nulla da ripristinare:
le chiavi `tenant:n:*`, la tabella `tenant_sedi`, la colonna `tenant_id` e il
campo `tenantId` sui record restano nel database, invisibili e innocui per il
codice vecchio. Nessuna copia, nessuna rinomina, nessun cutover.

### Errori che l'operatore può vedere (WS2)

- `[persistence] accesso allo store <nome> senza tenant nel contesto` — un
  punto d'ingresso gira fuori da una richiesta senza dichiarare l'azienda.
  Dove guardare: il worker o il callback nominato dallo stack. Si corregge
  avvolgendolo in `conTenant`, `conTenantDellaSede` o `perOgniTenantAttivo`
  (`server/tenants/giri.ts`). Non è un problema di dati: nessuna richiesta ha
  letto l'archivio sbagliato, è il fail-closed che ha funzionato.
- `[persistence] store <nome> non istanziato per il tenant <id>` — un'azienda
  creata a metà (il comando `crea` è fallito dopo il tenant, prima degli
  archivi). Il comando resta in `errore` con il motivo: correggi e riaccoda.
- `[tenants] <tabella>: lock non ottenuto entro 5s, rinviata al prossimo boot`
  e `[tenants] tabelle: … R rinviate (…)` — quella tabella era occupata da
  una transazione lunga. Non è un guasto: al riavvio successivo ci riprova.
  Se si ripete su ogni boot, cerca la transazione che tiene il lock.
- `[tenants] tenant_sedi assente: colonne e trigger si installano lo stesso…`
  — il control plane non c'è ancora. `tenant_id` resta NULL finché non
  arriva; il boot successivo lo riempie.
- `[tenants] backfill tenant_id saltato: tenant_sedi non esiste ancora` —
  stessa causa, sul backfill.
- `[whatsapp-webhook] …`, `[ics] …`, `[fic-oauth] …` — le quattro rotte
  anonime (handshake e webhook WhatsApp, feed ICS, callback OAuth Fatture in
  Cloud) non hanno un utente, quindi cercano il tenant proprietario in tutte
  le aziende attive. Dal WS2 un errore lì viene **registrato** e la rotta
  risponde 403/404/500 o rimanda a `?fic=errore`: prima la promise rifiutata
  di un handler `async` non veniva catturata da Express e **abbatteva il
  processo** — con Meta e Google che riprovano, un ciclo di riavvii. Se una
  di queste righe si ripete, il servizio è comunque in piedi: guarda il
  messaggio, non i riavvii.

## WS3 — file, backup, credenziali e guasti per tenant

Spec: `docs/superpowers/specs/2026-09-08-ws3-file-integrazioni-design.md`
(le decisioni prese durante l'esecuzione sono nella sua §2-bis).

> **Stato al 09/09/2026:** il WS3 è **su `main` e in produzione**. I suoi 13
> task sono nati su `feature/ws3-file-integrazioni` (da `cea968e` a `3c9b2e3`,
> più la fusione di `main` `212bf6f` e l'ondata di fix `33c6056`/`1f33a4f`) e
> sono arrivati su `main` con la PR **#8** insieme al WS4 (merge `37c1889`,
> 09/09; la PR #7 del solo WS3 è stata chiusa a favore di quella). Da lì
> Railway ha distribuito, e `FLAG_MULTI_AZIENDA` è acceso dalle 09:54 dello
> stesso giorno: tutto ciò che segue è comportamento vivo.

Con il solo WS2 gli archivi sono per azienda, ma file, backup, credenziali e
guasti sono ancora dell'installazione: per questo il runbook vietava una
seconda azienda in produzione. Il WS3 toglie il divieto — ogni azienda ha i
suoi file contati, il suo backup sul suo Drive con un ripristino provato, i
suoi `state` OAuth, il suo instradamento dei webhook, e un guasto suo non
ferma le altre.

### Cosa fa il boot, in ordine (aggiunte del WS3)

Sopra i sette passi della sezione WS2, il boot con questo codice fa anche:

1. In `preparaTenants()`, insieme allo schema del control plane: la tabella
   `tenant_storage` (il ledger dei byte per azienda), la tabella
   `oauth_state` (gli `state` OAuth persistiti), la colonna
   `tenants.storage_quota_bytes` (100 GiB di default) e il `CHECK` di
   `tenant_comandi` allargato ai sette tipi di comando — i due nuovi sono
   `ricalcola_storage` e `ripristina_archivi`. Subito dopo,
   `impostaContabileStorage(creaContabileStorage())`: da qui in avanti ogni
   `putFile` e ogni `deleteFileQuiet` aggiornano il ledger.
2. In `bootstrapAll`, al caricamento di `backup_oauth`: il refresh token del
   Drive viene **cifrato** con `MAIL_ENCRYPTION_KEY` e il campo in chiaro
   sparisce dal blob e dallo specchio su file. **È a senso unico** (v.
   «Backup per azienda»). Senza la chiave la riga resta in chiaro e il boot
   lo dice: `[backup] tenant <id>: MAIL_ENCRYPTION_KEY assente, il refresh
   token resta in chiaro`.
3. **Dopo** `server.listen`, in sottofondo (accanto al backfill di
   `tenant_id` del WS2): il ricalcolo iniziale del ledger, solo per le
   aziende che non hanno ancora una riga in `tenant_storage`, una per volta.
   Riga di log attesa:

       [storage] ricalcolo iniziale tenant 1: 12043 file, 98123456789 byte in 61250 ms

   Da lì in poi il ledger lo tengono aggiornato `putFile` e
   `deleteFileQuiet`; il ricalcolo torna solo su comando.

**Dal WS3 la sonda dello script chiede sei tabelle, non quattro**:
`tenants`, `tenant_eventi`, `tenant_comandi`, `tenant_sedi` più
`tenant_storage` e `oauth_state` (`verificaSchema`,
`server/tenants/repository.ts`). Su un database dove gira il WS2 ma il WS3
non ha ancora fatto boot, `elenco`, `crea`, `stato`, `proprietario`,
`storage` e `ripristina` si fermano con «Tabelle del control plane del
tenant assenti (tenants, tenant_eventi, tenant_comandi, tenant_sedi,
tenant_storage, oauth_state)…»: il messaggio le nomina **tutte e sei** (fino
alla revisione finale ne nominava tre e mandava a cercare il guasto sulla
tabella sbagliata), e a mancare sono le due nuove. Non è un guasto — deploy
prima, script poi, anche fra WS2 e WS3. `verifica` resta l'eccezione: gira lo
stesso, senza DDL. **Col WS4 le tabelle chieste diventano sette**: si
aggiunge `abbonamenti`, e il messaggio la nomina (v. la sezione WS4).

### File: chiavi, ledger, quota

- I file **nuovi** nascono sotto `tenant/<id>/…`, per ogni azienda, **tenant
  1 compreso**. Le chiavi **nude** sono quelle di Ruffino Group e restano
  dove sono: nessuna migrazione fisica, nessuna rinomina (decisione 2 della
  spec). `docs/storage-r2.md` racconta le chiavi in dettaglio.
- In lettura c'è una cintura: `getFile` e `openFileReadStream` su una chiave
  di un'altra azienda restituiscono `null` — per il chiamante è «non
  trovato» — e lasciano nel log `[fileStorage] lettura rifiutata: chiave di
  un'altra azienda`. Mai la chiave: direbbe l'id di un record altrui. Le
  chiavi nude le legge solo il tenant 1.
- Il ledger `tenant_storage` sale a ogni `putFile` e scende a ogni
  `deleteFileQuiet`. Superata una soglia (50, 80, 100 % della quota) scrive
  un evento `storage_soglia` in `tenant_eventi` con percentuale, byte e
  quota, e non la ripete; si riarma scendendo sotto il 50 %.
- **La quota non blocca niente** (decisione 5): conta e avvisa. Il default è
  100 GiB per azienda (`tenants.storage_quota_bytes`).
- La contabilità è best effort: un suo errore è un log
  (`[fileStorage] contabilità non aggiornata (<id>): …`), mai un upload
  rifiutato. Il ledger deriva dal vero e può quindi discostarsi: la fonte di
  verità è il ricalcolo, su comando.
- La query `tenants.storage` espone byte, file, quota, percentuale, soglia
  avvisata e data dell'ultimo ricalcolo all'azienda della sessione. Nessuna
  schermata la mostra ancora: il WS3 non tocca il client.

### Comandi dell'operatore (aggiunte del WS3)

    pnpm tenant storage --slug=ruffino-group
    pnpm tenant storage --slug=acme --ricalcola --scrivi --attendi
    pnpm tenant ripristina --slug=acme --backup=2026-09-07 --prova --attendi
    pnpm tenant ripristina --slug=acme --backup=2026-09-07 --scrivi --attendi
    pnpm tenant elenco

- `storage` **senza** `--ricalcola` è sola lettura e non accoda niente:
  stampa `<slug>: N file, M byte su Q (P %), soglia avvisata S %,
  ricalcolato <ISO>`, oppure «nessun ledger ancora (il server lo calcola al
  primo boot del WS3, oppure `--ricalcola --scrivi`)».
- `storage --ricalcola` accoda il comando `ricalcola_storage` e vale la
  regola di sempre: senza `--scrivi` è solo l'anteprima. Lo esegue il
  server, che rilegge i documenti, gli allegati dei ticket, gli allegati
  delle comunicazioni e — con una `HEAD` allo storage, perché la dimensione
  non è registrata — le anteprime dei documenti e i PDF/XML delle fatture.
  Su un archivio grosso costa: si lancia quando serve, non per abitudine.
- `elenco` mostra ora, sotto ogni azienda, i worker sospesi
  dall'interruttore per guasto:

      2	acme	attivo	Acme Infissi
        worker sospeso: backup fino a 2026-09-08T23:41:12.004Z (Drive 503)

### Backup per azienda

- Ogni azienda collega il **suo** Drive: Integrazioni → «Backup e storage» →
  «Backup notturno su Google Drive» → collega l'account. Le procedure
  `backup.*` agiscono sull'azienda della sessione: nessuna legge o scrive il
  Drive di un'altra. Ruffino Group non cambia nulla di quello che fa oggi.
- Cartella radice: il tenant 1 tiene **«Backup CRM Ruffino»** (invariata: è
  la chiave con cui si ritrovano i backup già fatti); ogni altra azienda ha
  **«Backup Wyndoor — `<nome azienda>`»**, trovata o creata al primo backup.
  Dentro, una cartella `Backup CRM <AAAA-MM-GG>` per notte.
- L'albero contiene **solo** l'azienda del contesto: `database/<nome>.json`
  col nome dello store (mai la chiave `tenant:<id>:…`), sedi e utenti
  filtrati, `Utenti.json` di ogni sede coi soli utenti dell'azienda —
  il difetto lasciato aperto dal WS2 è chiuso. `backup_log` e `backup_oauth`
  non entrano nel dump: un segreto a riposo non si copia su Drive, nemmeno
  cifrato.
- Il giro notturno (00:00 Europe/Rome) resta uno e passa per ogni azienda
  attiva che ha il backup abilitato nella **sua** configurazione; i tre
  ritentativi a 20 minuti di distanza restano, per azienda.
- **Un'azienda che non ha ancora collegato il suo Drive viene saltata**, con
  la riga `[backup] tenant <id>: Drive non collegato, salto`: non è un
  errore, non fa tentativi e non trattiene il giro delle altre (il backup
  nasce abilitato per tutte, quindi senza il salto ogni notte avrebbe
  bruciato tre tentativi e due attese da 20 minuti per un esito noto in
  partenza). Il backup che invece **fallisce davvero** tre volte conta come
  errore per l'interruttore qui sotto.
- **I ripieghi valgono solo per Ruffino Group**: service account e disco
  locale del server sono del tenant 1. Un'altra azienda senza OAuth non
  finisce da qualche altra parte: il backup fallisce e lo dice, «Account
  Google non collegato: collega il Drive dell'azienda da Integrazioni →
  Backup».
- **Token cifrato e rollback a senso unico.** Al primo caricamento con
  questo codice il refresh token viene cifrato con `MAIL_ENCRYPTION_KEY`; il
  codice precedente legge solo il campo in chiaro, che non c'è più. Se si
  torna al build precedente il backup Drive smette di funzionare finché non
  si **ricollega il Drive** da Integrazioni, una volta per azienda. Nessun
  dato perso, ma è l'unico punto non additivo del WS3: va messo nel piano di
  rollback.
- `MAIL_ENCRYPTION_KEY` deve essere già sul server quando si collega un
  Drive: senza, il callback rifiuta prima di salvare («MAIL_ENCRYPTION_KEY
  non configurata sul server: senza chiave il refresh token di Drive non può
  essere salvato.») e il browser torna su `/integrazioni?gdrive=errore`.
- Gli `state` OAuth di Drive e Fatture in Cloud non vivono più in una mappa
  di processo: stanno in `oauth_state` (azienda, sede, utente, scadenza 10
  minuti, consumo una tantum). Un deploy fra «collega» e il ritorno da
  Google non invalida più il collegamento; uno `state` scaduto o già usato
  porta a `/integrazioni?gdrive=errore` (o `?fic=errore`) con un log, e non
  salva niente.

### Ripristino degli archivi, passo per passo

Il ripristino **sostituisce archivi interi**, non fonde niente: i record
nati dopo il backup si perdono, ed è il senso dell'operazione. I file **non**
si ricaricano — le `storageKey` restano valide nello storage, il Drive è la
seconda copia. Il tenant 1 pretende `--anche-tenant-1`, come `sospendi`.

1. **Prova.**

       pnpm tenant ripristina --slug=acme --backup=2026-09-07 --prova --attendi

   `ripristina` è l'unico sottocomando che accoda anche in prova: il Drive
   dell'azienda lo legge il server, che ha il token, non lo script. Il
   `--backup` è una data (`Backup CRM <data>` sotto la radice dell'azienda)
   oppure l'id di una cartella. Con `--solo=clienti,commesse` si limita
   l'elenco degli store. **Uno fra `--prova` e `--scrivi` va sempre
   indicato**: senza, il comando si ferma con «Indica --prova (solo lettura
   da Drive) oppure --scrivi (ripristino vero)» e non accoda nulla.
2. **Leggi l'esito** (`--attendi` lo stampa; altrimenti sta in
   `tenant_comandi.esito`): `dryRun`, la cartella trovata, `store[]` con
   `nome`, `prima`, `dopo`, `sostituito`, le `anomalie` (le note dicono
   perché un dump presente sul Drive non verrà sostituito, i difetti dicono
   che il dump è rotto) e le `avvertenze`. Un dump difettoso fa fallire il
   ripristino vero: si guarda qui prima di scrivere.
3. **Scrivi**: stesso comando con `--scrivi` al posto di `--prova`. Il
   server mette l'azienda in `sospeso` (motivo «ripristino archivi in
   corso»), sostituisce gli store uno per uno scrivendo subito il blob sotto
   il lock dello store, riattiva l'azienda — solo se era attiva prima: una
   già sospesa resta sospesa — e registra l'evento `archivi_ripristinati`
   con backup, store e conteggi.
4. **Verifica**: `pnpm tenant elenco` (l'azienda deve essere `attivo`),
   `pnpm --silent tenant verifica --json`, e un giro nell'app con un utente
   di quell'azienda.
5. **Riavvia il server se il backup è più vecchio del codice.** Gli archivi
   ripristinati **non passano da `onLoad`**: default dei campi nuovi,
   backfill e migrazioni di forma non girano. L'esito lo ripete
   nell'avvertenza «Gli archivi ripristinati non passano da onLoad: se il
   backup è di una versione più vecchia del codice, riavviare il server
   subito dopo il ripristino.»
6. **Se si interrompe a metà**, l'azienda **resta sospesa** di proposito
   (metà archivio nuovo e metà vecchio non è uno stato in cui far rientrare
   la gente): il messaggio dice quali store erano già stati sostituiti
   («Ripristino interrotto dopo clienti, commesse: … (azienda lasciata
   sospesa)»). Si verifica, poi si riattiva a mano:

       pnpm tenant stato --slug=acme --riattiva --motivo="ripristino verificato" --scrivi

Rifiuti previsti, tutti prima di toccare qualsiasi cosa: backup inesistente
(«Backup 2026-09-07 non trovato sul Drive dell'azienda»), store chiesti che
il backup non ha («Store richiesti assenti dal backup: …»), dump non valido
(«Dump non valido: …»), niente da sostituire («Nessuno store da
ripristinare» — succede con un `--solo` che nomina solo store esclusi).
`backup_config`, `backup_oauth` e `backup_log` non si ripristinano mai:
riscriverli con una fotografia vecchia scollegherebbe l'azienda dal Drive da
cui sta ripristinando.

### Webhook WhatsApp: prima la firma, poi il numero

- L'ordine è: si verifica la **firma** provando i segreti di tutte le
  aziende (senza leggere il payload), poi si decide il destinatario **per
  `phone_number_id`**, cercandolo fra le aziende attive, e si ingerisce la
  sola porzione del payload di quel numero nel contesto della sua sede. Con
  l'Embedded Signup il segreto dell'app è uno per tutte: la firma non dice
  più di chi è il messaggio, lo dice il numero.
- Numero sconosciuto: `200` a Meta (nessun retry) e log
  `[whatsapp-webhook] numero sconosciuto: <id>`.
- L'errore di un numero non ferma gli altri numeri della stessa consegna.

### Guasti isolati per azienda

`perOgniTenantAttivo` tiene il conto degli errori per (worker, azienda):
dopo 3 errori consecutivi quell'azienda viene saltata per 15 minuti, poi 30,
60, 120 (tetto). Ogni sospensione scrive `[<etichetta>] tenant <id> sospeso
per <min> min: <errore>` e un evento `worker_sospeso`; il primo giro
riuscito riarma e registra `worker_riarmato`. Le altre aziende continuano a
girare, e `pnpm tenant elenco` mostra chi è fermo e fino a quando. Nessuna
coda nuova: la coda durevole degli eventi resta com'è.

**Questo vale anche a `FLAG_MULTI_AZIENDA` spento**, dove l'unica azienda è
Ruffino Group: è l'unico comportamento del WS3 che si vede a interruttore
spento, ed è additivo ma non invisibile. I worker che ci passano sono
`fic`, `imap`, `imap-watcher`, `tars-*`, `costo-da-conferma`, `archivio-fornitori`,
`conferme-auto-archivio`, `action-center`, `timeline` e `backup`. Che cosa
vede chi è di turno: dopo tre giri consecutivi falliti, per esempio

    [fic] tenant 1 sospeso per 15 min: HTTP 500 da Fatture in Cloud

e quel worker **non riprova** per 15 minuti (poi 30, 60, 120), mentre gli
altri continuano; il primo giro riuscito riarma e scrive `worker_riarmato`.
Prima, con una sola azienda, lo stesso guasto produceva un errore a ogni
giro all'infinito: ora i log si asciugano ma il worker resta fermo più a
lungo — se un integrazione «non riparte da sola» subito dopo un guasto, è
questo, e `pnpm tenant elenco` lo dice sotto Ruffino Group:

    1	ruffino-group	attivo	Ruffino Group
      worker sospeso: fic fino a 2026-09-08T23:41:12.004Z (HTTP 500 da Fatture in Cloud)

Un riavvio del server azzera l'attesa (lo stato vive in memoria).

### Script di manutenzione: `--tenant`, e la trappola dell'interruttore

`scripts/migrate-documents-to-storage.ts` accetta ora `--tenant=<id>`
(default 1) come `pattuiti:reset` e `importa-clienti`, e gira dentro il
contesto di quell'azienda; i file migrati da `dataBase64` ricevono la chiave
col prefisso dell'azienda.

    npx tsx scripts/migrate-documents-to-storage.ts --apply --tenant=2

**Trappola da conoscere, comune a tutti gli script con `--tenant`:** con
`FLAG_MULTI_AZIENDA` **spento** il resolver degli store risolve sempre il
tenant 1, quindi `--tenant=2` **non fallisce** — lo script stampa
`Tenant: 2` e lavora sull'archivio di Ruffino Group. È l'interruttore a
decidere, non lo script. Prima di lavorare su un'altra azienda: verificare
che l'interruttore sia acceso nell'ambiente in cui lo script gira. Restano
tutti gli avvisi di prima, a partire da **mai contro un'istanza in
esecuzione**.

Il pannello dello storage della direzione (`fileStorage.status`,
`fileStorage.migrate`) conta e migra ora i documenti **dell'azienda della
sessione**, non dell'installazione.

### Produzione, in ordine (WS3)

1. **Backup Drive riuscito nelle 24 ore precedenti.** Prima del deploy: al
   primo boot il codice cifra il refresh token (a senso unico) e ricalcola
   il ledger.
2. **Deploy a interruttore spento.** Nei log, in quest'ordine: nessun errore
   `[tenants]`, `[backup]` o `[storage]`; il servizio che risponde; poi, in
   sottofondo, `[storage] ricalcolo iniziale tenant 1: …`. Il primo boot non
   riscrive tutti i blob come faceva il WS2 — l'unico riscritto è
   `backup_oauth`, per cifrare il token: il lavoro pesante è il ricalcolo,
   in sola lettura sugli archivi, che scrive solo `tenant_storage`.
3. `pnpm --silent tenant verifica --json` — come nel WS2. Se dice «Tabelle
   del control plane del tenant assenti…», il server non ha ancora fatto
   boot con questa versione (la sonda ora ne chiede sei).
4. `pnpm tenant storage --slug=ruffino-group`: deve stampare file e byte,
   non «nessun ledger ancora». Se il ricalcolo iniziale è ancora in corso,
   aspetta la riga di log del passo 2. **Annota l'ordine di grandezza atteso
   PRIMA del deploy** (quanti file e quanti byte ha oggi lo storage: il
   pannello della direzione o il conteggio dei documenti): un numero da solo
   si legge sempre come giusto, e questo passo serve a confrontarlo, non a
   guardarlo. Se è più basso di un ordine di grandezza, il ricalcolo non ha
   ancora finito oppure ha saltato una fonte: si rilancia con `--ricalcola
   --scrivi` prima di accendere l'interruttore.
5. **Accensione** — `FLAG_MULTI_AZIENDA=on` e riavvio, se non è già accesa;
   poi un nuovo login.
6. **Prima azienda 2 in staging**, non in produzione: `pnpm tenant crea …`;
   entra il proprietario; collega il Drive **dell'azienda** da Integrazioni;
   lancia un backup a mano e verifica sul suo Drive la cartella «Backup
   Wyndoor — `<nome azienda>`»; poi `pnpm tenant ripristina --slug=<slug>
   --backup=<data> --prova --attendi` e leggi l'esito.
7. Solo dopo, **la stessa sequenza in produzione**. Dal WS3 una seconda
   azienda in produzione è ammessa: la regola del WS2 decade qui.

**Rollback = redeploy del build precedente**, con **un'unica eccezione**: il
refresh token del Drive è cifrato e il codice vecchio non lo legge, quindi
ogni azienda che aveva collegato il Drive deve ricollegarlo. Tutto il resto
resta nel database, invisibile e innocuo per il codice precedente: le chiavi
`tenant/<id>/…` (i file già scritti restano leggibili, il codice vecchio non
guarda il prefisso), `tenant_storage`, `oauth_state`, la colonna
`storage_quota_bytes`.

### Errori che l'operatore può vedere (WS3)

- `[fileStorage] scrittura senza tenant nel contesto` (o `lettura`) — un
  upload o un download è partito fuori da una richiesta con l'interruttore
  acceso. Nessun file è stato salvato senza prefisso: è il fail-closed che
  ha funzionato. Si corregge avvolgendo il punto d'ingresso in
  `conTenant`/`conTenantDellaSede`.
- `[fileStorage] lettura rifiutata: chiave di un'altra azienda` — la cintura
  in lettura. Il chiamante vede «non trovato». Se si ripete, il record che
  porta quella chiave è di un'altra azienda: guardarlo, non alzare la
  cintura.
- `[fileStorage] contabilità non aggiornata (<id>): …` e
  `[fileStorage] delete fallito per <chiave>: …` — il file è a posto, il
  conto no. Si rimette in pari con `pnpm tenant storage --slug=… --ricalcola
  --scrivi`.
- Evento `storage_soglia` in `tenant_eventi` (50, 80, 100 %) — avviso, non
  blocco: nessun upload viene rifiutato oltre quota.
- «Account Google non collegato: collega il Drive dell'azienda da
  Integrazioni → Backup» nel log del backup — un'azienda diversa da Ruffino
  Group non ha ancora collegato il suo Drive. Nessun ripiego: il backup di
  quell'azienda non esiste finché non lo collega.
- «MAIL_ENCRYPTION_KEY non configurata sul server: senza chiave il refresh
  token di Drive non può essere salvato.» — collegamento rifiutato prima di
  salvare; il browser torna con `?gdrive=errore`.
- `[backup] tenant <id>: MAIL_ENCRYPTION_KEY assente, il refresh token resta
  in chiaro` — al boot: la chiave manca, la migrazione del token non è
  potuta girare. Aggiungere la chiave e riavviare.
- `?gdrive=errore` / `?fic=errore` dopo un collegamento — `state` scaduto
  (10 minuti), già usato o sconosciuto. Niente è stato salvato: si rifà il
  collegamento.
- `[whatsapp-webhook] numero sconosciuto: <id>` — un `phone_number_id` che
  nessuna azienda attiva ha in `configWhatsApp`. Meta riceve `200` (non
  ritenta): controllare la configurazione WhatsApp della sede.
- `[<etichetta>] tenant <id> sospeso per <min> min: <errore>` — tre errori
  consecutivi di quel worker su quell'azienda. Le altre girano; `pnpm tenant
  elenco` dice fino a quando. **Si vede anche a interruttore spento**, con
  `tenant 1`: è l'unico comportamento del WS3 visibile in mono-azienda.
- `[backup] tenant <id>: Drive non collegato, salto` — il giro notturno ha
  saltato un'azienda che non ha ancora collegato il suo Drive. Non è un
  errore e non conta per l'interruttore: è un'azienda da collegare.
- «Risorsa non trovata.» (`NOT_FOUND`) al posto di un 500 — dal WS3 i 98
  «non trovato» dei router rispondono così, sia per un id inesistente sia
  per uno di un'altra sede.
- «Backup … non trovato sul Drive dell'azienda», «Store richiesti assenti
  dal backup: …», «Dump non valido: …», «Nessuno store da ripristinare» —
  ripristino rifiutato **prima** di toccare qualsiasi cosa, azienda non
  sospesa.
- «Ripristino interrotto dopo …: … (azienda lasciata sospesa)» — verifica e
  poi `pnpm tenant stato --slug=… --riattiva --motivo=… --scrivi`.

## WS4 — abbonamenti, quota che blocca, budget Tars per azienda

Spec: `docs/superpowers/specs/2026-09-08-ws4-abbonamenti-design.md` (le
decisioni prese durante l'esecuzione sono nella sua §2-bis).

> **Stato al 09/09/2026:** il WS4 è **su `main` e in produzione**. I suoi 9
> task sono nati su `feature/ws4-abbonamenti` (da `bb2f147` a `d335a68`),
> branch che conteneva anche tutto il WS3, e sono arrivati su `main` con la
> PR **#8** (merge `37c1889`, 09/09). `FLAG_MULTI_AZIENDA` è acceso in
> produzione dalle 09:54 dello stesso giorno: abbonamenti, quota e budget
> Tars contano e bloccano davvero.

Con il WS3 un'azienda ha i suoi file, il suo backup e i suoi guasti, ma non ha
un contratto: nessuno sa quando inizia, quando scade e che cosa succede se non
paga. Il WS4 dà a ogni azienda un abbonamento nel control plane — prova
gratuita di 30 giorni, omaggio, insoluto, sola lettura — e trasforma le due
risorse misurate, spazio e Tars, da «conta e avvisa» a «conta, avvisa, tollera
e poi ferma». Il provider di pagamento **non** è ancora scelto: esiste solo
l'adattatore, con l'unica implementazione «nessuno». Non c'è nessun checkout,
nessun portale, nessun pulsante di pagamento: un'azienda si riapre a mano, con
un omaggio o con una proroga.

### Cosa fa il boot, in ordine (aggiunte del WS4)

Sopra i passi delle sezioni WS2 e WS3, il boot con questo codice fa anche:

1. In `preparaTenants()`, con lo schema del control plane: la tabella
   `abbonamenti` (una riga per azienda), la colonna
   `tenant_storage.soglia_100_dal` e il `CHECK` di `tenant_comandi` allargato
   all'ottavo tipo di comando, `imposta_abbonamento`. Subito dopo il contabile
   dei byte del WS3, `registraGanciQuota()`: da qui in avanti `putFile` può
   **rifiutare** un caricamento e il governor di Tars conosce il tetto
   dell'azienda. Senza questa chiamata (script, test) non blocca niente.
2. In `completaTenants()`, dopo lo specchio delle sedi: l'abbonamento del
   tenant 1 — `complimentary`, `active`, **senza scadenza**, senza tetto Tars
   per azienda, motivo «Ruffino Group, proprietaria della piattaforma». Nasce
   **sempre, anche a interruttore spento**, ed è l'unica riga di dominio che
   il WS4 aggiunge in mono-azienda. Un errore qui non ferma l'avvio: lascia
   `[tenants] abbonamento del tenant 1: …` nel log.
3. **Dopo** `server.listen`, accanto al backfill e al ricalcolo dello storage:
   `avviaWorkerAbbonamenti()`. Un giro subito, poi ogni 6 ore
   (`setInterval` con `unref`, come la sonda FiC). **A `FLAG_MULTI_AZIENDA`
   spento non parte** — se lo verifica da sé. Il giro passa da
   `perOgniTenantAttivo("abbonamenti", …)`: quindi mai sulle aziende sospese,
   e con l'interruttore per (worker, azienda) del WS3 sopra.

**Dal WS4 la sonda dello script chiede sette tabelle, non sei**: alle sei del
WS3 si aggiunge `abbonamenti`. Su un database dove gira il WS3 ma il WS4 non
ha ancora fatto boot, tutti i sottocomandi tranne `verifica` si fermano con
«Tabelle del control plane del tenant assenti (tenants, tenant_eventi,
tenant_comandi, tenant_sedi, tenant_storage, oauth_state, abbonamenti)…».
Non è un guasto: deploy prima, script poi, anche fra WS3 e WS4.

### Il percorso di un abbonamento

    crea azienda ──▶ trialing, 30 giorni, budget Tars 25 €/mese, tolleranze 7 e 7
    trialing ──7, 3, 1 giorno alla scadenza──▶ un avviso ciascuno (una volta sola)
    trialing ──scadenza passata──▶ past_due   (insoluto_dal = adesso, notifica)
    past_due ──7 giorni──▶ suspended          (azienda in SOLA LETTURA, notifica)
    past_due | suspended ──omaggio o proroga──▶ active | trialing (azienda riaperta)
    active con disdetta ──fine periodo──▶ cancelled (sola lettura, come suspended)

A muovere gli stati è sempre e solo `server/abbonamenti/servizio.ts`: su
comando dell'operatore (omaggio, proroga, disdetta) oppure da sé, e in questo
secondo caso **solo quando il worker passa** — le transizioni automatiche
(avvisi, insoluto, sola lettura, chiusura per disdetta) non accadono fra un
giro e l'altro, e un giro dura sei ore. Una scadenza «di oggi» diventa
insoluto entro sei ore, non al secondo.

**Che cosa vede l'azienda.** Proprietari e direzione ricevono una notifica a
ogni passaggio (avvisi 7/3/1, insoluto, sola lettura) e dall'80 % in su sulle
due risorse; in cima alle pagine compare una riga d'avviso (`AvvisoAzienda`),
e la scheda «Abbonamento e consumi» in Integrazioni dice tipo, stato, giorni
alla scadenza e le due barre. La riga d'avviso compare **solo a interruttore
acceso**; la scheda si vede sempre, anche a interruttore spento, dove mostra
l'omaggio senza scadenza di Ruffino Group. **Nessun pulsante di pagamento**:
finché il provider è «nessuno» non c'è niente da premere. In sola lettura si
legge, si cerca, si scarica e il backup continua; non si scrive.

**Come si riapre un'azienda in sola lettura.** Con un omaggio o con una
proroga:

    pnpm tenant abbonamento --slug=acme --omaggio --motivo="pilota fino a marzo" --scrivi --attendi
    pnpm tenant abbonamento --slug=acme --proroga=15 --motivo="attesa bonifico" --scrivi --attendi

**Non** con `pnpm tenant stato --slug=acme --riattiva`: quella riapre
l'azienda ma non tocca il contratto, e l'abbonamento resta `suspended`. Il
giro successivo del worker (entro 6 ore) rimette in pari le due cose e
**risospende** l'azienda, con un evento che lo spiega (R15):

    motivoStato = «abbonamento: contratto sospeso, azienda risultava attiva»

Quindi `stato --riattiva` **non è il modo di riaprire un'azienda insolvente**:
dura al massimo sei ore. Resta la mano dell'operatore per tutto il resto: una
sospensione decisa a mano — o dal ripristino archivi, «ripristino archivi in
corso» — **non** viene annullata da un omaggio o da una proroga, perché non
porta il marcatore `abbonamento: ` che il dominio si lascia dietro quando è lui
a chiudere (`motivoStato` = «abbonamento: …»), e per la stessa ragione il giro
di R15 la lascia stare: agisce solo su un tenant `attivo`.

**Un'azienda senza riga di abbonamento.** Il worker la salta e lo scrive:

    [abbonamenti] tenant 2 senza abbonamento: rilancia pnpm tenant crea

Si ripara come dice il log: `pnpm tenant crea` con lo **stesso** slug è
idempotente e semina solo l'abbonamento mancante (non una seconda azienda, né
una seconda sede o un secondo utente). Il worker non crea niente da solo.

### Comandi dell'operatore (aggiunte del WS4)

    pnpm tenant abbonamento --slug=acme --omaggio --motivo="pilota" [--scadenza=2027-03-31] --scrivi --attendi
    pnpm tenant abbonamento --slug=acme --proroga=15 --motivo="attesa bonifico" --scrivi --attendi
    pnpm tenant abbonamento --slug=acme --quota-gb=200 --scrivi --attendi
    pnpm tenant abbonamento --slug=acme --budget-tars-eur=40 --scrivi --attendi
    pnpm tenant abbonamento --slug=acme --budget-tars-eur=nessuno --scrivi --attendi
    pnpm tenant abbonamento --slug=acme --extra-tars-eur=10 --scrivi --attendi
    pnpm tenant abbonamento --slug=acme --tolleranza-storage=14 --tolleranza-tars=3 --scrivi --attendi
    pnpm tenant abbonamento --slug=acme --disdetta --scrivi --attendi
    pnpm tenant abbonamento --slug=acme --annulla-disdetta --scrivi --attendi

- **Una sola azione per comando.** `--tolleranza-storage` e
  `--tolleranza-tars` contano per una sola (si possono dare insieme);
  `--disdetta` e `--annulla-disdetta` sono le due facce della stessa. Con due
  azioni lo script si ferma: «Un'azione per comando (trovate 2: omaggio,
  proroga)».
- Valgono le regole di sempre: senza `--scrivi` è solo l'anteprima, `--attendi`
  aspetta l'esito fino a 90 s, il comando lo esegue **il server**, non lo
  script. `--motivo` è obbligatorio per omaggio e proroga: finisce nel
  registro e nella scheda.
- `--omaggio` senza `--scadenza` è un omaggio **senza scadenza** (come quello
  del tenant 1). Con `--scadenza=AAAA-MM-GG` scade a fine di quel giorno, e
  gli avvisi 7/3/1 valgono anche per lui.
- `--proroga=<giorni>` riporta il contratto a **prova**: `paid`, stato
  `trialing`, omaggio azzerato, disdetta azzerata. Se la scadenza è ancora nel
  futuro i giorni si sommano a quella; se è passata partono da oggi. Da 1 a
  365 giorni.
- `--quota-gb` non tocca l'abbonamento: scrive `tenants.storage_quota_bytes`
  (la quota del WS3) e lascia nel registro un `abbonamento_modificato` con
  campo `quota_storage_gb`.
- `--budget-tars-eur=nessuno` toglie il tetto per azienda: restano i tetti
  globali `TARS_*` della piattaforma. `--budget-tars-eur=0` è invece un piano
  **senza Tars incluso** (esaurito per definizione).
- `--extra-tars-eur` è una concessione una tantum che vale **solo per il mese
  corrente**: il primo giro del worker del mese nuovo la azzera.
- Il **tenant 1 rifiuta** `--omaggio`, `--proroga` e `--disdetta` («Il tenant 1
  è la proprietaria della piattaforma…»): lo script si ferma prima di
  accodare. Quota, budget e tolleranze restano ammessi.
- `pnpm tenant elenco` stampa, sotto ogni azienda, una riga in più:

      2	acme	attivo	Acme Infissi
        abbonamento: paid trialing, fine 2026-10-08T09:12:00.000Z, insoluto dal -

  Per Ruffino Group: `abbonamento: complimentary active, fine nessuna,
  insoluto dal -`. «abbonamento: nessuno» è l'anomalia da riparare con `crea`.

### Quota storage: da avviso a blocco

- Il conto dei byte è quello del WS3 (`tenant_storage`, soglie 50/80/100 %).
  Il WS4 aggiunge il timbro `soglia_100_dal`, messo al **primo**
  attraversamento del 100 % e azzerato scendendo sotto.
- Da lì parte la **tolleranza** (`tolleranza_storage_giorni`, 7 di default per
  azienda). Passata quella — e **solo** con `FLAG_MULTI_AZIENDA` acceso —
  `putFile` rifiuta ogni caricamento nuovo con `PRECONDITION_FAILED`:

      Spazio esaurito: l'azienda ha superato i 100 GB inclusi. Libera spazio o chiedi capacità aggiuntiva.

  Prima della tolleranza non blocca: conta, avvisa e mostra nella scheda **la
  data** in cui i caricamenti si fermeranno.
- Si blocca solo **ciò che costa spazio**: caricamenti di documenti, allegati,
  anteprime e PDF/XML delle fatture. Lettura, ricerca, download, backup,
  ripristino e CRM ordinario continuano. La posta, le anteprime e i media
  WhatsApp hanno già il loro `try/catch`: l'allegato resta elencato e non
  scaricato, l'anteprima non si genera, il media resta su Meta — il messaggio
  arriva lo stesso.
- La **migrazione dei file legacy** (`pnpm storage:migrate`, `docs/storage-r2.md`)
  passa da `putFile` come tutto il resto: oltre la tolleranza si ferma al primo
  rifiuto, con il messaggio della quota una volta sola nel rapporto
  (`interrotta: "quota"`), e nessun record perde il suo `dataBase64` (R17). Si
  riprende dopo aver alzato la quota o liberato spazio: la migrazione è
  idempotente, i record già spostati vengono saltati.
- Le due leve dell'operatore, quando un'azienda si ferma e non può liberare
  spazio subito:

      pnpm tenant abbonamento --slug=acme --quota-gb=200 --scrivi --attendi        # più spazio incluso
      pnpm tenant abbonamento --slug=acme --tolleranza-storage=14 --scrivi --attendi  # più giorni prima del blocco

  La prima riapre subito — sotto quota il blocco cade, e il primo
  caricamento riuscito registra `storage_sbloccato`; la seconda sposta in
  avanti la data di stacco. Non esiste uno «sblocca e basta»: il blocco è una
  conseguenza dei byte contati, non uno stato scritto a mano.
- Il primo rifiuto del giorno lascia un evento `storage_bloccato` in
  `tenant_eventi` (con byte, quota e data del blocco) e una notifica; il
  ritorno sotto quota lascia `storage_sbloccato`, una volta sola.
- **Ruffino Group (tenant 1) non si blocca mai** (R16), come non ha un tetto
  Tars per azienda: la proprietaria della piattaforma paga i propri costi. Le
  soglie 50/80/100 la avvisano lo stesso, e la scheda non le promette nessun
  giorno di stacco. Se è al 100 % la leva è `--quota-gb`: alzarla rimette le
  soglie al loro posto (un'azienda perennemente al 140 % non avvisa più
  niente).

### Budget Tars per azienda

- Il ledger dei costi (`tars_costi`) conta ora **per azienda e per mese**. Il
  tetto dell'azienda è `budget_tars_nano_mese` + l'extra del mese;
  `null` = nessun tetto (è il caso del tenant 1).
- Anche qui prima si conta, poi si blocca: soglie 50/80/100 % (evento
  `tars_soglia`, una volta per soglia per mese; notifica dall'80 % in su),
  timbro al primo 100 %, e blocco solo dopo `tolleranza_tars_giorni` (7 di
  default). Il budget si rinnova il primo del mese: la somma è per mese
  locale (Europe/Rome).
- Quando blocca, chi parla con Tars legge:

      Tars ha esaurito il budget mensile dell'azienda; le funzioni che non costano restano disponibili, il budget si rinnova il primo del mese.

  Lo stesso testo arriva ai lavori di fondo a pagamento (analisi,
  smistamento, lettura visiva), che si fermano lì: un budget esaurito non è un
  guasto del provider, quindi niente retry e nessun circuito aperto.
  **Si ferma solo ciò che costa**: il resto di Tars, e tutto il CRM, continua.
- Le leve: `--budget-tars-eur=<n>` (il tetto del piano),
  `--extra-tars-eur=<n>` (una tantum, solo questo mese),
  `--tolleranza-tars=<gg>`, `--budget-tars-eur=nessuno` (nessun tetto per
  azienda). L'utente vede sempre e solo una **percentuale**: mai token, mai
  dollari; budget ed extra in euro li leggono solo proprietario e direzione.
- I tetti globali `TARS_DAILY_BUDGET_USD`/`TARS_MONTHLY_BUDGET_USD` restano
  come rete della piattaforma, sopra a tutte le aziende.

### Variabili d'ambiente (WS4)

| Variabile | Default | A che serve |
|---|---|---|
| `SAAS_BUDGET_TARS_EUR_MESE` | `25` | Budget Tars incluso di **ogni azienda nuova**, in euro al mese. `0` è valido (piano senza Tars incluso); negativo o non numerico fa fallire il comando, senza scritture. Non cambia le aziende già create. |
| `SAAS_CAMBIO_EUR_USD` | `1.08` | Cambio euro→dollaro per convertire il budget nei nano-dollari del ledger. Deve essere > 0. |

Nessuna delle due va aggiunta per far partire il WS4: senza, valgono i
default. Cambiare il cambio **non riconverte** i budget già salvati: cambia
solo le conversioni successive (comandi nuovi, euro mostrati nella scheda).

### Notifiche: solo dove il centro notifiche della sede è attivo

Le cinque notifiche del WS4 (`abbonamento.avviso`, `abbonamento.insoluto`,
`abbonamento.sospeso`, `consumi.storage`, `consumi.tars`) si scrivono
**direttamente** nel repository delle notifiche, per i proprietari e la
direzione **attivi** dell'azienda; non passano dal bus degli eventi. Ognuna
rispetta l'interruttore per sede: **arriva solo se `notificationMode` della
sede è `active`**. Il default è `legacy`, e l'endpoint di scrittura dei flag
di piattaforma oggi non esiste (handoff §13): su un'installazione dove nessuno
li ha portati ad `active`, gli stati dell'abbonamento **si muovono lo stesso**
(eventi, sola lettura, blocchi) ma nessuno riceve la notifica. Restano
l'avviso in cima alle pagine e la scheda, che leggono le query e non dipendono
da quel flag. Un'azienda senza sedi attive non riceve nulla: non c'è una sede
su cui scrivere.

### Produzione, in ordine (WS4)

Dopo l'ordine del WS3 (che questo branch contiene):

1. **Deploy a interruttore spento.** Nei log non deve comparire
   `[tenants] abbonamento del tenant 1: …`, e il worker non parte (non deve).
   Le uniche aggiunte sono la tabella `abbonamenti`, la colonna
   `tenant_storage.soglia_100_dal` e la riga omaggio del tenant 1.
2. `pnpm --silent tenant verifica --json` — come nel WS3. Se dice «Tabelle del
   control plane del tenant assenti…», il server non ha ancora fatto boot con
   questa versione (la sonda ora ne chiede sette).
3. `pnpm tenant elenco`: sotto `ruffino-group` deve comparire
   `abbonamento: complimentary active, fine nessuna, insoluto dal -`. È il
   controllo che il seed è passato: senza quella riga, il passo 1 non è
   andato a buon fine e non si prosegue.

   **3-bis.** `pnpm tenant storage --slug=ruffino-group`: il tenant 1 non si
   blocca mai (R16), ma se è già al 100 % dei suoi GB le soglie non dicono
   più niente. Si alza la quota con `pnpm tenant abbonamento
   --slug=ruffino-group --quota-gb=<n> --scrivi --attendi`, così l'avviso
   torna significativo prima dell'accensione.

4. **Accensione** — `FLAG_MULTI_AZIENDA=on` e riavvio, se non è già accesa.
   Da qui il worker parte dopo il listen e gira ogni 6 ore; blocco dello
   spazio e tetto Tars per azienda diventano vivi.
5. **Prima azienda pilota**, in staging: `pnpm tenant crea …` la fa nascere
   `trialing` con 30 giorni, budget 25 €/mese e tolleranze 7/7 — si verifica
   con `pnpm tenant elenco`. Per un pilota che non deve scadere:
   `pnpm tenant abbonamento --slug=<slug> --omaggio --motivo="pilota" --scrivi
   --attendi`, e la scheda dirà «Abbonamento omaggio».
6. Per provare avvisi e insoluto senza aspettare un mese: `--proroga=<gg>` con
   un numero piccolo, oppure una scadenza vicina, e si guarda il giro
   successivo del worker (o si riavvia il server, che ne fa uno subito).
7. Solo dopo, **la stessa sequenza in produzione**.

**Rollback = redeploy del build precedente.** Tutto il WS4 è additivo: la
tabella `abbonamenti`, la colonna `soglia_100_dal`, il tipo di comando e i
tipi di evento nuovi restano nel database, invisibili e innocui per il codice
di prima — che non blocca nulla e non conosce alcun abbonamento. Nessuna
migrazione a senso unico.

### Errori che l'operatore può vedere (WS4)

- «Spazio esaurito: l'azienda ha superato i `<N>` GB inclusi. Libera spazio o
  chiedi capacità aggiuntiva.» — quota **e** tolleranza superate. Da tRPC è
  `PRECONDITION_FAILED`; dalla rotta Express dei documenti di commessa arriva
  come HTTP `400` con lo stesso messaggio. Rimedi: liberare spazio,
  `--quota-gb`, `--tolleranza-storage`. Ruffino Group non lo vede mai: il
  tenant 1 è esente dal blocco (R16).
- «Tars ha esaurito il budget mensile dell'azienda; le funzioni che non costano
  restano disponibili, il budget si rinnova il primo del mese.» — tetto
  d'azienda e tolleranza superati. Rimedi: `--extra-tars-eur` (questo mese),
  `--budget-tars-eur` (da qui in avanti), `--tolleranza-tars`, o aspettare il
  primo del mese.
- «Azienda sospesa: il gestionale è in sola lettura.» — è la sola lettura del
  WS1, accesa qui dall'abbonamento (insoluto scaduto o disdetta). Si riapre
  con `--omaggio` o `--proroga`, non con `stato --riattiva`.
- «Il tenant 1 è la proprietaria della piattaforma: niente omaggio, proroga o
  disdetta.» — comando rifiutato dallo script (e comunque dal servizio).
- «Un'azione per comando (trovate 2: omaggio, proroga).» / «Indica --disdetta
  oppure --annulla-disdetta» — due azioni nello stesso comando: se ne dà una.
- «SAAS_CAMBIO_EUR_USD non valido: «…». Serve un numero maggiore di zero
  (predefinito: 1.08).» e «SAAS_BUDGET_TARS_EUR_MESE non valido: «…». Serve un
  numero maggiore o uguale a zero (predefinito: 25).» — l'ambiente è
  sbagliato: il comando (o la creazione dell'azienda) fallisce **senza
  scrivere niente**. Si corregge la variabile, non il database.
- «Si proroga solo una prova in corso, scaduta o sospesa (stato: active)» — si
  proroga da `trialing`, `past_due` o `suspended`. Un `active` si allunga con
  `--omaggio`; un `cancelled` è chiuso.
- «Abbonamento del tenant `<id>` inesistente» in `esito` del comando — l'azienda
  non ha la riga: `pnpm tenant crea` con lo stesso slug la ripara.
- `[abbonamenti] tenant <id> senza abbonamento: rilancia pnpm tenant crea` —
  lo stesso, visto dal giro del worker, che salta quell'azienda.
- `[tenants] abbonamento del tenant 1: …` — il seed dell'omaggio della
  proprietaria è fallito al boot. L'avvio prosegue, ma `pnpm tenant elenco`
  dirà «abbonamento: nessuno» per `ruffino-group`: guardare l'errore.
- `[abbonamenti] notifica <tipo> non consegnata (tenant <id>, utente <id>): …` e
  `[abbonamenti] notifica consumi storage non consegnata: …` — la notifica non
  è partita; lo stato dell'abbonamento è cambiato lo stesso. Nessun
  caricamento e nessuna transizione fallisce per una notifica.
- `[abbonamenti] consumo Tars del tenant <id> non leggibile: …` — la scheda
  mostra la percentuale Tars vuota invece di uno zero falso (tipico senza
  `DATABASE_URL`).
- `[tars] tetto del budget d'azienda: …` / `[tars] soglie del budget
  d'azienda: …` — la politica per azienda ha lanciato. La chiamata a Tars
  prosegue **senza** tetto d'azienda: se si ripete, il blocco per azienda non
  sta funzionando.
- `[<etichetta>] tenant <id> sospeso per <min> min: …` con etichetta
  `abbonamenti` — il giro degli abbonamenti fallisce per quell'azienda: è
  l'interruttore del WS3. Le altre continuano; `pnpm tenant elenco` dice fino
  a quando.
- Eventi da leggere in `tenant_eventi` quando qualcosa non torna:
  `abbonamento_creato`, `abbonamento_stato` (`da`/`a`/`motivo`),
  `abbonamento_omaggio`, `abbonamento_prova_prorogata`, `abbonamento_avviso`,
  `abbonamento_modificato`, `tars_soglia`, `storage_bloccato`/`storage_sbloccato`,
  `tars_bloccato`/`tars_sbloccato`.

## WS6 — pannello piattaforma

Spec: `docs/superpowers/specs/2026-09-09-ws6-pannello-piattaforma-design.md`
(le decisioni prese durante l'esecuzione sono nella sua §2-bis). Modulo:
`server/piattaforma/`. Nessun interruttore nuovo: il pannello è gated
dall'identità (chi è in `PLATFORM_ADMIN_EMAILS`), non da un flag — a
differenza di WS2/WS3/WS4, non c'è un «acceso/spento» da decidere qui.

> **Stato al 09/09/2026:** WS1, WS2, WS3 e WS4 sono su `main` e in produzione
> (PR #3, #5 e #8; `FLAG_MULTI_AZIENDA` acceso dalle 09:54 del 09/09/2026). Il
> **WS6** è implementato sul branch `feature/ws6-pannello-piattaforma`
> (nato da `main` @ `37c1889`, cioè dopo quel merge) e **non è su `main`**:
> questa sezione vale dal momento in cui il branch viene distribuito.

### Accesso

- `PLATFORM_ADMIN_EMAILS`: email separate da virgola, confrontate senza
  maiuscole né spazi. Letta a ogni chiamata (come `interruttoreAttivo`),
  nessuna cache: aggiungere o togliere un'email vale dalla richiesta
  successiva, senza bisogno di ricaricare nient'altro lato codice — su
  Railway, però, cambiare una variabile d'ambiente riavvia comunque il
  servizio da sé.
- La voce **«Piattaforma»** in cima al menu utente (accanto a
  «Impostazioni») compare **solo** se `tenants.mio.piattaforma` è vero:
  utente attivo, login **locale** (non OAuth), del tenant 1, con l'email
  nell'elenco. Chi non ci rientra non vede la voce e, se prova comunque
  `/piattaforma` o `/piattaforma/<slug>` a mano, trova la stessa guardia
  («Sezione riservata alla piattaforma»); ogni query e mutation del router
  `piattaforma` ricontrolla comunque l'email a ogni chiamata — la voce di
  menu è solo comodità, non è la sicurezza.
- Le azioni sensibili (creare un'azienda, sospendere, riattivare, assegnare o
  revocare un proprietario, ogni azione sull'abbonamento, un ripristino
  **scritto** — non la prova) chiedono di reinserire la **password
  dell'amministratore**. Stesso limitatore del login — 5 tentativi in 15
  minuti — estratto in `server/_core/limiteTentativi.ts` e riusato con una
  chiave propria (`conferma:<email>`): sbagliarla troppe volte blocca la
  conferma, non il login stesso. Un tentativo sbagliato lascia
  `[piattaforma] conferma password rifiutata per <dominio email>` nei log
  (mai l'indirizzo intero).
- L'amministratore **agisce SU un'altra azienda**, non dentro la propria: il
  router non passa dalla guardia di tenant del resto del CRM
  (`guardiaTenant`), quindi può riattivare anche un tenant 1 sospeso. Ogni
  azienda si individua per `slug`, mai per un `tenantId` passato dal client.

### Cosa fa il boot, in ordine (aggiunte del WS6)

Sopra i passi delle sezioni WS2, WS3 e WS4, il boot con questo codice fa
anche:

1. In `preparaTenants()`, con lo schema del control plane: la tabella
   `tenant_inviti` (id, azienda, utente, email, tipo, `token_hash` UNIQUE,
   scadenza, chi l'ha creata, quando usata o annullata), il suo indice
   `(tenant_id, created_at DESC)` e l'indice parziale **unico**
   `tenant_inviti_valido_idx` su `(tenant_id, utente_id)` fra gli inviti non
   usati e non annullati — un solo invito vivo per utente e azienda, garantito
   dalla tabella e non solo dal codice. Additivi come gli altri: `CREATE …
   IF NOT EXISTS`, nessun `ALTER` su tabelle esistenti (la tabella nasce con
   questa stessa versione, quindi nessuna riga può violare l'indice).
2. **Dal WS6 la sonda dello script chiede otto tabelle, non sette**: alle
   sette di WS2+WS3+WS4 si aggiunge `tenant_inviti` (`verificaSchema`,
   `server/tenants/repository.ts`; `MESSAGGI.schemaAssente` le nomina tutte
   e otto). Su un database dove gira il WS4 ma il WS6 non ha ancora fatto
   boot, ogni sottocomando tranne `verifica` si ferma con lo stesso messaggio
   di sempre: non è un guasto, deploy prima, pannello poi.
3. Subito dopo la spazzata degli `oauth_state` scaduti, in un `try/catch` a
   parte (così un guasto nell'uno non nasconde il messaggio dell'altro):
   `repo.pulisciInvitiScaduti()` cancella gli inviti scaduti da **più di 30
   giorni**. Riga di log solo se ne toglie almeno uno:
   `[tenants] inviti scaduti rimossi: N`. Un errore qui non ferma l'avvio
   (il control plane è già a posto) e lascia
   `[tenants] pulizia inviti: <messaggio>`.
4. **Dopo il `listen`**, accanto agli altri avvisi di avvio: se
   `APP_BASE_URL` manca, una riga sola — `[piattaforma] APP_BASE_URL non
   impostata: i link d'invito useranno l'host della richiesta`. Non ferma
   niente: è il promemoria che i link nasceranno dall'Host visto dal server.

### Il percorso di un invito

1. **Creazione.** Da «Nuova azienda» (il proprietario nasce con l'azienda) o
   da «Invia invito» nella scheda di un'azienda esistente (sezione
   Proprietari e inviti). **Entrambe chiedono la password
   dell'amministratore** — un link d'invito è la presa dell'account del
   proprietario di un'altra azienda, quindi è un'azione sensibile come
   sospendere o toccare un abbonamento. In entrambi i casi il proprietario
   riceve una
   **password inutilizzabile** (un hash di 32 byte casuali: nessuno può
   entrare prima di accettare l'invito) e il servizio emette un token
   monouso (`randomBytes(32)` in base64url) — a terra resta solo il suo
   sha256, il token in chiaro esce **una volta sola**, dentro il link.
   Invitare di nuovo lo stesso utente **annulla da solo** ogni invito
   precedente ancora valido: non ne restano mai due attivi.
2. **Consegna.** Con `RESEND_API_KEY` impostata, l'email parte da
   `POSTA_PIATTAFORMA_MITTENTE` (default `Wyndoor <no-reply@wyndoor.com>`),
   oggetto «Il tuo accesso a Wyndoor per `<Azienda>`», e il pannello mostra
   solo l'esito («Invito inviato a …»): il link **non torna nemmeno al
   browser** — il token è già nella casella giusta, e una seconda copia nella
   pagina dell'amministratore sarebbe soltanto un'altra copia da rubare.
   **Senza chiave, o se Resend rifiuta o non risponde entro 10 s, l'invio non
   si rompe**: allora il link c'è, con un pulsante «Copia» e la riga «Link su
   &lt;base&gt;» che dice su quale indirizzo è nato — si consegna a mano
   (email a parte, WhatsApp, di persona). Nessun invito va perso per questo:
   il link resta valido comunque. Conseguenza operativa: **se la posta è
   partita e il proprietario non trova l'email, il link non si recupera** —
   si manda un invito nuovo, che annulla il precedente.
3. **La pagina pubblica `/invito/<token>`** (fuori dalla shell, senza
   sessione) mostra azienda, nome ed email di chi è stato invitato, chiede la
   password (minimo 12 caratteri, conferma) e apre la sessione da sola
   all'accettazione — stesso cookie del login. Un token sbagliato, scaduto,
   già usato o annullato dà sempre lo stesso «Questo invito non è valido o è
   scaduto: chiedi un nuovo invito»: nessun indizio su quale motivo sia,
   apposta.
4. **Validità: 7 giorni, un solo uso.** Passata la scadenza, o dopo il primo
   uso, il token non vale più — `consumaInvito` è atomico: due tentativi
   concorrenti sullo stesso token hanno esattamente un vincitore.
5. **Rinvio e annullo.** «Invia invito» di nuovo sullo stesso proprietario
   rinnova il link (annulla il vecchio, ne emette uno nuovo; su Postgres lo
   garantisce anche un indice parziale unico, `tenant_inviti_valido_idx`, non
   solo il codice). «Annulla invito» nella scheda azienda smette di far
   valere un invito non ancora usato, senza toccarne uno già accettato, e
   **non** chiede la password: toglie potere, non ne dà.
6. **Nessuna scorciatoia da riga di comando.** Non esiste un `pnpm tenant
   invita`: il link è un segreto a tempo che non deve restare scritto in
   `tenant_comandi` (o in un terminale, o in uno script). Solo il pannello lo
   emette e lo consegna.
7. **Audit.** Tre eventi in `tenant_eventi`, mai col token:
   `invito_inviato` (con l'esito dell'invio e l'eventuale motivo del
   fallimento), `invito_accettato`, `invito_annullato`.

### Le azioni del pannello e la loro traccia

- Ogni mutation del pannello **accoda** un comando in `tenant_comandi` con
  `richiesto_da = piattaforma:<email dell'amministratore>` — mai
  `script:…`, mai `boot`. L'evento che ne risulta porta lo stesso attore:
  `tenant_eventi.attore = piattaforma:<email>`, leggibile alla lettera nella
  scheda dell'azienda (sezione Eventi) e da SQL:

      SELECT tipo, attore, created_at FROM tenant_eventi
       WHERE attore LIKE 'piattaforma:%' ORDER BY id DESC LIMIT 20;

- **Esecuzione immediata.** Cinque delle nove mutation del router (`crea`,
  `sospendi`, `riattiva`, `proprietario`, `abbonamento` — quest'ultima porta
  da sola le sette azioni sul contratto: omaggio, proroga, budget, extra,
  quota, tolleranze, disdetta/annulla) accodano e **subito dopo** eseguono lo
  stesso comando con `eseguiComandoSubito`: la
  stessa funzione del giro dei 30 secondi, chiamata su un solo id, con lo
  stesso claim atomico (`FOR UPDATE SKIP LOCKED` su Postgres) — se il giro
  regolare lo ha già preso nel frattempo, il pannello aspetta ed espone
  l'esito vero, non lo riesegue. L'amministratore vede l'esito nella
  risposta della mutation, senza dover ricaricare la pagina.
- **Le due che restano in coda:** `ricalcolaStorage` e `ripristina` (perché
  il server, non lo script né il pannello, deve parlare col Drive
  dell'azienda). Il pannello segue il comando con `piattaforma.comando({id})`
  ogni 2 secondi finché non chiude, e mostra «In corso…» sotto la sezione
  Spazio o Backup rispettivamente.
- **`invita` e `annullaInvito` non sono comandi**: passano dal servizio degli
  inviti (sopra), non da `tenant_comandi` — il link è un segreto a tempo, un
  comando invece lascia il suo `payload`/`esito` leggibile a chiunque legga
  la tabella. `invita` chiede comunque la password (è sensibile);
  `annullaInvito` no.
- **Le azioni sensibili** (password dell'amministratore, 5 tentativi in 15
  minuti): `crea`, `invita`, `sospendi`, `riattiva`, `proprietario`, tutte e
  sette le azioni sull'abbonamento e `ripristina` con scrittura. **Non**
  sensibili: ricalcolo dello spazio, ripristino in prova, annullo di un
  invito.
- `pnpm tenant elenco` e `pnpm tenant verifica` restano validi e mostrano gli
  stessi dati di sempre: nessun comando dello script cambia forma per via del
  pannello.

### Variabili d'ambiente (WS6)

| Variabile | Default | A che serve |
|---|---|---|
| `PLATFORM_ADMIN_EMAILS` | *(nessuno)* | Email separate da virgola: senza questa variabile **nessuno** vede il pannello, indipendentemente da ruolo o capability — è l'unica porta. |
| `RESEND_API_KEY` | *(nessuno)* | Chiave del provider Resend per la posta transazionale della piattaforma. Senza, `inviaPosta` torna sempre `{ inviato: false }` e il pannello mostra il link da copiare: nessun invito si perde, nessuno riceve un'email. |
| `POSTA_PIATTAFORMA_MITTENTE` | `Wyndoor <no-reply@wyndoor.com>` | Intestazione `From:` delle email della piattaforma (oggi solo l'invito). |
| `APP_BASE_URL` | ripiego `req.protocol`+`req.get("host")` | Base del link d'invito (`<APP_BASE_URL>/invito/<token>`, senza barra finale). In produzione va impostata esplicitamente — stesso ripiego di `fattureInCloud.ts` per il redirect OAuth, pensato per lo sviluppo locale, non per un dominio pubblico. Se manca, al boot compare `[piattaforma] APP_BASE_URL non impostata: i link d'invito useranno l'host della richiesta`; il pannello mostra comunque, sotto il link da copiare, la riga «Link su &lt;base&gt;» con l'indirizzo davvero usato. |

Nessuna delle quattro tocca `FLAG_MULTI_AZIENDA`: il pannello resta gated
dall'identità, come detto sopra.

### Produzione, in ordine (WS6)

1. **Deploy.** `FLAG_MULTI_AZIENDA` è già acceso dal 09/09 (WS3+WS4): il WS6
   non ne dipende e non lo tocca. Nei log nessun errore `[tenants]`; la
   tabella `tenant_inviti` nasce da sola nello schema, come le altre.
2. **Impostare `PLATFORM_ADMIN_EMAILS`** (almeno l'email di chi amministra
   oggi la piattaforma) sul servizio Wyndoor di Railway — il riavvio è
   automatico quando si cambia una variabile.
3. **Login** con quell'utente: la voce **«Piattaforma»** compare nel menu
   utente. Aprirla mostra Ruffino Group con l'etichetta «piattaforma» e il
   suo abbonamento omaggio.
4. **Posta**, prima di invitare qualcuno per email: account Resend, dominio
   `wyndoor.com` aggiunto e verificato (i record DNS — SPF via TXT, DKIM via
   CNAME — li assegna Resend alla registrazione del dominio: si copiano dal
   suo pannello, non sono fissi), poi `RESEND_API_KEY` nell'ambiente. **Finché
   non è fatto**, ogni invito funziona lo stesso: il pannello mostra il link
   da copiare e consegnare a mano.
5. **Azienda pilota**: «Nuova azienda» dall'elenco — slug, ragione sociale,
   prima sede, proprietario (nome, cognome, email, telefono), omaggio
   opzionale, password di conferma dell'amministratore.
6. **L'invito**: arriva via email se Resend è configurato, altrimenti si
   copia il link dal riepilogo (o più tardi dalla scheda azienda, sezione
   Proprietari e inviti) e lo si consegna. Il proprietario apre
   `/invito/<token>`, sceglie la password, entra: da qui in poi lavora come
   qualunque proprietario del CRM.

**Rollback = build precedente.** Additivo come le sezioni WS2/WS3/WS4:
`tenant_inviti` resta a terra, invisibile e innocua; un invito già emesso con
il codice nuovo **non si accetta** finché il codice nuovo non torna (la
pagina `/invito` e il router pubblico `inviti` non esistono nel build
precedente) — non è una perdita di dati, solo un invito da riemettere dopo il
roll-forward.

### Errori che l'operatore può vedere (WS6)

- «Questa sezione è riservata all'amministrazione della piattaforma.»
  (`FORBIDDEN`) — l'utente loggato non è (più) nell'elenco
  `PLATFORM_ADMIN_EMAILS`, non è attivo, oppure non è un utente locale del
  tenant 1. Non è un guasto: aggiungere l'email e riavviare, se doveva
  esserci.
- «Password non corretta.» (`UNAUTHORIZED`) sulla conferma di un'azione
  sensibile — password dell'amministratore sbagliata. Dopo 5 tentativi in 15
  minuti: «Troppi tentativi di accesso. Riprova tra qualche minuto.»
  (`TOO_MANY_REQUESTS`), lo stesso testo del login.
- «Con FLAG_MULTI_AZIENDA spento il pannello è in sola lettura.»
  (`PRECONDITION_FAILED`) — ogni mutation rifiuta a interruttore spento; le
  query rispondono comunque (si vede il tenant 1 e il suo omaggio). Non
  capita in produzione dal 09/09 (il flag è acceso); capita su un ambiente di
  prova senza `FLAG_MULTI_AZIENDA=on`.
- «Sospendere il tenant 1 mette Ruffino Group in sola lettura: conferma con
  «anche Ruffino Group» (ancheTenant1).» — stesso rifiuto di `pnpm tenant
  sospendi` senza `--anche-tenant-1`: nel dialogo di sospensione si spunta la
  casella «Anche Ruffino Group».
- «Questo invito non è valido o è scaduto: chiedi un nuovo invito.»
  (`NOT_FOUND`) su `/invito/<token>` — token già usato, annullato, scaduto
  (oltre 7 giorni) o inventato: stesso messaggio per ogni motivo, di
  proposito. Rimedio: dalla scheda dell'azienda, «Invia invito» di nuovo.
- «Accesso non disponibile: il multi-azienda della piattaforma è spento.»
  (`PRECONDITION_FAILED`) al login — porta chiusa a interruttore spento
  (sezione «Interruttore»): l'utente è di un'azienda diversa dal tenant 1 e
  `FLAG_MULTI_AZIENDA` è `off`. Rimedio: riaccendere l'interruttore, non
  toccare l'utente. Nello stesso stato `/invito/<token>` risponde «Con
  FLAG_MULTI_AZIENDA spento il pannello è in sola lettura.» senza consumare
  il token.
- «Troppi tentativi di accesso. Riprova tra qualche minuto.»
  (`TOO_MANY_REQUESTS`) su `/invito/<token>` — 30 token sbagliati in 15
  minuti dallo stesso indirizzo (il limite dell'anteprima), o 5 accettazioni
  fallite sullo stesso token. Un invito valido azzera il contatore
  dell'indirizzo: chi ricarica la propria pagina non lo consuma.
- «Posta della piattaforma non configurata: copia il link e consegnalo a
  mano.» — `RESEND_API_KEY` assente, oppure Resend ha rifiutato o non ha
  risposto entro 10 s. Il link resta valido: si copia e si consegna
  altrimenti. Non blocca né la creazione dell'azienda né l'invito.
- «L'azienda ha più proprietari: indica l'email di chi invitare.»
  (`BAD_REQUEST`) — dal pannello **non si vede**: la sezione «Proprietari e
  inviti» manda sempre l'email della riga su cui si è premuto «Invia invito»,
  quindi la scelta è già fatta. Lo si incontra solo chiamando
  `piattaforma.invita` direttamente (API, script) senza `email` su un'azienda
  con più di un proprietario: rimedio, passare l'email.
- «L'azienda esiste già: nessun invito inviato.» — «Nuova azienda» con uno
  slug già usato: idempotente come `pnpm tenant crea`, non manda un secondo
  invito né tocca l'azienda esistente.
- «Risorsa non trovata.» (`NOT_FOUND`) su uno slug che non esiste — stesso
  comportamento del resto del CRM dal WS3: nessun indizio per enumerare gli
  slug altrui.
- `[piattaforma] conferma password rifiutata per <dominio email>` — un
  tentativo di conferma sbagliato; se si ripete su un dominio noto, verificare
  chi sta provando.
- `[posta] invio a <dominio>: fallito (<motivo>)` — l'invito non è partito
  (chiave assente, Resend ha risposto un errore, timeout di 10 s); mai
  l'indirizzo intero nel log. Il link resta comunque disponibile da copiare.
- `[inviti] accettazione fallita: <messaggio>` — un errore inatteso (non un
  token scaduto/usato/sconosciuto) durante l'accettazione: chi lo prova vede
  comunque «invito non valido», ma qui c'è il motivo vero, mai il token.
- `[tenants] inviti scaduti rimossi: N` — spazzata di boot, normale, non un
  errore. `[tenants] pulizia inviti: <messaggio>` — quella spazzata è
  fallita: l'avvio prosegue lo stesso, ma la tabella cresce finché non si
  risolve.
- (solo operatore) «Tabelle del control plane del tenant assenti (…,
  `tenant_inviti`)…» — il server non ha ancora fatto boot con questa
  versione: deploy prima, pannello poi (v. sopra, ora sono otto).

## Verifica in sola lettura (prima e dopo l'accensione)

    SELECT id, slug, stato FROM tenants ORDER BY id;
    SELECT tipo, attore, created_at FROM tenant_eventi ORDER BY id DESC LIMIT 20;
    SELECT id, tipo, stato, richiesto_da FROM tenant_comandi WHERE stato = 'in_attesa';
    SELECT COUNT(*) FROM jsonb_array_elements((SELECT data FROM kv_store WHERE key = 'utenti')) u WHERE (u->>'tenantId') IS NULL;

L'ultima deve dare 0 dopo il primo boot col nuovo codice (backfill).

## Produzione, in ordine (WS1)

> Se distribuisci WS1 e WS2 insieme — è il caso oggi, il branch del WS2
> contiene il WS1 — segui l'ordine della sezione «Produzione, in ordine
> (WS2)» qui sopra, che comprende questi passi.

1. Backup Drive riuscito nelle 24 ore precedenti. Viene prima del deploy, non
   solo prima dell'accensione: il backfill di `tenantId` su `utenti` e
   `sedi` scatta al primo boot del nuovo codice anche a interruttore spento.
2. Deploy con interruttore spento; verifica in sola lettura; nessun errore `[tenants]`.
3. Backup Drive riuscito nelle 24 ore (di nuovo: verificane la freschezza se
   è passato tempo dal passo 1).
4. `FLAG_MULTI_AZIENDA=on`, riavvio; log `[tenants] tenant 1 … pronto`, evento
   `proprietario_assegnato` per l'utente 1; `tenants.mio` dal client, dopo un
   nuovo login.
5. Nessun tenant 2 in produzione finché il WS3 non separa storage, backup e
   credenziali (col solo WS1: finché il WS2 non apre la porta).

## Errori che l'utente può vedere
- «Azienda sospesa: il gestionale è in sola lettura.» — mutation con tenant
  sospeso; da tRPC `PRECONDITION_FAILED`, dalle rotte Express (upload
  documenti) HTTP `412` con lo stesso messaggio.
- «L'azienda non ha una sede attiva.» — tenant senza sedi attive; stessi due
  canali, `412` anche su download, anteprime, allegati mail e SSE.
- ~~«L'azienda non è ancora attiva su questa installazione.»~~ — era la
  «porta chiusa» del WS1: **rimossa dal WS2**, insieme al suo gemello nel
  login. Dal WS6 esiste una porta chiusa diversa, che vale **solo a
  interruttore spento** (v. «Interruttore»): «Accesso non disponibile: il
  multi-azienda della piattaforma è spento.» A interruttore acceso — cioè in
  produzione dal 09/09 — nessun utente la vede.
- «Impossibile: è l'ultima sede attiva dell'azienda. Attiva un'altra sede
  prima di disattivarla.» — `sedi.update` con `attiva: false` sull'unica
  sede attiva del tenant.
- «Solo un proprietario può nominare o revocare un proprietario.»
- «Il ruolo proprietario richiede FLAG_MULTI_AZIENDA.»
- (solo operatore, `pnpm tenant`) «Tabelle del control plane del tenant assenti
  (tenants, tenant_eventi, tenant_comandi, tenant_sedi, tenant_storage,
  oauth_state, abbonamenti, tenant_inviti)…» — script lanciato contro un
  database su cui il server con questa versione non è mai partito. Dal WS6 il
  messaggio nomina tutte e **otto** le tabelle che la sonda chiede (prima
  erano sette): quella che manca è fra queste (`abbonamenti` è del WS4,
  `tenant_storage` e `oauth_state` del WS3, `tenant_inviti` del WS6, pannello
  piattaforma).

