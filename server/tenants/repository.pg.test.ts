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
    await sql`DROP TABLE IF EXISTS tenant_storage, oauth_state, tenant_sedi, tenant_comandi, tenant_eventi, tenants CASCADE`;
    resetTenantRepositoryForTesting();
  });

  afterAll(async () => {
    await sql`DROP TABLE IF EXISTS tenant_storage, oauth_state, tenant_sedi, tenant_comandi, tenant_eventi, tenants CASCADE`;
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
    await sql`DROP TABLE IF EXISTS tenant_storage, oauth_state, tenant_sedi, tenant_comandi, tenant_eventi, tenants CASCADE`;
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

  it("storage e oauth_state su Postgres: incremento atomico, soglia, quota, consumo unico, CHECK dei comandi nuovi", async () => {
    const repo = getTenantRepository();
    await repo.ensureSchema();
    await repo.caricaCache();
    await repo.assicuraTenantPredefinito();
    // Delta di segno misto in sequenza, non in Promise.all: con -5 la riga
    // usa il ramo INSERT/UPDATE con GREATEST(delta, 0), quindi il risultato
    // dipende da QUALE arriva per primo al DB (se -5 vince la corsa, la riga
    // nasce a zero invece di sottrarre) — non è un bug, è il clamp voluto,
    // ma rende il test non deterministico se lanciato in concorrenza.
    // Eseguendoli uno alla volta il totale è prevedibile.
    await repo.aggiornaStorage(1, 10, 1);
    await repo.aggiornaStorage(1, 20, 1);
    await repo.aggiornaStorage(1, -5, 0);
    expect(await repo.storageDi(1)).toMatchObject({ bytes: 25, file: 2, quotaBytes: 100 * 1024 ** 3 });
    // Concorrenza vera, ma solo delta positivi: qui il clamp non entra mai in
    // gioco, quindi l'ordine di arrivo non conta e la somma finale deve
    // tornare esatta — è la prova che l'incremento su Postgres è atomico
    // (nessuna scrittura concorrente si perde per una race sul valore letto).
    const primaDellaConcorrenza = await repo.storageDi(1);
    await Promise.all([repo.aggiornaStorage(1, 10, 1), repo.aggiornaStorage(1, 20, 1), repo.aggiornaStorage(1, 5, 1)]);
    const dopoLaConcorrenza = await repo.storageDi(1);
    expect(dopoLaConcorrenza?.bytes).toBe((primaDellaConcorrenza?.bytes ?? 0) + 35);
    expect(dopoLaConcorrenza?.file).toBe((primaDellaConcorrenza?.file ?? 0) + 3);
    await repo.impostaSogliaAvvisata(1, 50);
    expect((await repo.storageDi(1))?.sogliaAvvisata).toBe(50);
    expect((await repo.impostaQuotaStorage(1, 1234)).storageQuotaBytes).toBe(1234);
    expect((await repo.storageDi(1))?.quotaBytes).toBe(1234);
    const state = await repo.emettiStateOAuth({ tipo: "gdrive", tenantId: 1, sedeId: null, utenteId: 1, payload: { a: 1 } });
    expect((await repo.consumaStateOAuth(state, "gdrive"))?.payload).toEqual({ a: 1 });
    expect(await repo.consumaStateOAuth(state, "gdrive")).toBeNull();
    const c = await repo.accodaComando({ tipo: "ricalcola_storage", tenantId: 1, payload: { slug: "ruffino-group" }, richiestoDa: "test" });
    expect(c.tipo).toBe("ricalcola_storage");
  });

  it("lo schema del WS3 è idempotente anche sopra uno schema del WS2 (CHECK vecchio a terra)", async () => {
    await sql`DROP TABLE IF EXISTS tenant_storage, oauth_state, tenant_sedi, tenant_comandi, tenant_eventi, tenants CASCADE`;
    await sql`CREATE TABLE tenants (id BIGSERIAL PRIMARY KEY, slug TEXT NOT NULL UNIQUE, nome TEXT NOT NULL,
      stato TEXT NOT NULL CHECK (stato IN ('attivo','sospeso')), motivo_stato TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    await sql`CREATE TABLE tenant_comandi (id BIGSERIAL PRIMARY KEY,
      tipo TEXT NOT NULL CHECK (tipo IN ('crea','sospendi','riattiva','assegna_proprietario','revoca_proprietario')),
      tenant_id BIGINT, payload JSONB NOT NULL, stato TEXT NOT NULL DEFAULT 'in_attesa', esito JSONB,
      richiesto_da TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), eseguito_at TIMESTAMPTZ)`;
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.ensureSchema();
    await repo.assicuraTenantPredefinito();
    const c = await repo.accodaComando({ tipo: "ripristina_archivi", tenantId: 1, payload: {}, richiestoDa: "test" });
    expect(c.tipo).toBe("ripristina_archivi");
    expect((await sql`SELECT storage_quota_bytes FROM tenants WHERE id = 1`)[0].storage_quota_bytes).toBe(String(100 * 1024 ** 3));
  });
});
