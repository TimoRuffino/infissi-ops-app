import type { Capability } from "../../authz/capabilities";
import type { EvidenceRef } from "../context/types";
import type {
  PlanStepDraft,
  StructuredValue,
  TarsPlan,
  TarsPlanStep,
} from "../planner/types";

export type WorkflowInput = {
  sedeId: number;
  operationKey: string;
  input: StructuredValue;
  entityRefs: Array<{ type: string; id: string }>;
  createdBy: number | null;
};

export type WorkflowContext = {
  plan: TarsPlan;
};

export type VerificationResult = {
  status: "completed" | "partially_completed" | "failed";
  result: StructuredValue;
  errorCode?: string | null;
};

export type WorkflowDefinition = {
  id: string;
  version: number;
  intent: string;
  requiredCapabilities: Capability[];
  riskClass: "read" | "low" | "medium" | "high";
  buildSteps(input: WorkflowInput): PlanStepDraft[];
  verify(ctx: WorkflowContext): Promise<VerificationResult>;
};

export type StepExecutionResult =
  | {
      status: "completed";
      output: StructuredValue;
      evidenceRefs?: EvidenceRef[];
    }
  | { status: "waiting_user"; output: StructuredValue }
  | { status: "waiting_approval"; output: StructuredValue }
  | { status: "waiting_technical"; errorCode: string }
  | { status: "failed"; errorCode: string; output?: StructuredValue };

export type StepExecutorContext = {
  plan: TarsPlan;
  step: TarsPlanStep;
  operationKey: string;
};

export type StepExecutor = (
  context: StepExecutorContext
) => Promise<StepExecutionResult>;
