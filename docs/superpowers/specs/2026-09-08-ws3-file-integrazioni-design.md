# WS3 — Prima azienda vera: file, backup, credenziali e guasti per tenant (spec tecnica)

**Data:** 08/09/2026 · **Stato:** approvata in chat a sezioni dalla direzione (sei scelte + design in nove sezioni), nessun codice scritto · **Spec madre:** `docs/superpowers/specs/2026-09-06-saas-multi-azienda-design.md` (§4.1, §12.4, §12.5, §13, §14.2 punti 5–6, §15, §16.5, §17 punto 3) · **Precedenti:** WS1 `2026-09-06-ws1-fondazione-tenant-design.md`, WS2 `2026-09-07-ws2-porta-aperta-design.md` (entrambi su `main` dall'08/09/2026, PR #3 e #5) · **Branch:** `feature/ws3-file-integrazioni`, da `main` @ `b77c9da`.

> Con il WS2 gli archivi sono per azienda, ma file, backup, credenziali e
> guasti sono ancora dell'installazione: per questo il runbook vieta una
> seconda azienda in produzione. Il WS3 toglie il divieto: ogni azienda ha i
> suoi file contati, il suo backup sul suo Drive con un ripristino provato,
> i suoi `state` OAuth, il suo instradamento dei webhook, e un guasto suo
> non ferma le altre.

## 1. Obiettivo, perimetro, non-obiettivi

**Obiettivo.** Dopo il WS3 una seconda azienda può stare in produzione con
`FLAG_MULTI_AZIENDA` acceso; con l'interruttore spento tutto si comporta
come oggi, salvo le aggiunte additive di §11.

**Entra nel WS3.**
- Chiavi storage con prefisso del tenant per ogni file nuovo, chiavi legacy
  intatte, cintura sulle letture (§3).
- Contatore dei byte per azienda come ledger, quota e avvisi senza blocco,
  ricalcolo su comando, pannello e migrazione dello storage per azienda (§3).
- Backup Drive per azienda (store, scheduler, OAuth, cartella, albero) e
  ripristino degli archivi via comando eseguito dal server, da Drive (§4).
- `state` OAuth persistito e legato ad azienda, sede e utente; refresh token
  Drive cifrato (§5).
- Webhook WhatsApp instradato per numero fra le aziende (§6).
- Interruttore per (worker, azienda) nei giri di fondo (§7).
- Helper `recordOppureNotFound` al posto delle 98 coppie «`throw new Error`
  + `assertSedeScope`» nei router, con guardia strutturale (§8).

**Resta fuori.**
- Abbonamenti, stati `trialing`/insoluto, blocco degli upload oltre quota,
  pacchetti extra, tolleranze (WS4).
- Budget Tars per azienda: oggi `TARS_DAILY_BUDGET_USD`/`TARS_MONTHLY_BUDGET_USD`
  sono somme globali in `tars_costi` (`server/tars/costi/ledger.ts:333-356`) con
  un unico `pg_advisory_xact_lock` (`:228, :325`): un'azienda può esaurire il
  tetto per tutte; è il WS4 (spec madre §4.2).
- Onboarding, inviti, reset password, personalizzazione (WS5); pannello
  Platform Admin (WS6); export aziendale (WS4/6).
- Chiavi di cifratura per azienda: resta l'unica `MAIL_ENCRYPTION_KEY`
  (`server/_core/secretBox.ts`).
- Migrazione fisica dei file legacy di Ruffino Group (decisione 2).
- Ripristino dei file dallo storage (decisione 4: solo gli archivi).
- Media WhatsApp: restano su Meta, scaricati a richiesta
  (`server/comunicazioni/whatsapp.ts:722-751`), nessun byte contato.

## 2. Decisioni prese in chat (08/09/2026)

| # | Tema | Decisione | Alternative scartate |
|---|---|---|---|
| 1 | Drive del backup | **Ogni azienda collega il suo Drive** (OAuth `drive.file`); Ruffino Group tiene il suo; credenziali per azienda, cifrate | un Drive della piattaforma con una cartella per azienda |
| 2 | File legacy | **Restano dove sono**: i file nuovi nascono sotto `tenant/<id>/…`, le chiavi nude sono del tenant 1 e valgono | migrazione fisica con checksum (spec madre §14.2 punto 6, possibile in futuro) |
| 3 | Guasti nei worker | **Interruttore per (worker, azienda)** dentro `perOgniTenantAttivo`, niente code nuove | estendere la coda durevole degli eventi a tutti i worker |
| 4 | Ripristino | **Archivi via comando, provato**: `pnpm tenant ripristina` accoda un comando che il server esegue leggendo i dump dal Drive dell'azienda; i file non si ricaricano | solo procedura documentata; ripristino completo con i file |
| 5 | Quota storage | **Conta e avvisa, non blocca**: ledger, soglie 50/80/100 % come eventi e query per il proprietario | blocco degli upload oltre il 100 % |
| 6 | Deploy | WS1 e WS2 fusi in `main` dalla direzione l'08/09 (PR #3, PR #5); il WS3 parte da `main` | — |

## 3. Storage per tenant

### 3.1 Chiavi

`server/_core/fileStorage.ts` resta l'unico modulo che tocca i byte
(`StorageDriver`: `put/get/openRead/delete`, `:34-48`; driver `local` e
`s3`). Oggi la chiave è `buildStorageKey(collezione, parentId, recordId, nome)` →
`<collezione>/<parentId>/<recordId>-<rand8><ext>` (`:61-71`); non esiste un
elenco per prefisso.

```ts
export function chiaveStorage(tenantId: number, collezione: string, parentId: number, recordId: number, nome: string): string;
// → `tenant/${tenantId}/${buildStorageKey(collezione, parentId, recordId, nome)}`  per OGNI tenant, tenant 1 compreso
export function tenantDellaChiave(storageKey: string): number;
// `tenant/<n>/…` → n; chiave nuda (legacy) → 1
```

- `putFile(collezione, parentId, recordId, nome, buffer, mimeType)` (`:461-479`)
  mantiene la firma: ricava il tenant da `tenantCorrente()` (import del
  modulo foglia `server/tenants/contestoCorrente.ts`; senza tenant a
  interruttore acceso → errore, come gli store) e costruisce la chiave con
  `chiaveStorage`. I sei chiamanti non cambiano (`routers/preventiviContratti.ts`
  ×4, `routers/ticketAllegati.ts`, `comunicazioni/imap.ts`, `documenti/anteprime.ts`,
  `fatture/emissione.ts` via l'alias iniettabile `archivia`).
- Cintura in lettura: `getFile` e `openFileReadStream` rifiutano
  (`null`, cioè «non trovato») una chiave il cui `tenantDellaChiave` non è il
  tenant corrente; le chiavi nude sono leggibili solo dal tenant 1. I record
  sono già per tenant (WS2): la cintura protegge dal record corrotto o
  dall'errore di programmazione, non è il confine primario.
- `deleteFileQuiet(storageKey, bytes?)`: firma estesa col numero di byte,
  che i nove chiamanti (`preventiviContratti.ts:347,603,685,790,817,1277,1279`,
  `ticketAllegati.ts:75,200`) passano dal record (`size`, presente su
  documenti `preventiviContratti.ts:75`, allegati ticket `ticketAllegati.ts:20`,
  allegati mail `comunicazioni.ts:36`); per le anteprime (`doc.anteprime.chiavi`)
  la dimensione viene da `statFile` (sotto).
- Driver: metodo nuovo opzionale `head(key): Promise<{ bytes: number } | null>`
  (`local`: `stat`; `s3`: `HEAD`), esposto come `statFile(storageKey)`.

### 3.2 Contabilità dei byte

Tabella del control plane (`server/tenants/repository.ts`):

```sql
CREATE TABLE IF NOT EXISTS tenant_storage (
  tenant_id BIGINT PRIMARY KEY REFERENCES tenants(id),
  bytes BIGINT NOT NULL DEFAULT 0,
  file INTEGER NOT NULL DEFAULT 0,
  soglia_avvisata INTEGER NOT NULL DEFAULT 0,   -- 0, 50, 80 o 100
  ricalcolato_il TIMESTAMPTZ,
  aggiornato_il TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS storage_quota_bytes BIGINT NOT NULL DEFAULT 107374182400; -- 100 GiB
```

- `fileStorage.ts` non importa il repository: riceve al boot un contabile
  con `impostaContabileStorage({ aggiungi(tenantId, bytes), togli(tenantId, bytes) })`
  (stesso schema del resolver del WS2); `putFile` chiama `aggiungi` dopo il
  `put` riuscito, `deleteFileQuiet` chiama `togli` dopo il `delete` riuscito
  (best effort: un errore di contabilità è un log, mai un upload rifiutato).
  Senza contabile registrato (script, test) nessun conteggio.
- Il contabile (`server/tenants/storage.ts`) incrementa in SQL
  (`UPDATE tenant_storage SET bytes = bytes + $1, file = file + $2 …`,
  riga creata se manca) e, se il nuovo totale supera una soglia non ancora
  avvisata (50, 80, 100 % di `storage_quota_bytes`), registra
  `tenant_eventi` tipo `storage_soglia` con `{ percentuale, bytes, quota }` e
  aggiorna `soglia_avvisata`; scendendo sotto il 50 % `soglia_avvisata` torna a 0.
- `ricalcolaStorage(tenantId)`: dentro `conTenant`, somma i `size` dei record
  con `storageKey` negli store dell'azienda (`preventivi_documenti`,
  `ticket_allegati`) e nella tabella `comunicazioni` (colonna JSONB
  `allegati[]`, `size` per allegato, `WHERE COALESCE(tenant_id, 1) = <id>`),
  e per le chiavi senza dimensione registrata — le anteprime
  (`doc.anteprime.chiavi[]`) e le fatture (`fatture.pdf_storage_key`,
  `xml_storage_key`) — usa `statFile`; scrive `bytes`, `file`,
  `ricalcolato_il` e registra `tenant_eventi` `storage_ricalcolato`. Gira
  come comando del control plane `ricalcola_storage`
  (`pnpm tenant storage --slug=acme --ricalcola --scrivi`; senza
  `--ricalcola` lo script stampa il ledger in sola lettura) e, al primo boot
  del WS3, per ogni azienda senza riga in `tenant_storage`, dopo
  `server.listen` in background (come il backfill di `tenant_id` del WS2).
- Query `tenants.storage` (`protectedProcedure`, azienda del contesto):
  `{ bytes, file, quotaBytes, percentuale, ricalcolatoIl, sogliaAvvisata }`.
  Nessun blocco degli upload (decisione 5).

### 3.3 Pannello e migrazione dello storage per azienda

`routers/fileStorageAdmin.ts` (`status`, `probe`, `migrate`) e
`_core/fileStorageMigrate.ts` filtrano oggi gli snapshot per `s.key` nudo e
iterano gli store fuori da un contesto (`fileStorageAdmin.ts:20-21`,
`fileStorageMigrate.ts:100-159`): vedono solo il tenant 1. Nel WS3: `status`
e `migrate` lavorano sull'azienda del contesto (filtro per `nome` sugli
snapshot, chiavi risolte con `chiaveStore`), lo script
`scripts/migrate-documents-to-storage.ts` accetta `--tenant=<id>` (default 1)
e gira dentro `conTenant`, e `docs/storage-r2.md` dice come si migra
un'azienda alla volta. I file migrati da `dataBase64` ricevono la chiave
col prefisso dell'azienda.

