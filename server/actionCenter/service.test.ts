import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryActionCaseRepository } from "./repository";
import {
  getActionCenterSummary,
  listActionCases,
  transitionActionCase,
} from "./service";
import type { ActionCaseDraft } from "./types";

const NOW = new Date("2026-08-24T12:00:00.000Z");

function draft(overrides: Partial<ActionCaseDraft> = {}): ActionCaseDraft {
  return {
    canonicalKey: "commessa:1",
    sedeId: 1,
    targetType: "commessa",
    targetId: 1,
    commessaId: 1,
    clienteId: 1,
    title: "COM-1 - Cliente",
    priority: "alta",
    priorityScore: 80,
    assigneeUserId: 7,
    dueAt: NOW,
    link: "/commesse/1",
    signals: [],
    signalFingerprint: "fp-1",
    nextAction: { sourceKind: "saldo", label: "Incassa il saldo" },
    ...overrides,
  };
}

describe("Action Center service", () => {
  let repository: ReturnType<typeof createMemoryActionCaseRepository>;

  beforeEach(async () => {
    repository = createMemoryActionCaseRepository();
    await repository.upsertDraft(draft(), NOW);
    await repository.upsertDraft(draft({
      canonicalKey: "ticket:2",
      targetType: "ticket",
      targetId: 2,
      commessaId: null,
      assigneeUserId: null,
      priority: "critica",
      signalFingerprint: "fp-2",
      signals: [{ targetRole: "post_vendita" } as any],
    }), NOW);
    await repository.upsertDraft(draft({
      canonicalKey: "commessa:3",
      targetId: 3,
      commessaId: 3,
      assigneeUserId: 99,
      signalFingerprint: "fp-3",
    }), NOW);
  });

  it("limita la vista personale ad assegnazioni e ruolo", async () => {
    const list = await listActionCases({
      repository,
      sedeId: 1,
      userId: 7,
      roles: ["commerciale", "post_vendita"],
      scope: "mine",
      now: NOW,
    });
    const summary = await getActionCenterSummary({
      repository,
      sedeId: 1,
      userId: 7,
      roles: ["commerciale", "post_vendita"],
      now: NOW,
    });

    expect(list.items.map(item => item.canonicalKey).sort()).toEqual([
      "commessa:1",
      "ticket:2",
    ]);
    expect(summary).toMatchObject({ badgeCount: 2, critical: 1, high: 1 });
  });

  it("riserva la vista sede alla direzione", async () => {
    await expect(listActionCases({
      repository,
      sedeId: 1,
      userId: 7,
      roles: ["commerciale"],
      scope: "site",
      now: NOW,
    })).rejects.toThrow("FORBIDDEN");
    const site = await listActionCases({
      repository,
      sedeId: 1,
      userId: 1,
      roles: ["direzione"],
      scope: "site",
      now: NOW,
    });
    expect(site.items).toHaveLength(3);
  });

  it("applica transizioni con audit e non rivela casi di altre sedi", async () => {
    const record = await repository.findByCanonicalKey(1, "commessa:1");
    const taken = await transitionActionCase({
      repository,
      sedeId: 1,
      caseId: record!.id,
      expectedFingerprint: record!.signalFingerprint,
      userId: 7,
      roles: ["commerciale"],
      action: "take",
      now: NOW,
    });
    expect(taken).toMatchObject({ status: "in_carico", assigneeUserId: 7 });

    await expect(transitionActionCase({
      repository,
      sedeId: 2,
      caseId: record!.id,
      expectedFingerprint: record!.signalFingerprint,
      userId: 7,
      roles: ["direzione"],
      action: "resolve",
      now: NOW,
    })).rejects.toThrow("NOT_FOUND");
  });
});
