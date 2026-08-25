import type { PlanStepType, TarsPlan } from "./types";
import { getTarsPlanRepository, type TarsPlanRepository } from "./repository";
import { getFeatureFlags } from "../../platform/featureFlags";
import { workflowRegistry, type WorkflowRegistry } from "../workflows/registry";
import type { StepExecutor } from "../workflows/types";

export type StepExecutors = Partial<Record<PlanStepType, StepExecutor>>;

const TERMINAL_PLAN_STATUSES = new Set<TarsPlan["status"]>([
  "completed",
  "partially_completed",
  "failed",
  "canceled",
]);

function codeFor(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.trim()) return code;
  }
  return "WORKFLOW_EXECUTION_FAILED";
}

async function failPlan(
  repository: TarsPlanRepository,
  plan: TarsPlan,
  errorCode: string,
  now: Date
): Promise<TarsPlan> {
  return repository.updatePlan({
    sedeId: plan.sedeId,
    planId: plan.id,
    expectedVersion: plan.version,
    status: "failed",
    errorCode,
    now,
  });
}

export async function runPlanOnce(input: {
  repository: TarsPlanRepository;
  registry: WorkflowRegistry;
  planId: number;
  sedeId: number;
  executors: StepExecutors;
  maxSteps?: number;
  now?: Date;
}): Promise<TarsPlan | null> {
  const now = input.now ?? new Date();
  const maxSteps = Math.max(1, Math.min(input.maxSteps ?? 5, 20));
  let plan = await input.repository.getById({
    sedeId: input.sedeId,
    planId: input.planId,
  });
  if (!plan || TERMINAL_PLAN_STATUSES.has(plan.status)) return plan;
  if (
    ["waiting_user", "waiting_approval", "waiting_technical"].includes(
      plan.status
    )
  ) {
    return plan;
  }

  const workflow = input.registry.get(plan.workflowId, plan.workflowVersion);
  if (!workflow) {
    return failPlan(input.repository, plan, "WORKFLOW_NOT_FOUND", now);
  }
  if (plan.status === "draft") {
    plan = await input.repository.updatePlan({
      sedeId: plan.sedeId,
      planId: plan.id,
      expectedVersion: plan.version,
      status: "running",
      now,
    });
  }

  for (let executed = 0; executed < maxSteps; executed += 1) {
    const incomplete = plan.steps.filter(
      step => !["completed", "skipped"].includes(step.status)
    );
    if (incomplete.length === 0) break;

    const done = new Set(
      plan.steps
        .filter(step => ["completed", "skipped"].includes(step.status))
        .map(step => step.key)
    );
    const step = plan.steps.find(
      candidate =>
        candidate.status === "pending" &&
        candidate.dependencies.every(dependency => done.has(dependency))
    );
    if (!step) {
      return failPlan(input.repository, plan, "PLAN_DEPENDENCY_DEADLOCK", now);
    }
    const executor = input.executors[step.type];
    if (!executor) {
      return failPlan(input.repository, plan, "STEP_EXECUTOR_NOT_FOUND", now);
    }

    plan = await input.repository.updateStep({
      sedeId: plan.sedeId,
      planId: plan.id,
      stepKey: step.key,
      expectedVersion: plan.version,
      status: "running",
      now,
    });
    const runningStep = plan.steps.find(
      candidate => candidate.key === step.key
    )!;
    try {
      const result = await executor({
        plan,
        step: runningStep,
        operationKey: `${plan.operationKey}:${step.key}`,
      });
      if (result.status === "waiting_technical") {
        plan = await input.repository.updateStep({
          sedeId: plan.sedeId,
          planId: plan.id,
          stepKey: step.key,
          expectedVersion: plan.version,
          status: "pending",
          errorCode: result.errorCode,
          now,
        });
        return input.repository.updatePlan({
          sedeId: plan.sedeId,
          planId: plan.id,
          expectedVersion: plan.version,
          status: "waiting_technical",
          errorCode: result.errorCode,
          now,
        });
      }
      plan = await input.repository.updateStep({
        sedeId: plan.sedeId,
        planId: plan.id,
        stepKey: step.key,
        expectedVersion: plan.version,
        status: result.status,
        output: "output" in result ? result.output : undefined,
        evidenceRefs:
          result.status === "completed" ? result.evidenceRefs : undefined,
        errorCode: result.status === "failed" ? result.errorCode : null,
        now,
      });
      if (result.status !== "completed") return plan;
    } catch (error) {
      return input.repository.updateStep({
        sedeId: plan.sedeId,
        planId: plan.id,
        stepKey: step.key,
        expectedVersion: plan.version,
        status: "failed",
        errorCode: codeFor(error),
        now,
      });
    }
  }

  if (
    plan.steps.every(step => ["completed", "skipped"].includes(step.status))
  ) {
    plan = await input.repository.updatePlan({
      sedeId: plan.sedeId,
      planId: plan.id,
      expectedVersion: plan.version,
      status: "verifying",
      now,
    });
    try {
      const verification = await workflow.verify({ plan });
      return input.repository.updatePlan({
        sedeId: plan.sedeId,
        planId: plan.id,
        expectedVersion: plan.version,
        status: verification.status,
        result: verification.result,
        errorCode: verification.errorCode,
        now,
      });
    } catch (error) {
      return failPlan(input.repository, plan, codeFor(error), now);
    }
  }
  return plan;
}

export function startPlanWorker(
  options: {
    repository?: TarsPlanRepository;
    registry?: WorkflowRegistry;
    executors?: StepExecutors;
    pollMs?: number;
    staleLeaseMs?: number;
    modeForSede?: (sedeId: number) => "off" | "shadow" | "active";
  } = {}
): { stop(): Promise<void> } {
  const repository = options.repository ?? getTarsPlanRepository();
  const registry = options.registry ?? workflowRegistry;
  const executors = options.executors ?? {};
  const pollMs = Math.max(500, options.pollMs ?? 2_000);
  const staleLeaseMs = Math.max(10_000, options.staleLeaseMs ?? 5 * 60_000);
  const modeForSede =
    options.modeForSede ?? (sedeId => getFeatureFlags(sedeId).plannerMode);
  const active = new Set<Promise<unknown>>();
  let stopping = false;

  const tick = async () => {
    if (stopping) return;
    const now = new Date();
    await repository.recoverStale({
      cutoff: new Date(now.getTime() - staleLeaseMs),
      now,
    });
    const plans = await repository.listRunnable({ limit: 20 });
    for (const plan of plans) {
      if (modeForSede(plan.sedeId) !== "active") continue;
      await runPlanOnce({
        repository,
        registry,
        executors,
        planId: plan.id,
        sedeId: plan.sedeId,
        now,
      });
    }
  };
  const run = () => {
    const promise = tick().catch(error => {
      console.error("[tars-planner] worker failed:", codeFor(error));
    });
    active.add(promise);
    void promise.finally(() => active.delete(promise));
  };
  const timer = setInterval(run, pollMs);
  timer.unref();
  run();

  return {
    async stop() {
      stopping = true;
      clearInterval(timer);
      await Promise.allSettled(Array.from(active));
    },
  };
}
