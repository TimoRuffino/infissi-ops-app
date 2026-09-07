# Runbook multi-azienda (WS1 fondazione tenant + WS2 archivi per tenant)

Spec: `docs/superpowers/specs/2026-09-06-ws1-fondazione-tenant-design.md` e
`docs/superpowers/specs/2026-09-07-ws2-porta-aperta-design.md` (le decisioni
prese durante l'esecuzione del WS2 sono nella sua §2-bis).
Modulo: `server/tenants/`. Interruttore: `FLAG_MULTI_AZIENDA` (fail-closed).

## Cosa fa, in una riga
Il tenant (azienda) esiste, è nel contesto di ogni richiesta, ha guardie e un
ruolo Proprietario (WS1); ogni store JSONB ha un archivio per azienda e le
tabelle SQL portano `tenant_id` (WS2, su branch). Ruffino Group è il tenant 1
e tiene le chiavi di sempre.

> **Stato al 07/09/2026:** il WS1 è su `feature/ws1-fondazione-tenant` (PR #3
> aperta verso `main`), il WS2 su `feature/ws2-porta-aperta`, nato dal
> precedente. Nessuno dei due è su `main`, quindi **niente di tutto questo è
> in produzione**. Le sezioni WS2 qui sotto valgono dal momento in cui il
> branch viene distribuito.

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
7. **Nessun tenant 2 in produzione** finché il WS3 non separa storage,
   backup e credenziali: è una regola di runbook, non un blocco del codice.
   Il primo tenant 2 nasce **in staging**, con `pnpm tenant crea`.

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
