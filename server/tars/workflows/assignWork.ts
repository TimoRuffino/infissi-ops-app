import { z } from "zod";
import { defineOperationalWorkflow } from "./operational";

export const assignWorkWorkflow = defineOperationalWorkflow({
  id: "assign-work-v1",
  intent: "assignment",
  schema: z.object({
    entityType: z.enum(["cliente", "commessa", "ticket", "intervento"]),
    entityId: z.number().int().positive(),
    assigneeId: z.number().int().positive(),
  }),
  requiredCapabilities: ["tars.use"],
  riskClass: "low",
  stepKeys: [
    "read-target",
    "validate-assignee",
    "approve-assignment",
    "verify-assignment-event",
  ],
});
