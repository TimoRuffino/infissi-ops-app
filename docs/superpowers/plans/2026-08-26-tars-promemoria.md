# Tars Promemoria Personali Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consentire a Tars di chiedere quando ricordare un'attività, creare dopo approvazione un promemoria personale persistente e mostrarlo come popup e notifica quando il CRM è aperto.

**Architecture:** Un dominio PostgreSQL `server/reminders/` conserva promemoria ed eventi, espone transizioni personali idempotenti e proietta le scadenze nel repository notifiche esistente. Tars aggiunge una proposta `promemoria` vincolata a una precedente domanda temporale risposta; il client monta un host globale nel `DashboardLayout`, con polling di fallback ogni 15 secondi e invalidazione SSE quando disponibile.

**Tech Stack:** TypeScript 5.9, Node/Express, tRPC 11, PostgreSQL tramite `postgres`, React 19, TanStack Query, Wouter, Radix/shadcn Dialog, Tailwind 4, Vitest 2, `@date-fns/tz` 1.4.x.

**Spec:** `docs/superpowers/specs/2026-08-26-tars-promemoria-design.md`

## Global Constraints

- Lavorare sul branch `main`, preservando ogni modifica utente già presente.
- Tars propone e non crea alcun promemoria senza approvazione esplicita.
- Il destinatario è il principal che ha originato la richiesta Tars, mai un id fornito dal modello o dal client.
- Ogni lookup e mutation applica `sedeId`; un record di altra sede o altro utente restituisce `NOT_FOUND`.
- Il fuso applicativo è esattamente `Europe/Rome`; PostgreSQL salva `TIMESTAMPTZ` in UTC.
- Ogni intento di promemoria passa da una domanda temporale; una data già presente richiede conferma esplicita.
- Popup e campanella funzionano in `legacy`, `shadow` e `active`, senza Web Push o email.
- Il popup deve comparire entro 15 secondi con CRM aperto e al primo accesso dopo una scadenza avvenuta a CRM chiuso.
- Nessun nuovo blob o payload cliente completo entra in JSONB, log, metriche o SSE.
- Usare token semantici esistenti, Plus Jakarta Sans, target touch minimi 44 x 44 px e nessuno scroll orizzontale globale.
- Verificare la UI a 1440 x 900 e 390 x 844, senza errori console.
- Prima della consegna devono passare `pnpm check`, `pnpm test` e `pnpm build`.

---

## File map

### Nuovi file

- `server/reminders/types.ts` — tipi dominio, input e transizioni.
- `server/reminders/time.ts` — parsing ISO e conversione deterministica `Europe/Rome`.
- `server/reminders/time.test.ts` — futuro, offset, preset e DST.
- `server/reminders/repository.ts` — repository memory/PostgreSQL e schema relazionale.
- `server/reminders/repository.test.ts` — isolamento, deduplica, claim e transizioni.
- `server/reminders/service.ts` — creazione approvata, complete/snooze/cancel e risoluzione notifiche.
- `server/reminders/service.test.ts` — idempotenza e integrazione con il repository notifiche.
- `server/reminders/worker.ts` — scadenza, proiezione notifiche, retry e scheduler.
- `server/reminders/worker.test.ts` — doppia istanza, retry e notifica unica.
- `server/routers/promemoria.ts` — API tRPC personali.
- `server/routers/promemoria.test.ts` — ACL, payload e transizioni API.
- `client/src/lib/reminders.ts` — formattazione e stato puro del popup.
- `client/src/lib/reminders.test.ts` — formattazione italiana e coda.
- `client/src/components/PromemoriaPopupHost.tsx` — dialog globale e azioni.

### File modificati

- `package.json`, `pnpm-lock.yaml` — dipendenza diretta `@date-fns/tz`.
- `server/_core/index.ts` — schema e worker promemoria dopo bootstrap.
- `server/routers.ts` — registrazione `promemoriaRouter`.
- `server/notifications/repository.ts` — filtro opzionale `types` per feed/count.
- `server/notifications/repository.test.ts` — filtro tipo notifica.
- `server/routers/notifiche.ts` — merge promemoria in legacy/shadow.
- `server/routers/notifiche.test.ts` — feed e badge in tutte le modalità.
- `server/tars/stores.ts` — tipo proposta, owner server-owned e backfill.
- `server/tars/tools.ts` — schema/handler `proponi_promemoria` e domanda marcata.
- `server/tars/prompt.ts` — distinzione promemoria/nota/calendario e conferma temporale.
- `server/tars/esecutore.ts` — creazione idempotente dopo approvazione.
- `server/tars/seguito.ts` — testo del seguito per intento promemoria.
- `server/routers/tars.ts` — capability e decisione riservata al richiedente.
- `server/tars/tars.test.ts` — prompt, tool, provenance, owner e approvazione.
- `server/tars/evals/cases/core.json`, `types.ts`, `fixtures.test.ts`,
  `metadata.test.ts` — casi reminder e versioni prompt/tool.
- `client/src/components/TarsPropostaCard.tsx` — tipo e dettagli leggibili.
- `client/src/hooks/useNotificationStream.ts` — invalidazione dei promemoria dovuti.
- `client/src/components/DashboardLayout.tsx` — mount globale del popup.
- `client/src/components/SedeSwitcher.tsx`, `client/src/_core/hooks/useAuth.ts` —
  svuotamento della coda personale al cambio principal/sede.
- `handoff.md`, `Agente_Ruffino_Ops.md`, `documento_requisiti_infissi_ops.md` — contratto operativo aggiornato.
- `scripts/build-prd-pdf.sh`, `PRD_infissi_ops_v4.pdf` — versione PRD e PDF rigenerato.

---

### Task 1: Tempo canonico Europe/Rome

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `server/reminders/time.ts`
- Create: `server/reminders/time.test.ts`

**Interfaces:**
- Consumes: stringhe ISO Tars e input `datetime-local` del popup.
- Produces: `REMINDER_TIMEZONE`, `parseFutureReminderInstant()`, `parseRomeLocalDateTime()`, `resolveSnoozeAt()`.

- [ ] **Step 1: Scrivere i test fallenti per timestamp e preset**

```ts
import { describe, expect, it } from "vitest";
import {
  parseFutureReminderInstant,
  parseRomeLocalDateTime,
  resolveSnoozeAt,
} from "./time";

const now = new Date("2026-08-26T10:00:00.000Z");

describe("reminder time", () => {
  it("accetta solo ISO futuri con offset esplicito", () => {
    expect(parseFutureReminderInstant("2026-08-27T09:00:00+02:00", now))
      .toEqual(new Date("2026-08-27T07:00:00.000Z"));
    expect(() => parseFutureReminderInstant("2026-08-26T09:00:00Z", now))
      .toThrow("REMINDER_TIME_NOT_FUTURE");
    expect(() => parseFutureReminderInstant("2026-08-27T09:00:00", now))
      .toThrow("REMINDER_TIME_OFFSET_REQUIRED");
  });

  it("interpreta il datetime locale nel fuso di Roma", () => {
    expect(parseRomeLocalDateTime("2026-08-27T09:00", now).toISOString())
      .toBe("2026-08-27T07:00:00.000Z");
  });

  it("rifiuta ore locali inesistenti o duplicate al cambio DST", () => {
    const beforeDst = new Date("2026-01-01T00:00:00.000Z");
    expect(() => parseRomeLocalDateTime("2026-03-29T02:30", beforeDst))
      .toThrow("REMINDER_LOCAL_TIME_INVALID");
    expect(() => parseRomeLocalDateTime("2026-10-25T02:30", beforeDst))
      .toThrow("REMINDER_LOCAL_TIME_AMBIGUOUS");
  });

  it("calcola domani alle 9 attraversando il cambio ora", () => {
    expect(resolveSnoozeAt({ kind: "preset", preset: "tomorrow_9" },
      new Date("2026-10-24T10:00:00.000Z")).toISOString())
      .toBe("2026-10-25T08:00:00.000Z");
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare il fallimento previsto**

Run: `pnpm test -- server/reminders/time.test.ts`

Expected: FAIL perché `server/reminders/time.ts` non esiste.

- [ ] **Step 3: Dichiarare la dipendenza timezone**

Run: `pnpm add @date-fns/tz@^1.4.1`

Expected: `package.json` dichiara `@date-fns/tz`; il lockfile aggiorna soltanto l'importer root perché la stessa versione è già transitiva.

- [ ] **Step 4: Implementare parsing e preset senza dipendere dal timezone del browser/server**

```ts
import { TZDate, tzOffset } from "@date-fns/tz";

