# CLAUDE.md - Wyndoor

Questa è la guida operativa per agenti AI che modificano il repository. Il CRM
è in uso reale e contiene dati di produzione: leggere il codice circostante,
mantenere la retrocompatibilità e verificare ogni modifica.

## Prima di iniziare

1. Leggere `handoff.md` e le sezioni PRD coinvolte.
2. Controllare `git status`; non sovrascrivere modifiche non proprie.
3. Cercare pattern esistenti prima di introdurre componenti o helper nuovi.
4. Non inserire mai token, password, export clienti o backup nel repository.

## Comandi

```bash
pnpm dev
pnpm check
pnpm test
pnpm build
```

Storage:

```bash
pnpm storage:check                  # sola lettura (checklist read-only)
pnpm storage:probe-write --scrivi   # sonda put/get/delete: SCRIVE _health/
pnpm storage:dry-run
pnpm storage:migrate  # solo dopo backup riuscito e dry-run verificato
```

## Architettura

- Frontend: React 19, Wouter, tRPC/React Query, Tailwind 4, shadcn/Radix.
- Backend: Express e tRPC 11.
- Persistenza prevalente: `persistedStore` su una riga JSONB di `kv_store`.
- `comunicazioni` usa una tabella PostgreSQL dedicata.
- File: `server/_core/fileStorage.ts`, driver `local` o S3-compatible.
- In sviluppo senza `DATABASE_URL` alcuni store ricadono in memoria: un test
  locale non dimostra lo stato dei dati Railway.

Quando si aggiunge un campo a uno store JSONB servono sempre tipo/schema,
default e backfill in `onLoad`. Evitare di salvare nuovi blob base64 in JSONB.

## Invarianti

- Applicare `sedeId` a ogni entità, query e mutation business.
- Un record di un'altra sede deve produrre `NOT_FOUND`, mai informazioni utili
  a enumerarne l'id. Nei router si passa da
  `recordOppureNotFound(record, ctx.sedeId)` — o da `oppureNotFound(record)`
  quando la sede non c'entra: mai `throw new Error("… non trovato")`, che
  diventa un 500 (guardia `server/routers/nonTrovato.confine.test.ts`).
- Ogni punto d'ingresso fuori richiesta (worker, scheduler, callback di
  librerie, riconciliazioni del boot, rotte anonime, script) dichiara il
  tenant con `conTenant`, `conTenantDellaSede`, `perOgniTenantAttivo` o
  `trovaNeiTenant` (`server/tenants/giri.ts`): gli store per tenant senza
  contesto falliscono. `conTenantDellaSede` è fail-closed: a interruttore
  acceso una sede sconosciuta lancia, non ripiega sul tenant 1. Ogni giro di
  fondo (scheduler, poller, worker) passa da `perOgniTenantAttivo`, che porta
  con sé l'interruttore per (worker, azienda): dopo 3 errori consecutivi
  quell'azienda viene saltata 15→120 minuti e le altre continuano.
- Una rotta Express anonima (webhook, feed pubblico, callback OAuth) ha un URL
  solo per tutta l'installazione: il proprietario si cerca con
  `trovaNeiTenant` e il lavoro gira nel suo contesto. Handler `async` sempre
  con `try/catch`: Express 4 non cattura la promise rifiutata e il processo
  cadrebbe (v. `server/_core/rotteAnonime.ts`).
- I file nuovi nascono sotto `tenant/<id>/…`: `putFile` ricava l'azienda dal
  contesto (mai un `tenantId` passato da fuori) e le chiavi nude sono legacy
  del tenant 1, leggibili solo da lui. `deleteFileQuiet(chiave, byte)` vuole i
  byte del record: senza, il ledger dello storage resta gonfio finché qualcuno
  non ricalcola.
- La tabella `abbonamenti` la scrive **solo** `server/tenants/repository.ts`,
  come il resto del control plane (guardia
  `server/tenants/confine.test.ts`), e ogni cambio di stato di un abbonamento
  passa da `server/abbonamenti/servizio.ts`: mai un `salvaAbbonamento` sparso
  nei router, negli strumenti di Tars o negli script. È il servizio che
  registra l'evento e che accende o spegne la sola lettura del tenant.
