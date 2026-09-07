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

describe.skipIf(!conDatabase)("repository tenant su Postgres", () => {
  const sql = kvSql!;

  beforeAll(async () => {
    await sql`DROP TABLE IF EXISTS tenant_comandi, tenant_eventi, tenants CASCADE`;
    resetTenantRepositoryForTesting();
  });

  afterAll(async () => {
    await sql`DROP TABLE IF EXISTS tenant_comandi, tenant_eventi, tenants CASCADE`;
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

  it("con creaSchema:false lo script non esegue DDL: si ferma se le tabelle mancano e non ricrea il trigger", async () => {
    await sql`DROP TABLE IF EXISTS tenant_comandi, tenant_eventi, tenants CASCADE`;
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
  });
});
