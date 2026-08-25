import { describe, expect, it } from "vitest";
import type { OperationalWorkflow } from "./operational";
import { manageLeadWorkflow } from "./manageLead";
import { assignWorkWorkflow } from "./assignWork";
import { reconcileInvoiceWorkflow } from "./reconcileInvoice";
import { manageDocumentWorkflow } from "./manageDocument";
import { planInterventionWorkflow } from "./planIntervention";
import { manageTicketWorkflow } from "./manageTicket";

const workflows: Array<{
  workflow: OperationalWorkflow;
  valid: Record<string, unknown>;
  missing: string;
}> = [
  {
    workflow: manageLeadWorkflow,
    valid: { communicationId: 11, assigneeId: 7, request: "Quattro finestre" },
    missing: "request",
  },
  {
    workflow: assignWorkWorkflow,
    valid: { entityType: "commessa", entityId: 12, assigneeId: 7 },
    missing: "assigneeId",
  },
  {
    workflow: reconcileInvoiceWorkflow,
    valid: { invoiceId: 13, candidateJobIds: [20, 21] },
    missing: "invoiceId",
  },
  {
    workflow: manageDocumentWorkflow,
    valid: { documentId: 14, classification: "contratto", candidateJobId: 20 },
    missing: "classification",
  },
  {
    workflow: planInterventionWorkflow,
    valid: { jobId: 15, teamId: 3, slotStart: "2026-09-01T08:00:00.000Z" },
    missing: "slotStart",
  },
  {
    workflow: manageTicketWorkflow,
    valid: {
      subject: "Maniglia bloccata",
      description: "Non chiude",
      customerId: 16,
    },
    missing: "description",
  },
];

const allowed = {
  requestSedeId: 1,
  resourceSedeId: 1,
  hasPermission: true,
  duplicate: false,
  approval: "approved" as const,
  providerAvailable: true,
  verificationPassed: true,
};

describe.each(workflows)(
  "$workflow.definition.id",
  ({ workflow, valid, missing }) => {
    it("completa il percorso valido con chiave canonica stabile", () => {
      expect(workflow.preflight(valid, allowed)).toEqual({ status: "ready" });
      expect(workflow.canonicalKey(valid)).toBe(
        workflow.canonicalKey({ ...valid })
      );
      expect(workflow.canonicalKey(valid)).not.toContain("Quattro finestre");
    });

    it("chiede i dati obbligatori mancanti", () => {
      const incomplete = { ...valid };
      delete incomplete[missing];
      expect(workflow.preflight(incomplete, allowed)).toMatchObject({
        status: "waiting_user",
        errorCode: "WORKFLOW_INPUT_INVALID",
      });
    });

    it("riconosce un duplicato prima della proposta", () => {
      expect(
        workflow.preflight(valid, { ...allowed, duplicate: true })
      ).toEqual({
        status: "duplicate",
      });
    });

    it("nega il flusso senza capability", () => {
      expect(
        workflow.preflight(valid, { ...allowed, hasPermission: false })
      ).toEqual({ status: "forbidden", errorCode: "CAPABILITY_DENIED" });
    });

    it("tratta una risorsa di altra sede come non trovata", () => {
      expect(
        workflow.preflight(valid, { ...allowed, resourceSedeId: 2 })
      ).toEqual({ status: "not_found", errorCode: "RESOURCE_NOT_FOUND" });
    });

    it("non ripropone un'approvazione rifiutata", () => {
      expect(
        workflow.preflight(valid, { ...allowed, approval: "rejected" })
      ).toEqual({ status: "rejected" });
    });

    it("conserva il lavoro quando il provider non è disponibile", () => {
      expect(
        workflow.preflight(valid, { ...allowed, providerAvailable: false })
      ).toEqual({
        status: "waiting_technical",
        errorCode: "PROVIDER_UNAVAILABLE",
      });
    });

    it("fallisce se il verifier non conferma le post-condizioni", () => {
      expect(
        workflow.preflight(valid, { ...allowed, verificationPassed: false })
      ).toEqual({ status: "failed", errorCode: "POSTCONDITION_FAILED" });
    });
  }
);

describe("vincoli specifici dei workflow", () => {
  it("limita a cinque le commesse candidate per una fattura", () => {
    expect(
      reconcileInvoiceWorkflow.preflight(
        { invoiceId: 1, candidateJobIds: [1, 2, 3, 4, 5, 6] },
        allowed
      )
    ).toMatchObject({
      status: "waiting_user",
      errorCode: "WORKFLOW_INPUT_INVALID",
    });
  });

  it("mantiene un ticket indipendente quando manca una relazione certa", () => {
    expect(
      manageTicketWorkflow.preflight(
        { subject: "Assistenza", description: "Porta vecchia" },
        allowed
      )
    ).toEqual({ status: "ready" });
  });
});
