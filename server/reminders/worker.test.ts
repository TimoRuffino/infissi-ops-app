import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryNotificationRepository } from "../notifications/repository";
import { createMemoryReminderRepository } from "./repository";
import { runReminderWorkerOnce, startReminderWorker } from "./worker";

const now = new Date("2026-08-26T10:00:00.000Z");
const expiredInput = {
  sedeId: 1,
  recipientUserId: 7,
  createdByUserId: 7,
  sourceProposalId: 94,
  canonicalKey: "reminder:1:7:worker",
  text: "Invia il preventivo",
  remindAt: new Date("2026-08-26T09:00:00Z"),
  timezone: "Europe/Rome" as const,
  clienteId: null,
  commessaId: null,
  now,
};

afterEach(() => {
  vi.useRealTimers();
  delete process.env.REMINDER_WORKER_ENABLED;
});

describe("reminder worker", () => {
  it("proietta una sola notifica per revisione anche con due worker", async () => {
    const reminders = createMemoryReminderRepository();
    const notifications = createMemoryNotificationRepository();
    const publish = vi.fn();
    await reminders.create(expiredInput);

    await Promise.all([
      runReminderWorkerOnce({
        reminders,
        notifications,
        publish,
        isRecipientActive: async () => true,
        now,
      }),
      runReminderWorkerOnce({
        reminders,
        notifications,
        publish,
        isRecipientActive: async () => true,
        now,
      }),
    ]);

    expect(
      (
        await notifications.list({
          sedeId: 1,
          recipientUserId: 7,
          types: ["reminder"],
          limit: 10,
          now,
        })
      ).items,
    ).toHaveLength(1);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("lascia il popup due e ritenta una proiezione fallita", async () => {
    const reminders = createMemoryReminderRepository();
    const notifications = createMemoryNotificationRepository();
    await reminders.create({
      ...expiredInput,
      sourceProposalId: 95,
      canonicalKey: "reminder:1:7:retry",
    });
    const originalUpsert = notifications.upsert.bind(notifications);
    const failing = {
      ...notifications,
      upsert: vi
        .fn()
        .mockRejectedValueOnce(new Error("down"))
        .mockImplementation(originalUpsert),
    };

    await runReminderWorkerOnce({
      reminders,
      notifications: failing,
      publish: vi.fn(),
      isRecipientActive: async () => true,
      now,
    });
    expect(
      await reminders.listPopupDue({
        sedeId: 1,
        recipientUserId: 7,
        limit: 20,
      }),
    ).toHaveLength(1);

    const publish = vi.fn();
    await runReminderWorkerOnce({
      reminders,
      notifications,
      publish,
      isRecipientActive: async () => true,
      now,
    });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("non proietta finché il destinatario è disattivato", async () => {
    const reminders = createMemoryReminderRepository();
    const notifications = createMemoryNotificationRepository();
    await reminders.create({
      ...expiredInput,
      sourceProposalId: 96,
      canonicalKey: "reminder:1:7:inactive",
    });

    await runReminderWorkerOnce({
      reminders,
      notifications,
      publish: vi.fn(),
      isRecipientActive: async () => false,
      now,
    });

    expect(
      (
        await notifications.list({
          sedeId: 1,
          recipientUserId: 7,
          types: ["reminder"],
          limit: 10,
          now,
        })
      ).items,
    ).toHaveLength(0);
  });

  it("rispetta il kill switch ed esegue subito più ogni 15 secondi", async () => {
    vi.useFakeTimers();
    const disabledRun = vi.fn(async () => undefined);
    process.env.REMINDER_WORKER_ENABLED = "false";
    const disabled = startReminderWorker({ run: disabledRun });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(disabledRun).not.toHaveBeenCalled();
    disabled.stop();

    delete process.env.REMINDER_WORKER_ENABLED;
    const enabledRun = vi.fn(async () => undefined);
    const enabled = startReminderWorker({ run: enabledRun });
    await vi.advanceTimersByTimeAsync(0);
    expect(enabledRun).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(enabledRun).toHaveBeenCalledTimes(2);
    enabled.stop();
  });
});
