import { describe, expect, it, vi } from "vitest";
import { createMemoryBusinessEventRepository } from "./repository";
import { createEventConsumerRegistry } from "./registry";
import { runEventWorkerOnce } from "./worker";

const now = new Date("2026-08-25T11:00:00.000Z");

async function publish(repo: ReturnType<typeof createMemoryBusinessEventRepository>) {
  return repo.publish({
    sedeId: 1,
    eventType: "commessa.assigned",
    source: { type: "commessa", id: "42" },
    actorUserId: 3,
    subjectRefs: [{ type: "commessa", id: "42" }],
    recipientHints: [7],
    payload: { version: 1, assigneeId: 7 },
    dedupeKey: "commessa:42:assigned:7:v1",
    occurredAt: now,
  });
}

describe("business event worker", () => {
  it("isola il fallimento di un consumer dal successo di un altro", async () => {
    const repo = createMemoryBusinessEventRepository();
    const registry = createEventConsumerRegistry();
    const handled = vi.fn();
    registry.register({
      name: "notifications",
      eventTypes: ["commessa.assigned"],
      handle: async () => {
        throw Object.assign(new Error("private payload"), { code: "TEMPORARY" });
      },
    });
    registry.register({
      name: "context",
      eventTypes: "*",
      handle: handled,
    });
    const event = await publish(repo);

    expect(
      await runEventWorkerOnce({
        repository: repo,
        registry,
        consumerName: "notifications",
        workerId: "a",
        now,
      })
    ).toMatchObject({ processed: 0, failed: 1 });
    expect(
      await runEventWorkerOnce({
        repository: repo,
        registry,
        consumerName: "context",
        workerId: "b",
        now,
      })
    ).toMatchObject({ processed: 1, failed: 0 });
    expect(handled).toHaveBeenCalledTimes(1);
    expect(await repo.getProcessing(event.id, "notifications")).toMatchObject({
      status: "pending",
      lastErrorCode: "TEMPORARY",
    });
    expect(await repo.getProcessing(event.id, "context")).toMatchObject({
      status: "completed",
    });
  });

  it("non consegna due volte lo stesso evento a worker concorrenti", async () => {
    const repo = createMemoryBusinessEventRepository();
    const registry = createEventConsumerRegistry();
    const handled = vi.fn(async () => undefined);
    registry.register({ name: "context", eventTypes: "*", handle: handled });
    await publish(repo);

    await Promise.all([
      runEventWorkerOnce({
        repository: repo,
        registry,
        consumerName: "context",
        workerId: "a",
        now,
      }),
      runEventWorkerOnce({
        repository: repo,
        registry,
        consumerName: "context",
        workerId: "b",
        now,
      }),
    ]);

    expect(handled).toHaveBeenCalledTimes(1);
  });

  it("rifiuta nomi consumer duplicati", () => {
    const registry = createEventConsumerRegistry();
    const consumer = { name: "context", eventTypes: "*" as const, handle: async () => {} };
    registry.register(consumer);
    expect(() => registry.register(consumer)).toThrow("EVENT_CONSUMER_DUPLICATE:context");
  });
});
