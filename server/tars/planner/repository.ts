import { kvSql } from "../../_core/persistence";
import type { Capability } from "../../authz/capabilities";
import type {
  PlanStatus,
  PlanStepDraft,
  StepStatus,
  StructuredValue,
  TarsPlan,
  TarsPlanEvent,
  TarsPlanStep,
} from "./types";

export type CreatePlanInput = {
  sedeId: number;
  operationKey: string;
  workflowId: string;
  workflowVersion: number;
  intent: string;
  riskClass: TarsPlan["riskClass"];
  requiredCapabilities: readonly Capability[];
  entityRefs: TarsPlan["entityRefs"];
  input: StructuredValue;
  createdBy: number | null;
  createdAt: Date;
  steps: PlanStepDraft[];
};

type UpdatePlanInput = {
  sedeId: number;
  planId: number;
  expectedVersion: number;
  status: PlanStatus;
  result?: StructuredValue | null;
  errorCode?: string | null;
  now: Date;
};

type UpdateStepInput = {
  sedeId: number;
  planId: number;
  stepKey: string;
  expectedVersion: number;
  status: StepStatus;
  output?: StructuredValue | null;
  evidenceRefs?: TarsPlanStep["evidenceRefs"];
  errorCode?: string | null;
  now: Date;
};

type ResumeInput = {
  sedeId: number;
  planId: number;
  stepKey: string;
  expectedVersion: number;
  response: StructuredValue;
  now: Date;
};

export type TarsPlanRepository = {
  ensureSchema(): Promise<void>;
  create(input: CreatePlanInput): Promise<{ plan: TarsPlan; created: boolean }>;
  getById(input: { sedeId: number; planId: number }): Promise<TarsPlan | null>;
  getByOperationKey(input: {
    sedeId: number;
    operationKey: string;
  }): Promise<TarsPlan | null>;
  updatePlan(input: UpdatePlanInput): Promise<TarsPlan>;
  updateStep(input: UpdateStepInput): Promise<TarsPlan>;
  resumeWithUserResponse(input: ResumeInput): Promise<TarsPlan>;
  listRunnable(input: { sedeId?: number; limit: number }): Promise<TarsPlan[]>;
  listBySite(input: { sedeId: number; limit: number }): Promise<TarsPlan[]>;
  recoverStale(input: { cutoff: Date; now: Date }): Promise<number>;
  listEvents(input: {
    sedeId: number;
    planId: number;
  }): Promise<TarsPlanEvent[]>;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sanitizeErrorCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const first = value.trim().split(/\s+/)[0] ?? "PLAN_STEP_FAILED";
  return (
    first
      .toUpperCase()
      .replace(/[^A-Z0-9_.:-]/g, "_")
      .slice(0, 120) || "PLAN_STEP_FAILED"
  );
}

function sanitizeValue(value: StructuredValue, depth = 0): StructuredValue {
  if (depth > 8) return "[depth-limited]";
  if (typeof value === "string") return value.slice(0, 5_000);
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 200).map(item => sanitizeValue(item, depth + 1));
  }
  const result: Record<string, StructuredValue> = {};
  for (const [key, item] of Object.entries(value).slice(0, 200)) {
    result[key] = /token|password|secret|authorization/i.test(key)
      ? "[redacted]"
      : sanitizeValue(item, depth + 1);
  }
  return result;
}

function assertCompletable(plan: TarsPlan, status: PlanStatus): void {
  if (
    status === "completed" &&
    plan.steps.some(step => !["completed", "skipped"].includes(step.status))
  ) {
    throw new Error("PLAN_STEPS_INCOMPLETE");
  }
}

function statusForStep(status: StepStatus): PlanStatus {
  if (status === "waiting_user") return "waiting_user";
  if (status === "waiting_approval") return "waiting_approval";
  if (status === "failed") return "failed";
  return "running";
}

