import { createHash } from "node:crypto";
import { z } from "zod";
import type { WorkflowDefinition } from "./types";

const customerSchema = z.object({
  nome: z.string().trim().min(1),
  cognome: z.string().trim().min(1),
  tipo: z
    .enum(["privato", "azienda", "condominio", "ente_pubblico"])
    .default("privato"),
  telefono: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  indirizzo: z.string().trim().min(1).optional(),
  citta: z.string().trim().min(1).optional(),
});

const jobSchema = z.object({
  assegnatoA: z.number().int().positive().optional(),
  priorita: z.enum(["bassa", "media", "alta", "urgente"]).default("media"),
  note: z.string().trim().max(2_000).optional(),
  prodotti: z
    .array(
      z.object({
        nome: z.string().trim().min(1),
        quantita: z.number().int().min(1),
      })
    )
    .max(50)
    .default([]),
});

export const createCustomerJobInput = z.object({
  customer: customerSchema,
  job: jobSchema,
  communicationId: z.number().int().positive().optional(),
});

export type CreateCustomerJobInput = z.input<typeof createCustomerJobInput>;
export type ParsedCreateCustomerJobInput = z.output<
  typeof createCustomerJobInput
>;

type Entity = { id: number; sedeId: number };
type JobEntity = Entity & { clienteId: number };

export type CreateCustomerJobOperation = {
  operationKey: string;
  sedeId: number;
  workflowId: "create-customer-job-v1";
  inputFingerprint: string;
  status: "running" | "failed" | "partially_completed" | "completed";
  customerId: number | null;
  jobId: number | null;
  communicationLinked: boolean;
  errorCode: string | null;
  updatedAt: Date;
};

export type CreateCustomerJobServices = {
  loadOperation(
    operationKey: string,
    sedeId: number
  ): Promise<CreateCustomerJobOperation | null>;
  saveOperation(operation: CreateCustomerJobOperation): Promise<void>;
  findEquivalentCustomer(
    customer: ParsedCreateCustomerJobInput["customer"],
    sedeId: number
  ): Promise<Entity | null>;
  findEquivalentJob(
    customerId: number,
    job: ParsedCreateCustomerJobInput["job"],
    sedeId: number
  ): Promise<JobEntity | null>;
  validateAssignee(
    assigneeId: number,
    sedeId: number
  ): Promise<{
    id: number;
    sedeId: number;
    active: boolean;
  } | null>;
  createCustomer(
    customer: ParsedCreateCustomerJobInput["customer"] & { assegnatoA: number },
    operationKey: string
  ): Promise<Entity>;
  createJob(
    customerId: number,
    job: ParsedCreateCustomerJobInput["job"] & { assegnatoA: number },
    operationKey: string
  ): Promise<JobEntity>;
  linkCommunication(
    communicationId: number,
    customerId: number,
    jobId: number,
    operationKey: string
  ): Promise<boolean>;
  verify(input: {
    customerId: number;
    jobId: number;
    communicationId?: number;
    sedeId: number;
  }): Promise<{ customer: Entity | null; job: JobEntity | null }>;
};

export type CreateCustomerJobResult =
  | {
      status: "waiting_user";
      customerId: null;
      jobId: null;
      missing: string[];
      errorCode: string;
    }
  | {
      status: "failed";
      customerId: null;
      jobId: null;
      errorCode: string;
    }
  | {
      status: "partially_completed" | "completed";
      customerId: number;
      jobId: number | null;
      errorCode: string | null;
    };

