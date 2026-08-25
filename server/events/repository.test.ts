import { describe, expect, it } from "vitest";
import { createMemoryBusinessEventRepository } from "./repository";
import type { BusinessEventDraft } from "./types";

const now = new Date("2026-08-25T10:00:00.000Z");

function draft(overrides: Partial<BusinessEventDraft> = {}): BusinessEventDraft {
  return {
    sedeId: 1,
    eventType: "commessa.assigned",
    source: { type: "commessa", id: "42", version: now.toISOString() },
    actorUserId: 3,
    subjectRefs: [{ type: "commessa", id: "42" }],
    recipientHints: [7],
    payload: { version: 1, previousAssigneeId: 3, assigneeId: 7 },
    dedupeKey: "commessa:42:assigned:7:2026-08-25T10:00:00.000Z",
    occurredAt: now,
    ...overrides,
  };
}

describe("BusinessEventRepository", () => {
  it("deduplica per sede e chiave", async () => {
    const repo = createMemoryBusinessEventRepository({ now: () => now });
    const first = await repo.publish(draft());
    const duplicate = await repo.publish(draft());
    const otherSite = await repo.publish(draft({ sedeId: 2 }));

    expect(first.inserted).toBe(true);
    expect(duplicate).toEqual({ id: first.id, inserted: false });
    expect(otherSite.inserted).toBe(true);
    expect(otherSite.id).not.toBe(first.id);
  });

  it("mantiene elaborazioni indipendenti per consumer", async () => {
    const repo = createMemoryBusinessEventRepository({ now: () => now });
    await repo.publish(draft());

    const notifications = await repo.claim({
      consumerName: "notifications",
      workerId: "worker-a",
      limit: 10,
      now,
    });
    const context = await repo.claim({
      consumerName: "context",
      workerId: "worker-b",
      limit: 10,
      now,
    });
    const duplicateClaim = await repo.claim({
      consumerName: "notifications",
      workerId: "worker-c",
      limit: 10,
      now,
    });

    expect(notifications.map(event => event.id)).toEqual(context.map(event => event.id));
    expect(duplicateClaim).toEqual([]);
  });

  it("recupera lease stale senza riaprire consumer completati", async () => {
    const repo = createMemoryBusinessEventRepository({ now: () => now });
    const published = await repo.publish(draft());
    await repo.claim({ consumerName: "notifications", workerId: "a", limit: 1, now });
    await repo.complete({
      eventId: published.id,
      consumerName: "notifications",
      workerId: "a",
      now,
    });
    await repo.claim({ consumerName: "context", workerId: "b", limit: 1, now });

    expect(
      await repo.recoverStale({
        cutoff: new Date("2026-08-25T10:01:00.000Z"),
        now: new Date("2026-08-25T10:02:00.000Z"),
      })
    ).toBe(1);
    expect(
      await repo.claim({
        consumerName: "notifications",
        workerId: "c",
        limit: 1,
        now: new Date("2026-08-25T10:02:00.000Z"),
      })
    ).toEqual([]);
    expect(
      await repo.claim({
        consumerName: "context",
        workerId: "c",
        limit: 1,
        now: new Date("2026-08-25T10:02:00.000Z"),
      })
    ).toHaveLength(1);
  });

  it("sposta in dead-letter al quinto fallimento", async () => {
    const repo = createMemoryBusinessEventRepository({ now: () => now });
    const published = await repo.publish(draft());

    for (let attempt = 1; attempt <= 5; attempt++) {
      const at = new Date(now.getTime() + attempt * 1_000);
      await repo.claim({
        consumerName: "notifications",
        workerId: "worker",
        limit: 1,
        now: at,
      });
      await repo.fail({
        eventId: published.id,
        consumerName: "notifications",
        workerId: "worker",
        errorCode: "PROVIDER_TIMEOUT contains private text",
        retryAt: new Date(at.getTime() + 1),
        now: at,
      });
    }

    expect(
      await repo.claim({
        consumerName: "notifications",
        workerId: "other",
        limit: 1,
        now: new Date(now.getTime() + 10_000),
      })
    ).toEqual([]);
    expect(await repo.getProcessing(published.id, "notifications")).toMatchObject({
      status: "dead_letter",
      attempts: 5,
      lastErrorCode: "PROVIDER_TIMEOUT",
    });
  });
});
