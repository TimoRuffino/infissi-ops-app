import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { modalitaTenantStretta, tenantCorrente } from "../tenants/contestoCorrente";
import {
  getTenantRepository,
  resetTenantRepositoryForTesting,
} from "../tenants/repository";
import { getSediStore } from "../routers/sedi";
import { createMemoryBusinessEventRepository } from "./repository";
import { createEventConsumerRegistry } from "./registry";
import { runEventWorkerOnce } from "./worker";

const now = new Date("2026-08-25T11:00:00.000Z");

async function publish(
  repo: ReturnType<typeof createMemoryBusinessEventRepository>,
  sedeId = 1
) {
  return repo.publish({
    sedeId,
    eventType: "commessa.assigned",
    source: { type: "commessa", id: "42" },
    actorUserId: 3,
    subjectRefs: [{ type: "commessa", id: "42" }],
    recipientHints: [7],
    payload: { version: 1, assigneeId: 7 },
    dedupeKey: `commessa:42:assigned:7:v1:${sedeId}`,
    occurredAt: now,
  });
}

describe("business event worker", () => {
  it("isola il fallimento di un consumer dal successo di un altro", async () => {
    const repo = createMemoryBusinessEventRepository({ now: () => now });
    const registry = createEventConsumerRegistry();
    const handled = vi.fn();
    registry.register({
      name: "notifications",
      eventTypes: ["commessa.assigned"],
      handle: async () => {
        throw Object.assign(new Error("private payload"), {
          code: "TEMPORARY",
        });
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
    const repo = createMemoryBusinessEventRepository({ now: () => now });
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

  // Task 10 (WS2 «porta aperta»): il consumer legge gli store del tenant
  // della sede dell'evento. Il worker gira su un timer, fuori da qualunque
  // richiesta: senza questo contesto, con FLAG_MULTI_AZIENDA acceso, ogni
  // handler che tocca uno store per tenant fallisce (e il retry con backoff
  // lo ripeterebbe all'infinito).
  describe("contesto del tenant (Task 10)", () => {
    beforeEach(async () => {
      delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
      modalitaTenantStretta(true);
      resetTenantRepositoryForTesting();
      const tenants = getTenantRepository();
      await tenants.inserisci({ id: 1, slug: "ruffino-group", nome: "RG" });
      await tenants.inserisci({ id: 2, slug: "acme", nome: "Acme" });
      getSediStore().length = 0;
      getSediStore().push(
        { id: 10, tenantId: 1, nome: "A", attiva: true } as any,
        { id: 20, tenantId: 2, nome: "B", attiva: true } as any
      );
    });
    afterEach(() => modalitaTenantStretta(false));

    it("consegna ogni evento nel contesto del tenant della sua sede, isolando i fallimenti", async () => {
      const repo = createMemoryBusinessEventRepository({ now: () => now });
      const registry = createEventConsumerRegistry();
      const visti: Array<{ sedeId: number; tenant: number | null }> = [];
      registry.register({
        name: "context",
        eventTypes: "*",
        handle: async event => {
          visti.push({ sedeId: event.sedeId, tenant: tenantCorrente() });
          if (event.sedeId === 10) throw new Error("consumer rotto");
        },
      });
      await publish(repo, 10);
      await publish(repo, 20);

      expect(
        await runEventWorkerOnce({
          repository: repo,
          registry,
          consumerName: "context",
          workerId: "a",
          now,
        })
      ).toMatchObject({ claimed: 2, processed: 1, failed: 1 });
      expect(visti.sort((a, b) => a.sedeId - b.sedeId)).toEqual([
        { sedeId: 10, tenant: 1 },
        { sedeId: 20, tenant: 2 },
      ]);
    });
  });

  it("rifiuta nomi consumer duplicati", () => {
    const registry = createEventConsumerRegistry();
    const consumer = {
      name: "context",
      eventTypes: "*" as const,
      handle: async () => {},
    };
    registry.register(consumer);
    expect(() => registry.register(consumer)).toThrow(
      "EVENT_CONSUMER_DUPLICATE:context"
    );
  });
});
