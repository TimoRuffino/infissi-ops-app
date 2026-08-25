import { z } from "zod";
import { defineOperationalWorkflow } from "./operational";

export const reconcileInvoiceWorkflow = defineOperationalWorkflow({
  id: "reconcile-invoice-v1",
  intent: "reconcile_invoice",
  schema: z.object({
    invoiceId: z.number().int().positive(),
    candidateJobIds: z.array(z.number().int().positive()).max(5),
  }),
  requiredCapabilities: ["economia.read", "tars.approve_high_risk"],
  riskClass: "high",
  stepKeys: [
    "read-invoice",
    "rank-candidates",
    "approve-invoice-link",
    "verify-reconciliation",
  ],
});
