import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";

function context(ruoli: string[]): TrpcContext {
  return {
    user: { id: 31, role: ruoli.includes("direzione") ? "admin" : "user", ruolo: ruoli[0], ruoli, name: "T" } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId: 1,
    sediIds: [1],
  };
}

describe("router tariffe", () => {
  it("la direzione legge le tariffe dei limiti; gli altri no", async () => {
    const t = await appRouter.createCaller(context(["direzione"])).tariffe.limiti();
    expect(t.massimali).toHaveLength(18);
    expect(t.validoDal).toBe("2022-04-15");
    expect(t.prodotti.length).toBeGreaterThan(300);
    expect(t.accessori.length).toBeGreaterThan(60);
    await expect(appRouter.createCaller(context(["commerciale"])).tariffe.limiti()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
