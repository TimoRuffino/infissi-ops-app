# Tars Cervello Aziendale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trasformare Tars in un motore operativo verificabile che comprende il contesto aziendale, porta a termine obiettivi composti dietro approvazione e coordina assegnazioni, notifiche e priorita in tempo reale.

**Architecture:** Un registro eventi PostgreSQL collega i domini senza rendere Tars un secondo database. Notifiche, memoria contestuale, situazioni ed eval sono consumer indipendenti e idempotenti; un policy engine capability-based autorizza ogni lettura e proposta. Tars usa intent router, planner persistente, workflow tipizzati, fascicoli con evidenze e cache versionate, mantenendo tutte le mutation business dietro approvazione.

**Tech Stack:** TypeScript 5.9, React 19, Express 4, tRPC 11, PostgreSQL tramite `postgres.js`/`kvSql`, persistedStore JSONB legacy, OpenAI Responses API, Zod 4, Vitest, Server-Sent Events, Service Worker e Web Push standard.

**Spec:** `docs/superpowers/specs/2026-08-25-tars-cervello-azienda-design.md`

## Global Constraints

- Tars propone e non esegue mutation business senza approvazione.
- Nessun pagamento, invio, eliminazione, cambio permesso o cambio stato diventa autonomo.
- Ogni evento, query, cache, contesto, notifica e decisione policy e sempre `sedeId`-scoped.
- Un record di altra sede restituisce `NOT_FOUND`, mai informazioni utili a enumerarne l'id.
- Gli store JSONB hanno consegna eventi at-least-once con deduplica e reconciler, non atomicita fittizia.
- I payload evento, log e push non contengono corpi completi, allegati, base64, token o segreti.
- Ogni conclusione importante di Tars espone fatti ed evidenze risolvibili con i permessi correnti.
- Matching e post-condizioni deterministiche precedono sempre il modello.
- Una proposta non viene ricreata se la stessa chiave canonica e gia pendente, gestita o rifiutata.
- Le cache cross-run includono sede, scope, versione entita e versione policy e vengono invalidate da eventi.
- Ogni sottosistema parte in `off` o `shadow`, misura il delta e possiede rollback tramite feature flag.
- Le modifiche a prompt, tool, caching, retrieval o planner aggiornano gli eval Tars.
- Le modifiche visuali vanno verificate a 1440x900 e 390x844, senza scroll orizzontale o errori console.
- Prima di ogni commit eseguire il test mirato; prima di ogni milestone eseguire `pnpm check`, `pnpm test` e `pnpm build`.

## Sequenza Di Rilascio

1. **Fondamenta:** baseline eval, feature flag e registro eventi in shadow.
2. **CRM dinamico:** notifiche persistenti, assegnazioni affidabili e SSE.
3. **Autorizzazioni:** capability in audit, poi enforcement progressivo.
4. **Memoria:** fascicoli incrementali, evidenze e cache cross-run.
5. **Ragionamento:** intent router, piani persistenti e workflow composti.
6. **Maturita:** ricerca semantica, eval continui e autonomia reversibile qualificata.

Ogni milestone e rilasciabile e reversibile da sola. Non iniziare una milestone se il gate della precedente non e verde in produzione.

---

### Task 1: Congelare La Baseline Di Qualita E Costo

**Files:**
- Create: `server/tars/evals/types.ts`
- Create: `server/tars/evals/cases/core.json`
- Create: `server/tars/evals/fixtures.ts`
- Create: `server/tars/evals/fixtures.test.ts`
- Modify: `server/tars/stores.ts`

**Interfaces:**
- Consumes: `Esecuzione` e `Proposta` da `server/tars/stores.ts`.
- Produces: `EvalCase`, `EvalExpected`, `EvalObserved` e un corpus minimizzato versionato.

- [x] **Step 1: Scrivere il test fallente sul caricamento del corpus**

```ts
it("carica casi con ground truth e senza dati cliente reali", () => {
  const cases = loadEvalCases();
  expect(cases.length).toBeGreaterThanOrEqual(24);
  expect(cases.every(item => item.version === 1)).toBe(true);
  expect(JSON.stringify(cases)).not.toMatch(/@ruffinogroup|3391987805/i);
});
```

- [x] **Step 2: Eseguire il test e osservare l'import mancante**

Run: `pnpm test -- server/tars/evals/fixtures.test.ts`

Expected: FAIL per `loadEvalCases` non definita.

- [x] **Step 3: Definire il contratto eval**

```ts
export type EvalCase = {
  id: string;
  version: 1;
  family: "email_classification" | "whatsapp" | "correlation" |
    "create_customer_job" | "assignment" | "invoice" | "document" |
    "ticket" | "stalled_job" | "no_action" | "security";
  trigger: string;
  input: Record<string, unknown>;
  expected: {
    intent?: string;
    toolNames: string[];
    forbiddenToolNames: string[];
    proposalTypes: string[];
    requiresEvidence: boolean;
    finalState?: string;
  };
  tags: string[];
};
```

- [x] **Step 4: Popolare 24 casi sintetici rappresentativi**

Includere almeno due casi per famiglia critica, un caso cross-sede, un prompt injection in email, una richiesta cliente+commessa, un duplicato e una `nessuna_azione` motivata. Usare nomi, telefoni, importi e codici inventati.

- [x] **Step 5: Aggiungere metadati di versione alle esecuzioni**

Estendere `Esecuzione` e relativo backfill con:

```ts
promptVersion: string;
toolRegistryVersion: string;
workflowVersion: string | null;
policyVersion: string;
```

- [x] **Step 6: Verificare e committare**

Run: `pnpm test -- server/tars/evals/fixtures.test.ts && pnpm check`

```bash
git add server/tars/evals server/tars/stores.ts
git commit -m "test(tars): add representative eval corpus"
```

### Task 2: Costruire Runner E Grader Riproducibili