export const REMINDER_TIMEZONE = "Europe/Rome" as const;
export type SnoozeInput =
  | { kind: "preset"; preset: "15m" | "1h" | "tomorrow_9" }
  | { kind: "custom"; localDateTime: string };

export function parseFutureReminderInstant(value: string, now = new Date()): Date {
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new Error("REMINDER_TIME_OFFSET_REQUIRED");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("REMINDER_TIME_INVALID");
  if (parsed.getTime() <= now.getTime()) throw new Error("REMINDER_TIME_NOT_FUTURE");
  return parsed;
}

export function parseRomeLocalDateTime(value: string, now = new Date()): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("REMINDER_LOCAL_TIME_INVALID");
  const [, y, m, d, h, min] = match.map(Number);
  const nominalUtc = Date.UTC(y, m - 1, d, h, min);
  const offsets = new Set([
    tzOffset(REMINDER_TIMEZONE, new Date(nominalUtc - 86_400_000)),
    tzOffset(REMINDER_TIMEZONE, new Date(nominalUtc)),
    tzOffset(REMINDER_TIMEZONE, new Date(nominalUtc + 86_400_000)),
  ]);
  const candidates = [...offsets]
    .map(offset => new Date(nominalUtc - offset * 60_000))
    .filter(candidate => {
      const local = new TZDate(candidate, REMINDER_TIMEZONE);
      return local.getFullYear() === y && local.getMonth() === m - 1 &&
        local.getDate() === d && local.getHours() === h &&
        local.getMinutes() === min;
    });
  if (candidates.length === 0) throw new Error("REMINDER_LOCAL_TIME_INVALID");
  if (candidates.length > 1) throw new Error("REMINDER_LOCAL_TIME_AMBIGUOUS");
  return parseFutureReminderInstant(candidates[0].toISOString(), now);
}

export function resolveSnoozeAt(input: SnoozeInput, now = new Date()): Date {
  if (input.kind === "custom") return parseRomeLocalDateTime(input.localDateTime, now);
  if (input.preset === "15m") return new Date(now.getTime() + 15 * 60_000);
  if (input.preset === "1h") return new Date(now.getTime() + 60 * 60_000);
  const romeNow = new TZDate(now, REMINDER_TIMEZONE);
  const tomorrowAtNine = new TZDate(
    romeNow.getFullYear(), romeNow.getMonth(), romeNow.getDate() + 1,
    9, 0, 0, 0, REMINDER_TIMEZONE
  );
  return new Date(tomorrowAtNine.getTime());
}
```

- [ ] **Step 5: Eseguire test e typecheck mirati**

Run: `pnpm test -- server/reminders/time.test.ts && pnpm check`

Expected: PASS; nessun errore TypeScript sull'API `TZDate`.

- [ ] **Step 6: Committare il tempo canonico**

```bash
git add docs/superpowers/plans/2026-08-26-tars-promemoria.md package.json pnpm-lock.yaml server/reminders/time.ts server/reminders/time.test.ts
git commit -m "feat(reminders): add Rome time handling"
```

---

### Task 2: Repository persistente e audit promemoria

**Files:**
- Create: `server/reminders/types.ts`
- Create: `server/reminders/repository.ts`
- Create: `server/reminders/repository.test.ts`

**Interfaces:**
- Consumes: `Date` già canonicalizzate e identity server-owned.
- Produces: `ReminderRepository`, `createMemoryReminderRepository()`, `getReminderRepository()` e record `Reminder`.

- [ ] **Step 1: Scrivere test fallenti per deduplica, scope e ciclo di vita**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryReminderRepository } from "./repository";

const now = new Date("2026-08-26T10:00:00.000Z");

describe("reminder repository", () => {
  let repo: ReturnType<typeof createMemoryReminderRepository>;
  beforeEach(() => { repo = createMemoryReminderRepository(); });

  it("deduplica la stessa proposta e isola sede e destinatario", async () => {
    const input = {
      sedeId: 1, recipientUserId: 7, createdByUserId: 7,
      sourceProposalId: 91, canonicalKey: "reminder:1:7:test",
      text: "Invia preventivo", remindAt: new Date("2026-08-27T07:00:00Z"),
      timezone: "Europe/Rome" as const, clienteId: null, commessaId: null, now,
    };
    const first = await repo.create(input);
    const retry = await repo.create(input);
    expect(retry).toEqual({ record: first.record, created: false });
    expect(await repo.findById(1, 8, first.record.id)).toBeNull();
    expect(await repo.findById(2, 7, first.record.id)).toBeNull();
  });

  it("reclama una scadenza una sola volta e conserva l'audit", async () => {
    const created = await repo.create({
      sedeId: 1, recipientUserId: 7, createdByUserId: 7,
      sourceProposalId: 92, canonicalKey: "reminder:1:7:due",
      text: "Chiama Rossi", remindAt: new Date("2026-08-26T09:00:00Z"),
      timezone: "Europe/Rome", clienteId: null, commessaId: null, now,
    });
    const [claimed, duplicate] = await Promise.all([
      repo.claimDue({ now, limit: 20 }), repo.claimDue({ now, limit: 20 }),
    ]);
    expect([...claimed, ...duplicate]).toHaveLength(1);
    expect((await repo.listEvents(1, created.record.id)).map(e => e.eventType))
      .toEqual(["created", "fired"]);
  });

  it("posticipa incrementando la revisione e azzerando la consegna", async () => {
    const created = await repo.create({
      sedeId: 1, recipientUserId: 7, createdByUserId: 7,
      sourceProposalId: 93, canonicalKey: "reminder:1:7:snooze",
      text: "Richiama il cliente", remindAt: new Date("2026-08-26T09:00:00Z"),
      timezone: "Europe/Rome", clienteId: null, commessaId: null, now,
    });
    await repo.claimDue({ now, limit: 20 });
    expect(await repo.markNotificationProjected({
      id: created.record.id, revision: 1, now,
    })).toBe(true);
    const snoozedAt = new Date("2026-08-26T11:00:00Z");
    const snoozed = await repo.snooze({
      sedeId: 1, recipientUserId: 7, id: created.record.id,
      actorUserId: 7, remindAt: snoozedAt, now,
    });
    expect(snoozed).toMatchObject({
      revision: 2, status: "scheduled", notificationRevision: 0,
      popupDismissedAt: null, firedAt: null,
    });
    expect(snoozed?.remindAt).toEqual(snoozedAt);
    expect((await repo.listEvents(1, created.record.id)).map(e => e.eventType))
      .toEqual(["created", "fired", "snoozed"]);
  });
});
```

- [ ] **Step 2: Eseguire il test e verificare il fallimento previsto**

Run: `pnpm test -- server/reminders/repository.test.ts`

Expected: FAIL per moduli mancanti.

- [ ] **Step 3: Definire tipi e firme complete del repository**

```ts
export type ReminderStatus = "scheduled" | "due" | "completed" | "cancelled";
export type Reminder = {
  id: number; sedeId: number; recipientUserId: number; createdByUserId: number;
  sourceProposalId: number | null; canonicalKey: string; text: string;
  remindAt: Date; timezone: "Europe/Rome"; status: ReminderStatus;
  revision: number; clienteId: number | null; commessaId: number | null;
  popupDismissedAt: Date | null; firedAt: Date | null;
  notificationRevision: number; completedAt: Date | null;
  cancelledAt: Date | null; createdAt: Date; updatedAt: Date;
};
export type ReminderEventType =
  | "created" | "fired" | "popup_dismissed"
  | "completed" | "snoozed" | "cancelled";
export type ReminderEvent = {
  id: number; reminderId: number; sedeId: number; actorUserId: number | null;
  eventType: ReminderEventType; metadata: Record<string, unknown>; createdAt: Date;
};

export type ReminderRepository = {
  ensureSchema(): Promise<void>;
  create(input: CreateReminderInput): Promise<{ record: Reminder; created: boolean }>;
  findById(sedeId: number, recipientUserId: number, id: number): Promise<Reminder | null>;
  listPopupDue(input: ReminderScope & { limit: number }): Promise<Reminder[]>;
  claimDue(input: { now: Date; limit: number }): Promise<Reminder[]>;
  listPendingNotification(limit: number): Promise<Reminder[]>;
  markNotificationProjected(input: { id: number; revision: number; now: Date }): Promise<boolean>;
  dismissPopup(input: ReminderMutationInput): Promise<Reminder | null>;
  complete(input: ReminderMutationInput): Promise<Reminder | null>;
  snooze(input: ReminderMutationInput & { remindAt: Date }): Promise<Reminder | null>;
  cancel(input: ReminderMutationInput): Promise<Reminder | null>;
  listEvents(sedeId: number, reminderId: number): Promise<ReminderEvent[]>;
};
```

