import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryNotificationRepository } from "../notifications/repository";
import { modalitaTenantStretta, tenantCorrente } from "../tenants/contestoCorrente";
import {
  getTenantRepository,
  resetTenantRepositoryForTesting,
} from "../tenants/repository";
import { getSediStore } from "../routers/sedi";
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
  // R20 (fix wave finale): `conTenantDellaSede` è fail-closed a interruttore
  // acceso — una sede che non esiste lancia invece di ripiegare sul tenant 1.
  // Le sedi vanno quindi dichiarate, come in produzione.
  beforeEach(() => {
    getSediStore().length = 0;
    getSediStore().push({ id: 1, tenantId: 1, nome: "La Spezia", attiva: true } as any);
  });

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

  // Task 10 (WS2 «porta aperta»): il worker gira su un timer, fuori da
  // qualunque richiesta. Ogni promemoria va proiettato nel contesto del
  // tenant della SUA sede: `isRecipientActive` legge gli utenti, la
  // proiezione e la pubblicazione toccano i dati di quell'azienda.
  describe("contesto del tenant (Task 10)", () => {
    beforeEach(async () => {
      delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
      modalitaTenantStretta(true);
      resetTenantRepositoryForTesting();
      const tenants = getTenantRepository();
      await tenants.inserisci({ id: 1, slug: "ruffino-group", nome: "RG" });
      await tenants.inserisci({ id: 2, slug: "acme", nome: "Acme" });
      getSediStore().length = 0;
      getSediStore().push(
        { id: 10, tenantId: 1, nome: "A", attiva: true } as any,
        { id: 20, tenantId: 2, nome: "B", attiva: true } as any
      );
    });
    afterEach(() => modalitaTenantStretta(false));

    it("proietta ogni promemoria nel contesto del tenant della sua sede, isolando gli errori", async () => {
      const reminders = createMemoryReminderRepository();
      const notifications = createMemoryNotificationRepository();
      const visti: Array<{ sedeId: number; tenant: number | null }> = [];
      await reminders.create({
        ...expiredInput,
        sedeId: 10,
        canonicalKey: "reminder:10:7:tenant",
      });
      await reminders.create({
        ...expiredInput,
        sedeId: 20,
        sourceProposalId: 97,
        canonicalKey: "reminder:20:7:tenant",
      });

      const esito = await runReminderWorkerOnce({
        reminders,
        notifications,
        publish: vi.fn(),
        isRecipientActive: async sedeId => {
          visti.push({ sedeId, tenant: tenantCorrente() });
          if (sedeId === 10) throw new Error("store non disponibile");
          return true;
        },
        now,
      });

      expect(visti.sort((a, b) => a.sedeId - b.sedeId)).toEqual([
        { sedeId: 10, tenant: 1 },
        { sedeId: 20, tenant: 2 },
      ]);
      expect(esito).toEqual({ projected: 1 });
    });
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
