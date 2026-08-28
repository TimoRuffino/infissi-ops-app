import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";

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

  it("espone metriche aggregate di eventi e notifiche", async () => {
    // Piani e workflow uscivano dal registro esecuzioni di Tars, rimosso il
    // 28/08/2026. Qui restano gli aggregati che non dipendono dall'agente.
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
      })
    );
  });
});