- [ ] **Step 4: Implementare il repository memory con copie difensive e transizioni idempotenti**

Implementare `createMemoryReminderRepository()` usando array privati. Ogni mutation cerca esattamente `(sedeId, recipientUserId, id)`; se non trova restituisce `null`. `complete`, `cancel` e `dismissPopup` non aggiungono un secondo evento se lo stato/campo è già quello richiesto. `claimDue` seleziona `scheduled && remindAt <= now`, ordina per `remindAt,id`, cambia subito in `due` e aggiunge `fired` prima di restituire copie.

```ts
async snooze(input) {
  const item = scopedFind(input);
  if (!item || item.status === "completed" || item.status === "cancelled") return null;
  item.status = "scheduled";
  item.remindAt = new Date(input.remindAt);
  item.revision += 1;
  item.popupDismissedAt = null;
  item.firedAt = null;
  item.notificationRevision = 0;
  item.updatedAt = new Date(input.now);
  append(item, input.actorUserId, "snoozed", { revision: item.revision });
  return structuredClone(item);
}
```

- [ ] **Step 5: Implementare schema PostgreSQL e claim concorrente**

Usare `kvSql` come i repository `notifications` e `actionCenter`. `ensureSchema()` crea `promemoria`, `promemoria_eventi`, i check e gli indici della spec. Il claim usa una singola transazione e `FOR UPDATE SKIP LOCKED`:

```sql
WITH claimed AS (
  SELECT id FROM promemoria
  WHERE status = 'scheduled' AND remind_at <= ${now}
  ORDER BY remind_at, id
  FOR UPDATE SKIP LOCKED
  LIMIT ${limit}
)
UPDATE promemoria p
SET status = 'due', fired_at = ${now}, updated_at = ${now}
FROM claimed
WHERE p.id = claimed.id AND p.status = 'scheduled'
RETURNING p.*
```

Nella stessa transazione inserire `fired` per ogni riga restituita. `create`
usa `ON CONFLICT (sede_id, canonical_key) DO NOTHING` e, se necessario, rilegge
per `(sede_id, source_proposal_id)`. Le mutation usano `UPDATE ... WHERE
sede_id = ? AND recipient_user_id = ? AND id = ? RETURNING *`; `snooze`
incrementa `revision` e azzera `notification_revision`.

`getReminderRepository()` segue il pattern dei repository notifiche: usa un
singleton PostgreSQL quando `kvSql` è disponibile e un singleton memory quando
`DATABASE_URL` manca. `ensureSchema()` sul repository memory è un no-op; i test
devono chiarire che il fallback non dimostra persistenza Railway.

- [ ] **Step 6: Completare il test di posticipo e aggiungere i casi complete/cancel/dismiss**

```ts
const dismissed = await repo.dismissPopup({
  sedeId: 1, recipientUserId: 7, id, actorUserId: 7, now,
});
expect(dismissed?.popupDismissedAt).toEqual(now);
expect(await repo.dismissPopup({
  sedeId: 1, recipientUserId: 7, id, actorUserId: 7, now,
})).toEqual(dismissed);
```

Verificare inoltre che una mutation con `recipientUserId` o `sedeId` diverso restituisca `null` e non aggiunga eventi.

- [ ] **Step 7: Eseguire test mirati e typecheck**

Run: `pnpm test -- server/reminders/repository.test.ts && pnpm check`

Expected: PASS.

- [ ] **Step 8: Committare il repository**

```bash
git add server/reminders/types.ts server/reminders/repository.ts server/reminders/repository.test.ts
git commit -m "feat(reminders): persist personal reminders"
```

---

### Task 3: Servizio personale e router tRPC

**Files:**
- Create: `server/reminders/service.ts`
- Create: `server/reminders/service.test.ts`
- Create: `server/routers/promemoria.ts`
- Create: `server/routers/promemoria.test.ts`
- Modify: `server/routers.ts:1-170`

**Interfaces:**
- Consumes: `ReminderRepository`, `NotificationRepository`, `SnoozeInput`.
- Produces: `ReminderService`, `getReminderService()` e namespace tRPC `promemoria`.

- [ ] **Step 1: Scrivere i test fallenti del servizio**

```ts
const reminders = createMemoryReminderRepository();
const notifications = createMemoryNotificationRepository();
const resolveGroup = vi.spyOn(notifications, "resolveGroup");
const service = createReminderService({
  reminders, notifications, now: () => now,
});

it("crea una volta sola dal principal originale", async () => {
  const input = {
    sedeId: 1, requestedByUserId: 7, sourceProposalId: 91,
    actionKey: "promemoria:1:7:x", text: "Invia preventivo",
    remindAtIso: "2026-08-27T09:00:00+02:00",
    clienteId: null, commessaId: null, now,
  };
  const first = await service.createApproved(input);
  const retry = await service.createApproved(input);
  expect(first.record.id).toBe(retry.record.id);
});

it("completa e risolve il gruppo notifiche personale", async () => {
  const seeded = await reminders.create({
    sedeId: 1, recipientUserId: 7, createdByUserId: 7,
    sourceProposalId: 92, canonicalKey: "reminder:1:7:complete",
    text: "Completa pratica", remindAt: new Date("2026-08-26T09:00:00Z"),
    timezone: "Europe/Rome", clienteId: null, commessaId: null, now,
  });
  await reminders.claimDue({ now, limit: 20 });
  const record = seeded.record;
  await service.complete({ sedeId: 1, recipientUserId: 7, id: record.id });
  expect(resolveGroup).toHaveBeenCalledWith(expect.objectContaining({
    sedeId: 1, recipientUserId: 7, groupKey: `reminder:${record.id}`,
  }));
});
```

- [ ] **Step 2: Eseguire il test e verificare il fallimento previsto**

Run: `pnpm test -- server/reminders/service.test.ts`

Expected: FAIL per servizio mancante.

- [ ] **Step 3: Implementare il servizio con errori dominio stabili**

```ts
export class ReminderNotFoundError extends Error {
  constructor() { super("REMINDER_NOT_FOUND"); }
}

export function createReminderService(deps: {
  reminders: ReminderRepository;
  notifications: NotificationRepository;
  now?: () => Date;
}) {
  return {
    async listPopupDue(scope: ReminderScope) {
      return deps.reminders.listPopupDue({ ...scope, limit: 20 });
    },
    async complete(scope: ReminderScope & { id: number }) {
      const now = deps.now?.() ?? new Date();
      const record = await deps.reminders.complete({
        ...scope, actorUserId: scope.recipientUserId, now,
      });
      if (!record) throw new ReminderNotFoundError();
      await deps.notifications.resolveGroup({
        ...scope, groupKey: `reminder:${record.id}`, now,
      });
      return record;
    },
  };
}
```

Implementare nello stesso factory `createApproved`, `dismissPopup`, `snooze` e
`cancel`. `createApproved` chiama `parseFutureReminderInstant`; `snooze` chiama
`resolveSnoozeAt`; entrambe rifiutano date non future. Dopo `snooze` e `cancel`
risolvere il gruppo notifica precedente.

Esportare anche il singleton produzione e un seam di test esplicito, seguendo i
pattern già presenti nel repository:

