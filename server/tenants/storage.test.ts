import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __impostaDriverPerTest, type StorageDriver } from "../_core/fileStorage";
import { __registraTenantNotoPerTest, storeDi } from "../_core/persistence";
// Side-effect only: registra le famiglie "preventivi_documenti" e
// "ticket_allegati" (persistedStore), che il ricalcolo (Task 4) legge con
// `storeDi`.
import "../routers";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";
import { applicaSoglie, creaContabileStorage, percentualeStorage, ricalcolaStorage, sogliaRaggiunta } from "./storage";

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

  // WS4 (quota che blocca, spec §6): `soglia100Dal` è la data da cui parte
  // la tolleranza — impostata al primo attraversamento del 100 %, mai
  // spostata ai giri successivi finché ci si resta, azzerata scendendo sotto.
  it("applicaSoglie imposta soglia100Dal al primo 100%, non la sposta ai giri successivi, la azzera scendendo sotto", async () => {
    const repo = getTenantRepository();
    let stato = await repo.aggiornaStorage(2, 1000, 1); // esattamente 100 %
    expect(stato.soglia100Dal).toBeNull(); // non ancora impostata: la riga arriva com'era prima di questo giro
    await applicaSoglie(stato);
    const primaData = (await repo.storageDi(2))?.soglia100Dal ?? null;
    expect(primaData).toBeInstanceOf(Date);

    // Un secondo giro, ancora al 100 % (es. un altro file arrivato): la data
    // di partenza della tolleranza non si sposta in avanti.
    stato = (await repo.storageDi(2))!;
    expect(stato.bytes).toBe(1000);
    await applicaSoglie(stato);
    expect((await repo.storageDi(2))?.soglia100Dal?.getTime()).toBe(primaData!.getTime());

    // Sotto il 100 %: si azzera (la tolleranza, se un giorno si torna a
    // riempire, riparte da un nuovo attraversamento).
    stato = await repo.aggiornaStorage(2, -600, 0); // 40 %
    await applicaSoglie(stato);
    expect((await repo.storageDi(2))?.soglia100Dal).toBeNull();
  });

  it("ricalcolaStorage somma size registrate e head delle anteprime, timbra e avvisa", async () => {
    // Mai `__resetPersistenzaPerTest()` in un file che importa i router: azzera
    // le famiglie registrate all'import. Si registra il tenant 2 e si puliscono gli array.
    __registraTenantNotoPerTest(2);
    storeDi<any>(2, "preventivi_documenti").length = 0;
    storeDi<any>(2, "ticket_allegati").length = 0;
    const file = new Map<string, Buffer>([["tenant/2/anteprime/1/1-aaaaaaaa.jpg", Buffer.alloc(7)]]);
    const driver: StorageDriver = {
      name: "local",
      async put() {}, async get() { return null; }, async openRead() { return null; }, async delete() {},
      async head(k) { const b = file.get(k); return b ? { bytes: b.length } : null; },
    };
    __impostaDriverPerTest(driver);
    try {
      storeDi<any>(2, "preventivi_documenti").push(
        { id: 1, tenantId: 2, sedeId: 20, commessaId: 1, nome: "a.pdf", size: 100, storageKey: "tenant/2/preventivi_documenti/1/1-aaaaaaaa.pdf", anteprime: { chiavi: ["tenant/2/anteprime/1/1-aaaaaaaa.jpg"] } },
        { id: 2, tenantId: 2, sedeId: 20, commessaId: 1, nome: "b.pdf", size: 999, dataBase64: "QUJD" } // legacy inline: non conta
      );
      storeDi<any>(2, "ticket_allegati").push({ id: 3, tenantId: 2, ticketId: 1, nome: "c.png", size: 50, storageKey: "tenant/2/ticket_allegati/1/3-aaaaaaaa.png" });
      const stato = await ricalcolaStorage(2, "test");
      expect(stato).toMatchObject({ tenantId: 2, bytes: 157, file: 3 });
      expect(stato.ricalcolatoIl).toBeInstanceOf(Date);
      const eventi = await getTenantRepository().eventi(2);
      expect(eventi.map(e => e.tipo)).toEqual(["storage_ricalcolato"]);
      expect(eventi[0].dettagli).toEqual({ bytes: 157, file: 3 });
    } finally {
      __impostaDriverPerTest(null);
      storeDi<any>(2, "preventivi_documenti").length = 0;
      storeDi<any>(2, "ticket_allegati").length = 0;
    }
  });
});
