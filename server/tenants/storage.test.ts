import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applicaSoglie, creaContabileStorage, percentualeStorage, sogliaRaggiunta } from "./storage";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";

describe("contabile dello storage", () => {
  beforeEach(async () => {
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    await repo.impostaQuotaStorage(2, 1000);
  });
  afterEach(() => resetTenantRepositoryForTesting());

  it("percentuale e soglia", () => {
    expect(percentualeStorage(0, 1000)).toBe(0);
    expect(percentualeStorage(333, 1000)).toBe(33.3);
    expect(percentualeStorage(10, 0)).toBe(0);
    expect(sogliaRaggiunta(499, 1000)).toBe(0);
    expect(sogliaRaggiunta(500, 1000)).toBe(50);
    expect(sogliaRaggiunta(800, 1000)).toBe(80);
    expect(sogliaRaggiunta(1500, 1000)).toBe(100);
  });

  it("aggiungi e togli aggiornano il ledger; ogni soglia si avvisa una volta e si riarma sotto il 50 %", async () => {
    const repo = getTenantRepository();
    const c = creaContabileStorage();
    await c.aggiungi(2, 400, 1);
    expect(await repo.eventi(2)).toEqual([]);
    await c.aggiungi(2, 150, 1); // 55 %
    await c.aggiungi(2, 100, 1); // 65 %: nessun nuovo evento
    let eventi = await repo.eventi(2);
    expect(eventi.map(e => e.tipo)).toEqual(["storage_soglia"]);
    expect(eventi[0].dettagli).toEqual({ percentuale: 50, bytes: 550, quotaBytes: 1000 });
    await c.aggiungi(2, 600, 1); // 125 %: salta direttamente a 100
    eventi = await repo.eventi(2);
    expect(eventi.map(e => e.dettagli?.percentuale)).toEqual([50, 100]);
    expect((await repo.storageDi(2))?.sogliaAvvisata).toBe(100);
    await c.togli(2, 1000, 3); // 15 %: si riarma
    expect((await repo.storageDi(2))?.sogliaAvvisata).toBe(0);
    expect(await repo.storageDi(2)).toMatchObject({ bytes: 250, file: 1 });
    await c.aggiungi(2, 300, 1); // di nuovo 55 %: nuovo avviso
    expect((await repo.eventi(2)).length).toBe(3);
  });

  it("applicaSoglie non avvisa un'azienda senza quota superata e non scrive eventi doppi", async () => {
    const repo = getTenantRepository();
    const stato = await repo.aggiornaStorage(1, 10, 1);
    expect(await applicaSoglie(stato)).toBeNull();
    expect(await repo.eventi(1)).toEqual([]);
  });
});