```ts
let serviceOverride: ReminderService | null = null;

export function getReminderService(): ReminderService {
  return serviceOverride ??= createReminderService({
    reminders: getReminderRepository(),
    notifications: getNotificationRepository(),
  });
}

export function setReminderServiceForTesting(value: ReminderService | null) {
  serviceOverride = value;
}
```

Ogni suite che imposta l'override deve ripristinarlo a `null` in `afterEach`.

- [ ] **Step 4: Scrivere test API fallenti per ACL e payload**

```ts
it("restituisce solo i promemoria dovuti dell'utente corrente", async () => {
  const caller = appRouter.createCaller(context({ sedeId: 990101, userId: 77 }));
  const due = await caller.promemoria.due();
  expect(due.items.every(item => item.recipientUserId === 77)).toBe(true);
});

it("non rivela id di altro utente o altra sede", async () => {
  await expect(otherCaller.promemoria.complete({ id }))
    .rejects.toMatchObject({ code: "NOT_FOUND" });
});
```

- [ ] **Step 5: Implementare `promemoriaRouter` con input discriminato per il posticipo**

```ts
const snoozeInput = z.discriminatedUnion("kind", [
  z.object({ id: z.number().int().positive(), kind: z.literal("preset"),
    preset: z.enum(["15m", "1h", "tomorrow_9"]) }),
  z.object({ id: z.number().int().positive(), kind: z.literal("custom"),
    localDateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) }),
]);

function scope(ctx: TrpcContext) {
  const sedeId = Number(ctx.sedeId);
  const recipientUserId = Number(ctx.user?.id);
  if (!Number.isInteger(sedeId) || sedeId <= 0 ||
      !Number.isInteger(recipientUserId) || recipientUserId <= 0) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sessione non valida." });
  }
  return { sedeId, recipientUserId };
}

export const promemoriaRouter = router({
  due: protectedProcedure.query(async ({ ctx }) => ({
    items: await getReminderService().listPopupDue(scope(ctx)),
  })),
  dismissPopup: protectedProcedure.input(idInput).mutation(({ input, ctx }) =>
    runPersonal(ctx, service => service.dismissPopup({ id: input.id, ...scope(ctx) }))),
  complete: protectedProcedure.input(idInput).mutation(({ input, ctx }) =>
    runPersonal(ctx, service => service.complete({ id: input.id, ...scope(ctx) }))),
  snooze: protectedProcedure.input(snoozeInput).mutation(({ input, ctx }) =>
    runPersonal(ctx, service => service.snooze({ ...input, ...scope(ctx) }))),
  cancel: protectedProcedure.input(idInput).mutation(({ input, ctx }) =>
    runPersonal(ctx, service => service.cancel({ id: input.id, ...scope(ctx) }))),
});
```

`runPersonal` converte esclusivamente `ReminderNotFoundError` in
`TRPCError({ code: "NOT_FOUND", message: "Promemoria non trovato." })`; gli
errori data diventano `BAD_REQUEST` con copy italiano stabile.

- [ ] **Step 6: Registrare il router nell'app**

```ts
import { promemoriaRouter } from "./routers/promemoria";
```

Aggiungere `promemoria: promemoriaRouter` all'oggetto passato a `router()` che
esporta `appRouter`, accanto agli altri namespace business.

- [ ] **Step 7: Eseguire test servizio/router e typecheck**

Run: `pnpm test -- server/reminders/service.test.ts server/routers/promemoria.test.ts && pnpm check`

Expected: PASS.

- [ ] **Step 8: Committare servizio e API**

```bash
git add server/reminders/service.ts server/reminders/service.test.ts server/routers/promemoria.ts server/routers/promemoria.test.ts server/routers.ts
git commit -m "feat(reminders): expose personal reminder API"
```

---

### Task 4: Worker, SSE e campanella compatibile

**Files:**
- Create: `server/reminders/worker.ts`
- Create: `server/reminders/worker.test.ts`
- Modify: `server/_core/index.ts:32-100`
- Modify: `server/notifications/repository.ts:1-520`
- Modify: `server/notifications/repository.test.ts`
- Modify: `server/routers/notifiche.ts:481-730`
- Modify: `server/routers/notifiche.test.ts`

**Interfaces:**
- Consumes: reminder `due`, repository notifiche e `publishNotificationSignal()`.
- Produces: `runReminderWorkerOnce()` e `startReminderWorker()`; feed promemoria in ogni rollout.

- [ ] **Step 1: Estendere con test fallente il filtro tipo del repository notifiche**

```ts
it("filtra feed e count per tipo", async () => {
  const repo = createMemoryNotificationRepository();
  await repo.upsert(draft({ canonicalKey: "reminder:1", type: "reminder" }));
  await repo.upsert(draft({ canonicalKey: "assignment:1", type: "assignment" }));
  const reminderScope = { sedeId: 1, recipientUserId: 7 };
  expect((await repo.list({ ...reminderScope, types: ["reminder"], limit: 10, now })).items)
    .toHaveLength(1);
  expect(await repo.countUnread({ ...reminderScope, types: ["reminder"], now })).toBe(1);
});
```

Riutilizzare nel nuovo test `draft()` e `now` già definiti in testa a
`server/notifications/repository.test.ts`; non introdurre un secondo fixture.

- [ ] **Step 2: Implementare filtro tipo e lettura massiva in memory e SQL**

Aggiornare le firme `list`, `countUnread` e aggiungere
`markAllRead(input: Scope & { types?: string[]; now: Date })`. In memoria
filtrare con un `Set`; in PostgreSQL aggiungere la condizione:

```sql
AND (${types.length === 0} OR type IN ${sql(types)})
```

Le chiamate esistenti senza `types` devono mantenere esattamente il comportamento
precedente. `markAllRead` aggiorna soltanto record `unread`/`seen`, valorizza
`seen_at` e `read_at` in modo idempotente e restituisce il conteggio modificato.

- [ ] **Step 3: Scrivere i test fallenti del worker**

```ts
import { vi } from "vitest";

const now = new Date("2026-08-26T10:00:00.000Z");
const expiredInput = {
  sedeId: 1, recipientUserId: 7, createdByUserId: 7,
  sourceProposalId: 94, canonicalKey: "reminder:1:7:worker",
  text: "Invia il preventivo", remindAt: new Date("2026-08-26T09:00:00Z"),
  timezone: "Europe/Rome" as const, clienteId: null, commessaId: null, now,
};

it("proietta una sola notifica per revisione anche con due worker", async () => {
  const reminders = createMemoryReminderRepository();
  const notifications = createMemoryNotificationRepository();
  const publish = vi.fn();
  await reminders.create(expiredInput);
  await Promise.all([
    runReminderWorkerOnce({
      reminders, notifications, publish,
      isRecipientActive: async () => true, now,
    }),
    runReminderWorkerOnce({
      reminders, notifications, publish,
      isRecipientActive: async () => true, now,
    }),
  ]);
  expect((await notifications.list({
    sedeId: 1, recipientUserId: 7, types: ["reminder"], limit: 10, now,
  })).items).toHaveLength(1);
  expect(publish).toHaveBeenCalledTimes(1);
});

it("lascia il popup due e ritenta una proiezione fallita", async () => {
  const reminders = createMemoryReminderRepository();
  const notifications = createMemoryNotificationRepository();
  await reminders.create({ ...expiredInput, sourceProposalId: 95,
    canonicalKey: "reminder:1:7:retry" });
  const originalUpsert = notifications.upsert.bind(notifications);
  const failing = {
    ...notifications,
    upsert: vi.fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockImplementation(originalUpsert),
  };
  await runReminderWorkerOnce({
    reminders, notifications: failing, publish: vi.fn(),
    isRecipientActive: async () => true, now,
  });
  expect(await reminders.listPopupDue({ sedeId: 1, recipientUserId: 7, limit: 20 }))
    .toHaveLength(1);
  const publish = vi.fn();
  await runReminderWorkerOnce({
    reminders, notifications, publish,
    isRecipientActive: async () => true, now,
  });
  expect(publish).toHaveBeenCalledTimes(1);
});

it("non proietta finché il destinatario è disattivato", async () => {
  const reminders = createMemoryReminderRepository();
  const notifications = createMemoryNotificationRepository();
  await reminders.create({ ...expiredInput, sourceProposalId: 96,
    canonicalKey: "reminder:1:7:inactive" });
  await runReminderWorkerOnce({
    reminders, notifications, publish: vi.fn(),
    isRecipientActive: async () => false, now,
  });
  expect((await notifications.list({
    sedeId: 1, recipientUserId: 7, types: ["reminder"], limit: 10, now,
  })).items).toHaveLength(0);
});
```

