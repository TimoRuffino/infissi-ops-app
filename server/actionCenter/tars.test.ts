import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryActionCaseRepository } from "./repository";
import { buildCaseAnalysisRequest, runQueuedCaseAnalyses } from "./tars";
import type { ActionCaseDraft } from "./types";

const NOW = new Date("2026-08-24T12:00:00.000Z");

function draft(id: number): ActionCaseDraft {
  return {
    canonicalKey: `commessa:${id}`,
    sedeId: 1,
    targetType: "commessa",
    targetId: id,
    commessaId: id,
    clienteId: id,
    title: `COM-${id} - Cliente`,
    priority: "alta",
    priorityScore: 80,
    assigneeUserId: 7,
    dueAt: NOW,
    link: `/commesse/${id}`,
    signals: [],
    signalFingerprint: `fp-${id}`,
    nextAction: { sourceKind: "saldo", label: "Incassa il saldo" },
  };
}

describe("Tars Action Center queue", () => {
  let repository: ReturnType<typeof createMemoryActionCaseRepository>;

  beforeEach(async () => {
    repository = createMemoryActionCaseRepository();
    for (const id of [1, 2]) {
      const record = (await repository.upsertDraft(draft(id), NOW)).record;
      await repository.markAnalysis({
        sedeId: 1,
        id: record.id,
        status: "in_coda",
        fingerprint: record.signalFingerprint,
        now: NOW,
      });
    }
  });

  it("costruisce una richiesta compatta con prove e vincolo di approvazione", () => {
    const request = buildCaseAnalysisRequest({
      ...draft(1),
      id: 1,
      status: "da_valutare",
      reviewAt: null,
      snoozedUntil: null,
      tarsAnalysis: null,
      tarsAnalysisFingerprint: null,
      tarsAnalysisStatus: "in_coda",
      createdAt: NOW,
      updatedAt: NOW,
      resolvedAt: null,
    });

    expect(request).toContain("COM-1 - Cliente");
    expect(request).toContain("non eseguire modifiche");
    expect(request.length).toBeLessThan(2_000);
  });

  it("rispetta il limite del lotto e salva i riferimenti dell'analisi", async () => {
    const seen: number[] = [];
    const result = await runQueuedCaseAnalyses({
      repository,
      sedeId: 1,
      limit: 1,
      now: NOW,
      analyze: async record => {
        seen.push(record.id);
        return { summary: "Verifica completata", executionId: 44, proposalIds: [81] };
      },
    });
    const analyzed = await repository.findById(1, seen[0]);

    expect(result).toEqual({ processed: 1, completed: 1, failed: 0 });
    expect(analyzed).toMatchObject({
      tarsAnalysisStatus: "completata",
      tarsAnalysisFingerprint: analyzed!.signalFingerprint,
      tarsAnalysis: { executionId: 44, proposalIds: [81] },
    });
    expect(await repository.listPendingAnalysis(1, 10)).toHaveLength(1);
  });

  it("mantiene il caso visibile e marca l'errore del provider", async () => {
    const result = await runQueuedCaseAnalyses({
      repository,
      sedeId: 1,
      limit: 1,
      now: NOW,
      analyze: async () => {
        throw new Error("provider unavailable");
      },
    });
    const records = (await repository.list({ sedeId: 1 })).items;

    expect(result).toEqual({ processed: 1, completed: 0, failed: 1 });
    expect(records.find(record => record.tarsAnalysisStatus === "errore")?.status)
      .toBe("da_valutare");
  });
});
