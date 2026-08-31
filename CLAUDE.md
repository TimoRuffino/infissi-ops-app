# CLAUDE.md - Ruffino Flow

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

## Agente AI (Tars v2)

- Tars v2 ESISTE: ricostruito il 29–30/08/2026 (`server/tars/`, slice T0–T9),
  mergiato con PR #2 e attivo in produzione dal 31/08 col provider reale.
  La spec vincolante è `docs/tars/architettura-tars-v2.md`; runbook in
  `docs/runbooks/rollout-tars.md`; gate costi in `docs/tars/gate-openai.md`.
  Il vecchio agente rimosso il 28/08 è storia: `docs/tars-rimosso-2026-08-28.md`.
- Kill switch fail-closed: `FLAG_TARS*` via `server/platform/interruttori.ts`.
  Tars spento non cambia il CRM; la UI si nasconde, il router rifiuta.
- Le proposte materiali (L3) restano inerti fino all'approvazione umana; il
  modello non approva se stesso. Nessun LLM in percorsi deterministici di
  stato, permessi, importi o scadenze.
- Cost governor, budget ledger e circuit breaker non si toccano senza
  decisione registrata nella spec (§20+ prima del codice, come da prassi).
- Nessuna chiave provider nel client; nessuna chiamata al modello mentre
  l'utente digita; niente pezzi dell'agente dentro i router business.
- Non rimuovere i residui di compatibilità (`tars_*` su `comunicazioni`,
  `fic_fatture.tarsAnalizzata`, capability `tars.*`) senza matrice
  campo→consumer e decisione registrata.

## Definizione di completato

- `pnpm check`, `pnpm test` e `pnpm build` passano.
- I casi ad alto rischio hanno test mirati.
- Le modifiche UI sono controllate desktop/mobile e senza errori console.
- PRD e `handoff.md` sono aggiornati se cambia un contratto o un runbook.
- Eventuali operazioni esterne non eseguite (Railway, R2, OAuth, rotazione
  credenziali) sono dichiarate esplicitamente, senza presentarle come concluse.