### 3.4 Cancellazioni

Verificato nella ricognizione: la cancellazione di un documento elimina il
file e le sue anteprime (`preventiviContratti.ts:1277-1279`), gli allegati
ticket si eliminano (`ticketAllegati.ts:75,200`); comunicazioni e fatture
non hanno un percorso di cancellazione (le fatture per ritenzione fiscale).
Nessuna cascata nuova; un test verifica che ogni `deleteFileQuiet` passi i
byte e che il ledger scenda.

## 4. Backup e ripristino per azienda

### 4.1 Store e scheduler

`backup_config`, `backup_oauth`, `backup_log` (oggi `{ ambito: "globale" }`,
`driveBackup.ts:57,91,112`) diventano store per tenant: il tenant 1 tiene le
sue righe (alias delle chiavi, WS2); la lista degli store globali scende a
quattro (`sedi`, `utenti`, `platform_feature_flags`,
`platform_feature_flag_audit`) e la guardia `storeGlobali.test.ts` viene
aggiornata. Il `setTimeout` di mezzanotte (`startBackupScheduler`,
`driveBackup.ts:1177-1199`) resta uno; il giro fa
`perOgniTenantAttivo("backup", t => runBackup({ trigger: "notturno" }))`
dentro il contesto dell'azienda: `runBackup` non cambia firma e legge gli
store per tenant attraverso i Proxy. I tre ritentativi ogni 20 minuti
restano per azienda.

