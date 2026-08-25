import { z } from "zod";
import { defineOperationalWorkflow } from "./operational";

export const manageLeadWorkflow = defineOperationalWorkflow({
  id: "manage-lead-v1",
  intent: "create_customer_job",
  schema: z.object({
    communicationId: z.number().int().positive(),
    assigneeId: z.number().int().positive(),
    request: z.string().trim().min(3).max(8_000),
  }),
  requiredCapabilities: ["cliente.create", "commessa.create"],
  riskClass: "medium",
  stepKeys: ["read-message", "dedupe-lead", "approve-lead", "verify-link"],
});
