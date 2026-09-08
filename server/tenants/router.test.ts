// Test del router tenants: `storage` espone il ledger dei byte dell'azienda
// della sessione (WS3 §3.2) — conta e avvisa, non blocca.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "../_core/context";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";
import { tenantsRouter } from "./router";

const SEDE = 90401;
const UTENTE = 90411;

function context(tenantId: number, sedeId = SEDE): TrpcContext {
  return {
    user: {
      id: UTENTE,
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      name: `Utente ${UTENTE}`,
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
    tenantId,
    tenant: null,
  };
}

describe("tenantsRouter", () => {
  beforeEach(async () => {
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    await repo.impostaQuotaStorage(2, 1000);
  });
  afterEach(() => resetTenantRepositoryForTesting());

  it("mio: l'azienda della sessione (smoke)", async () => {
    const caller = tenantsRouter.createCaller(context(2));
    const risultato = await caller.mio();
    expect(risultato.id).toBe(2);
    expect(risultato.slug).toBe("acme");
  });

  it("storage: byte, file e percentuale dell'azienda della sessione, senza bloccare", async () => {
    const repo = getTenantRepository();
    await repo.aggiornaStorage(2, 500, 1);
    const caller = tenantsRouter.createCaller(context(2));
    expect(await caller.storage()).toEqual({
      bytes: 500,
      file: 1,
      quotaBytes: 1000,
      percentuale: 50,
      sogliaAvvisata: 0,
      ricalcolatoIl: null,
    });
  });

  it("storage: zeri e default quando l'azienda non ha ancora un ledger", async () => {
    const caller = tenantsRouter.createCaller(context(2));
    expect(await caller.storage()).toEqual({
      bytes: 0,
      file: 0,
      quotaBytes: 1000,
      percentuale: 0,
      sogliaAvvisata: 0,
      ricalcolatoIl: null,
    });
  });
});