- [ ] **Step 4: Implementare il giro worker iniettando tutte le dipendenze**

```ts
export async function runReminderWorkerOnce(input: {
  reminders: ReminderRepository;
  notifications: NotificationRepository;
  publish: typeof publishNotificationSignal;
  isRecipientActive: (sedeId: number, userId: number) => Promise<boolean>;
  now: Date;
  limit?: number;
}) {
  await input.reminders.claimDue({ now: input.now, limit: input.limit ?? 50 });
  const pending = await input.reminders.listPendingNotification(input.limit ?? 50);
  let projected = 0;
  for (const reminder of pending) {
    try {
      if (!(await input.isRecipientActive(
        reminder.sedeId, reminder.recipientUserId
      ))) continue;
      const result = await input.notifications.upsert({
        sedeId: reminder.sedeId,
        recipientUserId: reminder.recipientUserId,
        canonicalKey: `reminder:${reminder.id}:${reminder.revision}`,
        type: "reminder",
        priority: "normal",
        title: "Promemoria",
        body: reminder.text,
        link: reminder.commessaId ? `/commesse/${reminder.commessaId}` : "/tars?tab=chat",
        groupKey: `reminder:${reminder.id}`,
        sourceEventId: null,
        entityRefs: reminder.commessaId
          ? [{ type: "commessa", id: String(reminder.commessaId) }]
          : [],
        createdAt: reminder.remindAt,
        expiresAt: null,
      });
      const marked = await input.reminders.markNotificationProjected({
        id: reminder.id, revision: reminder.revision, now: input.now,
      });
      if (!marked) continue;
      await input.publish({ notificationId: result.id,
        recipientUserId: reminder.recipientUserId, sedeId: reminder.sedeId });
      projected += 1;
    } catch (error) {
      console.warn("[reminders] notification projection failed", {
        code: error instanceof Error ? error.name : "UNKNOWN",
      });
    }
  }
  return { projected };
}
```

`startReminderWorker()` esegue subito `run`, poi `setInterval(run, 15_000)` con
`unref()`. Un booleano `running` evita sovrapposizioni nello stesso processo.
La dipendenza produzione `isRecipientActive` legge `getUtentiStore()` e richiede
utente `attivo` assegnato alla sede; se è disattivato la revisione resta pending
e sarà proiettata soltanto dopo un'eventuale riattivazione.

Il solo kill switch operativo è `REMINDER_WORKER_ENABLED=false`: in quel caso
`startReminderWorker()` restituisce senza creare timer e registra soltanto un
messaggio tecnico privo di dati personali. Qualsiasi altro valore, incluso
l'assenza della variabile, mantiene il worker attivo. Aggiungere un test con
fake timer che verifichi zero callback quando il kill switch è disabilitato e
un giro immediato più intervallo a 15 secondi quando è attivo.

- [ ] **Step 5: Inizializzare schema e worker dopo il bootstrap**

In `startServer()`:

```ts
const { getReminderRepository } = await import("../reminders/repository");
await getReminderRepository().ensureSchema();
const { startReminderWorker } = await import("../reminders/worker");
startReminderWorker();
```

Posizionarlo dopo lo schema notifiche/eventi e prima dell'ascolto HTTP; un errore
schema in produzione deve fermare l'avvio.

- [ ] **Step 6: Scrivere test fallenti per feed legacy/shadow/active**

Per tre sedi test distinte creare una notifica persistente `type: "reminder"` e
verificare:

```ts
expect((await caller.notifiche.feed({ limit: 10 })).items
  .filter(item => item.type === "reminder")).toHaveLength(1);
expect((await caller.notifiche.unreadCount()).count).toBeGreaterThanOrEqual(1);
await caller.notifiche.markAllRead();
expect((await caller.notifiche.unreadCount()).count).toBe(0);
```

In `shadow`, il confronto diagnostico deve continuare a confrontare il solo feed
piattaforma: calcolare `persistentPlatformUnread` come conteggio persistente
totale meno `countUnread({types:["reminder"]})`, confrontarlo con il legacy e
sommare il promemoria soltanto dopo il confronto.

- [ ] **Step 7: Unire i promemoria persistenti al feed non-active**

Estrarre `listReminderNotifications(sedeId,userId,input)` che usa
`types:["reminder"]`. In `legacy` e `shadow` unire `legacy.map(legacyDto)` e
`persistent.map(persistentDto)`, ordinare per `createdAt` decrescente e applicare
il limite una sola volta. `unreadCount` restituisce `legacyCount + reminderCount`.
In `active` il feed persistente già contiene il promemoria e non va sommato.
`markAllRead` marca i record legacy e i soli persistenti `reminder` in
legacy/shadow; in active marca tutti i persistenti. I singoli `markSeen` e
`markRead` continuano a distinguere id legacy stringa e id persistente numero.

- [ ] **Step 8: Eseguire test worker/notifiche e typecheck**

Run: `pnpm test -- server/reminders/worker.test.ts server/notifications/repository.test.ts server/routers/notifiche.test.ts && pnpm check`

Expected: PASS.

- [ ] **Step 9: Committare worker e integrazione notifiche**

```bash
git add server/reminders/worker.ts server/reminders/worker.test.ts server/_core/index.ts server/notifications/repository.ts server/notifications/repository.test.ts server/routers/notifiche.ts server/routers/notifiche.test.ts
git commit -m "feat(reminders): deliver due notifications"
```

---

### Task 5: Flusso Tars domanda → proposta → approvazione

**Files:**
- Modify: `server/tars/stores.ts:25-240`
- Modify: `server/tars/tools.ts:70-360,950-1030,1310-1530,2900-3260`
- Modify: `server/tars/prompt.ts:1-250`
- Modify: `server/tars/seguito.ts:25-115`
- Modify: `server/tars/esecutore.ts:150-520`
- Modify: `server/routers/tars.ts:40-250,690-940`
- Modify: `server/tars/tars.test.ts`
- Modify: `server/tars/evals/cases/core.json`
- Modify: `server/tars/evals/types.ts`
- Modify: `server/tars/evals/fixtures.test.ts`
- Modify: `server/tars/evals/metadata.test.ts`

**Interfaces:**
- Consumes: `ReminderService.createApproved()` e origine domanda Tars.
- Produces: `TipoProposta="promemoria"`, tool `proponi_promemoria`, owner `requestedByUserId` e capability `reminder.create`.

- [ ] **Step 1: Scrivere test fallenti per store e profili tool**

```ts
it("espone proponi_promemoria solo nei percorsi umani previsti", () => {
  expect(toolDefsForTrigger("chat").map(t => t.name)).toContain("proponi_promemoria");
  expect(toolDefsForTrigger("seguito").map(t => t.name)).toContain("proponi_promemoria");
  expect(toolDefsForTrigger("smistamento").map(t => t.name))
    .not.toContain("proponi_promemoria");
  expect(toolDefsForTrigger("audit_processi").map(t => t.name))
    .not.toContain("proponi_promemoria");
});

it("il prompt distingue promemoria, nota e calendario", () => {
  const prompt = buildSystemPrompt(1);
  expect(prompt).toContain("promemoria personale");
  expect(prompt).toContain("chiedi sempre quando");
  expect(prompt).toContain("non usare proponi_nota_timeline");
});
```

Aggiungere a `core.json` tre fixture versionate e farle validare da
`fixtures.test.ts`:

