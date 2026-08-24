import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryActionCaseRepository } from "./repository";
import { parseActionCenterMode, reconcileActionCases } from "./reconcile";
import type { ActionCaseDraft } from "./types";

const NOW = new Date("2026-08-24T12:00:00.000Z");

function draft(fingerprint = "fp-1"): ActionCaseDraft {
  return {
    canonicalKey: "commessa:60",
    sedeId: 1,
    targetType: "commessa",
    targetId: 60,
    commessaId: 60,
    clienteId: 12,
    title: "COM-2026-060 - Maioglio Alessia",
    priority: "alta",
    priorityScore: 80,
    assigneeUserId: 7,
    dueAt: NOW,
    link: "/commesse/60",
    signals: [],
    signalFingerprint: fingerprint,
    nextAction: { sourceKind: "saldo", label: "Incassa il saldo" },
  };
}

describe("Action Center reconciliation", () => {
  let repository: ReturnType<typeof createMemoryActionCaseRepository>;

  beforeEach(() => {
    repository = createMemoryActionCaseRepository();
  });

  it("usa shadow per configurazioni assenti o non valide", () => {
    expect(parseActionCenterMode(undefined)).toBe("shadow");
    expect(parseActionCenterMode("invalid")).toBe("shadow");
    expect(parseActionCenterMode("active")).toBe("active");
    expect(parseActionCenterMode("legacy")).toBe("legacy");
  });

  it("crea, non duplica e chiude automaticamente un caso scomparso", async () => {
    const created = await reconcileActionCases({
      repository,
      sedeId: 1,
      drafts: [draft()],
      now: NOW,
    });
    const unchanged = await reconcileActionCases({
      repository,
      sedeId: 1,
      drafts: [draft()],
      now: new Date(NOW.getTime() + 60_000),
    });
    const resolved = await reconcileActionCases({
      repository,
      sedeId: 1,
      drafts: [],
      now: new Date(NOW.getTime() + 120_000),
    });
    const record = await repository.findByCanonicalKey(1, "commessa:60");

    expect(created).toMatchObject({ created: 1, unchanged: 0 });
    expect(unchanged).toMatchObject({ created: 0, unchanged: 1 });
    expect(resolved).toMatchObject({ autoResolved: 1 });
    expect(record?.status).toBe("risolta");
    expect((await repository.listEvents(1, record!.id)).map(e => e.eventType)).toEqual([
      "creata",
      "auto_risolta",
    ]);
  });

  it("riapre un caso risolto soltanto con evidenze cambiate", async () => {
    await reconcileActionCases({ repository, sedeId: 1, drafts: [draft()], now: NOW });
    await reconcileActionCases({ repository, sedeId: 1, drafts: [], now: NOW });
    await reconcileActionCases({ repository, sedeId: 1, drafts: [draft()], now: NOW });
    expect((await repository.findByCanonicalKey(1, "commessa:60"))?.status).toBe("risolta");

    const reopened = await reconcileActionCases({
      repository,
      sedeId: 1,
      drafts: [draft("fp-2")],
      now: new Date(NOW.getTime() + 60_000),
    });
    expect(reopened.reopened).toBe(1);
    expect((await repository.findByCanonicalKey(1, "commessa:60"))?.status).toBe("da_valutare");
  });

  it("risveglia rinvii scaduti o modificati e accoda solo casi rilevanti", async () => {
    await reconcileActionCases({ repository, sedeId: 1, drafts: [draft()], now: NOW });
    const record = await repository.findByCanonicalKey(1, "commessa:60");
    await repository.transition({
      sedeId: 1,
      id: record!.id,
      expectedFingerprint: record!.signalFingerprint,
      status: "rinviata",
      assigneeUserId: 7,
      snoozedUntil: new Date(NOW.getTime() + 86_400_000),
      actorUserId: 7,
      eventType: "rinviata",
      now: NOW,
    });

    const changed = await reconcileActionCases({
      repository,
      sedeId: 1,
      drafts: [draft("fp-material-change")],
      now: new Date(NOW.getTime() + 60_000),
    });
    const current = await repository.findByCanonicalKey(1, "commessa:60");

    expect(changed).toMatchObject({ updated: 1, reopened: 1, queuedForTars: 1 });
    expect(current).toMatchObject({
      status: "da_valutare",
      snoozedUntil: null,
      tarsAnalysisStatus: "in_coda",
    });
  });
});
