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

## Procedura verificabile

1. Impostare le sei variabili nel servizio Railway e ridistribuire.
2. Eseguire `pnpm storage:check` nel contesto Railway. La sonda fa
   put/get/checksum/delete di un piccolo oggetto sotto `_health/`.
3. Eseguire `pnpm storage:dry-run` e conservare il report.
4. Eseguire un backup Drive manuale e verificarne l'esito.
5. Solo dopo, eseguire `pnpm storage:migrate`. La migrazione rifiuta l'apply
   se non trova un backup Drive riuscito nelle ultime 24 ore.
6. Ripetere `pnpm storage:dry-run`: `da migrare` deve essere zero.

La migrazione è idempotente. Per ogni record esegue scrittura, rilettura e
verifica SHA-256 prima di eliminare `dataBase64` dal database. Il backup Drive
risolve sia i record legacy sia quelli con `storageKey`, e fallisce se un
oggetto manca o risulta corrotto.
