import { describe, expect, it, vi } from "vitest";
import { createMemoryTarsPlanRepository } from "./repository";
import { runPlanOnce } from "./runner";
import { createWorkflowRegistry } from "../workflows/registry";
import type { WorkflowDefinition } from "../workflows/types";

const NOW = new Date("2026-08-25T13:00:00.000Z");

function workflow(): WorkflowDefinition {
  return {
    id: "test-flow",
    version: 1,
    intent: "test",
    requiredCapabilities: ["tars.use"],
    riskClass: "low",
    buildSteps: () => [],
    verify: async () => ({ status: "completed", result: { verified: true } }),
  };
}

async function plan(
  repository: ReturnType<typeof createMemoryTarsPlanRepository>
) {
  return (
    await repository.create({
      sedeId: 1,
      operationKey: "test:plan:1",
      workflowId: "test-flow",
      workflowVersion: 1,
      intent: "test",
      riskClass: "low",
      requiredCapabilities: ["tars.use"],
      entityRefs: [],
      input: {},
      createdBy: 1,
      createdAt: NOW,
      steps: [
        { key: "read", type: "read", dependencies: [], input: {} },
        { key: "ask", type: "ask", dependencies: ["read"], input: {} },
        { key: "verify", type: "verify", dependencies: ["ask"], input: {} },
      ],
    })
  ).plan;
}

describe("Tars plan runner", () => {
  it("rispetta il budget massimo di step per giro", async () => {
    const repository = createMemoryTarsPlanRepository();
    const registry = createWorkflowRegistry();
    registry.register(workflow());
    const created = await plan(repository);
    const execute = vi.fn(async () => ({
      status: "completed" as const,
      output: {},
    }));

    const result = await runPlanOnce({
      repository,
      registry,
      planId: created.id,
      sedeId: 1,
      executors: { read: execute, ask: execute, verify: execute },
      maxSteps: 1,
      now: NOW,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result?.status).toBe("running");
    expect(result?.steps.map(step => step.status)).toEqual([
      "completed",
      "pending",
      "pending",
    ]);
  });

  it("si ferma su domanda e riparte dallo stesso step dopo la risposta", async () => {
    const repository = createMemoryTarsPlanRepository();
    const registry = createWorkflowRegistry();
    registry.register(workflow());
    let asked = false;
    const created = await plan(repository);

    const first = await runPlanOnce({
      repository,
      registry,
      planId: created.id,
      sedeId: 1,
      maxSteps: 5,
      now: NOW,
      executors: {
        read: async () => ({ status: "completed", output: { read: true } }),
        ask: async context => {
          if (!context.step.output) {
            asked = true;
            return {
              status: "waiting_user",
              output: { question: "Quale sede?" },
            };
          }
          return { status: "completed", output: context.step.output };
        },
        verify: async () => ({ status: "completed", output: {} }),
      },
    });
    expect(first?.status).toBe("waiting_user");
    expect(asked).toBe(true);

    const resumed = await repository.resumeWithUserResponse({
      sedeId: 1,
      planId: created.id,
      stepKey: "ask",
      expectedVersion: first!.version,
      response: { sedeId: 1 },
      now: new Date(NOW.getTime() + 1_000),
    });
    const completed = await runPlanOnce({
      repository,
      registry,
      planId: created.id,
      sedeId: 1,
      maxSteps: 5,
      now: new Date(NOW.getTime() + 2_000),
      executors: {
        ask: async context => ({
          status: "completed",
          output: context.step.output,
        }),
        verify: async () => ({ status: "completed", output: {} }),
      },
    });

    expect(resumed.steps.find(step => step.key === "read")?.status).toBe(
      "completed"
    );
    expect(completed?.status).toBe("completed");
    expect(completed?.result).toEqual({ verified: true });
  });

  it("recupera uno step running stale mantenendo la stessa operation key", async () => {
    const repository = createMemoryTarsPlanRepository();
    const registry = createWorkflowRegistry();
    registry.register(workflow());
    const created = await plan(repository);
    const running = await repository.updateStep({
      sedeId: 1,
      planId: created.id,
      stepKey: "read",
      expectedVersion: created.version,
      status: "running",
      now: new Date(NOW.getTime() - 60_000),
    });
    expect(running.steps[0].attempts).toBe(1);
    expect(
      await repository.recoverStale({
        cutoff: new Date(NOW.getTime() - 30_000),
        now: NOW,
      })
    ).toBe(1);
    const keys: string[] = [];

    await runPlanOnce({
      repository,
      registry,
      planId: created.id,
      sedeId: 1,
      maxSteps: 1,
      now: NOW,
      executors: {
        read: async context => {
          keys.push(context.operationKey);
          return { status: "completed", output: {} };
        },
      },
    });

    expect(keys).toEqual(["test:plan:1:read"]);
    const latest = await repository.getById({ sedeId: 1, planId: created.id });
    expect(latest?.steps[0]).toMatchObject({
      status: "completed",
      attempts: 2,
    });
  });

  it("un provider indisponibile mette il piano in attesa tecnica", async () => {
    const repository = createMemoryTarsPlanRepository();
    const registry = createWorkflowRegistry();
    registry.register(workflow());
    const created = await plan(repository);

    const result = await runPlanOnce({
      repository,
      registry,
      planId: created.id,
      sedeId: 1,
      maxSteps: 1,
      now: NOW,
      executors: {
        read: async () => ({
          status: "waiting_technical",
          errorCode: "AI_UNAVAILABLE",
        }),
      },
    });

    expect(result?.status).toBe("waiting_technical");
    expect(result?.steps[0].status).toBe("pending");
  });
});