### 4.2 OAuth e cartella

- `backup_oauth` porta `refreshTokenCifrato` (`encryptSecret`); al
  caricamento dello store una riga con `refreshToken` in chiaro viene
  cifrata e il campo in chiaro azzerato (migrazione a senso unico: il codice
  precedente non rilegge il token; rollback = ricollegare il Drive, §11).
  Lo specchio locale `data/backup-oauth.json` (`driveBackup.ts:120-144`)
  diventa `data/backup-oauth-<tenantId>.json` col solo testo cifrato.
- `issueOAuthState`/`consumeOAuthState` in memoria (`:161-173`) spariscono:
  `backup.oauthStartUrl` emette uno `state` persistito legato ad azienda,
  sede e utente (§5); `GET /api/oauth/gdrive/callback` (`index.ts`) consuma lo
  `state`, ricava l'azienda e salva il token dentro `conTenant(tenantId)`.
- Cartella radice: tenant 1 «Backup CRM Ruffino» (invariata, è la chiave dei
  backup esistenti); ogni altra azienda «Backup Wyndor — <nome>», trovata o
  creata da `ensureOAuthRoot(tenantId)`; `checkBackupRoot` per azienda.
- `routers/backup.ts` (`adminProcedure`) agisce sull'azienda del contesto:
  la direzione o il proprietario di ogni azienda vede stato e log, collega e
  scollega il proprio Drive, lancia il proprio backup. Nessuna procedura
  legge o scrive il Drive di un'altra azienda.