```json
[
  {"id":"reminder-missing-time-01","version":1,"family":"reminder","trigger":"chat","input":{"text":"Ricordami di inviare il preventivo"},"expected":{"intent":"personal_reminder","toolNames":["chiedi_chiarimento"],"forbiddenToolNames":["proponi_promemoria","proponi_nota_timeline"],"proposalTypes":["domanda"],"requiresEvidence":false,"finalState":"waiting_user"},"tags":["time-required"]},
  {"id":"reminder-confirm-time-01","version":1,"family":"reminder","trigger":"chat","input":{"text":"Ricordami domani alle 9 di chiamare Rossi"},"expected":{"intent":"personal_reminder","toolNames":["chiedi_chiarimento"],"forbiddenToolNames":["proponi_promemoria","proponi_nota_timeline"],"proposalTypes":["domanda"],"requiresEvidence":false,"finalState":"waiting_confirmation"},"tags":["time-confirmation"]},
  {"id":"reminder-answered-time-01","version":1,"family":"reminder","trigger":"seguito","input":{"requestedText":"Chiamare Rossi","answer":"27 agosto 2026 alle 09:00"},"expected":{"intent":"personal_reminder","toolNames":["proponi_promemoria"],"forbiddenToolNames":["proponi_nota_timeline"],"proposalTypes":["promemoria"],"requiresEvidence":false,"finalState":"waiting_approval"},"tags":["follow-up","approval"]}
]
```

Inserire soltanto i tre oggetti nell'array già esistente di `core.json`.
Aggiungere anche `"reminder"` a `EVAL_FAMILIES` in `types.ts`, così il corpus
continua a essere validato dal loader senza allargare il tipo a stringhe libere.
Poiché cambiano prompt e catalogo strumenti, incrementare
`TARS_PROMPT_VERSION` a `prompt-v3` e `TARS_TOOL_REGISTRY_VERSION` a `tools-v3`;
aggiornare `metadata.test.ts` affinché verifichi che le nuove versioni arrivino
nei metadati di esecuzione.

- [ ] **Step 2: Aggiungere tipo, owner e backfill proposta**

In `TIPI_PROPOSTA` aggiungere `"promemoria"`. In `Proposta` aggiungere:

```ts
requestedByUserId: number | null;
```

Nel `onLoad`: `if (p.requestedByUserId === undefined) p.requestedByUserId = null`.
In `creaProposta`, impostare sempre il valore dal runtime:

```ts
const requestedByUserId = Number((rt.ctx.user as any)?.id) || null;
```

Inserire la proprietà shorthand `requestedByUserId` nel record `p` costruito da
`creaProposta`; il payload dello strumento non deve poterla sovrascrivere.

Estendere `chiaveAzioneProposta` con `requestedByUserId` e il caso:

```ts
case "promemoria":
  effetto = {
    requestedByUserId: p.requestedByUserId ?? null,
    text: normalizzaTesto(pay.text),
    remindAtIso: pay.remindAtIso,
    commessaId: p.commessaId ?? null,
    clienteId: p.clienteId ?? null,
  };
  break;
```

- [ ] **Step 3: Estendere `chiedi_chiarimento` con provenance promemoria**

Nel JSON schema aggiungere:

```ts
intent: { type: "string", enum: ["promemoria"] },
requestedText: { type: "string", maxLength: 500 },
```

Nel payload del caso `chiedi_chiarimento`, copiare solo valori validi. Il prompt
obbliga `intent:"promemoria"` e `requestedText` quando il messaggio contiene
"ricordami"; se data/ora sono già presenti, la domanda deve confermare l'istante
italiano esplicito.

- [ ] **Step 4: Scrivere il test fallente del gate server**

```ts
it("rifiuta un promemoria senza domanda temporale risposta", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-26T10:00:00.000Z"));
  const rt: ToolRuntime = {
    ctx: makeCtx(), esecuzioneId: 999_901, trigger: "chat",
    maxProposte: 3, proposteIds: [], terminato: null,
    origineId: null, risultatiCache: new Map(),
  };
  const result = await eseguiStrumento(rt, "proponi_promemoria", {
      text: "Invia preventivo", remindAtIso: "2026-08-27T09:00:00+02:00",
      timezone: "Europe/Rome", titolo: "Invia preventivo",
      motivazione: "Richiesto dall'operatore", confidenza: "alta",
    });
  expect(result.isError).toBe(true);
  expect(result.content).toContain("chiedere quando");
  vi.useRealTimers();
});
```

Spostare `vi.useRealTimers()` in `afterEach` per garantire il ripristino anche
quando un'asserzione fallisce.

- [ ] **Step 5: Definire e implementare `proponi_promemoria`**

Schema tool:

```ts
{
  name: "proponi_promemoria",
  description: "Propone un promemoria personale solo dopo una domanda temporale risposta.",
  input_schema: {
    type: "object",
    properties: {
      text: { type: "string", maxLength: 500 },
      remindAtIso: { type: "string", description: "ISO 8601 con offset" },
      timezone: { type: "string", enum: ["Europe/Rome"] },
      commessaId: { type: "number" }, clienteId: { type: "number" },
      ...PROPOSTA_PROPS,
    },
    required: ["text", "remindAtIso", "timezone", "titolo", "motivazione", "confidenza"],
  },
}
```

Nel handler verificare, in quest'ordine:

1. trigger `chat` o `seguito`;
2. `rt.origineId` punta a una proposta stessa sede di tipo `domanda`;
3. origine `stato === "risposta"`, `payload.intent === "promemoria"` e risposta non vuota;
4. `origine.requestedByUserId === current user id`;
5. `timezone === "Europe/Rome"`, testo non vuoto e ISO futuro con offset;
6. cliente/commessa eventuali esistono nella sede attiva, altrimenti errore generico;
7. creare una sola proposta `promemoria` con timestamp normalizzato UTC.

- [ ] **Step 6: Rendere il seguito specifico per il promemoria**

In `richiestaSeguito`, prima del testo generico della domanda:

```ts
if (p.payload?.intent === "promemoria") {
  return `${intestazione}\n\nL'operatore vuole questo promemoria personale:
<promemoria>${p.payload.requestedText}</promemoria>
<quando>${p.risposta ?? ""}</quando>

Interpreta la risposta in Europe/Rome. Se non identifica data e ora esatte,
usa ancora chiedi_chiarimento. Se è esatta, usa proponi_promemoria una sola
volta. Non creare note timeline, appuntamenti o attività operative.`;
}
```

- [ ] **Step 7: Riservare domanda e decisione al richiedente**

In `server/routers/tars.ts` aggiungere:

```ts
function assertReminderOwner(p: Proposta, user: any) {
  const personal = p.tipo === "promemoria" ||
    (p.tipo === "domanda" && p.payload?.intent === "promemoria");
  if (personal && Number(p.requestedByUserId) !== Number(user?.id)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Proposta non trovata." });
  }
}
```

Chiamarlo in `approveProposalOnce`, `rifiuta` e `rispondi` subito dopo
`trovaPropostaVisibile`. Aggiungere `promemoria:["reminder.create"]` a
`CAPABILITIES_PER_PROPOSAL`.

- [ ] **Step 8: Eseguire il promemoria approvato tramite il servizio**

In `eseguiProposta`:

```ts
case "promemoria": {
  const requestedByUserId = Number(proposta.requestedByUserId);
  if (requestedByUserId !== Number((ctx.user as any)?.id)) {
    throw new Error("Il promemoria personale può essere approvato solo dal richiedente.");
  }
  const { getReminderService } = await import("../reminders/service");
  const sedeId = Number(ctx.sedeId);
  if (!Number.isInteger(sedeId) || sedeId <= 0) {
    throw new Error("Sede attiva non valida.");
  }
  const result = await getReminderService().createApproved({
    sedeId,
    requestedByUserId,
    sourceProposalId: proposta.id,
    actionKey: proposta.chiaveAzione ?? `promemoria:${proposta.id}`,
    text: p.text,
    remindAtIso: p.remindAtIso,
    clienteId: proposta.clienteId,
    commessaId: proposta.commessaId,
    now: new Date(),
  });
  return `Promemoria impostato per ${formatReminderForAudit(result.record.remindAt)}`;
}
```

L'esecutore rivalida utente attivo, cliente e commessa nella sede prima di
`createApproved`; una data scaduta produce l'errore italiano della spec.

- [ ] **Step 9: Aggiungere test end-to-end del contratto Tars**

