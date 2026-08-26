import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import {
  createMemoryNotificationRepository,
  setNotificationRepositoryForTesting,
} from "../notifications/repository";
import { createMemoryReminderRepository } from "../reminders/repository";
import {
  createReminderService,
  setReminderServiceForTesting,
} from "../reminders/service";
import { runReminderWorkerOnce } from "../reminders/worker";
import { appRouter } from "../routers";
import { getUtentiStore } from "./utenti";
import { proposte } from "../tars/stores";
import { eseguiStrumento, type ToolRuntime } from "../tars/tools";

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
    vi.useRealTimers();
    setReminderServiceForTesting(null);
    setNotificationRepositoryForTesting(null);
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

  it("copre approvazione Tars, consegna, popup, notifica e completamento", async () => {
    vi.useFakeTimers();
    let currentTime = new Date("2026-08-26T10:00:00.000Z");
    vi.setSystemTime(currentTime);
    const sedeId = 990105;
    const userId = 79005;
    const ctx = context(sedeId, userId);
    const caller = appRouter.createCaller(ctx);
    const notifications = createMemoryNotificationRepository();
    reminders = createMemoryReminderRepository();
    setNotificationRepositoryForTesting(notifications);
    setReminderServiceForTesting(
      createReminderService({
        reminders,
        notifications,
        now: () => currentTime,
      }),
    );

    const users = getUtentiStore();
    users.push({
      id: userId,
      nome: "Operatore",
      cognome: "Promemoria",
      attivo: true,
      sediIds: [sedeId],
      ruoli: ["commerciale"],
      createdAt: currentTime,
      updatedAt: currentTime,
    });
    const createdProposalIds: number[] = [];

    try {
      const questionRuntime: ToolRuntime = {
        ctx,
        esecuzioneId: 990_105_001,
        trigger: "chat",
        maxProposte: 3,
        proposteIds: [],
        terminato: null,
        origineId: null,
        risultatiCache: new Map(),
      };
      await eseguiStrumento(questionRuntime, "chiedi_chiarimento", {
        domanda: "Quando vuoi che te lo ricordi?",
        contesto: "Serve una data e un'ora esatte.",
        intent: "promemoria",
        requestedText: "Inviare il preventivo di prova",
      });
      const questionId = questionRuntime.proposteIds[0];
      createdProposalIds.push(questionId);
      const question = proposte.find((item) => item.id === questionId)!;
      question.seguitoAt = currentTime;
      await caller.tars.proposte.rispondi({
        id: questionId,
        risposta: "Oggi alle 12:01",
      });

      const proposalRuntime: ToolRuntime = {
        ...questionRuntime,
        esecuzioneId: 990_105_002,
        trigger: "seguito",
        proposteIds: [],
        origineId: questionId,
      };
      await eseguiStrumento(proposalRuntime, "proponi_promemoria", {
        text: "Inviare il preventivo di prova",
        remindAtIso: "2026-08-26T12:01:00+02:00",
        timezone: "Europe/Rome",
        titolo: "Invia il preventivo",
        motivazione: "Data e ora confermate dall'operatore.",
        confidenza: "alta",
      });
      const proposalId = proposalRuntime.proposteIds[0];
      createdProposalIds.push(proposalId);
      await caller.tars.proposte.approva({ id: proposalId });

      currentTime = new Date("2026-08-26T10:02:00.000Z");
      vi.setSystemTime(currentTime);
      await runReminderWorkerOnce({
        reminders,
        notifications,
        publish: vi.fn(),
        isRecipientActive: async () => true,
        now: currentTime,
      });

      const due = await caller.promemoria.due();
      const feed = await caller.notifiche.feed({ limit: 30 });
      const unread = await caller.notifiche.unreadCount();
      expect(due.items).toHaveLength(1);
      expect(feed.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "reminder",
            body: "Inviare il preventivo di prova",
          }),
        ]),
      );
      expect(unread.count).toBeGreaterThanOrEqual(1);

      await caller.promemoria.complete({ id: due.items[0].id });
      expect((await caller.promemoria.due()).items).toHaveLength(0);
      expect(
        (
          await notifications.list({
            sedeId,
            recipientUserId: userId,
            statuses: ["resolved"],
            types: ["reminder"],
            limit: 10,
            now: currentTime,
          })
        ).items,
      ).toHaveLength(1);
    } finally {
      for (const id of createdProposalIds) {
        const index = proposte.findIndex((item) => item.id === id);
        if (index >= 0) proposte.splice(index, 1);
      }
      const userIndex = users.findIndex((user: any) => Number(user.id) === userId);
      if (userIndex >= 0) users.splice(userIndex, 1);
    }
  });
});
