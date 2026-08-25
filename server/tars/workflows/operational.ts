import { createHash } from "node:crypto";
import type { ZodType } from "zod";
import type { Capability } from "../../authz/capabilities";
import type { WorkflowDefinition } from "./types";

export type OperationalChecks = {
  requestSedeId: number;
  resourceSedeId: number;
  hasPermission: boolean;
  duplicate: boolean;
  approval: "pending" | "approved" | "rejected";
  providerAvailable: boolean;
  verificationPassed: boolean;
};

export type OperationalDecision =
  | { status: "ready" | "duplicate" | "rejected" | "waiting_approval" }
  | {
      status:
        | "waiting_user"
        | "forbidden"
        | "not_found"
        | "waiting_technical"
        | "failed";
      errorCode: string;
    };

export type OperationalWorkflow = {
  definition: WorkflowDefinition;
  canonicalKey(input: unknown): string;
  preflight(input: unknown, checks: OperationalChecks): OperationalDecision;
};

function stable(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
    .join(",")}}`;
}

export function defineOperationalWorkflow(config: {
  id: string;
  intent: string;
  schema: ZodType;
  requiredCapabilities: Capability[];
  riskClass: WorkflowDefinition["riskClass"];
  stepKeys: [string, string, string, string];
}): OperationalWorkflow {
  const definition: WorkflowDefinition = {
    id: config.id,
    version: 1,
    intent: config.intent,
    requiredCapabilities: config.requiredCapabilities,
    riskClass: config.riskClass,
    buildSteps: () => [
      { key: config.stepKeys[0], type: "read", dependencies: [], input: {} },
      {
        key: config.stepKeys[1],
        type: "compute",
        dependencies: [config.stepKeys[0]],
        input: {},
      },
      {
        key: config.stepKeys[2],
        type: "propose",
        dependencies: [config.stepKeys[1]],
        input: {},
      },
      {
        key: config.stepKeys[3],
        type: "verify",
        dependencies: [config.stepKeys[2]],
        input: {},
      },
    ],
    async verify({ plan }) {
      const verification = plan.steps.find(
        step => step.key === config.stepKeys[3]
      );
      return verification?.status === "completed"
        ? { status: "completed", result: verification.output ?? {} }
        : { status: "failed", result: {}, errorCode: "POSTCONDITION_FAILED" };
    },
  };
  return {
    definition,
    canonicalKey(input) {
      const parsed = config.schema.parse(input);
      const digest = createHash("sha256")
        .update(stable(parsed))
        .digest("hex")
        .slice(0, 24);
      return `${config.id}:${digest}`;
    },
    preflight(input, checks) {
      if (!config.schema.safeParse(input).success) {
        return { status: "waiting_user", errorCode: "WORKFLOW_INPUT_INVALID" };
      }
      if (checks.resourceSedeId !== checks.requestSedeId) {
        return { status: "not_found", errorCode: "RESOURCE_NOT_FOUND" };
      }
      if (!checks.hasPermission) {
        return { status: "forbidden", errorCode: "CAPABILITY_DENIED" };
      }
      if (checks.duplicate) return { status: "duplicate" };
      if (checks.approval === "rejected") return { status: "rejected" };
      if (checks.approval === "pending") return { status: "waiting_approval" };
      if (!checks.providerAvailable) {
        return {
          status: "waiting_technical",
          errorCode: "PROVIDER_UNAVAILABLE",
        };
      }
      if (!checks.verificationPassed) {
        return { status: "failed", errorCode: "POSTCONDITION_FAILED" };
      }
      return { status: "ready" };
    },
  };
}