- `putFile` può **rifiutare** per quota (`ErroreQuotaStorage`,
  `PRECONDITION_FAILED`): nei siti di upload quell'errore si **rilancia
  sempre**, prima di qualunque ripiego. Il ripiego su `dataBase64` inline
  esiste per lo storage non durevole, non per la quota: usarlo qui
  aggirerebbe il blocco e il conto dei byte.
- Il tetto Tars per azienda arriva al governor come **politica iniettata**
  (`impostaPoliticaTarsAzienda`, registrata al boot da
  `server/abbonamenti/quota.ts`): `server/tars/costi/` non importa gli
  abbonamenti e non legge il control plane. Chi aggiunge un limite nuovo
  passa da lì, non da una lettura diretta dentro il ledger.
- Con `FLAG_MULTI_AZIENDA` spento **niente blocca**: nessun worker degli
  abbonamenti, nessun rifiuto per quota, nessun tetto per azienda. Le sole
  aggiunte visibili sono le tabelle e l'abbonamento omaggio del tenant 1.
- Ogni flusso OAuth nuovo emette il suo `state` in `oauth_state`
  (`emettiStateOAuth`/`consumaStateOAuth`, legati ad azienda, sede e utente):
  mai una mappa in memoria, che un deploy azzera a metà collegamento.
- `sostituisciStore` esiste solo per il ripristino degli archivi
  (`server/tenants/ripristino.ts`): nessun altro percorso rimpiazza un
  archivio intero fuori dal debounce.
- `storeDi` solo in migrazione, verifica, ripristino e Platform Admin, mai nei
  router né negli strumenti di Tars. Store globali: solo quattro — `sedi`,
  `utenti`, `platform_feature_flags`, `platform_feature_flag_audit` (dal WS3 i
  tre `backup_*` sono per azienda; guardia
  `server/_core/storeGlobali.test.ts`). Il backfill di `tenantId` non parte
  mai da uno script: gli script chiamano `bootstrapAll()` senza `backfill`
  (scrivere è un'altra cosa — `pattuiti:reset --apply` e `storage:migrate`
  scrivono). Uno script che legge o scrive uno store per tenant dichiara su
  quale azienda lavora con `--tenant=<id>` (default: 1): `pattuiti:reset`,
  `importa-clienti` e `migrate-documents-to-storage`. A interruttore spento
  `--tenant=<n>` non fallisce: il resolver risolve comunque il tenant 1.
- Rispettare i ruoli in `server/_core/permissions.ts` e `client/src/lib/roles.ts`.
- `importoIncassato` deriva da `pagamenti[]` e non è un input aggiornabile.
- Usare gli helper di `client/src/lib/euro.ts` per ogni importo.
- Per aziende/condomini/enti, mantenere la convenzione Ragione sociale.
- Tars agisce con i permessi dell'utente con cui parla: conferma umana
  solo per soldi, cancellazioni definitive ed effetti esterni (vedi
  «Agente AI»); ogni effetto di Tars è tracciato e segnalato.

## UI e UX

- Usare i token semantici di `client/src/index.css`, non hex locali.
- Plus Jakarta Sans è il font di prodotto.
- Il CRM è uno strumento operativo: layout densi, leggibili e prevedibili;
  niente sezioni marketing, card annidate o decorazioni gratuite.
- Icone lucide per azioni note, con `aria-label`/tooltip sui pulsanti solo icona.
- Target touch comodi, focus visibile e `prefers-reduced-motion` rispettato.
- Nessuna pagina deve introdurre scroll orizzontale globale. Tabelle e pannelli
  devono usare `min-w-0`, colonne responsive o una vista mobile dedicata.
- Verificare almeno 1440x900 e 390x844 nel browser prima di chiudere una modifica
  visuale.

## Storage e backup

- I file migrati vivono dietro `storageKey` con checksum SHA-256.
- Le letture devono mantenere il fallback `dataBase64` per i record legacy.
- Il backup Drive deve leggere i byte dallo storage, non assumere base64 inline.
- Oltre la quota dell'azienda e la sua tolleranza i caricamenti nuovi vengono
  rifiutati: le leve sono `--quota-gb` e `--tolleranza-storage` di `pnpm
  tenant abbonamento` (v. `docs/storage-r2.md` e il runbook multi-azienda).
- Non eseguire la migrazione reale senza un backup Drive riuscito nelle ultime
  24 ore. Procedura completa: `docs/storage-r2.md`.

## Integrazioni