export function createMemoryTarsPlanRepository(): TarsPlanRepository {
  const plans: TarsPlan[] = [];
  const events: TarsPlanEvent[] = [];
  let nextPlanId = 1;
  let nextStepId = 1;
  let nextEventId = 1;

  const find = (sedeId: number, planId: number) =>
    plans.find(plan => plan.sedeId === sedeId && plan.id === planId) ?? null;
  const emit = (
    plan: TarsPlan,
    type: string,
    payload: StructuredValue,
    at: Date
  ) => {
    events.push({
      id: nextEventId++,
      planId: plan.id,
      planVersion: plan.version,
      type,
      payload: sanitizeValue(payload),
      createdAt: new Date(at),
    });
  };
  const requireVersion = (
    sedeId: number,
    planId: number,
    expectedVersion: number
  ) => {
    const plan = find(sedeId, planId);
    if (!plan) throw new Error("PLAN_NOT_FOUND");
    if (plan.version !== expectedVersion) {
      throw new Error("PLAN_VERSION_CONFLICT");
    }
    return plan;
  };

  return {
    async ensureSchema() {},

    async create(input) {
      const existing = plans.find(
        plan =>
          plan.sedeId === input.sedeId &&
          plan.operationKey === input.operationKey
      );
      if (existing) return { plan: clone(existing), created: false };
      const id = nextPlanId++;
      const plan: TarsPlan = {
        id,
        sedeId: input.sedeId,
        operationKey: input.operationKey,
        workflowId: input.workflowId,
        workflowVersion: input.workflowVersion,
        intent: input.intent,
        status: "draft",
        riskClass: input.riskClass,
        requiredCapabilities: [...input.requiredCapabilities],
        entityRefs: clone(input.entityRefs),
        input: sanitizeValue(input.input),
        result: null,
        errorCode: null,
        version: 1,
        createdBy: input.createdBy,
        createdAt: new Date(input.createdAt),
        updatedAt: new Date(input.createdAt),
        completedAt: null,
        steps: input.steps.map((step, position) => ({
          id: nextStepId++,
          planId: id,
          key: step.key,
          position,
          type: step.type,
          dependencies: [...step.dependencies],
          input: sanitizeValue(step.input),
          output: null,
          evidenceRefs: [],
          status: "pending",
          attempts: 0,
          errorCode: null,
          startedAt: null,
          completedAt: null,
        })),
      };
      if (
        new Set(plan.steps.map(step => step.key)).size !== plan.steps.length
      ) {
        throw new Error("PLAN_STEP_KEY_DUPLICATE");
      }
      plans.push(plan);
      emit(
        plan,
        "plan_created",
        { workflowId: plan.workflowId },
        input.createdAt
      );
      return { plan: clone(plan), created: true };
    },

    async getById(input) {
      const plan = find(input.sedeId, input.planId);
      return plan ? clone(plan) : null;
    },

    async getByOperationKey(input) {
      const plan = plans.find(
        item =>
          item.sedeId === input.sedeId &&
          item.operationKey === input.operationKey
      );
      return plan ? clone(plan) : null;
    },

    async updatePlan(input) {
      const plan = requireVersion(
        input.sedeId,
        input.planId,
        input.expectedVersion
      );
      assertCompletable(plan, input.status);
      plan.status = input.status;
      plan.result =
        input.result === undefined
          ? plan.result
          : input.result == null
            ? null
            : sanitizeValue(input.result);
      plan.errorCode = sanitizeErrorCode(input.errorCode);
      plan.version += 1;
      plan.updatedAt = new Date(input.now);
      plan.completedAt = [
        "completed",
        "partially_completed",
        "failed",
        "canceled",
      ].includes(input.status)
        ? new Date(input.now)
        : null;
      emit(plan, "plan_status_changed", { status: input.status }, input.now);
      return clone(plan);
    },

    async updateStep(input) {
      const plan = requireVersion(
        input.sedeId,
        input.planId,
        input.expectedVersion
      );
      const step = plan.steps.find(item => item.key === input.stepKey);
      if (!step) throw new Error("PLAN_STEP_NOT_FOUND");
      step.status = input.status;
      step.output =
        input.output === undefined
          ? step.output
          : input.output == null
            ? null
            : sanitizeValue(input.output);
      step.evidenceRefs = clone(input.evidenceRefs ?? step.evidenceRefs);
      step.errorCode = sanitizeErrorCode(input.errorCode);
      if (input.status === "running") {
        step.attempts += 1;
        step.startedAt = new Date(input.now);
      }
      step.completedAt = ["completed", "failed", "skipped"].includes(
        input.status
      )
        ? new Date(input.now)
        : null;
      plan.status = statusForStep(input.status);
      plan.version += 1;
      plan.updatedAt = new Date(input.now);
      emit(
        plan,
        "step_status_changed",
        { stepKey: step.key, status: step.status },
        input.now
      );
      return clone(plan);
    },

    async resumeWithUserResponse(input) {
      const plan = requireVersion(
        input.sedeId,
        input.planId,
        input.expectedVersion
      );
      const step = plan.steps.find(item => item.key === input.stepKey);
      if (!step || step.status !== "waiting_user") {
        throw new Error("PLAN_STEP_NOT_WAITING_USER");
      }
      step.status = "pending";
      step.output = { userResponse: sanitizeValue(input.response) };
      step.errorCode = null;
      step.completedAt = null;
      plan.status = "running";
      plan.version += 1;
      plan.updatedAt = new Date(input.now);
      emit(plan, "user_response_received", { stepKey: step.key }, input.now);
      return clone(plan);
    },

    async listRunnable(input) {
      return plans
        .filter(
          plan =>
            (input.sedeId == null || plan.sedeId === input.sedeId) &&
            ["draft", "running", "verifying"].includes(plan.status)
        )
        .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
        .slice(0, Math.max(1, Math.min(input.limit, 100)))
        .map(plan => clone(plan));
    },

    async listBySite(input) {
      return plans
        .filter(plan => plan.sedeId === input.sedeId)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, Math.max(1, Math.min(input.limit, 100)))
        .map(plan => clone(plan));
    },

    async recoverStale(input) {
      let recovered = 0;
      for (const plan of plans) {
        const staleSteps = plan.steps.filter(
          step =>
            step.status === "running" &&
            step.startedAt != null &&
            step.startedAt < input.cutoff
        );
        if (staleSteps.length === 0) continue;
        for (const step of staleSteps) {
          step.status = "pending";
          step.errorCode = null;
          step.completedAt = null;
          recovered += 1;
        }
        plan.status = "running";
        plan.version += 1;
        plan.updatedAt = new Date(input.now);
        emit(
          plan,
          "stale_steps_recovered",
          { stepKeys: staleSteps.map(step => step.key) },
          input.now
        );
      }
      return recovered;
    },

    async listEvents(input) {
      const plan = find(input.sedeId, input.planId);
      if (!plan) return [];
      return events
        .filter(event => event.planId === input.planId)
        .map(event => clone(event));
    },
  };
}

