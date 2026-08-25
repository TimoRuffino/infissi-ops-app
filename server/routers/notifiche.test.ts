import { beforeAll, describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { getActionCaseRepository } from "../actionCenter/repository";
import { getNotificationRepository } from "../notifications/repository";
import { setFeatureFlags } from "../platform/featureFlags";
import { appRouter } from "../routers";

const NOW = new Date("2026-08-24T12:00:00.000Z");
const KEY = "commessa:990060";

function context(sedeId: number, roles = ["commerciale"]): TrpcContext {
  return {
    user: {
      id: 990007,
      role: roles.includes("direzione") ? "admin" : "user",
      ruolo: roles[0],
      ruoli: roles,
      name: "Test Action Center",
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

describe("notifiche Action Center API", () => {
  beforeAll(async () => {
    await getActionCaseRepository().upsertDraft({
      canonicalKey: KEY,
      sedeId: 990001,
      targetType: "commessa",
      targetId: 990060,
      commessaId: 990060,
      clienteId: null,
      title: "COM-TEST - Cliente",
      priority: "critica",
      priorityScore: 100,
      assigneeUserId: 990007,
      dueAt: NOW,
      link: "/commesse/990060",
      signals: [],
      signalFingerprint: "api-fingerprint",
      nextAction: { sourceKind: "ticket", label: "Gestisci il ticket" },
    }, NOW);
  });

  it("espone il riepilogo personale e permette la presa in carico", async () => {
    const caller = appRouter.createCaller(context(990001));
    const summary = await caller.notifiche.summary();
    const list = await caller.notifiche.cases.list({ scope: "mine", limit: 50 });
    const record = list.items.find(item => item.canonicalKey === KEY)!;
    const taken = await caller.notifiche.cases.take({
      id: record.id,
      expectedFingerprint: record.signalFingerprint,
    });

    expect(summary.badgeCount).toBeGreaterThanOrEqual(1);
    expect(taken).toMatchObject({ status: "in_carico", assigneeUserId: 990007 });
  });

  it("non rivela il caso da una sede diversa", async () => {
    const record = await getActionCaseRepository().findByCanonicalKey(990001, KEY);
    await expect(
      appRouter.createCaller(context(990002, ["direzione"])).notifiche.cases.detail({
        id: record!.id,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("espone il feed persistente in active senza accettare un destinatario esterno", async () => {
    const sedeId = 990003;
    setFeatureFlags(
      sedeId,
      { notificationMode: "active" },
      { actorUserId: 990007, reason: "Test feed notifiche persistenti" }
    );
    const repository = getNotificationRepository();
    const created = await repository.upsert({
      sedeId,
      recipientUserId: 990007,
      canonicalKey: "test:feed:active",
      type: "assignment",
      priority: "high",
      title: "Nuova assegnazione",
      body: "Responsabilita da gestire",
      link: "/commesse/1",
      groupKey: "commessa:1",
      sourceEventId: null,
      entityRefs: [{ type: "commessa", id: "1" }],
      createdAt: NOW,
      expiresAt: null,
    });
    await repository.upsert({
      sedeId,
      recipientUserId: 990008,
      canonicalKey: "test:feed:other",
      type: "assignment",
      priority: "high",
      title: "Altra notifica",
      body: "Non visibile",
      link: "/commesse/2",
      groupKey: "commessa:2",
      sourceEventId: null,
      entityRefs: [],
      createdAt: NOW,
      expiresAt: null,
    });

    const caller = appRouter.createCaller(context(sedeId));
    const feed = await caller.notifiche.feed({ limit: 10 });
    expect(feed.mode).toBe("active");
    expect(feed.items.map(item => item.canonicalKey)).toContain("test:feed:active");
    expect(feed.items.map(item => item.canonicalKey)).not.toContain("test:feed:other");
    await caller.notifiche.markSeen({ ids: [created.id] });
    await caller.notifiche.markRead({ ids: [created.id] });
    expect((await repository.findById(created.id, 990007, sedeId))?.status).toBe("read");
  });

  it("mantiene le procedure legacy quando il flag non e attivo", async () => {
    const caller = appRouter.createCaller(context(990004));
    const list = await caller.notifiche.list();
    const count = await caller.notifiche.count();
    expect(Array.isArray(list)).toBe(true);
    expect(typeof count).toBe("number");
  });

  it("salva preferenze soltanto per l'utente autenticato", async () => {
    const sedeId = 990005;
    const caller = appRouter.createCaller(context(sedeId));
    await caller.notifiche.preferences.set({
      pushEnabled: true,
      criticalFallbackEnabled: false,
      mutedTypes: ["daily_reminder"],
      quietHours: { from: "19:00", to: "07:30" },
    });

    expect(await caller.notifiche.preferences.get()).toMatchObject({
      pushEnabled: true,
      quietHours: { from: "19:00", to: "07:30" },
    });
    expect(
      await appRouter.createCaller({ ...context(sedeId), user: { ...context(sedeId).user, id: 990008 } } as any)
        .notifiche.preferences.get()
    ).toMatchObject({ pushEnabled: false });
  });
});
