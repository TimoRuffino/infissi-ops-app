# AGENTS.md - Ruffino Flow

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
pnpm storage:check
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
  a enumerarne l'id.
- Rispettare i ruoli in `server/_core/permissions.ts` e `client/src/lib/roles.ts`.
- `importoIncassato` deriva da `pagamenti[]` e non è un input aggiornabile.
- Usare gli helper di `client/src/lib/euro.ts` per ogni importo.
- Per aziende/condomini/enti, mantenere la convenzione Ragione sociale.
- Le azioni Tars sono proposte: nessuna mutation autonoma senza approvazione.

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
- Ogni automatismo che determina verità business resta deterministico: match,
  regole, state machine, permessi, importi, scadenze e gate. Il modello non
  decide né reimplementa questi vincoli.
- Ogni azione Tars passa da un servizio di dominio tipizzato e dalla policy
  server-side: mai `force`, mai mutazioni tRPC invocate dal modello, mai SQL
  generico, `executeSql`, `updateRecord` o scritture dirette. Il provider
  reale nasce solo dietro il governor; nessun percorso parallelo può aggirarlo.
- Il catalogo è fail-closed per capability, sede e flag. Un record di un'altra
  sede dà `NOT_FOUND`; L1 esplicito può agire senza una seconda conferma, gli
  effetti condivisi/esterni usano l'unica anteprima e conferma prevista dalla
  policy, L5/R4 è tecnicamente inesistente.
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