### 4.3 Albero

`buildBackupTree()` (`driveBackup.ts:835-1027`) produce solo l'azienda del
contesto: `database/<nome>.json` per le famiglie per tenant (istanza
dell'azienda, salvata col NOME dello store, non con la chiave `tenant:n:…`),
più le famiglie globali filtrate (`sedi` e `utenti` dell'azienda,
`platform_feature_flags`/`_audit` delle sue sedi); cartelle «Sede …» solo
per le sedi dell'azienda; `Utenti.json` per sede con i soli utenti
dell'azienda (`utente.tenantId`) — chiuso il difetto del WS2. I file passano
sempre da `resolveBackupFileData` (checksum SHA-256, `:811-833`).

### 4.4 Ripristino degli archivi

Comando del control plane `ripristina_archivi`, accodato da
`pnpm tenant ripristina --slug=acme --backup=<AAAA-MM-GG|folderId> [--solo=clienti,commesse] --prova|--scrivi [--anche-tenant-1] [--attendi]`
ed eseguito dal server (unico scrittore, come nel WS1). Senza `--prova` né
`--scrivi` lo script stampa l'anteprima del comando e non accoda nulla;
`--prova` accoda la prova (il server legge Drive e riferisce, non scrive),
`--scrivi` accoda il ripristino vero. In entrambi i casi `--attendi` stampa
l'esito. Il server:

1. con l'OAuth dell'azienda trova sul suo Drive la cartella del backup
   indicato (`Backup CRM <data>` sotto la radice dell'azienda, oppure l'id
   della cartella), la sua sottocartella `database/` e scarica i
   `<nome>.json` richiesti (`drive.file` legge ciò che l'app ha creato);
2. valida ogni dump (array, `id` numerici unici, `sedeId` — quando c'è —
   fra le sedi dell'azienda, `tenantId` — quando c'è — uguale all'azienda),
   scarta i nomi che non sono famiglie per tenant istanziate e gli store
   operativi del backup stesso (`backup_config`, `backup_oauth`,
   `backup_log`), e confronta i conteggi con gli archivi vivi;
3. in prova si ferma qui e scrive l'esito (`dryRun: true`, conteggi
   prima/dopo, anomalie) in `tenant_comandi.esito`;
4. con `scrivi`: mette l'azienda in `sospeso` (motivo «ripristino archivi in
   corso»), sostituisce gli archivi uno per uno con
   `sostituisciStore(tenantId, nome, items)` (nuova funzione di
   `persistence.ts`: rimpiazza gli item dell'istanza, alza il contatore
   degli id della famiglia e scrive subito il blob su `kv_store`, fuori dal
   debounce), riattiva l'azienda, registra `tenant_eventi`
   `archivi_ripristinati` con backup, store e conteggi; un errore a metà
   lascia l'azienda sospesa (l'esito e l'evento `comando_fallito` dicono
   quali store sono stati sostituiti; riattivazione con
   `pnpm tenant stato --riattiva` dopo verifica).