Nel test usare `makeCtx()`, `appRouter.createCaller(ctx)` e un `ToolRuntime`
esplicito come nello Step 4. Chiamare `chiedi_chiarimento` con
`intent:"promemoria"`, leggere l'id aggiunto a `rt.proposteIds`, rispondere con
`caller.tars.rispondi`, quindi creare un secondo runtime con `trigger:"seguito"`
e `origineId` uguale all'id della domanda. Chiamare `proponi_promemoria`, leggere
la nuova proposta da `proposte`, approvarla con `caller.tars.approva` e verificare
tramite il repository un solo record con `sourceProposalId` uguale. Richiamare
l'approvazione e verificare lo stesso id. Creare infine un caller copiando il
contesto ma con un altro `user.id`: risposta e approvazione devono entrambe
restituire `NOT_FOUND` e non cambiare repository o audit.

- [ ] **Step 10: Eseguire i test Tars e typecheck**

Run: `pnpm test -- server/tars/tars.test.ts server/tars/evals/fixtures.test.ts server/tars/evals/metadata.test.ts server/routers/promemoria.test.ts && pnpm check`

Expected: PASS, inclusi metadati tool/profilo aggiornati.

- [ ] **Step 11: Committare il flusso Tars**

```bash
git add server/tars/stores.ts server/tars/tools.ts server/tars/prompt.ts server/tars/seguito.ts server/tars/esecutore.ts server/routers/tars.ts server/tars/tars.test.ts server/tars/evals/cases/core.json server/tars/evals/types.ts server/tars/evals/fixtures.test.ts server/tars/evals/metadata.test.ts
git commit -m "feat(tars): propose personal reminders"
```

---

### Task 6: Card Tars e popup globale accessibile

**Files:**
- Create: `client/src/lib/reminders.ts`
- Create: `client/src/lib/reminders.test.ts`
- Create: `client/src/components/PromemoriaPopupHost.tsx`
- Modify: `client/src/components/TarsPropostaCard.tsx:1-240`
- Modify: `client/src/hooks/useNotificationStream.ts:35-65`
- Modify: `client/src/components/DashboardLayout.tsx:140-190`
- Modify: `client/src/components/SedeSwitcher.tsx:20-40`
- Modify: `client/src/_core/hooks/useAuth.ts:20-55`

**Interfaces:**
- Consumes: `trpc.promemoria.due/complete/snooze/dismissPopup` e proposta `promemoria`.
- Produces: formattazione `it-IT`, coda deterministica e dialog globale.

- [ ] **Step 1: Scrivere test fallenti per formattazione e selezione coda**

```ts
import { describe, expect, it } from "vitest";
import { formatReminderAt, nextDueReminder, remainingReminderLabel } from "./reminders";

it("formatta sempre nel fuso di Roma", () => {
  expect(formatReminderAt(new Date("2026-08-27T07:00:00Z")))
    .toContain("09:00");
});

it("sceglie la scadenza più vecchia con tie-break id", () => {
  expect(nextDueReminder([
    { id: 9, remindAt: new Date("2026-08-27T07:00:00Z") },
    { id: 8, remindAt: new Date("2026-08-27T07:00:00Z") },
  ])?.id).toBe(8);
  expect(remainingReminderLabel(3)).toBe("Altri 2 promemoria in attesa");
});
```

- [ ] **Step 2: Implementare helper puri**

```ts
export const formatReminderAt = (value: Date | string) =>
  new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome", weekday: "long", day: "2-digit",
    month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));

export function nextDueReminder<T extends { id: number; remindAt: Date | string }>(items: T[]) {
  return [...items].sort((a, b) =>
    new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime() || a.id - b.id
  )[0] ?? null;
}
```

- [ ] **Step 3: Mostrare la proposta promemoria nella card Tars**

In `TIPO_LABEL` aggiungere `promemoria: "Promemoria"`. In `describePayload`:

```ts
case "promemoria":
  out.push(`Quando: ${formatReminderAt(pay.remindAtIso)}`);
  out.push(`Per te: ${proposta.requestedByName ?? "utente corrente"}`);
  out.push(`Promemoria: ${pay.text}`);
  break;
```

Estendere l'idratazione server della proposta con `requestedByName`, ricavato da
utente attivo stessa sede o dal nome dell'esecuzione; non restituire dati di
utenti di altre sedi.

- [ ] **Step 4: Implementare `PromemoriaPopupHost` come Dialog controllato**

Struttura minima:

```tsx
export function PromemoriaPopupHost() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const due = trpc.promemoria.due.useQuery(undefined, {
    enabled: Boolean(user),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const current = nextDueReminder(due.data?.items ?? []);
  const [customOpen, setCustomOpen] = useState(false);
  const [customDate, setCustomDate] = useState("");
  const doneRef = useRef<HTMLButtonElement>(null);
  const refresh = async () => {
    await Promise.all([
      utils.promemoria.due.invalidate(), utils.notifiche.feed.invalidate(),
      utils.notifiche.unreadCount.invalidate(),
    ]);
  };
  const dismissPopup = trpc.promemoria.dismissPopup.useMutation({ onSuccess: refresh });
  const complete = trpc.promemoria.complete.useMutation({ onSuccess: refresh });
  const snooze = trpc.promemoria.snooze.useMutation({ onSuccess: refresh });
  const busy = dismissPopup.isPending || complete.isPending || snooze.isPending;
  const error = dismissPopup.error ?? complete.error ?? snooze.error;

  const openJob = async () => {
    if (!current?.commessaId) return;
    await dismissPopup.mutateAsync({ id: current.id });
    setLocation(`/commesse/${current.commessaId}`);
  };

  return (
    <Dialog open={Boolean(current)} onOpenChange={open => {
      if (!open && current && !busy) dismissPopup.mutate({ id: current.id });
    }}>
      <DialogContent
        className="w-[calc(100vw-1.5rem)] max-w-lg overflow-hidden p-0"
        onOpenAutoFocus={event => {
          event.preventDefault();
          doneRef.current?.focus();
        }}
      >
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Promemoria</DialogTitle>
          <DialogDescription>{current ? formatReminderAt(current.remindAt) : ""}</DialogDescription>
        </DialogHeader>
        {current ? (
          <div className="min-w-0 space-y-4 px-5 py-4">
            <p className="break-words text-sm [overflow-wrap:anywhere]">{current.text}</p>
            {due.data && due.data.items.length > 1 ? (
              <p className="text-xs text-muted-foreground">
                {remainingReminderLabel(due.data.items.length)}
              </p>
            ) : null}
            {error ? <p role="alert" className="text-sm text-destructive">{error.message}</p> : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <Button ref={doneRef} className="min-h-11" disabled={busy}
                onClick={() => complete.mutate({ id: current.id })}>
                {complete.isPending ? <Loader2 className="animate-spin" /> : <Check />}
                Fatto
              </Button>
              {current.commessaId ? (
                <Button variant="outline" className="min-h-11" disabled={busy}
                  onClick={() => void openJob()}>
                  <ExternalLink /> Apri commessa
                </Button>
              ) : null}
            </div>
            <div className="space-y-2 border-t pt-4">
              <p className="text-sm font-medium">Posticipa</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([ ["15m", "15 minuti"], ["1h", "1 ora"],
                    ["tomorrow_9", "Domani 09:00"] ] as const).map(([preset, label]) => (
                  <Button key={preset} variant="secondary" className="min-h-11"
                    disabled={busy} onClick={() => snooze.mutate({
                      id: current.id, kind: "preset", preset,
                    })}>{label}</Button>
                ))}
                <Button variant="secondary" className="min-h-11" disabled={busy}
                  onClick={() => setCustomOpen(value => !value)}>Personalizza</Button>
              </div>
              {customOpen ? (
                <div className="space-y-2">
                  <Label htmlFor="reminder-custom-date">Nuova data e ora</Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input id="reminder-custom-date" type="datetime-local"
                      value={customDate} onChange={event => setCustomDate(event.target.value)} />
                    <Button className="min-h-11" disabled={busy || !customDate}
                      onClick={() => snooze.mutate({
                        id: current.id, kind: "custom", localDateTime: customDate,
                      })}>Conferma</Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
```

