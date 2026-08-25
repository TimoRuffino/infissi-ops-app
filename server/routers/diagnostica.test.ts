import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { esecuzioni } from "../tars/stores";

function context(role: "direzione" | "commerciale"): TrpcContext {
  return {
    user: {
      id: role === "direzione" ? 1 : 2,
      role: role === "direzione" ? "admin" : "user",
      ruolo: role,
      ruoli: [role],
      name: role,
    } as any,
    sedeId: 977,
    sediIds: [977],
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
  };
}

describe("diagnostica operativa", () => {
  it("e accessibile solo alla direzione", async () => {
    await expect(
      appRouter.createCaller(context("commerciale")).diagnostica.snapshot()
    ).rejects.toThrow();
  });

  it("espone metriche aggregate senza payload o dati personali", async () => {
    esecuzioni.push({
      id: 997_701,
      sedeId: 977,
      trigger: "on_demand",
      modello: "gpt-test",
      richiesta: "scrivi a mario@example.it telefono 3331234567",
      riepilogo: "contenuto mail privato",
      strumenti: [],
      proposteIds: [],
      commessaId: null,
      comunicazioneId: null,
      profiloStrumenti: "completo",
      strumentiDisponibili: 3,
      toolCacheHits: 4,
      proposteDuplicateBloccate: 0,
      comunicazioniClassificateIds: [],
      fascicoloPrecaricato: false,
      contextFingerprint: null,
      contextScope: "direzione",
      contextCacheHit: true,
      evidenceRefs: [],
      factsRead: 2,
      factsRevalidated: 2,
      tokensIn: 120,
      tokensOut: 30,
      tokensCacheRead: 80,
      tokensCacheWrite5m: 0,
      tokensCacheWrite1h: 0,
      durataMs: 50,
      esito: "ok",
      errore: null,
      utenteId: 1,
      utenteNome: "Mario Rossi",
      promptVersion: "p1",
      toolRegistryVersion: "t1",
      workflowVersion: "w1",
      policyVersion: "policy1",
      createdAt: new Date(),
    });

    const result = await appRouter
      .createCaller(context("direzione"))
      .diagnostica.snapshot();
    expect(result).toEqual(
      expect.objectContaining({
        events: expect.objectContaining({
          consumers: expect.any(Array),
          deadLetter: expect.any(Number),
        }),
        notifications: expect.objectContaining({
          pending: expect.any(Number),
          sseConnections: expect.any(Number),
        }),
        plans: expect.any(Array),
        workflows: expect.arrayContaining([
          expect.objectContaining({
            workflow: "on_demand",
            tokensIn: 120,
            cacheHits: 4,
          }),
        ]),
      })
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(
      /mario@example|3331234567|contenuto mail|Mario Rossi/
    );
  });
});
