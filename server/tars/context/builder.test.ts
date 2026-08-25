import { describe, expect, it, vi } from "vitest";
import type { BusinessEvent } from "../../events/types";
import { createMemoryContextRepository } from "./repository";
import { rebuildEntityContext, type ContextSynthesizer } from "./builder";
import { createQueryCache } from "./cache";
import { createContextEventConsumer } from "./consumer";
import type { ContextFact, EntityContextKey } from "./types";

const KEY: EntityContextKey = {
  sedeId: 1,
  entityType: "commessa",
  entityId: 42,
  scope: "operativo",
};

function facts(value: string): ContextFact[] {
  return [
    {
      key: "commessa.stato",
      value,
      confidence: "certain",
      evidence: [
        {
          sourceType: "commessa",
          sourceId: "42",
          label: "Scheda commessa",
          version: value,
        },
      ],
    },
  ];
}

function synthesizer(
  counter: { calls: number },
  fail = false
): ContextSynthesizer {
  return async input => {
    counter.calls += 1;
    if (fail) throw new Error("MODEL_UNAVAILABLE");
    return {
      summary: `Stato: ${String(input.facts[0].value)}`,
      openQuestions: [],
      risks: [],
      nextActions: [],
    };
  };
}

describe("rebuildEntityContext", () => {
  it("chiama il modello una volta sola quando il fingerprint non cambia", async () => {
    const repository = createMemoryContextRepository();
    const counter = { calls: 0 };
    const collect = vi.fn(async () => ({
      facts: facts("v1"),
      sourceVersions: { commessa: "v1" },
    }));

    const first = await rebuildEntityContext({
      key: KEY,
      repository,
      collect,
      synthesize: synthesizer(counter),
      policyVersion: "policy-1",
      now: new Date("2026-08-25T10:00:00.000Z"),
    });
    const second = await rebuildEntityContext({
      key: KEY,
      repository,
      collect,
      synthesize: synthesizer(counter),
      policyVersion: "policy-1",
      now: new Date("2026-08-25T10:01:00.000Z"),
    });

    expect(first).toMatchObject({ modelCalled: true, cacheHit: false });
    expect(second).toMatchObject({ modelCalled: false, cacheHit: true });
    expect(counter.calls).toBe(1);
    expect(second.snapshot?.state).toBe("ready");
  });

  it("un cambio policy invalida il fingerprint e richiede una nuova sintesi", async () => {
    const repository = createMemoryContextRepository();
    const counter = { calls: 0 };
    const collect = async () => ({
      facts: facts("v1"),
      sourceVersions: { commessa: "v1" },
    });

    await rebuildEntityContext({
      key: KEY,
      repository,
      collect,
      synthesize: synthesizer(counter),
      policyVersion: "policy-1",
    });
    const changed = await rebuildEntityContext({
      key: KEY,
      repository,
      collect,
      synthesize: synthesizer(counter),
      policyVersion: "policy-2",
    });

    expect(counter.calls).toBe(2);
    expect(changed).toMatchObject({ modelCalled: true, cacheHit: false });
    expect(await repository.listVersions(KEY)).toHaveLength(2);
  });

  it("un errore del modello conserva come corrente l'ultima versione valida", async () => {
    const repository = createMemoryContextRepository();
    const firstCounter = { calls: 0 };
    await rebuildEntityContext({
      key: KEY,
      repository,
      collect: async () => ({ facts: facts("v1"), sourceVersions: {} }),
      synthesize: synthesizer(firstCounter),
      policyVersion: "policy-1",
    });

    const failed = await rebuildEntityContext({
      key: KEY,
      repository,
      collect: async () => ({ facts: facts("v2"), sourceVersions: {} }),
      synthesize: synthesizer({ calls: 0 }, true),
      policyVersion: "policy-1",
    });
    const latest = await repository.getLatest({ key: KEY, now: new Date() });

    expect(failed.failed).toBe(true);
    expect(failed.snapshot?.fingerprint).toBe(latest?.fingerprint);
    expect(latest).toMatchObject({ state: "ready", definitive: true });
    expect(await repository.listVersions(KEY)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "failed",
          errorCode: "MODEL_UNAVAILABLE",
        }),
      ])
    );
  });

  it("rifiuta una sintesi che cita prove assenti dal fascicolo", async () => {
    const repository = createMemoryContextRepository();
    const result = await rebuildEntityContext({
      key: KEY,
      repository,
      collect: async () => ({ facts: facts("v1"), sourceVersions: {} }),
      synthesize: async () => ({
        summary: "Sintesi",
        openQuestions: [],
        risks: [
          {
            text: "Rischio senza fonte",
            evidenceIds: ["fattura_fic:inesistente:v9"],
          },
        ],
        nextActions: [],
      }),
      policyVersion: "policy-1",
    });

    expect(result.failed).toBe(true);
    expect(result.snapshot).toBeNull();
    expect(await repository.listVersions(KEY)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "failed",
          errorCode: "UNKNOWN_EVIDENCE",
        }),
      ])
    );
  });
});