Il corpo usa `break-words [overflow-wrap:anywhere]`. I pulsanti **Fatto**,
**Posticipa**, preset, scelta personalizzata e **Apri commessa** hanno
`min-h-11`. Durante una mutation disabilitare tutte le azioni e mostrare
`Loader2`. Se una mutation fallisce, mantenere il dialog aperto e mostrare
`error.message` in un blocco `role="alert"`.

- [ ] **Step 5: Gestire navigazione e posticipo senza perdere lo stato**

- **Fatto** chiama `complete({id})`.
- 15 minuti, 1 ora e domani alle 9 chiamano `snooze({id,kind:"preset",preset})`.
- La scelta personalizzata mostra un `<Input type="datetime-local">` con
  `<Label>` visibile e chiama `snooze({id,kind:"custom",localDateTime})`.
- **Apri commessa** attende `dismissPopup`, poi naviga a
  `/commesse/${commessaId}`.
- Chiusura X, `Esc` o backdrop chiama `dismissPopup`; se fallisce, riapre il
  dialog con errore.

- [ ] **Step 6: Montare il popup e collegarlo allo stream**

In `DashboardLayout`, dentro il ramo autenticato e accanto a `TarsChatFloating`:

```tsx
<PromemoriaPopupHost />
```

In `useNotificationStream.refresh()`:

```ts
void utils.promemoria.due.invalidate();
```

Il polling resta attivo anche quando `realtimeNotifications` è false; TanStack
Query non esegue l'intervallo in background e rifà il fetch al focus.

- [ ] **Step 7: Azzerare la coda prima di cambio sede e logout**

In `SedeSwitcher`, prima della mutation di cambio sede, annullare il fetch e
svuotare il dato cached:

```ts
onMutate: async () => {
  await utils.promemoria.due.cancel();
  utils.promemoria.due.setData(undefined, { items: [] });
},
```

Nel `finally` di `logout()` eseguire lo stesso `cancel` + `setData` prima di
azzerare `auth.me`. In `PromemoriaPopupHost` impostare `enabled` soltanto quando
`useAuth()` restituisce un utente autenticato. Questo impedisce che una coda
personale resti visibile tra due principal o durante il cambio sede; il normale
`utils.invalidate()` dello switch ricarica poi lo scope nuovo.

- [ ] **Step 8: Eseguire test helper e typecheck**

Run: `pnpm test -- client/src/lib/reminders.test.ts && pnpm check`

Expected: PASS.

- [ ] **Step 9: Committare card e popup**

```bash
git add client/src/lib/reminders.ts client/src/lib/reminders.test.ts client/src/components/PromemoriaPopupHost.tsx client/src/components/TarsPropostaCard.tsx client/src/hooks/useNotificationStream.ts client/src/components/DashboardLayout.tsx client/src/components/SedeSwitcher.tsx client/src/_core/hooks/useAuth.ts
git commit -m "feat(ui): show due reminder popup"
```

---

### Task 7: Integrazione, QA visuale e documentazione

**Files:**
- Modify: `handoff.md`
- Modify: `Agente_Ruffino_Ops.md`
- Modify: `documento_requisiti_infissi_ops.md`
- Modify: `scripts/build-prd-pdf.sh`
- Modify: `PRD_infissi_ops_v4.pdf`
- Review: tutti i file modificati nei Task 1-6

**Interfaces:**
- Consumes: flusso completo compilato e testato.
- Produces: contratto documentato, PRD v4.30 e verifica desktop/mobile.

- [ ] **Step 1: Aggiungere un test d'integrazione del percorso completo**

In `server/routers/promemoria.test.ts` aggiungere un caso con
`vi.useFakeTimers()`, un `now` fisso, i due repository memory e i factory
`createReminderService`/`runReminderWorkerOnce`. Iniettare il servizio nel router
con `setReminderServiceForTesting(service)`. Il test deve:

1. crea una proposta `promemoria` con owner e origine domanda risposta;
2. approva tramite `appRouter.createCaller` come richiedente;
3. fa avanzare l'orologio oltre la scadenza;
4. esegue `runReminderWorkerOnce`;
5. verifica `promemoria.due`, `notifiche.feed` e `unreadCount`;
6. completa il promemoria e verifica popup vuoto e gruppo notifica risolto.

Usare sede/user id unici, `isRecipientActive: async () => true`, un `publish`
mockato e repository memory; ripristinare timer e singleton in `afterEach`.
Nessuna chiamata OpenAI live.

- [ ] **Step 2: Eseguire tutti i test prima della QA browser**

Run: `pnpm test`

Expected: tutti i test PASS, nessuna chiamata esterna.

- [ ] **Step 3: Avviare il CRM e predisporre dati di prova locali**

Run: `pnpm dev`

Dal flusso reale della chat Tars creare e approvare tre promemoria con scadenza
un minuto avanti, aspettare la scadenza e verificare la coda senza introdurre
route di debug o scritture SQL manuali:

- testo breve senza commessa;
- testo lungo con commessa valida;
- terzo elemento per verificare il conteggio coda.

Non inserire dati cliente reali nei fixture o negli screenshot.

- [ ] **Step 4: Verificare desktop 1440 x 900 nel browser**

Controllare:

- popup centrato, testo non troncato, data leggibile;
- focus iniziale su **Fatto**, Tab ordinato, `Esc` funzionante;
- chiusura lascia la notifica nella campanella;
- **Posticipa** rimuove il popup corrente e mostra il successivo;
- **Apri commessa** naviga dopo la dismissione;
- nessun errore console e nessuna richiesta push/email.

- [ ] **Step 5: Verificare mobile 390 x 844 nel browser**

Controllare:

- larghezza entro viewport e nessuno scroll orizzontale;
- pulsanti minimi 44 px, testo lungo a capo;
- selezione data personalizzata utilizzabile senza sovrapposizioni;
- tastiera/viewport non nascondono le azioni;
- i promemoria multipli avanzano uno alla volta.

- [ ] **Step 6: Aggiornare i documenti sorgente**

In `handoff.md` aggiungere una sezione "Promemoria personali Tars del
26/08/2026" con schema, worker 15 s, fallback polling, route e limiti. In
`Agente_Ruffino_Ops.md` documentare `chiedi_chiarimento(intent=promemoria)`,
`proponi_promemoria`, ownership e approvazione. In
`documento_requisiti_infissi_ops.md`:

- aggiornare versione a `v4.30` e data;
- aggiungere il comportamento in §25 e §50;
- aggiungere `promemoria`, `promemoria_eventi` alle tabelle;
- aggiungere una riga cronologia v4.30;
- dichiarare esplicitamente fuori ambito Web Push a CRM chiuso.

- [ ] **Step 7: Rigenerare e verificare il PDF PRD**

Prima del comando seguire la skill PDF e registrare l'operazione di modifica.
Aggiornare il `<title>` di `scripts/build-prd-pdf.sh` a v4.30, poi:

Run: `bash scripts/build-prd-pdf.sh`

Renderizzare le pagine modificate del PDF in `tmp/pdfs/`, ispezionarle e
verificare titoli, spezzature, numerazione e assenza di testo tagliato. Non
consegnare PNG intermedi.

- [ ] **Step 8: Eseguire i gate finali da stato pulito**

Run: `pnpm check && pnpm test && pnpm build`

Expected: exit code 0 per tutti e tre.

- [ ] **Step 9: Controllare diff e segreti**

Run:

```bash
git diff --check
git status --short
git diff --stat
rg -n 'OPENAI_API_KEY=|DATABASE_URL=|MAIL_ENCRYPTION_KEY=' --glob '!*.example' --glob '!docs/**' .
```

Expected: nessun whitespace error; nessun segreto aggiunto; soltanto file della
funzionalità e documentazione prevista.

- [ ] **Step 10: Committare integrazione e documentazione**

```bash
git add handoff.md Agente_Ruffino_Ops.md documento_requisiti_infissi_ops.md scripts/build-prd-pdf.sh PRD_infissi_ops_v4.pdf server/routers/promemoria.test.ts
git commit -m "docs(tars): document personal reminders"
```

- [ ] **Step 11: Verificare il commit finale**

Run: `git status --short && git log --oneline -8`

Expected: worktree pulito e sette checkpoint della funzionalità visibili dopo
il commit della specifica `64c2efa`.
