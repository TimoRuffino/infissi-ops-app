import { describe, expect, it } from "vitest";
import { createMemoryTarsPlanRepository } from "./repository";

const NOW = new Date("2026-08-25T12:00:00.000Z");

function draft(operationKey = "lead:mail:42") {
  return {
    sedeId: 1,
    operationKey,
    workflowId: "create-customer-job",
    workflowVersion: 1,
    intent: "create_customer_job",
    riskClass: "medium" as const,
    requiredCapabilities: ["cliente.create", "commessa.create"] as const,
    entityRefs: [{ type: "comunicazione", id: "42" }],
    input: { customer: { nome: "Mario", cognome: "Rossi" } },
    createdBy: 7,
    createdAt: NOW,
    steps: [
      {
        key: "collect",
        type: "ask" as const,
        dependencies: [],
        input: { field: "assegnatoA" },
      },
      {
        key: "propose",
        type: "propose" as const,
        dependencies: ["collect"],
        input: {},
      },
    ],
  };
}

describe("TarsPlanRepository", () => {
  it("deduplica create concorrenti con la stessa operationKey", async () => {
    const repository = createMemoryTarsPlanRepository();
    const [first, second] = await Promise.all([
      repository.create(draft()),
      repository.create(draft()),
    ]);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.plan.id).toBe(first.plan.id);
    expect(second.plan.steps).toHaveLength(2);
  });

  it("non completa un piano con step ancora pendenti", async () => {
    const repository = createMemoryTarsPlanRepository();
    const { plan } = await repository.create(draft());

    await expect(
      repository.updatePlan({
        sedeId: 1,
        planId: plan.id,
        expectedVersion: plan.version,
        status: "completed",
        now: NOW,
      })
    ).rejects.toThrow("PLAN_STEPS_INCOMPLETE");
  });

  it("una risposta riapre soltanto lo step waiting_user e incrementa la versione", async () => {
    const repository = createMemoryTarsPlanRepository();
    const { plan } = await repository.create(draft());
    const waiting = await repository.updateStep({
      sedeId: 1,
      planId: plan.id,
      stepKey: "collect",
      expectedVersion: plan.version,
      status: "waiting_user",
      output: { question: "A chi la assegno?" },
      now: NOW,
    });
    const resumed = await repository.resumeWithUserResponse({
      sedeId: 1,
      planId: plan.id,
      stepKey: "collect",
      expectedVersion: waiting.version,
      response: { assegnatoA: 9 },
      now: new Date(NOW.getTime() + 1_000),
    });

    expect(resumed.status).toBe("running");
    expect(resumed.version).toBe(waiting.version + 1);
    expect(resumed.steps.find(step => step.key === "collect")).toMatchObject({
      status: "pending",
      output: { userResponse: { assegnatoA: 9 } },
    });
    expect(resumed.steps.find(step => step.key === "propose")?.status).toBe(
      "pending"
    );
  });

  it("rifiuta update con versione superata e sanitizza gli errori", async () => {
    const repository = createMemoryTarsPlanRepository();
    const { plan } = await repository.create(draft());
    const updated = await repository.updateStep({
      sedeId: 1,
      planId: plan.id,
      stepKey: "collect",
      expectedVersion: plan.version,
      status: "failed",
      errorCode: "Errore privato: token=secret value",
      now: NOW,
    });

    expect(updated.steps[0].errorCode).toBe("ERRORE");
    await expect(
      repository.updatePlan({
        sedeId: 1,
        planId: plan.id,
        expectedVersion: plan.version,
        status: "failed",
        now: NOW,
      })
    ).rejects.toThrow("PLAN_VERSION_CONFLICT");
  });
});