function stable(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
    .join(",")}}`;
}

function fingerprint(input: ParsedCreateCustomerJobInput): string {
  return createHash("sha256").update(stable(input)).digest("hex");
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.trim()) return code.slice(0, 120);
  }
  return "CREATE_CUSTOMER_JOB_FAILED";
}

export async function executeCreateCustomerJobSaga(args: {
  sedeId: number;
  operationKey: string;
  input: CreateCustomerJobInput;
  services: CreateCustomerJobServices;
}): Promise<CreateCustomerJobResult> {
  const parsed = createCustomerJobInput.parse(args.input);
  if (parsed.job.assegnatoA == null) {
    return {
      status: "waiting_user",
      customerId: null,
      jobId: null,
      missing: ["job.assegnatoA"],
      errorCode: "ASSIGNEE_REQUIRED",
    };
  }
  const assignee = await args.services.validateAssignee(
    parsed.job.assegnatoA,
    args.sedeId
  );
  if (!assignee || !assignee.active || assignee.sedeId !== args.sedeId) {
    return {
      status: "waiting_user",
      customerId: null,
      jobId: null,
      missing: ["job.assegnatoA"],
      errorCode: "ASSIGNEE_NOT_AVAILABLE",
    };
  }

  const inputFingerprint = fingerprint(parsed);
  let operation = await args.services.loadOperation(
    args.operationKey,
    args.sedeId
  );
  if (operation && operation.inputFingerprint !== inputFingerprint) {
    throw Object.assign(
      new Error("Operation key already used for other input"),
      {
        code: "OPERATION_KEY_CONFLICT",
      }
    );
  }
  if (operation?.status === "completed" && operation.jobId != null) {
    return {
      status: "completed",
      customerId: operation.customerId!,
      jobId: operation.jobId,
      errorCode: null,
    };
  }
  operation ??= {
    operationKey: args.operationKey,
    sedeId: args.sedeId,
    workflowId: "create-customer-job-v1",
    inputFingerprint,
    status: "running",
    customerId: null,
    jobId: null,
    communicationLinked: false,
    errorCode: null,
    updatedAt: new Date(),
  };

  try {
    if (operation.customerId == null) {
      const existing = await args.services.findEquivalentCustomer(
        parsed.customer,
        args.sedeId
      );
      const customer =
        existing && existing.sedeId === args.sedeId
          ? existing
          : await args.services.createCustomer(
              { ...parsed.customer, assegnatoA: parsed.job.assegnatoA },
              `${args.operationKey}:create-customer`
            );
      if (customer.sedeId !== args.sedeId)
        throw { code: "CUSTOMER_SCOPE_MISMATCH" };
      operation.customerId = customer.id;
      operation.status = "running";
      operation.updatedAt = new Date();
      await args.services.saveOperation(operation);
    }

    if (operation.jobId == null) {
      const existing = await args.services.findEquivalentJob(
        operation.customerId,
        parsed.job,
        args.sedeId
      );
      const job =
        existing &&
        existing.sedeId === args.sedeId &&
        existing.clienteId === operation.customerId
          ? existing
          : await args.services.createJob(
              operation.customerId,
              { ...parsed.job, assegnatoA: parsed.job.assegnatoA },
              `${args.operationKey}:create-job`
            );
      if (
        job.sedeId !== args.sedeId ||
        job.clienteId !== operation.customerId
      ) {
        throw { code: "JOB_RELATION_MISMATCH" };
      }
      operation.jobId = job.id;
      operation.updatedAt = new Date();
      await args.services.saveOperation(operation);
    }

    if (parsed.communicationId != null && !operation.communicationLinked) {
      const linked = await args.services.linkCommunication(
        parsed.communicationId,
        operation.customerId,
        operation.jobId,
        `${args.operationKey}:link-communication`
      );
      if (!linked) throw { code: "COMMUNICATION_LINK_FAILED" };
      operation.communicationLinked = true;
      operation.updatedAt = new Date();
      await args.services.saveOperation(operation);
    }

    const verified = await args.services.verify({
      customerId: operation.customerId,
      jobId: operation.jobId,
      communicationId: parsed.communicationId,
      sedeId: args.sedeId,
    });
    if (
      !verified.customer ||
      verified.customer.sedeId !== args.sedeId ||
      !verified.job ||
      verified.job.sedeId !== args.sedeId ||
      verified.job.clienteId !== verified.customer.id
    ) {
      throw { code: "POSTCONDITION_FAILED" };
    }
    operation.status = "completed";
    operation.errorCode = null;
    operation.updatedAt = new Date();
    await args.services.saveOperation(operation);
    return {
      status: "completed",
      customerId: operation.customerId,
      jobId: operation.jobId,
      errorCode: null,
    };
  } catch (error) {
    operation.status =
      operation.customerId == null ? "failed" : "partially_completed";
    operation.errorCode = errorCode(error);
    operation.updatedAt = new Date();
    await args.services.saveOperation(operation);
    return operation.customerId == null
      ? {
          status: "failed",
          customerId: null,
          jobId: null,
          errorCode: operation.errorCode,
        }
      : {
          status: "partially_completed",
          customerId: operation.customerId,
          jobId: operation.jobId,
          errorCode: operation.errorCode,
        };
  }
}

export function createCustomerJobWorkflow(): WorkflowDefinition {
  return {
    id: "create-customer-job-v1",
    version: 1,
    intent: "create_customer_job",
    requiredCapabilities: ["cliente.create", "commessa.create"],
    riskClass: "medium",
    buildSteps() {
      return [
        { key: "dedupe-customer", type: "read", dependencies: [], input: {} },
        {
          key: "resolve-assignee",
          type: "ask",
          dependencies: ["dedupe-customer"],
          input: {},
        },
        {
          key: "approve-composed-proposal",
          type: "propose",
          dependencies: ["resolve-assignee"],
          input: {},
        },
        {
          key: "create-customer",
          type: "propose",
          dependencies: ["approve-composed-proposal"],
          input: {},
        },
        {
          key: "create-job",
          type: "propose",
          dependencies: ["create-customer"],
          input: {},
        },
        {
          key: "link-communication",
          type: "propose",
          dependencies: ["create-job"],
          input: {},
        },
        {
          key: "verify-relations",
          type: "verify",
          dependencies: ["link-communication"],
          input: {},
        },
      ];
    },
    async verify({ plan }) {
      const step = plan.steps.find(item => item.key === "verify-relations");
      return step?.status === "completed"
        ? { status: "completed", result: step.output ?? {} }
        : { status: "failed", result: {}, errorCode: "POSTCONDITION_FAILED" };
    },
  };
}
