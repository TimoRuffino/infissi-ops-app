import { z } from "zod";
import { CAPABILITIES } from "../../authz/capabilities";

export const TARS_INTENTS = [
  "informational_query",
  "cross_domain_search",
  "create_customer_job",
  "manage_communication",
  "reconcile_invoice",
  "manage_document",
  "plan_intervention",
  "manage_ticket",
  "analyze_job",
  "audit_process",
] as const;

export const intentDecisionSchema = z.object({
  intent: z.enum(TARS_INTENTS),
  workflow: z.string().min(1).nullable(),
  entityRefs: z
    .array(
      z.object({
        type: z.string().min(1).max(50),
        id: z.string().min(1).max(120),
      })
    )
    .max(20),
  riskClass: z.enum(["read", "low", "medium", "high"]),
  requiredCapabilities: z.array(z.enum(CAPABILITIES)).max(10),
  confidence: z.number().min(0).max(1),
  needsClarification: z.boolean(),
});

export type IntentDecision = z.infer<typeof intentDecisionSchema>;
export type TarsIntent = IntentDecision["intent"];

export type TrustedIntentHint = {
  intent: TarsIntent;
  workflow?: string | null;
  entityRefs?: IntentDecision["entityRefs"];
};