describe("versioned query cache", () => {
  it("riusa soltanto stessa sede, scope e versioni", async () => {
    let loads = 0;
    const cache = createQueryCache({
      maxEntriesPerSede: 2,
      maxEntryBytes: 1_024,
    });
    const load = async () => ({ value: ++loads });
    const base = {
      key: "commessa:42",
      sedeId: 1,
      scope: "operativo",
      ttlMs: 60_000,
      load,
    };

    expect((await cache.get({ ...base, versions: ["v1"] })).hit).toBe(false);
    expect((await cache.get({ ...base, versions: ["v1"] })).hit).toBe(true);
    expect((await cache.get({ ...base, versions: ["v2"] })).hit).toBe(false);
    expect(loads).toBe(2);
  });

  it("non memorizza errori e applica LRU per sede", async () => {
    const cache = createQueryCache({
      maxEntriesPerSede: 2,
      maxEntryBytes: 1_024,
    });
    let attempts = 0;
    const failing = () =>
      cache.get({
        key: "errore",
        sedeId: 1,
        scope: "operativo",
        versions: ["v1"],
        ttlMs: 60_000,
        load: async () => {
          attempts += 1;
          throw new Error("NO_CACHE");
        },
      });
    await expect(failing()).rejects.toThrow("NO_CACHE");
    await expect(failing()).rejects.toThrow("NO_CACHE");
    expect(attempts).toBe(2);

    for (const key of ["a", "b", "c"]) {
      await cache.get({
        key,
        sedeId: 1,
        scope: "operativo",
        versions: ["v1"],
        ttlMs: 60_000,
        load: async () => key,
      });
    }
    expect(cache.stats(1).entries).toBe(2);
  });
});

describe("context event consumer", () => {
  it("ricostruisce i tre scope per le entita referenziate quando attivo", async () => {
    const rebuild = vi.fn(async () => undefined);
    const consumer = createContextEventConsumer({
      rebuild,
      modeForSede: () => "active",
    });
    const event: BusinessEvent = {
      id: 1,
      sedeId: 1,
      eventType: "commessa.updated",
      source: { type: "commessa", id: "42" },
      actorUserId: 7,
      subjectRefs: [
        { type: "commessa", id: "42" },
        { type: "cliente", id: "7" },
      ],
      recipientHints: [],
      payload: { version: 1 },
      dedupeKey: "context-test-1",
      occurredAt: new Date(),
      createdAt: new Date(),
    };

    await consumer.handle(event);
    expect(rebuild).toHaveBeenCalledTimes(6);
    expect(rebuild).toHaveBeenCalledWith(
      expect.objectContaining({
        key: {
          sedeId: 1,
          entityType: "commessa",
          entityId: 42,
          scope: "operativo",
        },
      })
    );
  });
});
