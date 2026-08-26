import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryNotificationRepository } from "../notifications/repository";
import { createMemoryReminderRepository } from "./repository";
import {
  ReminderNotFoundError,
  createReminderService,
} from "./service";

const now = new Date("2026-08-26T10:00:00.000Z");

describe("reminder service", () => {
  let reminders: ReturnType<typeof createMemoryReminderRepository>;
  let notifications: ReturnType<typeof createMemoryNotificationRepository>;
  let service: ReturnType<typeof createReminderService>;

  beforeEach(() => {
    reminders = createMemoryReminderRepository();
    notifications = createMemoryNotificationRepository();
    service = createReminderService({
      reminders,
      notifications,
      now: () => now,
    });
  });

  it("crea una volta sola dal principal originale", async () => {
    const input = {
      sedeId: 1,
      requestedByUserId: 7,
      sourceProposalId: 91,
      actionKey: "promemoria:1:7:x",
      text: "Invia preventivo",
      remindAtIso: "2026-08-27T09:00:00+02:00",
      clienteId: null,
      commessaId: null,
    };

    const first = await service.createApproved(input);
    const retry = await service.createApproved(input);

    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(first.record.id).toBe(retry.record.id);
    expect(first.record).toMatchObject({
      sedeId: 1,
      recipientUserId: 7,
      createdByUserId: 7,
      timezone: "Europe/Rome",
    });
  });

  it("rifiuta la creazione con una data scaduta", async () => {
    await expect(
      service.createApproved({
        sedeId: 1,
        requestedByUserId: 7,
        sourceProposalId: 92,
        actionKey: "promemoria:1:7:past",
        text: "Invia preventivo",
        remindAtIso: "2026-08-26T11:00:00+02:00",
        clienteId: null,
        commessaId: null,
      }),
    ).rejects.toThrow("REMINDER_TIME_NOT_FUTURE");
  });

  it("completa e risolve il gruppo notifiche personale", async () => {
    const resolveGroup = vi.spyOn(notifications, "resolveGroup");
    const seeded = await reminders.create({
      sedeId: 1,
      recipientUserId: 7,
      createdByUserId: 7,
      sourceProposalId: 93,
      canonicalKey: "reminder:1:7:complete",
      text: "Completa pratica",
      remindAt: new Date("2026-08-26T09:00:00Z"),
      timezone: "Europe/Rome",
      clienteId: null,
      commessaId: null,
      now,
    });
    await reminders.claimDue({ now, limit: 20 });

    const record = await service.complete({
      sedeId: 1,
      recipientUserId: 7,
      id: seeded.record.id,
    });

    expect(record.status).toBe("completed");
    expect(resolveGroup).toHaveBeenCalledWith({
      sedeId: 1,
      recipientUserId: 7,
      groupKey: `reminder:${record.id}`,
      now,
    });
  });

  it("posticipa in ora di Roma e risolve la revisione precedente", async () => {
    const resolveGroup = vi.spyOn(notifications, "resolveGroup");
    const seeded = await reminders.create({
      sedeId: 1,
      recipientUserId: 7,
      createdByUserId: 7,
      sourceProposalId: 94,
      canonicalKey: "reminder:1:7:snooze",
      text: "Richiama il cliente",
      remindAt: new Date("2026-08-26T09:00:00Z"),
      timezone: "Europe/Rome",
      clienteId: null,
      commessaId: null,
      now,
    });
    await reminders.claimDue({ now, limit: 20 });

    const record = await service.snooze({
      sedeId: 1,
      recipientUserId: 7,
      id: seeded.record.id,
      kind: "custom",
      localDateTime: "2026-08-26T14:30",
    });

    expect(record).toMatchObject({ status: "scheduled", revision: 2 });
    expect(record.remindAt.toISOString()).toBe("2026-08-26T12:30:00.000Z");
    expect(resolveGroup).toHaveBeenCalledOnce();
  });

  it("non rivela un id fuori scope", async () => {
    const seeded = await reminders.create({
      sedeId: 1,
      recipientUserId: 7,
      createdByUserId: 7,
      sourceProposalId: 95,
      canonicalKey: "reminder:1:7:private",
      text: "Controlla il cantiere",
      remindAt: new Date("2026-08-27T09:00:00Z"),
      timezone: "Europe/Rome",
      clienteId: null,
      commessaId: null,
      now,
    });

    await expect(
      service.complete({ sedeId: 1, recipientUserId: 8, id: seeded.record.id }),
    ).rejects.toBeInstanceOf(ReminderNotFoundError);
  });
});
