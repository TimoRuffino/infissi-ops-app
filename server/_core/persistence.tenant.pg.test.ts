// Su PostgreSQL vero, come server/tenants/repository.pg.test.ts (stesso
// container Docker):
//   docker run -d --name perf-pg-test -e POSTGRES_PASSWORD=test \
//     -e POSTGRES_DB=perf_test -p 55433:5432 postgres:16-alpine
//   DATABASE_URL=postgres://postgres:test@localhost:55433/perf_test \
//     pnpm vitest run server/_core/persistence.tenant.pg.test.ts
//
// Qui si prova ciò che in memoria non si vede: la chiave legacy del tenant 1
// è quella di sempre, il tenant 2 scrive sotto `tenant:2:*`, e il backfill
// di `tenantId` avviene al CARICAMENTO (spec §3.4), non alla scrittura.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bootstrapAll,
  chiaveStore,
  elencaChiaviDaDb,
  flushAll,
  impostaResolverTenant,
  istanziaStoresPerTenant,
  kvSql,
  leggiBlobDaDb,
  persistedStore,
  storeDi,
  __resetPersistenzaPerTest,
} from "./persistence";

const conDatabase = Boolean(process.env.DATABASE_URL && kvSql);
let tenant: number | null = 1;

describe.skipIf(!conDatabase)("persistence per tenant su Postgres", () => {
  const sql = kvSql!;
  beforeAll(async () => {
    // Lo schema lo crea `ensureSchema` al bootstrap, ma qui la riga legacy va
    // seminata prima: la tabella deve esistere già.
    await sql`CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`DELETE FROM kv_store WHERE key IN ('prova_pg', 'tenant:2:prova_pg', 'tenant:3:prova_pg')`;
    await sql`INSERT INTO kv_store (key, data) VALUES ('prova_pg', '[{"id":1,"sedeId":1}]'::jsonb)`;
    __resetPersistenzaPerTest();
    impostaResolverTenant(() => tenant);
  });
  afterAll(async () => {
    await sql`DELETE FROM kv_store WHERE key IN ('prova_pg', 'tenant:2:prova_pg', 'tenant:3:prova_pg')`;
    __resetPersistenzaPerTest();
  });

  it("carica la chiave legacy per il tenant 1, backfilla tenantId e scrive tenant:2:* per il tenant 2", async () => {
    const s = persistedStore<any>("prova_pg");
    await bootstrapAll({ tenantIds: [1, 2] });
    expect(storeDi(1, "prova_pg")).toEqual([{ id: 1, sedeId: 1, tenantId: 1 }]); // backfill centrale
    tenant = 2;
    s.items.push({ id: 2, sedeId: 9 });
    s.save();
    await flushAll();
    // Il record nato adesso NON riceve `tenantId` qui: il timbro è additivo e
    // vive nel caricamento (spec §3.4), non nella scrittura. Lo prende al
    // boot successivo — il caso qui sotto.
    expect(await leggiBlobDaDb("tenant:2:prova_pg")).toEqual([{ id: 2, sedeId: 9 }]);
    expect(await leggiBlobDaDb("prova_pg")).toEqual([{ id: 1, sedeId: 1, tenantId: 1 }]); // risalvato dal backfill
    expect(await elencaChiaviDaDb()).toEqual(expect.arrayContaining(["prova_pg", "tenant:2:prova_pg"]));
    expect(chiaveStore(3, "prova_pg")).toBe("tenant:3:prova_pg");
    await istanziaStoresPerTenant(3);
    expect(storeDi(3, "prova_pg")).toEqual([]);
    expect(await leggiBlobDaDb("tenant:3:prova_pg")).toBeNull();
  });

  it("al boot successivo il backfill timbra anche le istanze tenant:n:*", async () => {
    __resetPersistenzaPerTest();
    impostaResolverTenant(() => tenant);
    persistedStore<any>("prova_pg");
    await bootstrapAll({ tenantIds: [1, 2] });
    expect(storeDi(2, "prova_pg")).toEqual([{ id: 2, sedeId: 9, tenantId: 2 }]);
    expect(storeDi(1, "prova_pg")).toEqual([{ id: 1, sedeId: 1, tenantId: 1 }]);
  });
});
