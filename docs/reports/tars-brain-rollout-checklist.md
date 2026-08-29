# Tars Business Brain - Rollout Checklist

> **DOCUMENTO STORICO (annotato il 28/08/2026).** Descrive il collaudo del
> 25/08/2026 di un sistema poi rimosso per intero il 28/08/2026
> (`docs/tars-rimosso-2026-08-28.md`). I gate qui elencati non sono più
> eseguibili: test, eval, `/tars` e i flag citati non esistono più o sono
> congelati. Conservato come riferimento per il futuro agente. Le procedure
> vive su eventi e notifiche sono in `docs/runbooks/eventi-notifiche.md`.

**Data:** 25/08/2026  
**Branch:** `main`  
**Ambito:** collaudo locale e gate per attivazione progressiva per sede

## Verifica automatica

- [x] Typecheck `pnpm check`.
- [x] Suite completa: 58 file, 439 test; nessun fallimento.
- [x] Build client/server completata.
- [x] Eval registrati: 38/38 verdi, zero security failure.
- [x] Contratto integrato fra componenti: email preventivo, classificazione, indice, domanda
  assegnatario, proposta, approvazione, saga cliente/commessa, deduplica evento,
  notifica live, risoluzione ed esiti per capability.
- [x] Prompt injection esterno confinato al workflow comunicazioni.

## Matrice guasti

| Caso | Copertura | Esito |
|---|---|---|
| OpenAI offline / 503 | `smistamento.test.ts`, `openai.test.ts` | coda conservata, errore sanitizzato |
| Worker DB riavviato | `events/worker.test.ts`, `planner/runner.test.ts` | lease stale recuperato |
| SSE disconnessa | `notifications/sse.test.ts` | replay da cursore, feed persistente |
| Evento duplicato | `tarsBrain.test.ts`, `events/publish.test.ts` | una sola identita evento |
| Assegnatario altra sede | `workflows/createCustomerJob.test.ts`, policy test | nessuna scrittura |
| Approvazione doppia | `createCustomerJob.test.ts`, router Tars | stesso esito, zero duplicati |
| Commessa fallita dopo cliente | `createCustomerJob.test.ts` | cliente conservato, retry dal passo incompleto |
| Cache stale | `context/builder.test.ts`, `context/repository.test.ts` | fallback live e rebuild |
| Prompt injection | `tarsBrain.test.ts`, `planner/router.test.ts` | nessuna escalation capability |

Il test `tarsBrain.test.ts` non e ancora un E2E di processo: costruisce alcuni
passaggi in modo deterministico. Smistamento, worker reali, planner con executor
di produzione ed endpoint SSE vanno attraversati nel collaudo produzione.

## Collaudo browser locale

- [x] `/tars` carica il Command Center senza errori console nuovi.
- [x] `/notifiche` carica il feed e non presenta scroll orizzontale a 1440x900.
- [x] Tars a 1440x900: `scrollWidth === clientWidth`, contenuto e tab visibili.
- [ ] Mobile 390x844 da ripetere: il backend browser della sessione non ha
  applicato l'override viewport (ha mantenuto 1440/1280 px), quindi non viene
  dichiarato verificato.
- [ ] Perdita/ripresa SSE da provare con due sessioni reali e un'assegnazione
  produzione controllata.

## Gate produzione per sede

Compilare prima di ogni passaggio. Un riquadro rosso interrompe il rollout.

- [ ] Eventi `shadow` osservati per 7 giorni.
- [ ] Zero eventi persi; ogni dead-letter ha causa e owner.
- [ ] Notifiche `shadow` confrontate con legacy per destinatario e deduplica.
- [ ] p95 SSE <3 s e duplicati percepiti <1%.
- [ ] Audit capability revisionato, nessun accesso cross-sede/economia/delete.
- [ ] Context engine: >=95% conclusioni importanti con evidence ref.
- [ ] Planner: >=95% cliente+commessa completati senza ripartenza/duplicati.
- [ ] Ricerca: ACL, cancellazione e reader revalidation verificati su Railway.
- [ ] Autonomia: minimo 6 settimane, 100 esiti, >=98%, zero incidenti, eval
  allegato, undo e principal minimo. Whitelist oggi vuota.
- [ ] Executor planner di produzione registrati e testati; fino ad allora il
  server rifiuta `plannerMode=active`.
- [ ] Producer eventi completi per email, WhatsApp, documenti, fatture,
  pagamenti e appuntamenti; fino ad allora context active e bloccato.
- [ ] Embedding indice/query reali; fino ad allora semantic search active e
  bloccata e Tars usa reader CRM strutturati.
- [ ] Claim approvazione cross-instance su PostgreSQL; il lock corrente evita
  doppio click nello stesso processo e la saga cliente/commessa e idempotente.

## Ordine firmabile

| Passo | Stato | Data | Responsabile | Note |
|---|---|---|---|---|
| Eventi shadow | Da avviare | | | |
| Notifiche shadow | Bloccato dal gate precedente | | | |
| Notifiche active | Bloccato dal gate precedente | | | |
| SSE | Bloccato dal gate precedente | | | |
| Policy audit | Bloccato dal gate precedente | | | |
| Policy enforce | Bloccato dal gate precedente | | | |
| Context shadow | Bloccato dal gate precedente | | | Active rifiutato finche mancano producer |
| Planner shadow | Bloccato dal gate precedente | | | Active rifiutato finche mancano executor |
| Ricerca semantic shadow | Richiede embedding reali e `pgvector` verificato | | | Active rifiutato |
| Autonomia | Non qualificata; whitelist vuota | | | |

Rollback: usare i flag nell'ordine inverso; non cancellare eventi, notifiche,
piani, contesti o outcome. Runbook in `docs/runbooks/`.
