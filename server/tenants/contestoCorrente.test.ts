import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  conTenant,
  conTenantDellaSede,
  modalitaTenantStretta,
  perOgniTenantAttivo,
  tenantCorrente,
  tenantsAttivi,
} from "./contestoCorrente";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";

describe("contesto corrente del tenant", () => {
  beforeEach(() => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    resetTenantRepositoryForTesting();
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

  it("conTenantDellaSede usa il tenant della sede (1 se la sede non esiste)", () => {
    expect(conTenantDellaSede(999_999, () => tenantCorrente())).toBe(1);
  });

  it("tenantsAttivi: 1 se il control plane è vuoto o spento, altrimenti i tenant attivi", async () => {
    expect(tenantsAttivi()).toEqual([1]);
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    await repo.inserisci({ id: 3, slug: "sospesa", nome: "Sospesa", stato: "sospeso" });
    expect(tenantsAttivi()).toEqual([1, 2]);
    process.env.FLAG_MULTI_AZIENDA = "off";
    expect(tenantsAttivi()).toEqual([1]);
  });

  it("perOgniTenantAttivo esegue ogni tenant nel suo contesto e un errore non ferma gli altri", async () => {
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    const visti: Array<number | null> = [];
    await perOgniTenantAttivo("prova", async id => {
      if (id === 1) throw new Error("boom");
      visti.push(tenantCorrente());
    });
    expect(visti).toEqual([2]);
  });
});
