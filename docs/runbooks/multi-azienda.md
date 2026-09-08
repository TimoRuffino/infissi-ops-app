# Runbook multi-azienda (WS1 fondazione tenant + WS2 archivi per tenant + WS3 file, backup, credenziali e guasti)

Spec: `docs/superpowers/specs/2026-09-06-ws1-fondazione-tenant-design.md`,
`docs/superpowers/specs/2026-09-07-ws2-porta-aperta-design.md` e
`docs/superpowers/specs/2026-09-08-ws3-file-integrazioni-design.md` (le
decisioni prese durante l'esecuzione di WS2 e WS3 sono nelle rispettive
§2-bis).
Modulo: `server/tenants/`. Interruttore: `FLAG_MULTI_AZIENDA` (fail-closed).

## Cosa fa, in una riga
Il tenant (azienda) esiste, è nel contesto di ogni richiesta, ha guardie e un
ruolo Proprietario (WS1); ogni store JSONB ha un archivio per azienda e le
tabelle SQL portano `tenant_id` (WS2); i file, il backup sul Drive, le
credenziali OAuth e i guasti dei worker sono per azienda, e il ripristino
degli archivi è un comando provato (WS3, su branch). Ruffino Group è il
tenant 1 e tiene le chiavi di sempre.

> **Stato al 08/09/2026:** WS1 e WS2 sono su `main` (PR #3 e #5, fuse
> dalla direzione l'08/09), quindi distribuiti — Railway segue `main`;
> l'accensione di `FLAG_MULTI_AZIENDA` in produzione resta una decisione
> della direzione, e le sezioni sotto dicono in che ordine si fa. Il **WS3**
> è su `feature/ws3-file-integrazioni` e **non è su `main`**: la sua sezione
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
- Rollback: rimetti `off` e riavvia. Nessun dato da toccare.
- Recupero — un'azienda resta senza sedi attive (dati manipolati fuori
  dall'app, non dalla guardia sull'ultima sede attiva introdotta col WS1):
  `FLAG_MULTI_AZIENDA=off`, riavvio, riattiva una sede sul tenant colpito,
  poi `on`.

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
    pnpm tenant stato --slug=acme --riattiva --motivo="pagato" --scrivi
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

> **Stato al 08/09/2026:** i 13 task del WS3 sono implementati e committati su
> `feature/ws3-file-integrazioni` (da `cea968e` a `c4efcd8`), nato da `main`
> @ `b77c9da`. Il branch **non è su `main`**, quindi **niente di questa
> sezione è in produzione**: vale dal momento in cui il branch viene
> distribuito. WS1 e WS2, invece, sono su `main` dall'08/09 (PR #3 e #5).

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
tenant assenti (tenants, tenant_eventi, tenant_comandi)…»: il messaggio ne
nomina tre, ma a mancare sono le due nuove. Non è un guasto — deploy prima,
script poi, anche fra WS2 e WS3. `verifica` resta l'eccezione: gira lo
stesso, senza DDL.

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
  **«Backup Wyndor — `<nome azienda>`»**, trovata o creata al primo backup.
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
   aspetta la riga di log del passo 2.
5. **Accensione** — `FLAG_MULTI_AZIENDA=on` e riavvio, se non è già accesa;
   poi un nuovo login.
6. **Prima azienda 2 in staging**, non in produzione: `pnpm tenant crea …`;
   entra il proprietario; collega il Drive **dell'azienda** da Integrazioni;
   lancia un backup a mano e verifica sul suo Drive la cartella «Backup
   Wyndor — `<nome azienda>`»; poi `pnpm tenant ripristina --slug=<slug>
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
  elenco` dice fino a quando.
- «Risorsa non trovata.» (`NOT_FOUND`) al posto di un 500 — dal WS3 i 98
  «non trovato» dei router rispondono così, sia per un id inesistente sia
  per uno di un'altra sede.
- «Backup … non trovato sul Drive dell'azienda», «Store richiesti assenti
  dal backup: …», «Dump non valido: …», «Nessuno store da ripristinare» —
  ripristino rifiutato **prima** di toccare qualsiasi cosa, azienda non
  sospesa.
- «Ripristino interrotto dopo …: … (azienda lasciata sospesa)» — verifica e
  poi `pnpm tenant stato --slug=… --riattiva --motivo=… --scrivi`.

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
  login.
- «Impossibile: è l'ultima sede attiva dell'azienda. Attiva un'altra sede
  prima di disattivarla.» — `sedi.update` con `attiva: false` sull'unica
  sede attiva del tenant.
- «Solo un proprietario può nominare o revocare un proprietario.»
- «Il ruolo proprietario richiede FLAG_MULTI_AZIENDA.»
- (solo operatore, `pnpm tenant`) «Tabelle del control plane del tenant assenti
  (tenants, tenant_eventi, tenant_comandi)…» — script lanciato contro un
  database su cui il server con questa versione non è mai partito.