5. I file non vengono ricaricati: le `storageKey` restano valide nello
   storage; il Drive è la seconda copia. Il tenant 1 non è ripristinabile
   senza `--anche-tenant-1` (come `sospendi`). Le `onLoad` dei moduli non
   vengono rieseguite: un dump di una versione più vecchia del codice va
   ripristinato con un riavvio subito dopo.

Provato su Postgres vero con un Drive finto (accesso a Drive iniettabile).

## 5. `state` OAuth e credenziali per azienda

Tabella del control plane:

```sql
CREATE TABLE IF NOT EXISTS oauth_state (
  state TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('fic','gdrive')),
  tenant_id BIGINT NOT NULL REFERENCES tenants(id),
  sede_id BIGINT,
  utente_id BIGINT NOT NULL,
  payload JSONB NOT NULL,
  scade_il TIMESTAMPTZ NOT NULL,
  consumato_il TIMESTAMPTZ
);
```

`emettiStateOAuth({ tipo, tenantId, sedeId, utenteId, payload })` → `state`
(24 byte casuali, scadenza 10 minuti); `consumaStateOAuth(state, tipo)`
restituisce la riga una sola volta (`UPDATE … SET consumato_il = NOW() WHERE
consumato_il IS NULL AND scade_il > NOW() RETURNING *`) o `null`; pulizia
delle righe scadute al boot. Sostituisce `pendingFicStates`
(`fattureInCloud.ts:177-208`) e le mappe di Drive. I callback
(`/api/oauth/fic/callback`, `/api/oauth/gdrive/callback`) ricavano azienda,
sede e utente dallo `state` e girano in `conTenantDellaSede`/`conTenant`;
`state` scaduto o sconosciuto → redirect con `?…=errore` e log, mai un
salvataggio. L'Embedded Signup WhatsApp non usa uno `state` nostro
(`scambiaCode`, `whatsapp.ts:339-360`): resta com'è, già per tenant.

## 6. Webhook WhatsApp per numero

Oggi `POST /api/webhook/whatsapp` (`rotteAnonime.ts`) trova «la prima
azienda il cui segreto valida la firma» e ingerisce lì; con Embedded Signup
il segreto dell'app è uno per tutte le aziende, quindi la firma valida sempre
nella prima azienda provata e i messaggi della seconda finiscono in un
archivio dove il loro numero non esiste (scartati in silenzio). Nel WS3 la
firma resta il primo passo, com'è (`mittenteWebhookWhatsApp`: si prova con
ogni segreto, senza leggere il payload); il destinatario però si decide DOPO,
per numero: `numeriDelPayload` estrae i `phone_number_id` distinti, per
ognuno `trovaNeiTenant` cerca il numero in `configWhatsApp`
(`configPerPhoneNumberId`, `whatsapp.ts:310-312`) di ogni azienda attiva e
l'ingestione della sola porzione del payload di quel numero gira in
`conTenantDellaSede(config.sedeId)`. Numero sconosciuto → `200` a Meta
(nessun retry) e log `[whatsapp-webhook] numero sconosciuto: <id>`. Il `GET`
di verifica resta per `verify_token` fra le aziende.

## 7. Guasti per azienda

In `server/tenants/giri.ts`, `perOgniTenantAttivo(etichetta, fn)` tiene per
`(etichetta, tenantId)` uno stato `{ erroriConsecutivi, sospesoFinoA, attese }`:
dopo 3 errori consecutivi l'azienda viene saltata per 15 minuti, poi 30,
60, 120 (tetto); ogni sospensione scrive `[<etichetta>] tenant <id>
sospeso per <min> min: <errore>` e un evento `worker_sospeso` in
`tenant_eventi` (`{ etichetta, minuti, errore }`); il primo giro riuscito
riarma e registra `worker_riarmato`. `pnpm tenant elenco` mostra i worker
sospesi per azienda (`tenants.salute` interna). Nessuna coda nuova
(decisione 3); la coda durevole degli eventi resta com'è.

