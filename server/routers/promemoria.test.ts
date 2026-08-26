import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { createMemoryNotificationRepository } from "../notifications/repository";
import { createMemoryReminderRepository } from "../reminders/repository";
import {
  createReminderService,
  setReminderServiceForTesting,
} from "../reminders/service";
import { appRouter } from "../routers";

const now = new Date("2026-08-26T10:00:00.000Z");

function context(sedeId: number, userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      role: "user",
      ruolo: "commerciale",
      ruoli: ["commerciale"],
      name: `Utente ${userId}`,
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

describe("promemoria API", () => {
  let reminders: ReturnType<typeof createMemoryReminderRepository>;

  beforeEach(() => {
    reminders = createMemoryReminderRepository();
    setReminderServiceForTesting(
      createReminderService({
        reminders,
        notifications: createMemoryNotificationRepository(),
        now: () => now,
      }),
    );
  });

  afterEach(() => {
    setReminderServiceForTesting(null);
  });

  it("restituisce solo i promemoria dovuti dell'utente corrente", async () => {
    await reminders.create({
      sedeId: 990101,
      recipientUserId: 77,
      createdByUserId: 77,
      sourceProposalId: 901,
      canonicalKey: "reminder:990101:77:mine",
      text: "Invia il preventivo",
      remindAt: new Date("2026-08-26T09:00:00Z"),
      timezone: "Europe/Rome",
      clienteId: null,
      commessaId: null,
      now,
    });
    await reminders.create({
      sedeId: 990101,
      recipientUserId: 78,
      createdByUserId: 78,
      sourceProposalId: 902,
      canonicalKey: "reminder:990101:78:other",
      text: "Promemoria privato",
      remindAt: new Date("2026-08-26T09:00:00Z"),
      timezone: "Europe/Rome",
      clienteId: null,
      commessaId: null,
      now,
    });
    await reminders.claimDue({ now, limit: 20 });

    const due = await appRouter
      .createCaller(context(990101, 77))
      .promemoria.due();

    expect(due.items).toHaveLength(1);
    expect(due.items[0]).toMatchObject({
      sedeId: 990101,
      recipientUserId: 77,
      text: "Invia il preventivo",
    });
  });

  it("non rivela id di altro utente o altra sede", async () => {
    const created = await reminders.create({
      sedeId: 990102,
      recipientUserId: 77,
      createdByUserId: 77,
      sourceProposalId: 903,
      canonicalKey: "reminder:990102:77:private",
      text: "Richiama il cliente",
      remindAt: new Date("2026-08-26T09:00:00Z"),
      timezone: "Europe/Rome",
      clienteId: null,
      commessaId: null,
      now,
    });

    await expect(
      appRouter.createCaller(context(990102, 78)).promemoria.complete({
        id: created.record.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      appRouter.createCaller(context(990103, 77)).promemoria.complete({
        id: created.record.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("traduce una data locale non valida in una richiesta correggibile", async () => {
    const created = await reminders.create({
      sedeId: 990104,
      recipientUserId: 77,
      createdByUserId: 77,
      sourceProposalId: 904,
      canonicalKey: "reminder:990104:77:date",
      text: "Controlla il sopralluogo",
      remindAt: new Date("2026-08-26T09:00:00Z"),
      timezone: "Europe/Rome",
      clienteId: null,
      commessaId: null,
      now,
    });
    await reminders.claimDue({ now, limit: 20 });

    await expect(
      appRouter.createCaller(context(990104, 77)).promemoria.snooze({
        id: created.record.id,
        kind: "custom",
        localDateTime: "2026-03-29T02:30",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Data o ora del promemoria non valida.",
    });
  });
});
