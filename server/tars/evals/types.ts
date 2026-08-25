export const EVAL_FAMILIES = [
  "email_classification",
  "whatsapp",
  "correlation",
  "create_customer_job",
  "assignment",
  "invoice",
  "document",
  "ticket",
  "stalled_job",
  "no_action",
  "security",
] as const;

export type EvalFamily = (typeof EVAL_FAMILIES)[number];

export type EvalExpected = {
  intent?: string;
  toolNames: string[];
  forbiddenToolNames: string[];
  proposalTypes: string[];
  requiresEvidence: boolean;
  finalState?: string;
};

export type EvalCase = {
  id: string;
  version: 1;
  family: EvalFamily;
  trigger: string;
  input: Record<string, unknown>;
  expected: EvalExpected;
  tags: string[];
};

export type EvalObserved = {
  intent?: string;
  toolNames: string[];
  proposalTypes: string[];
  importantClaims: number;
  citedClaims: number;
  finalState?: string;
  securityViolation?: string | null;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
};

export const TARS_PROMPT_VERSION = "prompt-v2";
export const TARS_TOOL_REGISTRY_VERSION = "tools-v2";
export const TARS_POLICY_VERSION = "policy-legacy-v1";