**Files:**
- Create: `server/tars/evals/graders.ts`
- Create: `server/tars/evals/runner.ts`
- Create: `server/tars/evals/runner.test.ts`
- Create: `scripts/run-tars-evals.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `EvalCase` da Task 1 e una funzione iniettata `execute(case): Promise<EvalObserved>`.
- Produces: `runEvalSuite(options): Promise<EvalReport>` e script `pnpm tars:eval`.

- [x] **Step 1: Scrivere test fallenti sui grader deterministici**

```ts
expect(gradeToolSet(["a", "b"], ["b", "a"], ["delete"])).toEqual({
  passed: true,
  missing: [],
  forbidden: [],
  unexpected: [],
});
expect(gradeEvidence({ importantClaims: 4, citedClaims: 3 }).score).toBe(0.75);
```

- [x] **Step 2: Implementare grader esatti senza chiamate AI**

Esportare `gradeToolSet`, `gradeProposalTypes`, `gradeEvidence`, `gradeFinalState`, `aggregateEvalReport`. Un fallimento di sicurezza rende l'intero report rosso indipendentemente dalla media.

- [x] **Step 3: Scrivere e implementare il runner con due modalita**

```ts
export async function runEvalSuite(options: {
  cases: EvalCase[];
  mode: "recorded" | "live";
  execute: (item: EvalCase) => Promise<EvalObserved>;
  concurrency?: number;
}): Promise<EvalReport>;
```

`recorded` e deterministico e adatto alla CI. `live` richiede `OPENAI_API_KEY`, limita concorrenza a 2 e salva soltanto metriche e output sanitizzati in una directory ignorata da Git.

- [x] **Step 4: Aggiungere comandi espliciti**

```json
"tars:eval": "tsx scripts/run-tars-evals.ts --mode=recorded",
"tars:eval:live": "tsx scripts/run-tars-evals.ts --mode=live"
```

- [x] **Step 5: Verificare e committare**

Run: `pnpm test -- server/tars/evals/runner.test.ts && pnpm tars:eval`

```bash
git add server/tars/evals scripts/run-tars-evals.ts package.json
git commit -m "feat(tars): add repeatable eval runner"
```

### Task 3: Introdurre Feature Flag Per Sede

**Files:**
- Create: `server/platform/featureFlags.ts`
- Create: `server/platform/featureFlags.test.ts`
- Modify: `server/routers/tars.ts`

**Interfaces:**
- Produces: `getFeatureFlags(sedeId)`, `setFeatureFlags(sedeId, patch)` e `FeatureFlags`.

- [x] **Step 1: Scrivere test fallenti su default, patch e isolamento sede**

```ts
expect(getFeatureFlags(1).eventBusMode).toBe("off");
setFeatureFlags(1, { eventBusMode: "shadow" });
expect(getFeatureFlags(1).eventBusMode).toBe("shadow");
expect(getFeatureFlags(2).eventBusMode).toBe("off");
```

- [x] **Step 2: Implementare store con backfill completo**

```ts
export type FeatureFlags = {
  eventBusMode: "off" | "shadow" | "active";
  notificationMode: "legacy" | "shadow" | "active";
  realtimeNotifications: boolean;
  webPushEnabled: boolean;
  policyMode: "legacy" | "audit" | "enforce";
  contextEngineMode: "off" | "shadow" | "active";
  plannerMode: "off" | "shadow" | "active";
  semanticSearchMode: "off" | "shadow" | "active";
  autonomyCapabilities: string[];
};
```

- [x] **Step 3: Esporre lettura e mutation direzione-only**

Aggiungere a `tars.config` una sezione `platformFlags`; validare array autonomia contro il registry capability e conservare audit con utente e timestamp.

- [x] **Step 4: Verificare e committare**

Run: `pnpm test -- server/platform/featureFlags.test.ts server/tars/tars.test.ts`

```bash
git add server/platform/featureFlags.ts server/platform/featureFlags.test.ts server/routers/tars.ts
git commit -m "feat: add staged platform feature flags"
```

### Task 4: Creare Il Registro Eventi Aziendali

**Files:**
- Create: `server/events/types.ts`
- Create: `server/events/repository.ts`
- Create: `server/events/repository.test.ts`

**Interfaces:**
- Produces: `BusinessEventRepository`, `publish`, `claim`, `complete`, `fail`, `recoverStale`.

- [x] **Step 1: Scrivere test fallenti per deduplica e consumer indipendenti**

```ts
const first = await repo.publish(eventDraft);
const duplicate = await repo.publish(eventDraft);
expect(first.inserted).toBe(true);
expect(duplicate).toEqual({ id: first.id, inserted: false });
expect(await repo.claim({ consumerName: "notifications", workerId: "a", limit: 10, now })).toHaveLength(1);
expect(await repo.claim({ consumerName: "context", workerId: "b", limit: 10, now })).toHaveLength(1);
```

- [x] **Step 2: Definire tipi chiusi e payload versionato**

```ts
export type BusinessEventDraft = {
  sedeId: number;
  eventType: string;
  source: { type: string; id: string; version?: string };
  actorUserId: number | null;
  subjectRefs: Array<{ type: string; id: string }>;
  recipientHints: number[];
  payload: { version: 1; [key: string]: unknown };
  dedupeKey: string;
  occurredAt: Date;
};
```

- [x] **Step 3: Implementare fallback memoria e PostgreSQL**

`ensureSchema()` crea `business_events` e `business_event_processing` come da spec. Il claim PostgreSQL inserisce le righe mancanti per il consumer, poi usa transazione e `FOR UPDATE SKIP LOCKED`; errori persistono solo `last_error_code` sanitizzato.

- [x] **Step 4: Coprire lease stale e dead-letter**

Dopo 5 tentativi lo stato diventa `dead_letter`; `recoverStale(cutoff)` rimette `processing` a `pending` senza modificare consumer gia completati.

- [x] **Step 5: Verificare e committare**

Run: `pnpm test -- server/events/repository.test.ts`

```bash
git add server/events
git commit -m "feat: add durable business event ledger"
```

### Task 5: Implementare Registry E Worker Multi-Istanza

**Files:**
- Create: `server/events/registry.ts`
- Create: `server/events/worker.ts`
- Create: `server/events/worker.test.ts`
- Modify: `server/_core/index.ts`

**Interfaces:**
- Consumes: `BusinessEventRepository` da Task 4.
- Produces: `registerEventConsumer`, `runEventWorkerOnce`, `startEventWorkers`.

- [x] **Step 1: Scrivere test fallenti su isolamento, retry e stop**

Un consumer che lancia non deve impedire il completamento di un altro; lo stop deve attendere i claim in corso; due worker non devono elaborare la stessa coppia evento/consumer.

- [x] **Step 2: Definire il contratto consumer**

```ts
export type BusinessEventConsumer = {
  name: string;
  eventTypes: readonly string[] | "*";
  handle(event: BusinessEvent): Promise<void>;
};
export function registerEventConsumer(consumer: BusinessEventConsumer): void;
```

- [x] **Step 3: Implementare ciclo con lease e backoff**

`runEventWorkerOnce` reclama massimo 25 eventi, usa concorrenza 4, marca complete o fail con backoff `min(15m, 2^attempt * 5s)`. `startEventWorkers` non parte se `eventBusMode=off` per tutte le sedi.

- [x] **Step 4: Inizializzare schema e worker al boot**

In `server/_core/index.ts`, dopo `bootstrapAll`, eseguire `ensureSchema`; in produzione l'errore blocca solo l'attivazione `active`, mentre `shadow` registra diagnostica e lascia disponibile il CRM.

- [x] **Step 5: Verificare e committare**

Run: `pnpm test -- server/events/worker.test.ts && pnpm check`

```bash
git add server/events server/_core/index.ts
git commit -m "feat: process business events safely"
```

### Task 6: Pubblicare Eventi Di Assegnazione E Mutazione

**Files:**
- Create: `server/events/publish.ts`
- Create: `server/events/reconcileAssignments.ts`
- Create: `server/events/publish.test.ts`
- Modify: `server/routers/clienti.ts`
- Modify: `server/routers/commesse.ts`
- Modify: `server/routers/ticket.ts`
- Modify: `server/routers/interventi.ts`
- Modify: `server/actionCenter/service.ts`

**Interfaces:**
- Produces: `publishDomainEvent(draft): Promise<PublishOutcome>` e `reconcileAssignmentEvents(sedeId)`.

- [x] **Step 1: Scrivere test fallenti sugli eventi materiali**

Verificare `cliente.assigned`, `commessa.assigned`, `ticket.assigned`, `intervento.assigned` e `azione_operativa.assigned`; un update senza cambio assegnatario non pubblica l'evento.

- [x] **Step 2: Implementare helper non bloccante e osservabile**

```ts
export async function publishDomainEvent(draft: BusinessEventDraft): Promise<
  { status: "inserted" | "duplicate" | "disabled" | "failed"; eventId: number | null }