## 8. Residui che bloccano una seconda azienda

- `server/_core/permissions.ts`: `recordOppureNotFound<T>(record: T | null | undefined, sedeId: number | null): T`
  che lancia `TRPCError NOT_FOUND` («Risorsa non trovata.») se il record
  manca o è di un'altra sede (usa `assertSedeScope`). Le 98 coppie
  `if (!x) throw new Error("… non trovato"); assertSedeScope(x, ctx.sedeId)`
  nei 19 router (`commesse.ts` 24, `preventiviContratti.ts` 13, `tars.ts` 9,
  `produzione.ts` 9, `fornitori.ts` 6, `ticket.ts` 5, `aperture.ts` 5,
  `reclamiRifacimenti.ts` 4, `ticketAllegati.ts` 3, `interventi.ts` 3,
  `anomalie.ts` 3, `utenti.ts` 2, `timeline.ts` 2, `squadre.ts` 2, `sedi.ts` 2,
  `garanzie.ts` 2, `externalCalendars.ts` 2, `verbali.ts` 1, `ficAllegati.ts` 1)
  diventano `const x = recordOppureNotFound(store.find(…), ctx.sedeId)`.
  Guardia strutturale: nessun `throw new Error("… non trovat…")` in
  `server/routers/`.
- `Utenti.json` del backup: chiuso da §4.3.
- `fileStorageAdmin`/migrazione per azienda: §3.3.

## 9. Errori

| Situazione | Esito |
|---|---|
| upload senza tenant nel contesto (interruttore acceso) | `Error` interno, log `[fileStorage] … senza tenant` (mai un file salvato senza prefisso) |
| lettura di una chiave di un'altra azienda | `null` → `NOT_FOUND` del chiamante |
| quota superata | nessun rifiuto: evento `storage_soglia`, `tenants.storage` lo mostra |
| `state` OAuth scaduto o sconosciuto | redirect `?fic=errore` / `?gdrive=errore`, log, niente salvato |
| webhook di un numero sconosciuto | `200`, log `[whatsapp-webhook] numero sconosciuto` |
| ripristino: dump non valido / backup assente | comando in `errore` con il motivo, azienda non toccata |
| ripristino interrotto a metà | azienda resta `sospeso`, esito con gli store sostituiti; riattivazione con `pnpm tenant stato --riattiva` dopo verifica |
| worker che fallisce 3 volte per un'azienda | azienda saltata 15→120 min, evento `worker_sospeso`, le altre aziende girano |
| record assente o di un'altra sede nei router | `NOT_FOUND` generico (mai 500) |

## 10. Test

- Storage: `chiaveStorage`/`tenantDellaChiave`; `putFile` con prefisso e
  fail-closed; cintura di `getFile`/`openFileReadStream`; `deleteFileQuiet`
  con byte; `statFile` sui due driver (`local` vero, `s3` con fetch finto).
- Ledger (`tenant_storage`, Postgres vero): incrementi atomici, soglie una
  volta sola e ritorno sotto il 50 %, `ricalcolaStorage` con `statFile` sulle
  anteprime, comando `ricalcola_storage`, `tenants.storage`.
