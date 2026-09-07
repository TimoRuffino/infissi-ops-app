// Su PostgreSQL vero, come server/_core/jsonbSnapshot.pg.test.ts:
//   docker run -d --name perf-pg-test -e POSTGRES_PASSWORD=test \
//     -e POSTGRES_DB=perf_test -p 55433:5432 postgres:16-alpine
//   DATABASE_URL=postgres://postgres:test@localhost:55433/perf_test \
//     pnpm vitest run server/tenants/repository.pg.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kvSql } from "../_core/persistence";
import {
  createPostgresTenantRepository,
  getTenantRepository,
  resetTenantRepositoryForTesting,
} from "./repository";

const conDatabase = Boolean(process.env.DATABASE_URL && kvSql);

/** Stesso numero in tabelle.pg.test.ts: i due file non si sovrappongono. */
const LOCK_TENANT_PG = 20260907;

describe.skipIf(!conDatabase)("repository tenant su Postgres", () => {
  const sql = kvSql!;
  let riservata: Awaited<ReturnType<typeof sql.reserve>> | null = null;

  beforeAll(async () => {
    // `tabelle.pg.test.ts` lavora sulle stesse tabelle: il lock consultivo su
    // una connessione riservata serializza i due file, che vitest esegue in
    // parallelo (senza, i DROP di qui cadrebbero in mezzo alle sue prove).
    riservata = await sql.reserve();
    await riservata`SELECT pg_advisory_lock(${LOCK_TENANT_PG})`;
    await sql`DROP TABLE IF EXISTS tenant_sedi, tenant_comandi, tenant_eventi, tenants CASCADE`;
    resetTenantRepositoryForTesting();
  });

  afterAll(async () => {
    await sql`DROP TABLE IF EXISTS tenant_sedi, tenant_comandi, tenant_eventi, tenants CASCADE`;
    if (riservata) {
      await riservata`SELECT pg_advisory_unlock(${LOCK_TENANT_PG})`;
      riservata.release();
    }
  });

  it("lo schema è idempotente e il seed del tenant 1 pure", async () => {
    const repo = getTenantRepository();
    await repo.ensureSchema();
    resetTenantRepositoryForTesting();
    const repo2 = getTenantRepository();
    await repo2.ensureSchema();
    const t1 = await repo2.assicuraTenantPredefinito();
    const bis = await repo2.assicuraTenantPredefinito();
    expect(t1.id).toBe(1);
    expect(bis.id).toBe(1);
    const righe = await sql`SELECT COUNT(*)::int AS n FROM tenants`;
    expect(righe[0].n).toBe(1);
    const acme = await repo2.inserisci({ slug: "acme", nome: "Acme" });
    expect(acme.id).toBeGreaterThanOrEqual(2);
    await repo2.caricaCache();
    expect(repo2.perSlug("acme")?.id).toBe(acme.id);
  });

  it("tenant_eventi rifiuta UPDATE e DELETE", async () => {
    const repo = getTenantRepository();
    const ev = await repo.registraEvento({ tenantId: 1, tipo: "creato", attore: "boot" });
    await expect(sql`UPDATE tenant_eventi SET motivo = 'x' WHERE id = ${ev.id}`).rejects.toThrow(/append-only/);
    await expect(sql`DELETE FROM tenant_eventi WHERE id = ${ev.id}`).rejects.toThrow(/append-only/);
    expect((await repo.eventi(1)).length).toBe(1);
  });

  it("i comandi si prendono uno alla volta con FOR UPDATE SKIP LOCKED", async () => {
    const repo = getTenantRepository();
    const c = await repo.accodaComando({ tipo: "sospendi", tenantId: 1, payload: { slug: "ruffino-group", motivo: "prova" }, richiestoDa: "script:tenant@test" });
    expect(await repo.prendiEdEsegui(async x => ({ id: x.id }))).toBe("eseguito");
    expect((await repo.comando(c.id))?.stato).toBe("eseguito");
    expect(await repo.prendiEdEsegui(async () => ({}))).toBe("nessuno");
  });

  it("rifiuta lo slug duplicato anche a cache fredda, dal vincolo UNIQUE di Postgres", async () => {
    const repo = getTenantRepository();
    await repo.inserisci({ slug: "doppio", nome: "Uno" });
    resetTenantRepositoryForTesting();
    const repo2 = getTenantRepository();
    await expect(repo2.inserisci({ slug: "doppio", nome: "Due" })).rejects.toThrow(/slug già usato/);
    const righe = await sql`SELECT COUNT(*)::int AS n FROM tenants WHERE slug = 'doppio'`;
    expect(righe[0].n).toBe(1);
  });

  it("lo specchio tenant_sedi è idempotente e segue il tenant di una sede", async () => {
    const repo = getTenantRepository();
    await repo.assicuraTenantPredefinito();
    await repo.caricaCache(); // le prove qui sopra lasciano la cache fredda
    const acme = repo.perSlug("acme") ?? (await repo.inserisci({ slug: "acme", nome: "Acme" }));
    await repo.sincronizzaTenantSedi([
      { sedeId: 1, tenantId: 1 },
      { sedeId: 5, tenantId: acme.id },
    ]);
    // Due volte le stesse righe: nessun duplicato, nessun errore di chiave.
    await repo.sincronizzaTenantSedi([
      { sedeId: 1, tenantId: 1 },
      { sedeId: 5, tenantId: acme.id },
    ]);
    expect(await repo.tenantSedi()).toEqual([
      { sedeId: 1, tenantId: 1 },
      { sedeId: 5, tenantId: acme.id },
    ]);
    // La sede 5 passa al tenant 1: lo specchio la segue, senza righe in più.
    await repo.sincronizzaTenantSedi([{ sedeId: 5, tenantId: 1 }]);
    expect(await repo.tenantSedi()).toEqual([
      { sedeId: 1, tenantId: 1 },
      { sedeId: 5, tenantId: 1 },
    ]);
    // Lista vuota: non tocca nulla.
    await repo.sincronizzaTenantSedi([]);
    expect((await repo.tenantSedi()).length).toBe(2);
    // Tenant inesistente: la riga viene saltata e il boot non muore sulla
    // chiave esterna (è il caso reale dell'interruttore spento, con `tenants`
    // ancora vuota).
    await expect(repo.sincronizzaTenantSedi([{ sedeId: 9, tenantId: 4242 }])).resolves.toBeUndefined();
    expect((await repo.tenantSedi()).map(r => r.sedeId)).toEqual([1, 5]);
  });

  it("con creaSchema:false lo script non esegue DDL: si ferma se le tabelle mancano e non ricrea il trigger", async () => {
    await sql`DROP TABLE IF EXISTS tenant_sedi, tenant_comandi, tenant_eventi, tenants CASCADE`;
    const soloLettura = createPostgresTenantRepository(sql, { creaSchema: false });
    await expect(soloLettura.caricaCache()).rejects.toThrow(/control plane del tenant assenti/);
    expect((await sql`SELECT to_regclass('tenants') AS t`)[0].t).toBeNull();

    // Il server crea lo schema; poi lo script legge senza DROP/CREATE TRIGGER.
    resetTenantRepositoryForTesting();
    await getTenantRepository().ensureSchema();
    const trigger = () => sql`SELECT oid FROM pg_trigger WHERE tgname = 'tenant_eventi_solo_insert'`;
    const prima = (await trigger())[0].oid;
    const soloLettura2 = createPostgresTenantRepository(sql, { creaSchema: false });
    await soloLettura2.caricaCache();
    expect(soloLettura2.tutti()).toEqual([]);
    expect((await trigger())[0].oid).toBe(prima);

    // Controprova: il repository del server ricrea il trigger (oid nuovo).
    resetTenantRepositoryForTesting();
    await getTenantRepository().ensureSchema();
    expect((await trigger())[0].oid).not.toBe(prima);

    // Anche lo specchio `tenant_sedi` fa parte del control plane: se manca
    // solo lui, la sonda in sola lettura si ferma lo stesso.
    await sql`DROP TABLE IF EXISTS tenant_sedi`;
    const soloLettura3 = createPostgresTenantRepository(sql, { creaSchema: false });
    await expect(soloLettura3.caricaCache()).rejects.toThrow(/control plane del tenant assenti/);
    resetTenantRepositoryForTesting();
    await getTenantRepository().ensureSchema();
    expect((await sql`SELECT to_regclass('tenant_sedi') AS t`)[0].t).not.toBeNull();
  });
});
