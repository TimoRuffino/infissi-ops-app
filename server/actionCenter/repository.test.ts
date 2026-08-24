import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryActionCaseRepository } from "./repository";
import type { ActionCaseDraft } from "./types";

const NOW = new Date("2026-08-24T12:00:00.000Z");

function draft(overrides: Partial<ActionCaseDraft> = {}): ActionCaseDraft {
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
    signalFingerprint: "first-fingerprint",
    nextAction: {
      sourceKind: "saldo",
      label: "Verifica e incassa il saldo residuo",
    },
    ...overrides,
  };
}

describe("Action Center repository contract", () => {
  let repository: ReturnType<typeof createMemoryActionCaseRepository>;

  beforeEach(async () => {
    repository = createMemoryActionCaseRepository();
    await repository.ensureSchema();
  });

  it("mantiene un solo caso per sede e chiave canonica", async () => {
    const created = await repository.upsertDraft(draft(), NOW);
    const unchanged = await repository.upsertDraft(draft(), NOW);
    const changed = await repository.upsertDraft(
      draft({ signalFingerprint: "second-fingerprint", priority: "critica" }),
      new Date("2026-08-24T13:00:00.000Z")
    );

    expect(created).toMatchObject({ created: true, changed: true });
    expect(unchanged).toMatchObject({ created: false, changed: false });
    expect(changed).toMatchObject({ created: false, changed: true });
    expect(changed.record.id).toBe(created.record.id);
    expect((await repository.list({ sedeId: 1 })).items).toHaveLength(1);
  });

  it("preserva lo stato esplicito durante l'aggiornamento dei segnali", async () => {
    const created = await repository.upsertDraft(draft(), NOW);
    await repository.transition({
      sedeId: 1,
      id: created.record.id,
      expectedFingerprint: "first-fingerprint",
      status: "in_carico",
      assigneeUserId: 9,
      actorUserId: 9,
      eventType: "presa_in_carico",
      now: NOW,
    });

    const updated = await repository.upsertDraft(
      draft({ signalFingerprint: "changed", priorityScore: 95 }),
      new Date("2026-08-24T13:00:00.000Z")
    );

    expect(updated.record).toMatchObject({
      status: "in_carico",
      assigneeUserId: 9,
      signalFingerprint: "changed",
      priorityScore: 95,
    });
    expect(await repository.listEvents(1, created.record.id)).toMatchObject([
      { eventType: "creata" },
      { eventType: "presa_in_carico", actorUserId: 9 },
      { eventType: "segnali_aggiornati" },
    ]);
  });

  it("isola le sedi e rifiuta transizioni su fingerprint obsoleto", async () => {
    const created = await repository.upsertDraft(draft(), NOW);

    expect(await repository.findById(2, created.record.id)).toBeNull();
    expect(await repository.findByCanonicalKey(2, "commessa:60")).toBeNull();
    await expect(repository.transition({
      sedeId: 1,
      id: created.record.id,
      expectedFingerprint: "stale",
      status: "risolta",
      assigneeUserId: 7,
      actorUserId: 7,
      eventType: "risolta",
      now: NOW,
    })).rejects.toThrow("STALE_ACTION_CASE");
  });

  it("pagina con cursore e gestisce la coda di analisi Tars", async () => {
    for (let id = 1; id <= 3; id += 1) {
      await repository.upsertDraft(draft({
        canonicalKey: `commessa:${id}`,
        targetId: id,
        commessaId: id,
        signalFingerprint: `fp-${id}`,
      }), new Date(NOW.getTime() + id));
    }
    const first = await repository.list({ sedeId: 1, limit: 2 });
    const second = await repository.list({
      sedeId: 1,
      limit: 2,
      cursor: first.nextCursor,
    });
    await repository.markAnalysis({
      sedeId: 1,
      id: first.items[0].id,
      status: "in_coda",
      fingerprint: first.items[0].signalFingerprint,
      now: NOW,
    });

    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(1);
    expect(await repository.listPendingAnalysis(1, 10)).toMatchObject([
      { id: first.items[0].id, tarsAnalysisStatus: "in_coda" },
    ]);
  });
});