- Backup: due aziende con Drive finti; `database/` e `Utenti.json`
  contengono solo l'azienda; scheduler `perOgniTenantAttivo`; token cifrato
  al caricamento; router per azienda (la direzione dell'azienda 2 non vede
  il Drive dell'azienda 1).
- Ripristino: dry-run e `--scrivi` su Postgres vero con dump finti,
  sospensione/riattivazione, errore a metà, `--anche-tenant-1`.
- `oauth_state`: emissione, consumo unico, scadenza, tipo sbagliato; callback
  FiC e Drive dallo `state`.
- Webhook: due aziende con lo stesso segreto e numeri diversi → l'azienda
  giusta; numero sconosciuto → 200 e log.
- Breaker: sequenza 3 errori → salto, riarmo, eventi.
- `recordOppureNotFound`: cross-sede e assente → `NOT_FOUND`; guardia
  strutturale sui router.
- `fileStorageAdmin` e script con `--tenant`.
- Interruttore spento: comportamento invariato (tenant 1, chiavi legacy,
  backup di oggi). `pnpm check`, `pnpm test`, `pnpm build`; pg in sequenza.

## 11. Rilascio

Additivo tranne un punto. Al boot: `tenant_storage`, `oauth_state`,
colonna `storage_quota_bytes`; ricalcolo dello storage per ogni azienda
senza riga, dopo il listen; `backup_oauth`: token cifrato al caricamento —
**a senso unico**: un rollback al codice precedente non legge più il token
e il Drive va ricollegato (runbook). I file nuovi hanno il prefisso anche
per Ruffino Group; i vecchi restano nudi. Ordine in produzione: backup Drive
riuscito, deploy a interruttore spento, `pnpm --silent tenant verifica`,
`pnpm tenant storage --slug=ruffino-group` (ledger popolato), accensione,
prima azienda 2 in staging (crea, collega Drive, backup, ripristino dry-run),
poi in produzione.

## 12. Rischi e limiti noti

- Ledger che deriva dal vero (errori di `delete`, file scritti fuori
  contesto): il ricalcolo è la fonte di verità, su comando.
- `statFile` sulle anteprime costa una HEAD per chiave nel ricalcolo.
- Ripristino: sostituisce archivi interi; niente merge; i record nati dopo
  il backup si perdono (è il senso del ripristino, scritto nell'esito).
- Drive `drive.file`: il server legge solo i file creati dall'app; un backup
  copiato a mano su Drive non è leggibile dal comando.
- Segreto dell'app WhatsApp condiviso fra aziende con Embedded Signup:
  l'instradamento per numero lo rende irrilevante per l'isolamento, ma un
  segreto compromesso tocca tutte.
- Una replica, come sempre.

## 13. File toccati

| File | Modifica |
|---|---|
| `server/_core/fileStorage.ts` | `chiaveStorage`, `tenantDellaChiave`, tenant dal contesto in `putFile`, cintura in lettura, `head`/`statFile`, `deleteFileQuiet(key, bytes)`, `impostaContabileStorage` |
| `server/tenants/storage.ts` (nuovo) | contabile, soglie, `ricalcolaStorage` |
| `server/tenants/repository.ts` | `tenant_storage`, `oauth_state`, `storage_quota_bytes`, metodi |
| `server/tenants/servizio.ts`, `comandi.ts`, `cli.ts`, `scripts/tenant.ts` | comandi `ricalcola_storage`, `ripristina_archivi`; sottocomandi `storage`, `ripristina`; `elenco` con worker sospesi |
| `server/tenants/router.ts` | `tenants.storage` |
| `server/tenants/giri.ts` | interruttore per (worker, azienda) |
| `server/_core/driveBackup.ts`, `server/routers/backup.ts`, `server/_core/index.ts` | backup per azienda, OAuth con `oauth_state`, token cifrato, cartella per azienda, albero filtrato, callback nel contesto |
| `server/tenants/ripristino.ts` (nuovo), `server/_core/persistence.ts` (`sostituisciStore`) | validazione dei dump e sostituzione degli archivi |
| `server/routers/fattureInCloud.ts` | `state` persistito |
| `server/_core/rotteAnonime.ts`, `server/_core/index.ts` | instradamento per numero dopo la firma |
| `server/_core/permissions.ts` + 19 router | `recordOppureNotFound` |
| `server/routers/fileStorageAdmin.ts`, `server/_core/fileStorageMigrate.ts`, `scripts/migrate-documents-to-storage.ts` | per azienda |
| `server/_core/storeGlobali.test.ts`, `server/tenants/verifica.ts` + `verifica.confine.test.ts` | quattro globali; `backup_*` classificati per tenant |
| `docs/runbooks/multi-azienda.md`, `docs/storage-r2.md`, PRD §60, `handoff.md`, `CLAUDE.md` | documentazione |

## 14. Cosa viene dopo

Il piano (`docs/superpowers/plans/2026-09-08-ws3-file-integrazioni.md`)
scompone questa spec in task con test; il codice parte dopo il piano. Poi
WS4: abbonamenti, prova gratuita, quote che bloccano, budget Tars per azienda.
