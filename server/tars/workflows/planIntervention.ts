import { z } from "zod";
import { defineOperationalWorkflow } from "./operational";

export const planInterventionWorkflow = defineOperationalWorkflow({
  id: "plan-intervention-v1",
  intent: "plan_intervention",
  schema: z.object({
    jobId: z.number().int().positive(),
    teamId: z.number().int().positive(),
    slotStart: z.string().datetime(),
  }),
  requiredCapabilities: ["intervento.plan", "intervento.assign"],
  riskClass: "medium",
  stepKeys: [
    "read-live-calendar",
    "validate-slot",
    "approve-intervention",
    "verify-calendar",
  ],
});
