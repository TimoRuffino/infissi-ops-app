import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { modalitaTenantStretta, tenantCorrente } from "./contestoCorrente";
import { conTenantDellaSede, perOgniTenantAttivo, tenantsAttivi } from "./giri";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";

describe("giri per tenant e per sede", () => {
  beforeEach(() => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    resetTenantRepositoryForTesting();
    modalitaTenantStretta(false);
  });
  afterEach(() => {
    delete process.env.FLAG_MULTI_AZIENDA;
    modalitaTenantStretta(false);
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
