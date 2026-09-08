# Storage file su Cloudflare R2

Il CRM supporta qualunque endpoint S3 compatibile. In produzione Railway il
driver locale non è considerato durevole senza un volume esplicitamente
abilitato; per R2 usare queste variabili:

```env
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_BUCKET=ruffino-crm-files
S3_ACCESS_KEY_ID=<access-key-id R2>
S3_SECRET_ACCESS_KEY=<secret-access-key R2>
S3_REGION=auto
```

Creare un token R2 limitato al solo bucket `ruffino-crm-files`, con permessi
Object Read & Write. Non inserire mai le credenziali nel repository.

## Chiavi per azienda (WS3, su branch)

Dal WS3 (`feature/ws3-file-integrazioni`, non ancora su `main`) ogni file
**nuovo** nasce sotto il prefisso dell'azienda:

    tenant/<tenantId>/<collezione>/<parentId>/<recordId>-<rand8><ext>

Vale per ogni azienda, **tenant 1 compreso**. Le chiavi **nude** — quelle
scritte prima del WS3 — sono di Ruffino Group e restano dove sono: nessuna
copia, nessuna rinomina, nessun cutover (decisione 2 della spec
`docs/superpowers/specs/2026-09-08-ws3-file-integrazioni-design.md`). Chi
legge una chiave nuda deve quindi essere il tenant 1: `getFile` e
`openFileReadStream` rifiutano (`null`, cioè «non trovato») una chiave di
un'altra azienda e lo scrivono nel log senza mai citarla.

Un rollback al build precedente non rompe niente sui file: le chiavi col
prefisso sono chiavi come le altre e il codice vecchio le legge dal
`storageKey` del record, senza guardare la forma.

### Migrazione, un'azienda alla volta

Lo script che sposta i `dataBase64` legacy nello storage accetta
`--tenant=<id>` (default 1, Ruffino Group) e gira dentro il contesto di
quell'azienda; i file migrati ricevono la chiave col prefisso dell'azienda:

    pnpm storage:dry-run --tenant=2
    pnpm storage:migrate --tenant=2

Il tenant scelto compare nella prima riga di output (`Tenant: 2`):
**leggerlo prima di dare `--apply`**. Attenzione: con `FLAG_MULTI_AZIENDA`
spento il resolver degli store risolve sempre il tenant 1, quindi
`--tenant=2` non fallisce — lavora su Ruffino Group. Vale per tutti gli
script con `--tenant` (v. `docs/runbooks/multi-azienda.md`). La stessa
migrazione, per l'azienda della sessione, è esposta alla direzione dalla
procedura `fileStorage.migrate`.

### Byte contati per azienda

Ogni `putFile` e ogni `deleteFileQuiet` aggiornano il ledger
`tenant_storage` (byte, numero di file) dell'azienda della chiave. Il conto
si legge e si rifà da CLI:

    pnpm tenant storage --slug=ruffino-group              # sola lettura
    pnpm tenant storage --slug=acme --ricalcola --scrivi  # rifà il conto sul server

Il ricalcolo è la fonte di verità (il ledger deriva dal vero e può
discostarsi): rilegge documenti, allegati dei ticket, allegati delle
comunicazioni e — con una `HEAD` allo storage — anteprime e PDF/XML delle
fatture. Superato il 50, 80 o 100 % della quota (`tenants.storage_quota_bytes`,
100 GiB di default) l'azienda riceve un evento `storage_soglia`: è un
avviso, **non** un blocco degli upload.

## Procedura verificabile

1. Impostare le sei variabili nel servizio Railway e ridistribuire.
2. Eseguire `pnpm storage:check` nel contesto Railway. La sonda fa
   put/get/checksum/delete di un piccolo oggetto sotto `_health/`.
3. Eseguire `pnpm storage:dry-run` e conservare il report.
4. Eseguire un backup Drive manuale e verificarne l'esito.
5. Solo dopo, eseguire `pnpm storage:migrate` (col WS3: un'azienda alla
   volta, `--tenant=<id>`). La migrazione rifiuta l'apply se non trova un
   backup Drive riuscito nelle ultime 24 ore.
6. Ripetere `pnpm storage:dry-run`: `da migrare` deve essere zero.
7. Col WS3: `pnpm tenant storage --slug=<slug> --ricalcola --scrivi` per
   rimettere in pari il conto dei byte dopo lo spostamento.

La migrazione è idempotente. Per ogni record esegue scrittura, rilettura e
verifica SHA-256 prima di eliminare `dataBase64` dal database. Il backup Drive
risolve sia i record legacy sia quelli con `storageKey`, e fallisce se un
oggetto manca o risulta corrotto.
