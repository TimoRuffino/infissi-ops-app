import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import {
  evaluateClosureReadiness,
  type ClosureDataSource,
} from "./closureReadiness";

const ctx = {
  sedeId: 1,
  user: { id: 1, ruolo: "direzione", ruoli: ["direzione"] },
} as TrpcContext;

function source(
  overrides: Partial<{
    commessa: any;
    documents: any[];
    timeline: any[];
    tickets: any[];
    interventions: any[];
  }> = {}
): ClosureDataSource {
  const completeDocuments = [
    "preventivo",
    "misure",
    "contratto",
    "fattura",
    "ordine",
    "saldo",
    "ddt_consegna",
    "ddt_posa",
    "ddt_finale",
  ].map((tipo, index) => ({ id: index + 1, tipo }));
  return {
    loadCommessa: async () =>
      overrides.commessa ?? {
        id: 41,
        sedeId: 1,
        stato: "preventivo",
        importoTotale: 10_000,
        importoIncassato: 10_000,
      },
    loadDocuments: async () => overrides.documents ?? completeDocuments,
    loadTimeline: async () => overrides.timeline ?? [],
    loadTickets: async () => overrides.tickets ?? [],
    loadInterventions: async () => overrides.interventions ?? [],
  };
}

describe("Tars closure readiness", () => {
  it("considera pronta una commessa senza blocchi", async () => {
    const result = await evaluateClosureReadiness(ctx, 41, source());
    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("raccoglie saldo, documenti, timeline e pratiche aperte", async () => {
    const result = await evaluateClosureReadiness(
      ctx,
      41,
      source({
        commessa: {
          id: 41,
          sedeId: 1,
          stato: "finiture_saldo",
          importoTotale: 10_000,
          importoIncassato: 9_000,
        },
        documents: [{ id: 1, tipo: "ddt_posa" }],
        timeline: [
          { id: 9, stepNumber: 9, label: "Consegna", stato: "in_corso" },
          { id: 10, stepNumber: 10, label: "Saldo", stato: "da_fare" },
        ],
        tickets: [{ id: 71, stato: "in_lavorazione" }],
        interventions: [{ id: 81, stato: "sospeso" }],
      })
    );

    expect(result.ready).toBe(false);
    expect(result.saldoResiduo).toBe(1000);
    expect(result.blockers.map(item => item.code)).toEqual([
      "saldo",
      "documenti",
      "timeline",
      "ticket",
      "interventi",
    ]);
    expect(result.incompleteTimelineSteps).toHaveLength(2);
    expect(result.openTicketIds).toEqual([71]);
    expect(result.openInterventionIds).toEqual([81]);
  });

  it("non considera i passaggi da fare un blocco da soli", async () => {
    const result = await evaluateClosureReadiness(
      ctx,
      41,
      source({
        timeline: [
          { id: 10, stepNumber: 10, label: "Passaggio non applicabile", stato: "da_fare" },
        ],
      })
    );
    expect(result.ready).toBe(true);
    expect(result.incompleteTimelineSteps).toHaveLength(1);
  });

  it("nasconde le commesse di un'altra sede", async () => {
    await expect(
      evaluateClosureReadiness(
        ctx,
        41,
        source({ commessa: { id: 41, sedeId: 2, stato: "preventivo" } })
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
