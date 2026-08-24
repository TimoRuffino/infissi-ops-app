import { beforeAll, describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { getActionCaseRepository } from "../actionCenter/repository";
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
});
