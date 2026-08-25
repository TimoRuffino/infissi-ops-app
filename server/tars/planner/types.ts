import type { Capability } from "../../authz/capabilities";
import type { EvidenceRef } from "../context/types";

export type PlanStatus =
  | "draft"
  | "running"
  | "waiting_user"
  | "waiting_approval"
  | "verifying"
  | "completed"
  | "partially_completed"
  | "failed"
  | "canceled";

export type StepStatus =
  | "pending"
  | "running"
  | "waiting_user"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "skipped";

export type PlanStepType = "read" | "compute" | "ask" | "propose" | "verify";

export type StructuredValue =
  | null
  | boolean
  | number
  | string
  | StructuredValue[]
  | { [key: string]: StructuredValue };

export type TarsPlanStep = {
  id: number;
  planId: number;
  key: string;
  position: number;
  type: PlanStepType;
  dependencies: string[];
  input: StructuredValue;
  output: StructuredValue | null;
  evidenceRefs: EvidenceRef[];
  status: StepStatus;
  attempts: number;
  errorCode: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
};

export type TarsPlan = {
  id: number;
  sedeId: number;
  operationKey: string;
  workflowId: string;
  workflowVersion: number;
  intent: string;
  status: PlanStatus;
  riskClass: "read" | "low" | "medium" | "high";
  requiredCapabilities: Capability[];
  entityRefs: Array<{ type: string; id: string }>;
  input: StructuredValue;
  result: StructuredValue | null;
  errorCode: string | null;
  version: number;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  steps: TarsPlanStep[];
};

export type PlanStepDraft = Pick<
  TarsPlanStep,
  "key" | "type" | "dependencies" | "input"
>;

export type TarsPlanEvent = {
  id: number;
  planId: number;
  planVersion: number;
  type: string;
  payload: StructuredValue;
  createdAt: Date;
};
