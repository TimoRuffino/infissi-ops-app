import { describe, expect, it } from "vitest";
import { createMemoryContextRepository } from "./repository";
import type { ContextFact, EntityContextKey } from "./types";

const NOW = new Date("2026-08-25T10:00:00.000Z");
const LATER = new Date("2026-08-25T12:00:00.000Z");

function key(scope: EntityContextKey["scope"], sedeId = 1): EntityContextKey {
  return { sedeId, entityType: "commessa", entityId: 42, scope };
}

function facts(label = "misure confermate"): ContextFact[] {
  return [
    {
      key: "commessa.stato",
      value: label,
      confidence: "certain",
      evidence: [
        {
          sourceType: "commessa",
          sourceId: "42",
          label: "Stato commessa",
          version: "2026-08-25T09:55:00.000Z",
          link: "/commesse/42",
        },
      ],
    },
  ];
}

describe("operational context repository", () => {
  it("mantiene fascicoli distinti per scope e sede", async () => {
    const repository = createMemoryContextRepository();
    await repository.saveVersion({
      key: key("operativo"),
      schemaVersion: "1",
      collectorVersion: "collector-1",
      policyVersion: "policy-1",
      fingerprint: "fingerprint-operativo",
      facts: facts("posa pianificata"),
      summary: null,
      state: "facts_only",
      expiresAt: LATER,
      createdAt: NOW,
    });
    await repository.saveVersion({
      key: key("amministrazione"),
      schemaVersion: "1",
      collectorVersion: "collector-1",
      policyVersion: "policy-1",
      fingerprint: "fingerprint-amministrazione",
      facts: facts("saldo da verificare"),
      summary: null,
      state: "facts_only",
      expiresAt: LATER,
      createdAt: NOW,
    });
    await repository.saveVersion({
      key: key("direzione"),
      schemaVersion: "1",
      collectorVersion: "collector-1",
      policyVersion: "policy-1",
      fingerprint: "fingerprint-direzione",
      facts: facts("margine revisionato"),
      summary: null,
      state: "facts_only",
      expiresAt: LATER,
      createdAt: NOW,
    });

    expect(
      (await repository.getLatest({ key: key("operativo"), now: NOW }))
        ?.facts[0].value
    ).toBe("posa pianificata");
    expect(
      (await repository.getLatest({ key: key("amministrazione"), now: NOW }))
        ?.facts[0].value
    ).toBe("saldo da verificare");
    expect(
      (await repository.getLatest({ key: key("direzione"), now: NOW }))
        ?.facts[0].value
    ).toBe("margine revisionato");
    expect(
      await repository.getLatest({ key: key("operativo", 2), now: NOW })
    ).toBeNull();
  });

  it("non crea una nuova versione quando fingerprint e schema sono invariati", async () => {
    const repository = createMemoryContextRepository();
    const input = {
      key: key("operativo"),
      schemaVersion: "1",
      collectorVersion: "collector-1",
      policyVersion: "policy-1",
      fingerprint: "fingerprint-stabile",
      facts: facts(),
      summary: null,
      state: "facts_only" as const,
      expiresAt: LATER,
      createdAt: NOW,
    };

    const first = await repository.saveVersion(input);
    const second = await repository.saveVersion({
      ...input,
      createdAt: new Date(NOW.getTime() + 1_000),
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.snapshot.version).toBe(1);
    expect(await repository.listVersions(key("operativo"))).toHaveLength(1);
  });

  it("crea una versione nuova quando cambia schema anche con fingerprint uguale", async () => {
    const repository = createMemoryContextRepository();
    const base = {
      key: key("operativo"),
      collectorVersion: "collector-1",
      policyVersion: "policy-1",
      fingerprint: "fingerprint-stabile",
      facts: facts(),
      summary: null,
      state: "facts_only" as const,
      expiresAt: LATER,
      createdAt: NOW,
    };
    await repository.saveVersion({ ...base, schemaVersion: "1" });
    const second = await repository.saveVersion({
      ...base,
      schemaVersion: "2",
    });

    expect(second.created).toBe(true);
    expect(second.snapshot.version).toBe(2);
  });

  it("riusa una versione gia nota se lo stesso fingerprint ritorna", async () => {
    const repository = createMemoryContextRepository();
    const base = {
      key: key("operativo"),
      schemaVersion: "1",
      collectorVersion: "collector-1",
      policyVersion: "policy-1",
      summary: null,
      state: "facts_only" as const,
      expiresAt: LATER,
      createdAt: NOW,
    };
    await repository.saveVersion({
      ...base,
      fingerprint: "fingerprint-a",
      facts: facts("A"),
    });
    await repository.saveVersion({
      ...base,
      fingerprint: "fingerprint-b",
      facts: facts("B"),
    });
    const repeated = await repository.saveVersion({
      ...base,
      fingerprint: "fingerprint-a",
      facts: facts("A"),
    });

    expect(repeated.created).toBe(false);
    expect(repeated.snapshot.facts[0].value).toBe("A");
    expect(await repository.listVersions(key("operativo"))).toHaveLength(2);
  });

  it("restituisce il contesto scaduto come stale e non definitivo", async () => {
    const repository = createMemoryContextRepository();
    await repository.saveVersion({
      key: key("operativo"),
      schemaVersion: "1",
      collectorVersion: "collector-1",
      policyVersion: "policy-1",
      fingerprint: "fingerprint-scaduto",
      facts: facts(),
      summary: {
        summary: "La posa risulta pianificata.",
        openQuestions: [],
        risks: [],
        nextActions: [],
      },
      state: "ready",
      expiresAt: new Date("2026-08-25T10:30:00.000Z"),
      createdAt: NOW,
    });

    const fresh = await repository.getLatest({
      key: key("operativo"),
      now: new Date("2026-08-25T10:15:00.000Z"),
    });
    const stale = await repository.getLatest({
      key: key("operativo"),
      now: new Date("2026-08-25T11:00:00.000Z"),
    });

    expect(fresh).toMatchObject({ stale: false, definitive: true });
    expect(stale).toMatchObject({ stale: true, definitive: false });
    expect(stale?.facts).toEqual(fresh?.facts);
  });

  it("versiona e collega ogni evidenza al fatto di origine", async () => {
    const repository = createMemoryContextRepository();
    const saved = await repository.saveVersion({
      key: key("operativo"),
      schemaVersion: "1",
      collectorVersion: "collector-1",
      policyVersion: "policy-1",
      fingerprint: "fingerprint-evidence",
      facts: facts(),
      summary: null,
      state: "facts_only",
      expiresAt: LATER,
      createdAt: NOW,
    });

    expect(saved.snapshot.evidence).toEqual([
      expect.objectContaining({
        factKey: "commessa.stato",
        ordinal: 0,
        sourceType: "commessa",
        sourceId: "42",
        sourceVersion: "2026-08-25T09:55:00.000Z",
      }),
    ]);
  });
});
