import { z } from "zod";
import { defineOperationalWorkflow } from "./operational";

export const manageTicketWorkflow = defineOperationalWorkflow({
  id: "manage-ticket-v1",
  intent: "manage_ticket",
  schema: z.object({
    subject: z.string().trim().min(3).max(200),
    description: z.string().trim().min(3).max(8_000),
    customerId: z.number().int().positive().optional(),
    jobId: z.number().int().positive().optional(),
  }),
  requiredCapabilities: ["ticket.create"],
  riskClass: "low",
  stepKeys: [
    "read-ticket-context",
    "resolve-relations",
    "approve-ticket",
    "verify-ticket",
  ],
});
