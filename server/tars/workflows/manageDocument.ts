import { z } from "zod";
import { defineOperationalWorkflow } from "./operational";

export const manageDocumentWorkflow = defineOperationalWorkflow({
  id: "manage-document-v1",
  intent: "manage_document",
  schema: z.object({
    documentId: z.number().int().positive(),
    classification: z.string().trim().min(2).max(100),
    candidateJobId: z.number().int().positive().optional(),
  }),
  requiredCapabilities: ["commessa.manage_documents"],
  riskClass: "medium",
  stepKeys: [
    "read-document",
    "classify-document",
    "approve-document-link",
    "verify-document",
  ],
});
