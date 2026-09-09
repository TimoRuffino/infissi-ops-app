// server/tenants/ripristino.test.ts
// Il ripristino in memoria, con un Drive finto: qui contano la validazione
// dei dump, la prova che non tocca nulla e l'ordine sospendi → sostituisci →
// riattiva → evento.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapAll, persistedStore, storeDi } from "../_core/persistence";
import { getSediStore } from "../routers/sedi";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";
import { ripristinaArchivi, validaDump, type DriveRipristino } from "./ripristino";

// Registrate all'import, una volta sola; `bootstrapAll` (in memoria) le marca
// `loaded`, condizione di `sostituisciStore`. Mai `__resetPersistenzaPerTest()`
// qui: azzererebbe anche `sedi` (registrata da ../routers/sedi).
persistedStore<any>("rip_clienti");
persistedStore<any>("rip_commesse");

function driveFinto(dump: Record<string, unknown>): DriveRipristino {
  return {
    async cartellaBackup(rif) { return rif === "2026-09-07" || rif === "idcartella" ? { id: "idcartella", nome: "Backup CRM 2026-09-07" } : null; },
    async dumpDisponibili() { return Object.entries(dump).map(([nome, dati]) => ({ nome, scarica: async () => dati })); },
  };
}

describe("ripristino degli archivi", () => {
  beforeAll(() => bootstrapAll({ tenantIds: [1, 2] }));
  beforeEach(async () => {
    delete process.env.FLAG_MULTI_AZIENDA;
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    getSediStore().length = 0;
    getSediStore().push({ id: 20, tenantId: 2, nome: "HQ", attiva: true } as any);
    storeDi<any>(2, "rip_clienti").length = 0;
    storeDi<any>(2, "rip_commesse").length = 0;
    storeDi<any>(2, "rip_clienti").push({ id: 1, tenantId: 2, sedeId: 20 }, { id: 2, tenantId: 2, sedeId: 20 });
  });
  afterEach(() => { resetTenantRepositoryForTesting(); getSediStore().length = 0; });

  it("validaDump: array di record con id unici, sede dell'azienda, tenant dell'azienda", () => {
    expect(validaDump("x", "no", 2, new Set([20])).anomalie).toEqual(["x: il dump non è un array"]);
    const v = validaDump("x", [{ id: 1, sedeId: 20 }, { id: 1, sedeId: 99 }, { id: "3" }, { id: 4, tenantId: 1 }], 2, new Set([20]));
    expect(v.anomalie).toEqual(["x: id duplicato 1", "x: record 1 con sedeId 99 non dell'azienda", "x: record senza id numerico (posizione 2)", "x: record 4 con tenantId 1 di un'altra azienda"]);
  });

  it("in prova confronta i conteggi e non tocca nulla; con scrivi sostituisce, sospende e riattiva, registra l'evento", async () => {
    const drive = driveFinto({ rip_clienti: [{ id: 7, tenantId: 2, sedeId: 20 }], backup_oauth: [{ id: 1 }], altro: [] });
    const prova = await ripristinaArchivi({ tenantId: 2, backup: "2026-09-07", solo: null, scrivi: false, attore: { tipo: "script", nome: "test" } }, drive);
    expect(prova.dryRun).toBe(true);
    expect(prova.store).toEqual([{ nome: "rip_clienti", prima: 2, dopo: 1, sostituito: false }]);
    expect(prova.anomalie).toEqual(["backup_oauth: escluso dal ripristino", "altro: non è uno store per azienda"]);
    // L'avvertenza sull'`onLoad` si legge già in prova, cioè prima di scrivere.
    expect(prova.avvertenze).toEqual([expect.stringContaining("non passano da onLoad")]);
    expect(storeDi(2, "rip_clienti")).toHaveLength(2);
    const vero = await ripristinaArchivi({ tenantId: 2, backup: "idcartella", solo: ["rip_clienti"], scrivi: true, attore: { tipo: "script", nome: "test" } }, drive);
    expect(vero.store).toEqual([{ nome: "rip_clienti", prima: 2, dopo: 1, sostituito: true }]);
    expect(vero.avvertenze).toEqual([expect.stringContaining("riavviare il server subito dopo il ripristino")]);
    expect(storeDi(2, "rip_clienti")).toEqual([{ id: 7, tenantId: 2, sedeId: 20 }]);
    const repo = getTenantRepository();
    expect(repo.perId(2)?.stato).toBe("attivo");
    expect((await repo.eventi(2)).map(e => e.tipo)).toEqual(["sospeso", "riattivato", "archivi_ripristinati"]);
  });

  it("backup inesistente, --solo sconosciuto, dump non valido: errore senza toccare gli archivi", async () => {
    const attore = { tipo: "script" as const, nome: "test" };
    await expect(ripristinaArchivi({ tenantId: 2, backup: "2020-01-01", solo: null, scrivi: true, attore }, driveFinto({}))).rejects.toThrow("Backup 2020-01-01 non trovato sul Drive dell'azienda");
    await expect(ripristinaArchivi({ tenantId: 2, backup: "2026-09-07", solo: ["boh"], scrivi: true, attore }, driveFinto({ rip_clienti: [] }))).rejects.toThrow("Store richiesti assenti dal backup: boh");
    await expect(ripristinaArchivi({ tenantId: 2, backup: "2026-09-07", solo: null, scrivi: true, attore }, driveFinto({ rip_clienti: [{ id: 1, sedeId: 99 }] }))).rejects.toThrow("Dump non valido");
    expect(storeDi(2, "rip_clienti")).toHaveLength(2);
    expect(getTenantRepository().perId(2)?.stato).toBe("attivo");
  });

  it("con --scrivi e nessuno store da sostituire rifiuta prima di sospendere l'azienda", async () => {
    const attore = { tipo: "script" as const, nome: "test" };
    // Un backup che porta solo store esclusi: non c'è niente da ripristinare.
    const drive = driveFinto({ backup_oauth: [{ id: 1 }] });
    // La prova lo dice e basta: è lì per far leggere le note.
    const prova = await ripristinaArchivi({ tenantId: 2, backup: "2026-09-07", solo: ["backup_oauth"], scrivi: false, attore }, drive);
    expect(prova.store).toEqual([]);
    expect(prova.anomalie).toEqual(["backup_oauth: escluso dal ripristino"]);
    expect(prova.avvertenze).toEqual([]);
    // Con `--scrivi` no: sospendere e riattivare l'azienda per non sostituire
    // niente sarebbe un fermo gratuito con un evento che non racconta nulla.
    await expect(
      ripristinaArchivi({ tenantId: 2, backup: "2026-09-07", solo: ["backup_oauth"], scrivi: true, attore }, drive)
    ).rejects.toThrow("Nessuno store da ripristinare");
    const repo = getTenantRepository();
    expect(repo.perId(2)?.stato).toBe("attivo");
    expect((await repo.eventi(2)).map(e => e.tipo)).toEqual([]);
  });

  it("il tenant 1 richiede ancheTenant1", async () => {
    await expect(ripristinaArchivi({ tenantId: 1, backup: "2026-09-07", solo: null, scrivi: false, attore: { tipo: "script", nome: "test" } }, driveFinto({}))).rejects.toThrow("Il tenant 1 si ripristina solo con --anche-tenant-1");
  });
});