- FiC usa OAuth Authorization Code e refresh automatico; il token manuale è
  solo fallback. Callback: `/api/oauth/fic/callback`.
- Drive usa OAuth utente con scope `drive.file`; callback:
  `/api/oauth/gdrive/callback`.
- I segreti cifrati dipendono da `MAIL_ENCRYPTION_KEY`.
- Non loggare access token, refresh token, password o payload cliente completi.

## Agente AI

- Tars v2 esiste in `server/tars/`: il registro storico della rimozione del
  28/08/2026 resta in `docs/tars-rimosso-2026-08-28.md`, ma non descrive lo
  stato corrente. Contratti, matrice verificata e gap sono in
  `docs/tars/architettura-tars-v2.md` e `docs/tars/matrice-azioni-tars.md`.
- **Policy «Tars libero» (mandato direzione 02/09/2026, piano
  `docs/superpowers/plans/2026-09-02-tars-libero.md`)**: Tars legge tutto,
  capisce tutto e fa tutto ciò che l'utente potrebbe fare a mano, con gli
  stessi permessi. Il modello decide e chiama gli strumenti; nessuna
  autorità derivata dal testo, nessuna potatura del catalogo per superficie
  o intento, nessuna risposta deterministica al posto del modello (le
  ambiguità arrivano come hint nel contesto). Chiede solo quando
  l'ambiguità cambia l'esito. Ogni effetto è tracciato nel ledger R1 ed
  esposto come «fatto da Tars per <utente>» (Registro e Situazione).
- Ogni automatismo che determina verità business resta deterministico e
  vive negli strumenti e nei servizi di dominio: sede, capability, state
  machine, gate, versione, idempotenza, importi, scadenze. Il modello non
  reimplementa questi vincoli: li invoca e ne rispetta l'esito.
- Ogni azione Tars passa da un servizio di dominio tipizzato: mai
  mutazioni tRPC invocate dal modello, mai SQL generico, `executeSql`,
  `updateRecord` o scritture dirette. Il provider reale nasce solo dietro il
  governor; nessun percorso parallelo può aggirarlo. Lo scavalco di un gate
  documentale è lo stesso «Procedi comunque» del board: Tars lo usa SOLO
  quando l'utente ha chiesto esplicitamente lo stato di arrivo (o di
  procedere comunque), con la capability dell'utente, registrato
  (`bypassGateDocumentale`) e dichiarato nella risposta; l'Undo non forza
  mai. Uno stato non adiacente si raggiunge un passaggio alla volta,
  ognuno annullabile.
- Il catalogo è fail-closed per capability, sede e flag. Un record di un'altra
  sede dà `NOT_FOUND`. Conferma umana (proposta con anteprima, un click)
  SOLO per pagamenti e importi, cancellazioni definitive, effetti esterni o
  su altre sedi; tutto il resto è azione diretta con Undo dove il dominio lo
  offre. L5/R4 è tecnicamente inesistente.
- Il mandato documentale T0 Tars è server/documentazione: non aggiunge né
  modifica file `client/`. Le estensioni operative successive devono prima
  aggiornare la matrice dominio→servizio→tool e i test di accettazione.
- Non rimuovere i residui di compatibilità senza una decisione registrata e
  una matrice campo→consumer: colonne `tars_*` su `comunicazioni`,
  `fic_fatture.tarsAnalizzata`, capability `tars.*` (in particolare
  `tars.manage_policy`, che governa regole già salvate), flag
  `contextEngineMode`/`plannerMode`/`semanticSearchMode`/`autonomyCapabilities`.
- `server/_core/llm.ts`, `voiceTranscription.ts` e `imageGeneration.ts` sono
  infrastruttura candidata senza consumatori attivi: tenerli, sostituirli o
  eliminarli richiede una decisione e una matrice campo→consumer. Non sono
  scorciatoie per aggirare il governor di Tars.

## Definizione di completato

- `pnpm check`, `pnpm test` e `pnpm build` passano.
- I casi ad alto rischio hanno test mirati.
- Le modifiche UI sono controllate desktop/mobile e senza errori console.
- PRD e `handoff.md` sono aggiornati se cambia un contratto o un runbook.
- Eventuali operazioni esterne non eseguite (Railway, R2, OAuth, rotazione
  credenziali) sono dichiarate esplicitamente, senza presentarle come concluse.