type Sql = NonNullable<typeof kvSql>;
type Row = Record<string, any>;

function rowStep(row: Row): TarsPlanStep {
  return {
    id: Number(row.id),
    planId: Number(row.plan_id),
    key: String(row.step_key),
    position: Number(row.position),
    type: row.step_type,
    dependencies: row.dependencies ?? [],
    input: row.input_json,
    output: row.output_json ?? null,
    evidenceRefs: row.evidence_refs ?? [],
    status: row.status,
    attempts: Number(row.attempts),
    errorCode: row.error_code ?? null,
    startedAt: row.started_at ? new Date(row.started_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
  };
}

function rowPlan(row: Row, steps: TarsPlanStep[]): TarsPlan {
  return {
    id: Number(row.id),
    sedeId: Number(row.sede_id),
    operationKey: String(row.operation_key),
    workflowId: String(row.workflow_id),
    workflowVersion: Number(row.workflow_version),
    intent: String(row.intent),
    status: row.status,
    riskClass: row.risk_class,
    requiredCapabilities: row.required_capabilities ?? [],
    entityRefs: row.entity_refs ?? [],
    input: row.input_json,
    result: row.result_json ?? null,
    errorCode: row.error_code ?? null,
    version: Number(row.version),
    createdBy: row.created_by == null ? null : Number(row.created_by),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    steps,
  };
}

export function createPostgresTarsPlanRepository(sql: Sql): TarsPlanRepository {
  let schemaPromise: Promise<void> | null = null;
  const ensureSchema = () => {
    schemaPromise ??= sql
      .begin(async tx => {
        await tx`CREATE TABLE IF NOT EXISTS tars_plans (
          id BIGSERIAL PRIMARY KEY,
          sede_id INTEGER NOT NULL,
          operation_key TEXT NOT NULL,
          workflow_id TEXT NOT NULL,
          workflow_version INTEGER NOT NULL,
          intent TEXT NOT NULL,
          status TEXT NOT NULL,
          risk_class TEXT NOT NULL,
          required_capabilities JSONB NOT NULL,
          entity_refs JSONB NOT NULL,
          input_json JSONB NOT NULL,
          result_json JSONB,
          error_code TEXT,
          version INTEGER NOT NULL DEFAULT 1,
          created_by INTEGER,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL,
          completed_at TIMESTAMPTZ,
          UNIQUE (sede_id, operation_key)
        )`;
        await tx`CREATE INDEX IF NOT EXISTS tars_plans_runnable_idx
          ON tars_plans (sede_id, status, updated_at, id)`;
        await tx`CREATE TABLE IF NOT EXISTS tars_plan_steps (
          id BIGSERIAL PRIMARY KEY,
          plan_id BIGINT NOT NULL REFERENCES tars_plans(id) ON DELETE CASCADE,
          step_key TEXT NOT NULL,
          position INTEGER NOT NULL,
          step_type TEXT NOT NULL,
          dependencies JSONB NOT NULL,
          input_json JSONB NOT NULL,
          output_json JSONB,
          evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
          status TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          error_code TEXT,
          started_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          UNIQUE (plan_id, step_key),
          UNIQUE (plan_id, position)
        )`;
        await tx`CREATE TABLE IF NOT EXISTS tars_plan_events (
          id BIGSERIAL PRIMARY KEY,
          plan_id BIGINT NOT NULL REFERENCES tars_plans(id) ON DELETE CASCADE,
          plan_version INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          payload_json JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL
        )`;
        await tx`CREATE INDEX IF NOT EXISTS tars_plan_events_plan_idx
          ON tars_plan_events (plan_id, id)`;
      })
      .then(() => undefined);
    return schemaPromise;
  };

  const loadBy = async (
    clause: "id" | "operation",
    input: { sedeId: number; planId?: number; operationKey?: string }
  ): Promise<TarsPlan | null> => {
    await ensureSchema();
    const rows =
      clause === "id"
        ? await sql`SELECT * FROM tars_plans WHERE sede_id = ${input.sedeId} AND id = ${input.planId!}`
        : await sql`SELECT * FROM tars_plans WHERE sede_id = ${input.sedeId} AND operation_key = ${input.operationKey!}`;
    if (!rows[0]) return null;
    const steps = await sql`SELECT * FROM tars_plan_steps
      WHERE plan_id = ${Number(rows[0].id)} ORDER BY position`;
    return rowPlan(rows[0], steps.map(rowStep));
  };

  const insertEvent = async (
    tx: any,
    planId: number,
    version: number,
    type: string,
    payload: StructuredValue,
    now: Date
  ) => {
    await tx`INSERT INTO tars_plan_events (
      plan_id, plan_version, event_type, payload_json, created_at
    ) VALUES (
      ${planId}, ${version}, ${type}, ${tx.json(sanitizeValue(payload) as any)}, ${now}
    )`;
  };

  return {
    ensureSchema,

    async create(input) {
      await ensureSchema();
      let created = false;
      const planId = await sql.begin(async tx => {
        const rows = await tx`INSERT INTO tars_plans (
          sede_id, operation_key, workflow_id, workflow_version, intent, status,
          risk_class, required_capabilities, entity_refs, input_json, version,
          created_by, created_at, updated_at
        ) VALUES (
          ${input.sedeId}, ${input.operationKey}, ${input.workflowId}, ${input.workflowVersion},
          ${input.intent}, 'draft', ${input.riskClass},
          ${tx.json([...input.requiredCapabilities])}, ${tx.json(input.entityRefs as any)},
          ${tx.json(sanitizeValue(input.input) as any)}, 1, ${input.createdBy},
          ${input.createdAt}, ${input.createdAt}
        ) ON CONFLICT (sede_id, operation_key) DO NOTHING RETURNING id`;
        if (!rows[0]) {
          const known = await tx`SELECT id FROM tars_plans
            WHERE sede_id = ${input.sedeId} AND operation_key = ${input.operationKey}`;
          return Number(known[0].id);
        }
        created = true;
        const id = Number(rows[0].id);
        const keys = new Set<string>();
        for (let position = 0; position < input.steps.length; position += 1) {
          const step = input.steps[position];
          if (keys.has(step.key)) throw new Error("PLAN_STEP_KEY_DUPLICATE");
          keys.add(step.key);
          await tx`INSERT INTO tars_plan_steps (
            plan_id, step_key, position, step_type, dependencies, input_json, status
          ) VALUES (
            ${id}, ${step.key}, ${position}, ${step.type},
            ${tx.json(step.dependencies)}, ${tx.json(sanitizeValue(step.input) as any)}, 'pending'
          )`;
        }
        await insertEvent(
          tx,
          id,
          1,
          "plan_created",
          { workflowId: input.workflowId },
          input.createdAt
        );
        return id;
      });
      const plan = await loadBy("id", { sedeId: input.sedeId, planId });
      if (!plan) throw new Error("PLAN_CREATE_NOT_READABLE");
      return { plan, created };
    },

    getById(input) {
      return loadBy("id", input);
    },

    getByOperationKey(input) {
      return loadBy("operation", input);
    },

    async updatePlan(input) {
      await ensureSchema();
      const current = await loadBy("id", input);
      if (!current) throw new Error("PLAN_NOT_FOUND");
      if (current.version !== input.expectedVersion) {
        throw new Error("PLAN_VERSION_CONFLICT");
      }
      assertCompletable(current, input.status);
      const terminal = [
        "completed",
        "partially_completed",
        "failed",
        "canceled",
      ].includes(input.status);
      const nextResult =
        input.result === undefined ? current.result : input.result;
      const resultParam =
        nextResult == null ? null : sql.json(sanitizeValue(nextResult) as any);
      const rows = await sql`UPDATE tars_plans SET
        status = ${input.status},
        result_json = ${resultParam},
        error_code = ${sanitizeErrorCode(input.errorCode)},
        version = version + 1, updated_at = ${input.now},
        completed_at = ${terminal ? input.now : null}
        WHERE sede_id = ${input.sedeId} AND id = ${input.planId}
          AND version = ${input.expectedVersion}
        RETURNING version`;
      if (!rows[0]) throw new Error("PLAN_VERSION_CONFLICT");
      await insertEvent(
        sql,
        input.planId,
        Number(rows[0].version),
        "plan_status_changed",
        { status: input.status },
        input.now
      );
      return (await loadBy("id", input))!;
    },

    async updateStep(input) {
      await ensureSchema();
      await sql.begin(async tx => {
        const plans = await tx`SELECT id, version FROM tars_plans
          WHERE sede_id = ${input.sedeId} AND id = ${input.planId} FOR UPDATE`;
        if (!plans[0]) throw new Error("PLAN_NOT_FOUND");
        if (Number(plans[0].version) !== input.expectedVersion) {
          throw new Error("PLAN_VERSION_CONFLICT");
        }
        const steps = await tx`SELECT * FROM tars_plan_steps
          WHERE plan_id = ${input.planId} AND step_key = ${input.stepKey} FOR UPDATE`;
        if (!steps[0]) throw new Error("PLAN_STEP_NOT_FOUND");
        const startedAt =
          input.status === "running"
            ? input.now
            : (steps[0].started_at ?? null);
        const completedAt = ["completed", "failed", "skipped"].includes(
          input.status
        )
          ? input.now
          : null;
        const nextOutput =
          input.output === undefined
            ? (steps[0].output_json ?? null)
            : input.output;
        const outputParam =
          nextOutput == null ? null : tx.json(sanitizeValue(nextOutput) as any);
        await tx`UPDATE tars_plan_steps SET
          status = ${input.status},
          output_json = ${outputParam},
          evidence_refs = ${tx.json((input.evidenceRefs ?? steps[0].evidence_refs ?? []) as any)},
          error_code = ${sanitizeErrorCode(input.errorCode)},
          attempts = attempts + ${input.status === "running" ? 1 : 0},
          started_at = ${startedAt}, completed_at = ${completedAt}
          WHERE id = ${Number(steps[0].id)}`;
        const version = input.expectedVersion + 1;
        await tx`UPDATE tars_plans SET status = ${statusForStep(input.status)},
          version = ${version}, updated_at = ${input.now}
          WHERE id = ${input.planId}`;
        await insertEvent(
          tx,
          input.planId,
          version,
          "step_status_changed",
          { stepKey: input.stepKey, status: input.status },
          input.now
        );
      });
      return (await loadBy("id", input))!;
    },

    async resumeWithUserResponse(input) {
      await ensureSchema();
      await sql.begin(async tx => {
        const plans = await tx`SELECT id, version FROM tars_plans
          WHERE sede_id = ${input.sedeId} AND id = ${input.planId} FOR UPDATE`;
        if (!plans[0]) throw new Error("PLAN_NOT_FOUND");
        if (Number(plans[0].version) !== input.expectedVersion) {
          throw new Error("PLAN_VERSION_CONFLICT");
        }
        const steps = await tx`SELECT id, status FROM tars_plan_steps
          WHERE plan_id = ${input.planId} AND step_key = ${input.stepKey} FOR UPDATE`;
        if (!steps[0] || steps[0].status !== "waiting_user") {
          throw new Error("PLAN_STEP_NOT_WAITING_USER");
        }
        await tx`UPDATE tars_plan_steps SET status = 'pending',
          output_json = ${tx.json({ userResponse: sanitizeValue(input.response) })},
          error_code = NULL, completed_at = NULL
          WHERE id = ${Number(steps[0].id)}`;
        const version = input.expectedVersion + 1;
        await tx`UPDATE tars_plans SET status = 'running', version = ${version},
          updated_at = ${input.now} WHERE id = ${input.planId}`;
        await insertEvent(
          tx,
          input.planId,
          version,
          "user_response_received",
          { stepKey: input.stepKey },
          input.now
        );
      });
      return (await loadBy("id", input))!;
    },

    async listRunnable(input) {
      await ensureSchema();
      const limit = Math.max(1, Math.min(input.limit, 100));
      const rows =
        input.sedeId == null
          ? await sql`SELECT sede_id, id FROM tars_plans
            WHERE status IN ('draft', 'running', 'verifying')
            ORDER BY updated_at ASC LIMIT ${limit}`
          : await sql`SELECT sede_id, id FROM tars_plans
            WHERE sede_id = ${input.sedeId}
              AND status IN ('draft', 'running', 'verifying')
            ORDER BY updated_at ASC LIMIT ${limit}`;
      const loaded = await Promise.all(
        rows.map(row =>
          loadBy("id", {
            sedeId: Number(row.sede_id),
            planId: Number(row.id),
          })
        )
      );
      return loaded.filter((plan): plan is TarsPlan => plan != null);
    },

    async listBySite(input) {
      await ensureSchema();
      const limit = Math.max(1, Math.min(input.limit, 100));
      const rows = await sql`SELECT id FROM tars_plans
        WHERE sede_id = ${input.sedeId}
        ORDER BY updated_at DESC LIMIT ${limit}`;
      const loaded = await Promise.all(
        rows.map(row =>
          loadBy("id", { sedeId: input.sedeId, planId: Number(row.id) })
        )
      );
      return loaded.filter((plan): plan is TarsPlan => plan != null);
    },

    async recoverStale(input) {
      await ensureSchema();
      return sql.begin(async tx => {
        const rows = await tx`SELECT id, plan_id, step_key
          FROM tars_plan_steps
          WHERE status = 'running' AND started_at < ${input.cutoff}
          FOR UPDATE SKIP LOCKED`;
        if (rows.length === 0) return 0;
        const byPlan = new Map<number, string[]>();
        for (const row of rows) {
          const planId = Number(row.plan_id);
          const keys = byPlan.get(planId) ?? [];
          keys.push(String(row.step_key));
          byPlan.set(planId, keys);
          await tx`UPDATE tars_plan_steps SET status = 'pending',
            error_code = NULL, completed_at = NULL
            WHERE id = ${Number(row.id)}`;
        }
        for (const [planId, stepKeys] of Array.from(byPlan.entries())) {
          const plans = await tx`UPDATE tars_plans SET status = 'running',
            version = version + 1, updated_at = ${input.now}
            WHERE id = ${planId} RETURNING version`;
          if (plans[0]) {
            await insertEvent(
              tx,
              planId,
              Number(plans[0].version),
              "stale_steps_recovered",
              { stepKeys },
              input.now
            );
          }
        }
        return rows.length;
      });
    },

    async listEvents(input) {
      await ensureSchema();
      const plan = await loadBy("id", input);
      if (!plan) return [];
      const rows = await sql`SELECT * FROM tars_plan_events
        WHERE plan_id = ${input.planId} ORDER BY id`;
      return rows.map(row => ({
        id: Number(row.id),
        planId: Number(row.plan_id),
        planVersion: Number(row.plan_version),
        type: String(row.event_type),
        payload: row.payload_json,
        createdAt: new Date(row.created_at),
      }));
    },
  };
}

let repository: TarsPlanRepository | null = null;

export function getTarsPlanRepository(): TarsPlanRepository {
  repository ??= kvSql
    ? createPostgresTarsPlanRepository(kvSql)
    : createMemoryTarsPlanRepository();
  return repository;
}