>;
```

`failed` registra codice e metrica, non payload. In `shadow` salva l'evento ma i consumer con effetti restano in confronto.

- [x] **Step 3: Rendere async le mutation coinvolte e usare dedupe stabile**

La chiave usa entita, id, versione `updatedAt` e nuovo assegnatario, per esempio `commessa:42:assigned:7:2026-08-25T10:00:00.000Z`. Il payload include solo precedente, nuovo, link e motivo normalizzato.

- [x] **Step 4: Implementare reconciler per gli store JSONB**

Il reconciler conserva un fingerprint per `(sede, entityType, entityId)` e ripubblica soltanto cambi materiali sfuggiti al producer. Esporre `--sede`, `--limit`, `--dry-run` in `scripts/reconcile-business-events.ts`.

- [x] **Step 5: Verificare e committare**

Run: `pnpm test -- server/events/publish.test.ts server/routers/notifiche.test.ts`

```bash
git add server/events scripts/reconcile-business-events.ts server/routers/clienti.ts server/routers/commesse.ts server/routers/ticket.ts server/routers/interventi.ts server/actionCenter/service.ts
git commit -m "feat: emit assignment business events"
```

### Task 7: Creare Il Repository Delle Notifiche Persistenti

**Files:**
- Create: `server/notifications/types.ts`
- Create: `server/notifications/repository.ts`
- Create: `server/notifications/repository.test.ts`

**Interfaces:**
- Produces: `NotificationRepository` con `upsert`, `list`, `markSeen`, `markRead`, `resolve`, `countUnread`, `recordDelivery`.

- [x] **Step 1: Scrivere test fallenti su stato e canonical key**

```ts
expect((await repo.upsert(draft)).created).toBe(true);
expect((await repo.upsert(draft)).created).toBe(false);
await repo.markRead({ sedeId: 1, recipientUserId: 7, ids: [1], now });
expect((await repo.findById(1, 7, 1))?.status).toBe("read");
expect((await repo.findById(1, 8, 1))).toBeNull();
```

- [x] **Step 2: Definire stati separati**

```ts
export type NotificationStatus = "unread" | "seen" | "read" | "acted" | "resolved" | "expired";
export type NotificationPriority = "critical" | "high" | "normal" | "low";
```

- [x] **Step 3: Implementare tabelle e indici**

Creare `notifications`, `notification_deliveries`, `push_subscriptions`, `notification_preferences`; unique `(sede_id, recipient_user_id, canonical_key)` e indici per coda, gruppo e fallback.

- [x] **Step 4: Verificare e committare**

Run: `pnpm test -- server/notifications/repository.test.ts`

```bash
git add server/notifications
git commit -m "feat: add persistent notification repository"
```

### Task 8: Proiettare Eventi In Notifiche Personali

**Files:**
- Create: `server/notifications/projector.ts`
- Create: `server/notifications/projector.test.ts`
- Modify: `server/events/registry.ts`

**Interfaces:**
- Consumes: eventi Task 6 e `NotificationRepository` Task 7.
- Produces: consumer `notification-projector-v1`.

- [x] **Step 1: Scrivere test fallenti per assegnazione, revoca e grouping**

Verificare destinatario nuovo, risoluzione notifica del precedente assegnatario, nessuna self-notification salvo richiesta esplicita, grouping dei messaggi nello stesso thread e zero doppioni su retry.

- [x] **Step 2: Implementare regole deterministiche**

```ts
export function projectNotification(event: BusinessEvent): NotificationDraft[];
```

La funzione pura restituisce zero o piu draft; titoli e link derivano dal tipo evento. Nessuna chiamata OpenAI decide se un'assegnazione deve essere consegnata.

- [x] **Step 3: Registrare il consumer**

Il consumer valida che il destinatario sia attivo e condivida la sede tramite `getUtentiStore`; utenti non validi generano diagnostica `recipient_invalid`, non notifiche orfane.

- [x] **Step 4: Verificare e committare**

Run: `pnpm test -- server/notifications/projector.test.ts server/events/worker.test.ts`

```bash
git add server/notifications server/events/registry.ts
git commit -m "feat: project assignments into personal notifications"
```

### Task 9: Migrare L'API Notifiche Senza Big Bang

**Files:**
- Modify: `server/routers/notifiche.ts`
- Modify: `server/routers/notifiche.test.ts`
- Create: `scripts/backfill-notifications.ts`

**Interfaces:**
- Produces: `notifiche.feed`, `notifiche.unreadCount`, `notifiche.markSeen`, `notifiche.markRead`, `notifiche.resolve`, `notifiche.preferences`.

- [x] **Step 1: Scrivere test fallenti su legacy, shadow e active**

In `legacy` le procedure correnti restano invariate; in `shadow` si confrontano conteggi senza mostrare doppioni; in `active` il feed usa il repository persistente e Action Center resta separato.

- [x] **Step 2: Implementare input sede-safe**

Le mutation non accettano `recipientUserId`; lo ricavano da `ctx.user.id`. `feed` usa cursore `(createdAt,id)` e limite massimo 50.

- [x] **Step 3: Implementare backfill dry-run**

Il backfill crea solo responsabilita ancora materialmente aperte, non converte `notifiche_read` in `resolved`, e supporta `--sede`, `--limit`, `--dry-run`.

- [x] **Step 4: Verificare e committare**

Run: `pnpm test -- server/routers/notifiche.test.ts`

```bash
git add server/routers/notifiche.ts server/routers/notifiche.test.ts scripts/backfill-notifications.ts
git commit -m "feat: expose staged persistent notifications"
```

### Task 10: Consegnare Notifiche In Tempo Reale Con SSE

**Files:**
- Create: `server/notifications/sse.ts`
- Create: `server/notifications/sse.test.ts`
- Modify: `server/_core/index.ts`
- Create: `client/src/lib/notificationStream.ts`
- Create: `client/src/lib/notificationStream.test.ts`
- Create: `client/src/hooks/useNotificationStream.ts`
- Modify: `client/src/components/DashboardLayout.tsx`

**Interfaces:**
- Produces: endpoint `GET /api/events/notifications`, `notificationHub.publish(userId,sedeId,cursor)` e hook `useNotificationStream()`.

- [x] **Step 1: Scrivere test server fallenti su autenticazione e replay**

Richiesta anonima: 401. Cookie valido: solo eventi del proprio utente e sede. `Last-Event-ID` non puo recuperare notifiche di altri destinatari.

- [x] **Step 2: Implementare route autenticata**

Riutilizzare `createContext({ req, res })`; impostare `text/event-stream`, heartbeat 25 secondi, `Cache-Control: no-cache, no-transform`, cleanup su `close`. PostgreSQL `LISTEN/NOTIFY` sveglia le istanze ma il replay legge sempre il repository.

- [x] **Step 3: Scrivere e implementare hook client**

```ts
export function useNotificationStream(): {
  state: "disabled" | "connecting" | "open" | "fallback";
  lastEventId: string | null;
};
```

Estrarre in `client/src/lib/notificationStream.ts` l'elezione del leader,
il parsing degli eventi e il backoff, cosi che siano testabili in ambiente
Node. Il leader multi-tab usa `BroadcastChannel("ruffino-notifications")`; in
fallback ogni tab usa EventSource. Ogni evento invalida solo `notifiche.feed`,
`unreadCount` e, se indicato, la query dell'entita.

- [x] **Step 4: Montare una sola volta nel layout**

Il hook parte solo con utente autenticato e flag `realtimeNotifications`; dopo tre errori usa polling a 30 secondi finche SSE si riapre.

- [x] **Step 5: Verificare e committare**

Run: `pnpm test -- server/notifications/sse.test.ts client/src/lib/notificationStream.test.ts && pnpm check`

```bash
git add server/notifications/sse.ts server/notifications/sse.test.ts server/_core/index.ts client/src/lib/notificationStream.ts client/src/lib/notificationStream.test.ts client/src/hooks/useNotificationStream.ts client/src/components/DashboardLayout.tsx
git commit -m "feat: stream notifications in real time"
```

### Task 11: Ridisegnare Campanella E Centro Notifiche

**Files:**
- Modify: `client/src/components/NotificheDropdown.tsx`
- Create: `client/src/components/notifications/NotificationItem.tsx`
- Create: `client/src/components/notifications/NotificationGroup.tsx`
- Create: `client/src/pages/Notifiche.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/index.css`

**Interfaces:**
- Consumes: API Task 9 e stream Task 10.
- Produces: campanella compatta e pagina `/notifiche` con viste `Per me`, `Critiche`, `Risolte`.

- [x] **Step 1: Definire stati UI e casi di interazione**

Preparare fixture per loading, vuoto, offline, 1 notifica, gruppo da 8, critica scaduta e notifica gia risolta. La campanella mostra responsabilita personali, non duplica il Centro Azioni.

- [x] **Step 2: Implementare item e gruppo accessibili**

Icona Lucide per tipo, priorita espressa anche da testo, azioni `Apri`, `Segna letta`, `Risolvi`; target minimi 40px; focus visibile; niente card annidate.

- [x] **Step 3: Implementare la pagina completa**

La pagina usa lista densa, filtri, raggruppamento e pannello dettaglio desktop; su mobile il dettaglio e una route/pagina, senza pannello laterale che causi overflow.

- [x] **Step 4: Verificare visualmente**

Avviare `pnpm dev`; controllare 1440x900 e 390x844 con browser, tastiera, console e `prefers-reduced-motion`. Correggere overflow prima del commit.

- [x] **Step 5: Verificare e committare**

Run: `pnpm check && pnpm build`

```bash
git add client/src/components/NotificheDropdown.tsx client/src/components/notifications client/src/pages/Notifiche.tsx client/src/App.tsx client/src/index.css
git commit -m "feat: redesign personal notification center"
```

### Task 12: Aggiungere Web Push E Fallback Critico

**Files:**
- Create: `server/notifications/push.ts`
- Create: `server/notifications/deliveryWorker.ts`
- Create: `server/notifications/deliveryWorker.test.ts`
- Create: `client/public/notification-sw.js`
- Create: `client/src/components/notifications/PushPreference.tsx`
- Modify: `server/routers/notifiche.ts`
- Modify: `client/src/pages/Notifiche.tsx`

**Interfaces:**
- Produces: subscribe/unsubscribe, delivery queue e preferenze per canale.

- [x] **Step 1: Scrivere test fallenti su payload privacy-safe e fallback unico**

Il payload push contiene `notificationId`, `title`, `genericBody`, `link`; non contiene nome cliente, telefono, importo o testo messaggio. Lo stesso fallback email non viene accodato due volte.

- [x] **Step 2: Implementare Web Push dietro flag**

Installare `web-push` e `@types/web-push` con `pnpm add web-push` e
`pnpm add -D @types/web-push`. Usare VAPID da env, subscription cifrata o
minimizzata ed endpoint invalido disattivato su 404/410.

- [x] **Step 3: Implementare opt-in contestuale**

Mostrare la richiesta soltanto dopo un gesto utente nella pagina notifiche. Se browser o sistema non supportano push, mostrare lo stato reale senza loop di prompt.

- [x] **Step 4: Implementare fallback come adapter disabilitato**

```ts
export type CriticalFallbackSender = {
  send(input: { userId: number; notificationId: number }): Promise<"sent" | "skipped">;
};
```

Finche manca un provider outbound configurato, l'adapter ritorna `skipped` con motivo `provider_not_configured`; non usare IMAP per inviare.

- [x] **Step 5: Verificare e committare**

Run: `pnpm test -- server/notifications/deliveryWorker.test.ts && pnpm check && pnpm build`

```bash
git add package.json pnpm-lock.yaml server/notifications client/public/notification-sw.js client/src/components/notifications/PushPreference.tsx server/routers/notifiche.ts client/src/pages/Notifiche.tsx
git commit -m "feat: add opt-in notification delivery channels"
```

### Task 13: Definire Capability E Policy Decision

**Files:**
- Create: `server/authz/capabilities.ts`
- Create: `server/authz/policy.ts`
- Create: `server/authz/policy.test.ts`
- Modify: `server/_core/permissions.ts`

**Interfaces:**
- Produces: `Capability`, `PolicyContext`, `PolicyDecision`, `can`, `requireCapability`.

- [x] **Step 1: Scrivere test tabellari fallenti**

Copertura minima: create cliente/commessa/ticket, update del proprietario, assign, economia, delete, cambio stato, cross-sede, utente inattivo, direzione e amministrazione.

- [x] **Step 2: Definire registry e default ruolo**

```ts
export const CAPABILITIES = ["cliente.read", "cliente.create", "cliente.update_operational", "cliente.assign", "cliente.archive", "cliente.delete", "commessa.read", "commessa.create", "commessa.update_operational", "commessa.assign", "commessa.change_state", "commessa.manage_documents", "ticket.create", "ticket.assign", "ticket.manage", "intervento.plan", "intervento.assign", "pagamento.read", "pagamento.record", "economia.read", "tars.use", "tars.approve_low_risk", "tars.approve_high_risk", "tars.manage_policy"] as const;
export type Capability = typeof CAPABILITIES[number];
```

- [x] **Step 3: Implementare decisione pura**

```ts
export function can(input: {
  user: AnyUser;
  capability: Capability;
  resource?: PolicyResource | null;
  activeSedeId: number;
  overrides?: CapabilityOverride[];
  now?: Date;
}): PolicyDecision;
```

Cross-sede restituisce decisione `not_found`; campi economici non ereditano capability operative; deleghe scadute vengono ignorate.

- [x] **Step 4: Mantenere wrapper legacy**

`requireDirezione`, `requireDirezioneOAmministrazione` e `requireOwnershipOrDirezione` restano disponibili durante la migrazione e delegano al nuovo motore solo quando il flag e attivo.

- [x] **Step 5: Verificare e committare**

Run: `pnpm test -- server/authz/policy.test.ts server/routers/notifiche.test.ts`

```bash
git add server/authz server/_core/permissions.ts
git commit -m "feat: add capability policy engine"
```

### Task 14: Persistenza Override, Deleghe E Audit-Only

**Files:**
- Create: `server/authz/repository.ts`
- Create: `server/authz/repository.test.ts`
- Create: `server/authz/audit.ts`
- Create: `server/authz/audit.test.ts`
- Modify: `server/_core/index.ts`

**Interfaces:**
- Produces: override/deleghe per utente e `comparePolicyDecision`.

- [x] **Step 1: Scrivere test fallenti su scadenza, sede e ultimo direzione**

Un override di sede 1 non vale in sede 2; una delega scaduta non vale; nessuna modifica puo rimuovere l'ultima capacita amministrativa da tutti gli utenti direzione attivi.

- [x] **Step 2: Creare schema dedicato**

Tabelle `capability_overrides`, `capability_delegations`, `policy_audit_diffs`, `policy_change_events`; unique e indici includono sempre `sede_id`.

- [x] **Step 3: Implementare audit senza payload business**

```ts
comparePolicyDecision({ endpoint, legacyAllowed, proposed, userId, sedeId, resourceType }): Promise<void>;
```

Salvare endpoint, capability, esiti e codici, mai l'oggetto risorsa.

- [x] **Step 4: Inizializzare schema al boot e report diff**

Esporre script `scripts/report-policy-diff.ts --sede=1 --days=7`; nessun enforcement finche diff non e revisionato.

- [x] **Step 5: Verificare e committare**

Run: `pnpm test -- server/authz/repository.test.ts server/authz/audit.test.ts`

```bash
git add server/authz server/_core/index.ts scripts/report-policy-diff.ts
git commit -m "feat: audit capability decisions before enforcement"
```

### Task 15: Applicare Capability Ai Flussi Operativi Prioritari

**Files:**
- Modify: `server/routers/clienti.ts`
- Modify: `server/routers/commesse.ts`
- Modify: `server/routers/ticket.ts`
- Modify: `server/routers/interventi.ts`
- Modify: `server/actionCenter/service.ts`
- Create: `server/authz/coreRouters.test.ts`

**Interfaces:**
- Consumes: `requireCapability` e policy audit.
- Produces: autorizzazione coerente per create/update/assign/archive/delete sui domini prioritari.

- [x] **Step 1: Scrivere caller test fallenti per la matrice approvata**

Verificare che un commerciale possa creare e aggiornare record propri, assegnare a utente compatibile della sede quando autorizzato e non possa vedere economia o cancellare definitivamente. Ripetere cross-sede con `NOT_FOUND`.

- [x] **Step 2: Estrarre validation dell'assegnatario**

```ts
export function requireAssignableUser(input: {
  assigneeUserId: number | null;
  sedeId: number;
  requiredCapability?: Capability;
}): void;
```

Rifiutare utente inattivo o non appartenente alla sede prima della mutation e prima dell'evento.

- [x] **Step 3: Integrare modalita `legacy`, `audit`, `enforce`**

In audit eseguire decisione legacy e nuova ma applicare legacy; in enforce applicare capability. Ogni endpoint dichiara una capability esplicita, senza fallback generico.

- [x] **Step 4: Verificare e committare**

Run: `pnpm test -- server/authz/coreRouters.test.ts server/routers/notifiche.test.ts`

```bash
git add server/routers/clienti.ts server/routers/commesse.ts server/routers/ticket.ts server/routers/interventi.ts server/actionCenter/service.ts server/authz/coreRouters.test.ts
git commit -m "feat: enforce capabilities on core workflows"
```

### Task 16: Rendere Amministrabili Permessi E Deleghe

**Files:**
- Modify: `server/routers/utenti.ts`
- Modify: `server/routers.ts`
- Create: `server/routers/permessi.ts`
- Create: `server/routers/permessi.test.ts`
- Modify: `client/src/pages/UtentiList.tsx`
- Create: `client/src/components/users/CapabilityMatrix.tsx`
- Create: `client/src/components/users/DelegationDialog.tsx`

**Interfaces:**
- Produces: `permessi.preview`, `permessi.updateOverride`, `permessi.createDelegation`, `permessi.revokeDelegation`, `permessi.auditSummary`.

- [x] **Step 1: Correggere prima lo scope della lista utenti**

Scrivere test che `utenti.list/byId/stats` mostrino soltanto utenti con almeno una sede condivisa, salvo direzione con scope esplicitamente amministrativo. Password e hash restano esclusi.

- [x] **Step 2: Implementare router direzione-only**

Ogni modifica richiede motivazione 10-500 caratteri; delega richiede inizio/fine; anteprima restituisce capability ereditate, override e motivazione della decisione.

- [x] **Step 3: Ridisegnare la pagina utenti**

Usare tabs `Profilo`, `Accessi`, `Deleghe`, `Storico`; matrice compatta con checkbox per override e badge per eredita. Non mostrare controlli che l'operatore non puo usare.

- [x] **Step 4: Verificare visualmente e committare**

Run: `pnpm test -- server/routers/permessi.test.ts && pnpm check && pnpm build`

```bash
git add server/routers/utenti.ts server/routers/permessi.ts server/routers/permessi.test.ts server/routers.ts client/src/pages/UtentiList.tsx client/src/components/users
git commit -m "feat: manage capabilities and delegations"
```

### Task 17: Creare Store Di Memoria Operativa E Fatti

**Files:**
- Create: `server/tars/context/types.ts`
- Create: `server/tars/context/repository.ts`
- Create: `server/tars/context/repository.test.ts`

**Interfaces:**
- Produces: eventi di rebuild, fascicoli per entita/scope, fatti ed evidenze versionate.

- [x] **Step 1: Scrivere test fallenti su scope, fingerprint e stale**

La stessa commessa ha contesti distinti `operativo`, `amministrazione`, `direzione`; un fingerprint invariato non crea nuova versione; un contesto scaduto resta leggibile come stale ma non definitivo.

- [x] **Step 2: Definire contratti senza `any`**

```ts
export type EvidenceRef = { sourceType: string; sourceId: string; label: string; version: string; link?: string };
export type ContextFact = { key: string; value: unknown; confidence: "certain" | "inferred"; evidence: EvidenceRef[] };
export type EntityContextKey = { sedeId: number; entityType: "cliente" | "commessa"; entityId: number; scope: "operativo" | "amministrazione" | "direzione" };
```

- [x] **Step 3: Implementare tabelle**

Creare `tars_entity_contexts`, `tars_context_versions`, `tars_context_evidence`; unique per chiave, fingerprint e versione schema. Non duplicare `business_events`.

- [x] **Step 4: Verificare e committare**

Run: `pnpm test -- server/tars/context/repository.test.ts`

```bash
git add server/tars/context
git commit -m "feat(tars): add scoped operational memory"
```

### Task 18: Costruire Collector Deterministico E Correlatore

**Files:**
- Create: `server/tars/context/collectors.ts`
- Create: `server/tars/context/correlation.ts`
- Create: `server/tars/context/fingerprint.ts`
- Create: `server/tars/context/collectors.test.ts`
- Create: `server/tars/context/correlation.test.ts`

**Interfaces:**
- Produces: `collectEntityFacts`, `rankEntityCandidates`, `fingerprintContext`.

- [x] **Step 1: Scrivere test fallenti per fonti e visibilita**

Operativo include stato, appuntamenti, ticket, documenti e riferimenti messaggi; amministrazione aggiunge fatture/pagamenti; direzione aggiunge dati consentiti. Nessuno scope include blob o conversazioni integrali.

- [x] **Step 2: Implementare collector con reader esistenti**

```ts
export async function collectEntityFacts(key: EntityContextKey): Promise<{
  facts: ContextFact[];
  sourceVersions: Record<string, string>;
} | null>;
```

Usare get/list sede-scoped da clienti, commesse, comunicazioni, FIC, documenti, calendario, ticket, interventi e Action Center.

- [x] **Step 3: Implementare ranking deterministico**

Punteggi documentati per id esplicito, codice commessa, telefono/email normalizzati, CF/PIVA, numero fattura, importo/data, assegnatario e prossimita temporale. Restituire massimo 5 candidati e motivazioni.

- [x] **Step 4: Implementare fingerprint SHA-256 canonico**

Ordinare fatti e chiavi, normalizzare date ISO, includere `schemaVersion`, `policyVersion`, `collectorVersion`; verificare in test che l'ordine input non cambi l'hash.

- [x] **Step 5: Verificare e committare**

Run: `pnpm test -- server/tars/context/collectors.test.ts server/tars/context/correlation.test.ts`

```bash
git add server/tars/context
git commit -m "feat(tars): collect verified cross-domain facts"
```

### Task 19: Collegare Eventi, Builder E Cache Cross-Run

**Files:**
- Create: `server/tars/context/builder.ts`
- Create: `server/tars/context/cache.ts`
- Create: `server/tars/context/consumer.ts`
- Create: `server/tars/context/builder.test.ts`
- Modify: `server/events/registry.ts`

**Interfaces:**
- Produces: `rebuildEntityContext`, `getCachedQuery`, consumer `tars-context-v1`.

- [x] **Step 1: Scrivere test fallenti su zero model call invariato**

Prima build chiama la sintesi una volta; secondo evento con stesso fingerprint completa senza chiamata; cambio policy invalida; errore modello preserva l'ultima versione valida.

- [x] **Step 2: Implementare builder a due fasi**

Il collector crea fatti; il modello sintetizza soltanto se il fingerprint cambia e solo entro budget. La risposta e Structured Output con `summary`, `openQuestions`, `risks`, `nextActions`, ognuno legato a evidence id.

- [x] **Step 3: Implementare cache query versionata**

```ts
export async function getCachedQuery<T>(input: {
  key: string; sedeId: number; scope: string; versions: string[]; ttlMs: number;
  load: () => Promise<T>;
}): Promise<{ value: T; hit: boolean }>;
```

Non memorizzare errori; invalidare per evento e versione; limite dimensionale per voce e LRU per sede.

- [x] **Step 4: Registrare consumer e rebuild manuale**

Eventi rilevanti invalidano cliente/commessa referenziati. Aggiungere script `scripts/rebuild-tars-context.ts --sede --entity --id --scope --dry-run`.

- [x] **Step 5: Verificare e committare**

Run: `pnpm test -- server/tars/context/builder.test.ts && pnpm check`

```bash
git add server/tars/context server/events/registry.ts scripts/rebuild-tars-context.ts
git commit -m "feat(tars): build and cache incremental context"
```

### Task 20: Usare Fascicoli Ed Evidenze Nel Loop Tars

**Files:**
- Modify: `server/tars/loop.ts`
- Modify: `server/tars/tools.ts`
- Modify: `server/tars/prompt.ts`
- Modify: `server/tars/stores.ts`
- Modify: `server/tars/tars.test.ts`
- Modify: `server/tars/commandCenter.ts`

**Interfaces:**
- Consumes: `EntityContext` Task 19 e policy Task 13.
- Produces: preload contestuale, citazioni strutturate e metriche cache per esecuzione.

- [x] **Step 1: Scrivere test fallenti per scope ed evidenze**

Un commerciale non riceve contesto amministrativo; un contesto stale viene dichiarato e verificato live prima di una proposta; conclusione importante senza evidence viene rifiutata dal server.

- [x] **Step 2: Sostituire il preload monolitico**

`runTars` risolve scope da capability, carica fascicolo sintetico e passa al modello soltanto fatti necessari. `leggi_fascicolo_commessa` resta fallback live e ritorna riferimenti, non dump indiscriminato.

- [x] **Step 3: Estendere esecuzione e proposta**

Salvare `contextFingerprint`, `contextScope`, `contextCacheHit`, `evidenceRefs`, `factsRead`, `factsRevalidated`; backfill valori neutrali per record legacy.

- [x] **Step 4: Rendere il prompt evidence-first**

Il prompt distingue `fatto_verificato`, `inferenza`, `domanda`; non consente di trasformare una similarita semantica in relazione business senza conferma.

- [x] **Step 5: Verificare e committare**

Run: `pnpm test -- server/tars/tars.test.ts server/tars/commandCenter.test.ts && pnpm tars:eval`

```bash
git add server/tars/loop.ts server/tars/tools.ts server/tars/prompt.ts server/tars/stores.ts server/tars/tars.test.ts server/tars/commandCenter.ts
git commit -m "feat(tars): reason from scoped evidence"
```

### Task 21: Introdurre Intent Router Tipizzato

**Files:**
- Create: `server/tars/planner/intents.ts`
- Create: `server/tars/planner/router.ts`
- Create: `server/tars/planner/router.test.ts`
- Modify: `server/tars/loop.ts`
- Modify: `server/tars/openai.ts`
- Modify: `server/tars/tools.ts`

**Interfaces:**
- Produces: `routeIntent(input): Promise<IntentDecision>`.

- [x] **Step 1: Scrivere test fallenti su intent espliciti e ambigui**

Contesto bottone `crea cliente e commessa` salta il modello; testo ambiguo produce `needsClarification`; richiesta economica porta capability richiesta; prompt injection resta contenuto non fidato.

- [x] **Step 2: Definire schema strict**

```ts
export const intentDecisionSchema = z.object({
  intent: z.enum(["informational_query", "cross_domain_search", "create_customer_job", "manage_communication", "reconcile_invoice", "manage_document", "plan_intervention", "manage_ticket", "analyze_job", "audit_process"]),
  workflow: z.string().nullable(),
  entityRefs: z.array(z.object({ type: z.string(), id: z.string() })),
  riskClass: z.enum(["read", "low", "medium", "high"]),
  requiredCapabilities: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  needsClarification: z.boolean(),
});
```

- [x] **Step 3: Implementare routing gerarchico**

Ordine: hint client firmato dal server, regole deterministiche, modello economico con tool assenti. Sotto 0.70 non avvia workflow con effetti; chiede chiarimento.

- [x] **Step 4: Selezionare profilo strumenti minimo**

`toolDefsForTrigger` riceve anche `workflow`; la chat completa usa catalogo pieno solo per `cross_domain_search` o quando il router non puo delimitare il dominio.

- [x] **Step 5: Verificare e committare**

Run: `pnpm test -- server/tars/planner/router.test.ts server/tars/tars.test.ts && pnpm tars:eval`

```bash
git add server/tars/planner server/tars/loop.ts server/tars/openai.ts server/tars/tools.ts
git commit -m "feat(tars): route requests to bounded workflows"
```

### Task 22: Creare Repository Dei Piani Persistenti

**Files:**
- Create: `server/tars/planner/types.ts`
- Create: `server/tars/planner/repository.ts`
- Create: `server/tars/planner/repository.test.ts`

**Interfaces:**
- Produces: `TarsPlanRepository` e stati piano/step da spec.

- [x] **Step 1: Scrivere test fallenti su transizioni e ripresa**

Non si puo completare un piano con step pendenti; una risposta utente riapre esattamente lo step `waiting_user`; due create con stessa `operationKey` restituiscono lo stesso piano.

- [x] **Step 2: Definire state machine**

```ts
export type PlanStatus = "draft" | "running" | "waiting_user" | "waiting_approval" | "verifying" | "completed" | "partially_completed" | "failed" | "canceled";
export type StepStatus = "pending" | "running" | "waiting_user" | "waiting_approval" | "completed" | "failed" | "skipped";
```

- [x] **Step 3: Implementare tabelle e optimistic concurrency**

Creare `tars_plans`, `tars_plan_steps`, `tars_plan_events`; ogni update usa `version` attesa e incremento atomico; output e errori sono strutturati e sanitizzati.

- [x] **Step 4: Verificare e committare**

Run: `pnpm test -- server/tars/planner/repository.test.ts`

```bash
git add server/tars/planner
git commit -m "feat(tars): persist resumable plans"
```

### Task 23: Implementare Runner E Registry Dei Workflow

**Files:**
- Create: `server/tars/workflows/types.ts`
- Create: `server/tars/workflows/registry.ts`
- Create: `server/tars/planner/runner.ts`
- Create: `server/tars/planner/runner.test.ts`
- Modify: `server/_core/index.ts`

**Interfaces:**
- Produces: `registerWorkflow`, `runPlanOnce`, `resumePlan`, `startPlanWorker`.

- [x] **Step 1: Scrivere test fallenti su budget, attesa e crash recovery**

Il runner si ferma su domanda/approvazione, riparte dallo step corretto, non supera budget e recupera step `running` stale senza duplicare side effect.

- [x] **Step 2: Definire workflow tipizzato**

```ts
export type WorkflowDefinition = {
  id: string;
  version: number;
  intent: string;
  requiredCapabilities: Capability[];
  riskClass: "read" | "low" | "medium" | "high";
  buildSteps(input: WorkflowInput): PlanStepDraft[];
  verify(ctx: WorkflowContext): Promise<VerificationResult>;
};
```

- [ ] **Step 3: Implementare runner senza mutation del modello**

Il runner e il registry sono presenti e testati con executor iniettati, ma gli
executor di produzione non sono ancora registrati. Il worker fallisce chiuso e
non parte senza executor.

Gli step `read`, `compute`, `ask`, `propose`, `verify` hanno executor server; il modello puo compilare output schema-validi ma non seleziona endpoint arbitrari. Ogni step usa idempotency key e policy.

- [ ] **Step 4: Avviare worker soltanto con planner attivo**

`plannerMode=active` e temporaneamente rifiutato dal server; un valore `active`
legacy viene degradato a `shadow` al bootstrap.

Il boot registra workflow, recupera stale e avvia poller; provider AI non disponibile porta a `waiting_technical`, senza perdere piano o nascondere notifiche.

- [x] **Step 5: Verificare e committare**

Run: `pnpm test -- server/tars/planner/runner.test.ts && pnpm check`

```bash
git add server/tars/workflows server/tars/planner server/_core/index.ts
git commit -m "feat(tars): execute resumable typed workflows"
```

### Task 24: Completare Il Workflow Cliente Piu Commessa

**Files:**
- Create: `server/tars/workflows/createCustomerJob.ts`
- Create: `server/tars/workflows/createCustomerJob.test.ts`
- Modify: `server/tars/esecutore.ts`
- Modify: `server/tars/tools.ts`
- Modify: `server/tars/stores.ts`

**Interfaces:**
- Produces: workflow `create-customer-job-v1` con saga approvabile e verificabile.

- [x] **Step 1: Scrivere test end-to-end fallenti**

Casi: dati completi; cliente esistente; commessa duplicata; assegnatario mancante; utente altra sede; create cliente riuscita e commessa fallita; retry dopo fallimento; approvazione ripetuta.

- [x] **Step 2: Definire input e post-condizioni**

```ts
const createCustomerJobInput = z.object({
  customer: z.object({ nome: z.string().min(1), cognome: z.string().min(1), telefono: z.string().optional(), email: z.string().email().optional() }),
  job: z.object({
    assegnatoA: z.number().int(),
    priorita: z.enum(["bassa", "media", "alta", "urgente"]).default("media"),
    note: z.string().optional(),
    prodotti: z.array(z.object({
      nome: z.string().min(1),
      quantita: z.number().int().min(1),
    })).default([]),
  }),
  communicationId: z.number().int().optional(),
});
```

- [x] **Step 3: Implementare saga persistente**

Step: dedupe cliente, chiedi assegnatario se assente, prepara proposta composta, attendi approvazione, crea cliente, registra id, crea commessa, collega comunicazione, verifica relazioni. Mai cancellare automaticamente il cliente su errore della commessa.

- [x] **Step 4: Rendere l'esecutore idempotente**

Ogni step passa `operationKey`; prima della create cerca l'esito registrato e un equivalente business. Il risultato parziale produce notifica e proposta di ripresa, non una seconda coppia.

- [x] **Step 5: Aggiornare eval e verificare**

Aggiungere almeno 8 casi al corpus. Run: `pnpm test -- server/tars/workflows/createCustomerJob.test.ts server/tars/tars.test.ts && pnpm tars:eval`

```bash
git add server/tars/workflows/createCustomerJob.ts server/tars/workflows/createCustomerJob.test.ts server/tars/esecutore.ts server/tars/tools.ts server/tars/stores.ts server/tars/evals/cases/core.json
git commit -m "feat(tars): complete customer and job workflow"
```

### Task 25: Estendere I Workflow Prioritari

**Files:**
- Create: `server/tars/workflows/manageLead.ts`
- Create: `server/tars/workflows/assignWork.ts`
- Create: `server/tars/workflows/reconcileInvoice.ts`
- Create: `server/tars/workflows/manageDocument.ts`
- Create: `server/tars/workflows/planIntervention.ts`
- Create: `server/tars/workflows/manageTicket.ts`
- Create: `server/tars/workflows/workflows.test.ts`
- Modify: `server/tars/workflows/registry.ts`
- Modify: `server/tars/evals/cases/core.json`

**Interfaces:**
- Produces: sei workflow versionati con chiavi canoniche e verifier deterministici.

- [x] **Step 1: Scrivere test tabellari per ogni workflow**

Per ciascuno coprire happy path, dati mancanti, duplicato, permesso negato, altra sede, approvazione rifiutata, provider esterno non disponibile e verifica fallita.

- [x] **Step 2: Implementare lead e assegnazione**

Lead da email/WhatsApp conserva richiesta reale, chiede assegnatario, propone cliente+commessa e collegamento. Assign valida capability e produce evento/notifica.

- [x] **Step 3: Implementare fattura e documento**

Fattura usa match deterministico e massimo 5 candidati; documento classifica e collega, ma non promuove una similarita a legame senza approvazione.

- [x] **Step 4: Implementare intervento e ticket**

Intervento propone slot/squadra usando calendario live; ticket collega cliente/commessa quando certo e mantiene ticket indipendente quando la relazione non esiste.

- [x] **Step 5: Registrare, aggiornare eval e committare**

Run: `pnpm test -- server/tars/workflows/workflows.test.ts && pnpm tars:eval`

```bash
git add server/tars/workflows server/tars/evals/cases/core.json
git commit -m "feat(tars): add core operational workflows"
```

### Task 26: Unificare Tars, Piani E Centro Azioni Nella UX

**Files:**
- Modify: `server/tars/commandCenter.ts`
- Modify: `server/routers/tars.ts`
- Modify: `server/actionCenter/tars.ts`
- Modify: `client/src/pages/TarsCommandCenter.tsx`
- Modify: `client/src/components/TarsChat.tsx`
- Modify: `client/src/components/TarsPropostaCard.tsx`
- Create: `client/src/components/tars/PlanProgress.tsx`
- Create: `client/src/components/tars/EvidenceList.tsx`

**Interfaces:**
- Produces: timeline piano, domande, approvazioni, evidenze e ripresa nello stesso obiettivo.

- [x] **Step 1: Scrivere test API su ownership e visibilita**

Un utente vede i propri piani e quelli assegnati; direzione vede la sede; evidenze economiche restano filtrate; risposta a domanda riapre una volta sola.

- [x] **Step 2: Estendere snapshot Command Center**

Restituire `activePlans`, `waitingQuestions`, `waitingApprovals`, `blockedCases`, `recentOutcomes` gia filtrati e ordinati server-side.

- [x] **Step 3: Ridisegnare la chat come spazio obiettivo**

Mostrare progressione compatta, step corrente, fonti, domanda o conferma primaria. Evitare bolle decorative e testo tecnico sui tool; gli errori mostrano azione di ripresa.

- [x] **Step 4: Collegare notifiche e deep link**

`tars.plan_waiting` apre direttamente piano e step; rispondere/approvare risolve la notifica associata soltanto dopo conferma server.

- [ ] **Step 5: Verificare desktop/mobile e committare**

Desktop verificato; il collaudo mobile resta aperto perche l'override viewport
del browser di test non e stato applicato dalla sessione corrente.

Run: `pnpm test -- server/tars/commandCenterApi.test.ts server/actionCenter/tars.test.ts && pnpm check && pnpm build`

```bash
git add server/tars/commandCenter.ts server/routers/tars.ts server/actionCenter/tars.ts client/src/pages/TarsCommandCenter.tsx client/src/components/TarsChat.tsx client/src/components/TarsPropostaCard.tsx client/src/components/tars
git commit -m "feat(tars): surface plans and evidence in command center"
```

### Task 27: Aggiungere Ricerca Semantica Ibrida

**Files:**
- Create: `server/tars/search/types.ts`
- Create: `server/tars/search/repository.ts`
- Create: `server/tars/search/indexer.ts`
- Create: `server/tars/search/retriever.ts`
- Create: `server/tars/search/retriever.test.ts`
- Create: `server/tars/search/consumer.ts`
- Modify: `server/events/registry.ts`
- Modify: `server/tars/tools.ts`

**Interfaces:**
- Produces: indicizzazione versionata e `hybridSearch` ACL-aware.

- [x] **Step 1: Scrivere test fallenti su ACL, delete e ranking**

Risultati altra sede o scope non autorizzato sono assenti; eliminazione fonte rimuove chunk; filtri identificativi vincono sulla similarita; massimo 8 frammenti.

- [x] **Step 2: Verificare supporto `pgvector` in shadow**

`ensureSchema` rileva estensione senza tentare installazione non autorizzata. Se assente, `semanticSearchMode` resta `off` e la ricerca testuale strutturata continua.

- [ ] **Step 3: Implementare chunking e versioni**

Chunking, versioni e cancellazione fonte sono implementati; mancano i producer
evento per tutti i domini e la generazione embedding nel percorso reale.

Chunk per email, WhatsApp, documenti estratti, note e conoscenza; ogni record include `sede_id`, `scope`, fonte, entity refs, checksum, versione e stato cancellato.

- [ ] **Step 4: Implementare retrieval ibrido**

```ts
export async function hybridSearch(input: {
  query: string; sedeId: number; userId: number; scope: VisibilityScope;
  entityRefs?: EntityRef[]; limit?: number;
}): Promise<SearchHit[]>;
```

Applicare filtri e testo prima del vettore, poi riapplicare policy al reader della fonte. Il tool restituisce snippet breve ed evidence ref.

Il fallback lessicale ACL-aware e pronto. Finche query e indice non producono
embedding reali, `semanticSearchMode=active` resta bloccato e il tool non viene
esposto come ricerca semantica operativa.

- [ ] **Step 5: Verificare e committare**

Run: `pnpm test -- server/tars/search/retriever.test.ts && pnpm tars:eval`

```bash
git add server/tars/search server/events/registry.ts server/tars/tools.ts
git commit -m "feat(tars): add scoped hybrid search"
```

### Task 28: Introdurre Apprendimento Da Esiti E Gate Di Autonomia

**Files:**
- Create: `server/tars/learning/outcomes.ts`
- Create: `server/tars/learning/outcomes.test.ts`
- Create: `server/tars/autonomy/policy.ts`
- Create: `server/tars/autonomy/policy.test.ts`
- Modify: `server/tars/stores.ts`
- Modify: `server/routers/tars.ts`

**Interfaces:**
- Produces: outcome dataset, metriche per capability e `evaluateAutonomyGate`.

- [x] **Step 1: Scrivere test fallenti sui gate**

Meno di 6 settimane, meno di 100 esiti o accuratezza sotto 98% negano; cambio modello/prompt/workflow revoca; capability irreversibile o alta rischiosita nega sempre.

- [x] **Step 2: Registrare outcome senza auto-promuoverli a regole**

Approvazione, modifica, rifiuto, undo, verifica e incidente producono record con versioni, workflow, capability e motivazione normalizzata. Il testo libero non entra automaticamente nel prompt.

- [x] **Step 3: Implementare gate puro e kill switch**

```ts
export function evaluateAutonomyGate(input: AutonomyEvidence): {
  allowed: boolean;
  reasons: string[];
  expiresAt: Date | null;
};
```

Whitelist iniziale vuota. L'abilitazione richiede direzione, feature flag per sede e report eval allegato; ogni esecuzione automatica conserva undo e principal di sistema minimo.

- [x] **Step 4: Esporre report, non interruttore facile**

La UI mostra `Non qualificata`, `In osservazione`, `Qualificata`, `Revocata`, con metriche per singola capability. Nessuna media generale abilita autonomia.

- [x] **Step 5: Verificare e committare**

Run: `pnpm test -- server/tars/learning/outcomes.test.ts server/tars/autonomy/policy.test.ts && pnpm tars:eval`

```bash
git add server/tars/learning server/tars/autonomy server/tars/stores.ts server/routers/tars.ts
git commit -m "feat(tars): gate learning and progressive autonomy"
```

### Task 29: Osservabilita, Runbook E Pulizia Contratti

**Files:**
- Create: `server/observability/metrics.ts`
- Create: `server/routers/diagnostica.ts`
- Create: `server/routers/diagnostica.test.ts`
- Modify: `server/routers.ts`
- Modify: `handoff.md`
- Modify: `documento_requisiti_infissi_ops.md`
- Modify: `Agente_Ruffino_Ops.md`
- Create: `docs/runbooks/tars-eventi-notifiche.md`
- Create: `docs/runbooks/tars-recovery.md`

**Interfaces:**
- Produces: metriche privacy-safe, diagnostica direzione-only e runbook operativi.

- [x] **Step 1: Scrivere test fallenti sulla diagnostica**

La risposta include coda eventi per consumer, dead-letter, notifiche pending, connessioni SSE, piani per stato, cache hit e token per workflow; non include prompt, corpi mail, telefoni o token.

- [x] **Step 2: Implementare metriche con cardinalita limitata**

Etichette ammesse: sede, consumer, workflow, versione, stato, classe rischio. Non usare entity id, email o user id come label.

- [x] **Step 3: Documentare boot, rollback e recovery**

Descrivere ordine feature flag, query di verifica, retry dead-letter, rebuild contesto, disattivazione SSE/push, revoca autonomia e comportamento quando OpenAI non risponde.

- [x] **Step 4: Aggiornare PRD, handoff e manuale Tars**

Rimuovere riferimenti superati ai soli polling/read-id; documentare eventi, notifiche, capability, memoria, planner, workflow e limiti di autonomia. Segnalare esplicitamente cio che resta in shadow.

- [x] **Step 5: Verificare e committare**

Run: `pnpm test -- server/routers/diagnostica.test.ts && pnpm check && pnpm test && pnpm build`

```bash
git add server/observability server/routers/diagnostica.ts server/routers/diagnostica.test.ts server/routers.ts handoff.md documento_requisiti_infissi_ops.md Agente_Ruffino_Ops.md docs/runbooks
git commit -m "docs: add Tars operations and recovery runbooks"
```

### Task 30: Collaudo Integrato E Attivazione Progressiva

**Files:**
- Create: `server/integration/tarsBrain.test.ts`
- Create: `docs/reports/tars-brain-rollout-checklist.md`
- Modify: `docs/superpowers/plans/2026-08-25-tars-cervello-azienda.md`

**Interfaces:**
- Consumes: tutte le milestone precedenti.
- Produces: test integrato, checklist firmabile e stato finale delle checkbox.

- [ ] **Step 1: Scrivere scenario end-to-end**

Esiste un contratto integrato deterministico tra componenti. Non viene ancora
chiamato end-to-end: il collaudo reale deve attraversare smistamento, worker,
planner con executor di produzione ed endpoint SSE.

Scenario: email richiesta preventivo -> classificazione -> contesto -> Tars chiede assegnatario -> proposta cliente+commessa -> approvazione -> saga -> eventi -> notifica SSE al destinatario -> presa in carico -> notifica risolta -> evidenze e outcome registrati.

- [x] **Step 2: Aggiungere scenari di guasto**

OpenAI offline, DB worker riavviato, SSE disconnessa, evento duplicato, assegnatario altra sede, approvazione doppia, commessa create fallita dopo cliente, cache stale e prompt injection.

- [x] **Step 3: Eseguire suite completa e baseline comparativa**

Run:

```bash
pnpm check
pnpm test
pnpm build
pnpm tars:eval
```

Expected: tutti verdi; nessuna regressione critica; report con token, latenza, duplicati ed evidence coverage confrontati con Task 1.

- [ ] **Step 4: Eseguire collaudo browser**

Desktop Tars/Notifiche verificato senza overflow o nuovi errori console. Mobile
390x844 e recovery SSE con due sessioni reali restano nel checklist firmabile.

Con dev server attivo verificare Chrome desktop 1440x900 e mobile 390x844: assegnazione real-time, campanella, pagina notifiche, piano Tars, perdita connessione e ripresa. Controllare console e network per errori o stream duplicati.

- [ ] **Step 5: Attivare una sede per volta**

Non attivato automaticamente: il primo gate richiede sette giorni di shadow in
produzione. Ordine e criteri sono in `docs/reports/tars-brain-rollout-checklist.md`.

Ordine obbligatorio: eventi shadow -> notifiche shadow -> notifiche active -> SSE -> policy audit -> policy enforce -> context shadow. Context active, planner active e ricerca semantic active restano tecnicamente bloccati finche i gate di completezza riportati nel checklist non sono chiusi. Fermarsi e fare rollback se un gate del documento di rollout e rosso.

- [x] **Step 6: Commit finale del collaudo**

```bash
git add server/integration/tarsBrain.test.ts docs/reports/tars-brain-rollout-checklist.md docs/superpowers/plans/2026-08-25-tars-cervello-azienda.md
git commit -m "test: verify Tars business brain rollout"
```

## Gate Tra Le Milestone

| Gate | Condizione necessaria |
|---|---|
| Eventi -> notifiche | 7 giorni shadow, zero eventi persi, dead-letter spiegate, dedupe verificata |
| Notifiche -> permessi | p95 SSE sotto 3 secondi, meno 1% duplicati percepiti, fallback polling provato |
| Permessi -> memoria | report audit revisionato, zero allargamenti economia/delete/cross-sede non voluti |
| Memoria -> planner | almeno 95% conclusioni importanti con evidenze, zero model call su fingerprint invariato |
| Planner -> workflow estesi | cliente+commessa completa almeno 95% senza ricominciare e senza duplicati |
| Workflow -> semantic search | policy e cancellazione fonte testate, retrieval strutturato gia stabile |
| Semantic search -> autonomia | almeno 6 settimane e 100 esiti per capability, accuratezza almeno 98%, eval verde |

## Strategia Di Rollback

- `eventBusMode=off`: ferma nuovi producer/consumer senza cancellare il registro.
- `notificationMode=legacy`: torna alla campanella precedente; le nuove notifiche restano auditabili.
- `realtimeNotifications=false`: mantiene feed persistente con polling.
- `policyMode=legacy`: disattiva enforcement capability ma conserva audit.
- `contextEngineMode=off`: Tars torna ai reader live; i fascicoli restano disponibili per diagnosi.
- `plannerMode=off`: le chat tornano al loop corrente; i piani gia avviati passano in attesa tecnica.
- `semanticSearchMode=off`: Tars usa i reader CRM strutturati; l'indice
  lessicale resta disponibile soltanto per collaudo interno.
- `autonomyCapabilities=[]`: revoca immediata ogni automazione qualificata.

Nessun rollback elimina dati. Cleanup e backfill sono operazioni separate, dry-run e sede-scoped.
