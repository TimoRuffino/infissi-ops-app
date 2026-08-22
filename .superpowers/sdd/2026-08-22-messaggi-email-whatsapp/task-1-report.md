# Task 1 Report

## Implementazione

- Estesa `segnaTutteViste` con il parametro opzionale `canale`.
- Estesa `statsComunicazioni` con il parametro opzionale `canale`.
- Nel fallback in memoria, statistiche e bulk update filtrano per canale solo quando il parametro e presente.
- In PostgreSQL, entrambe le operazioni usano una condizione nullable parametrizzata; senza canale il comportamento resta invariato.
- I contatori `email` e `whatsapp`, insieme agli altri contatori, sono calcolati sul dataset filtrato.

## Test e risultati

- RED: `pnpm test -- server/tars/mail.test.ts` — fallito come previsto nel nuovo caso: `statsComunicazioni(1, "email")` restituiva `whatsapp: 1` invece di `0`. Risultato complessivo del comando: 12 file, 148 test passati, 1 fallito.
- GREEN mirato: `pnpm test -- server/tars/mail.test.ts` — PASS, 12 file, 149 test passati.
- Suite completa pre-commit: `pnpm test` — PASS, 12 file, 149 test passati.
- Type-check: `pnpm check` — PASS.
- Build: `pnpm build` — PASS; Vite e bundle server completati.

## RED/GREEN evidence

Il RED e stato osservato prima della modifica di produzione sul test che crea una email e un WhatsApp nella stessa sede. Il GREEN e stato osservato dopo l'estensione delle firme e dei filtri, con tutte le asserzioni channel-scoped passate e senza regressioni nei test esistenti.

## File cambiati

- `server/tars/comunicazioni.ts`
- `server/tars/mail.test.ts`
- `.superpowers/sdd/2026-08-22-messaggi-email-whatsapp/task-1-report.md`

## Self-review e concerns

- Le firme restano retrocompatibili: il secondo argomento e opzionale.
- Lo scope `sedeId` resta applicato in entrambi i percorsi.
- Le comunicazioni escluse e i tombstone mantengono il comportamento precedente.
- Il test locale non esercita una connessione PostgreSQL perche `DATABASE_URL` non e presente; la query SQL e stata aggiornata simmetricamente e il type-check/build passano.

## Commit

Subject: `feat: separa statistiche comunicazioni per canale`
