import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { conTenant, modalitaTenantStretta, tenantCorrente } from "./contestoCorrente";

// I giri per tenant e per sede (conTenantDellaSede, tenantsAttivi,
// perOgniTenantAttivo) sono in ./giri.test.ts (Fix round 1, Task 7):
// questo modulo resta una foglia del grafo e i suoi test toccano solo
// AsyncLocalStorage, l'interruttore e la modalità stretta dei test — mai
// il control plane del tenant.
describe("contesto corrente del tenant", () => {
  beforeEach(() => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    modalitaTenantStretta(false);
  });
  afterEach(() => {
    delete process.env.FLAG_MULTI_AZIENDA;
    modalitaTenantStretta(false);
  });

  it("dentro conTenant risolve il tenant, anche attraverso await e timer", async () => {
    const visto = await conTenant(7, async () => {
      await new Promise(r => setTimeout(r, 1));
      return tenantCorrente();
    });
    expect(visto).toBe(7);
  });

  it("annidato: l'interno vince e l'esterno torna alla fine", async () => {
    await conTenant(2, async () => {
      expect(tenantCorrente()).toBe(2);
      await conTenant(3, async () => expect(tenantCorrente()).toBe(3));
      expect(tenantCorrente()).toBe(2);
    });
  });

  it("nei test senza contesto ripiega sul tenant 1; in modalità stretta è null", () => {
    expect(tenantCorrente()).toBe(1);
    modalitaTenantStretta(true);
    expect(tenantCorrente()).toBeNull();
  });

  it("con interruttore spento è sempre 1, anche dentro conTenant(5)", () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    expect(tenantCorrente()).toBe(1);
    expect(conTenant(5, () => tenantCorrente())).toBe(1);
  });
});
