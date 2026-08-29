# Runbook recovery della piattaforma

> Era `tars-recovery.md`. Riscritto il 28/08/2026 sul boot reale del CRM
> senza agente: le sezioni su OpenAI, planner, contesto e autonomia
> descrivevano codice rimosso (storia in `docs/tars-rimosso-2026-08-28.md`).

## Ordine di boot (da `server/_core/index.ts`)

1. `bootstrapAll()` carica gli store `kv_store`; senza `DATABASE_URL` tutto
   degrada in memoria (solo sviluppo). Uno store che non riesce a caricare
   resta `UNLOADED` e **i suoi save sono bloccati** finché la background
   recovery (30 tentativi × 5 s) non legge il dato: mai riavviare in loop
   sperando che "si sistemi", guardare i log `[persistence]`.
2. Riconciliazione timeline→board (idempotente, solo in avanti).
3. `ensureSchema` di: azioni operative, eventi business, policy, notifiche,
   promemoria. In produzione un fallimento qui deve fermare l'avvio.
4. Worker: scheduler Centro Azioni (60 s), worker promemoria (15 s), bridge
   SSE, worker eventi, backup Drive (00:00 Europe/Rome), sync FiC (6 h se
   abilitato), poller IMAP (5 min).

## Guasti tipici

- **DNS/DB freddo su Railway** (`EAI_AGAIN` nei primi secondi): la
  persistenza ritenta da sola con backoff; nessun intervento se i log
  passano a `loaded`.
- **Store non caricato dopo la recovery**: NON scrivere sul database da
  fuori. Fermare il servizio, verificare la riga `kv_store` interessata,
  ripartire. Con l'istanza viva qualsiasi scrittura esterna viene
  sovrascritta al primo `save()` (incidente del 26/08/2026).
- **Eventi fermi**: `diagnostica.snapshot` → `events.consumers.pending` e
  `deadLetter`; vedere `docs/runbooks/eventi-notifiche.md`.
- **Coda comunicazioni**: l'ingest è idempotente per
  `(casella_id, canale, message_id)`; un import ripetuto non duplica.
- **Storage file**: nessuna migrazione reale senza backup Drive riuscito
  nelle 24 ore precedenti (`docs/storage-r2.md`). L'assenza di `pgvector`
  non autorizza installazioni di estensioni.

## Verifica finale

`pnpm check`, `pnpm test`, `pnpm build`; poi `diagnostica.snapshot` e, su
Railway, log dei worker e conteggi PostgreSQL reali.
