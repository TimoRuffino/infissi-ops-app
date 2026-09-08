// Su PostgreSQL vero, come server/tenants/repository.pg.test.ts (stesso
// container Docker):
//   docker run -d --name perf-pg-test -e POSTGRES_PASSWORD=test \
//     -e POSTGRES_DB=perf_test -p 55433:5432 postgres:16-alpine
//   DATABASE_URL=postgres://postgres:test@localhost:55433/perf_test \
//     pnpm vitest run server/tenants/storage.pg.test.ts --no-file-parallelism
//
// Qui si prova il ramo `if (kvSql)` di `ricalcolaStorage` (fix wave finale,
// R19): gli allegati delle comunicazioni (JSONB) e le chiavi PDF/XML delle
// fatture. In memoria quel ramo non gira proprio — `kvSql` è null — quindi
// fino a qui era codice mai eseguito da un test: la parte più facile da
// rompere in silenzio del ricalcolo (nomi di colonna, `COALESCE(tenant_id, 1)`,
// somma dei `size` contro le `HEAD` allo storage).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { __impostaDriverPerTest, type StorageDriver } from "../_core/fileStorage";
import { kvSql, __registraTenantNotoPerTest, storeDi } from "../_core/persistence";
// Side-effect: registra "preventivi_documenti"/"ticket_allegati", che il
// ricalcolo legge con `storeDi` prima di arrivare al ramo SQL.
import "../routers";
import { ensureComunicazioniSchema } from "../comunicazioni/comunicazioni";
import { createPostgresFattureRepository } from "../fatture/repository";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";
import { ricalcolaStorage } from "./storage";

const conDatabase = Boolean(process.env.DATABASE_URL && kvSql);

/**
 * LO STESSO numero di `repository.pg.test.ts` e `tabelle.pg.test.ts`, non uno
 * suo: quel file fa `DROP TABLE … tenants CASCADE` in `beforeAll` e in
 * `afterAll`, e questo test scrive in `tenant_storage` e `tenant_eventi`, che
 * da `tenants` dipendono. Un lock diverso lascerebbe cadere quel DROP in
 * mezzo al ricalcolo. (`ripristino.pg.test.ts` ne ha uno suo perché tocca
 * solo `kv_store`.)
 */
const LOCK_TENANT_PG = 20260907;

/** Sedi solo di questo file: nessun altro test pg le usa. */
const SEDE_CAVIA = 99820;
const SEDE_TENANT_1 = 99821;

describe.skipIf(!conDatabase)("ricalcolo dello storage su Postgres", () => {
  const sql = kvSql!;
  let riservata: Awaited<ReturnType<typeof sql.reserve>> | null = null;
  let tenantCavia = 0;

  const pulisci = async () => {
    await sql`DELETE FROM comunicazioni WHERE sede_id IN (${SEDE_CAVIA}, ${SEDE_TENANT_1})`;
    await sql`DELETE FROM fatture WHERE sede_id IN (${SEDE_CAVIA}, ${SEDE_TENANT_1})`;
  };

  beforeAll(async () => {
    riservata = await sql.reserve();
    await riservata`SELECT pg_advisory_lock(${LOCK_TENANT_PG})`;
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.ensureSchema();
    await repo.assicuraTenantPredefinito();
    await repo.caricaCache();
    tenantCavia =
      repo.perSlug("cavia-storage")?.id ??
      (await repo.inserisci({ slug: "cavia-storage", nome: "Cavia Storage" })).id;
    __registraTenantNotoPerTest(tenantCavia);

    // Le due tabelle si creano con il LORO schema vero (`ensureSchema` dei
    // moduli che le possiedono), mai a mano: una versione minima scritta qui
    // resterebbe a terra sotto `CREATE TABLE IF NOT EXISTS` e farebbe fallire
    // ogni altro test pg che le usa davvero.
    await ensureComunicazioniSchema();
    await createPostgresFattureRepository(sql).ensureSchema();
    // `tenant_id` la mette `applicaTenantIdAlleTabelle` al boot: qui basta la
    // colonna (additiva e idempotente, come in produzione), senza indice né
    // trigger — quelli vivrebbero oltre questo file e toccherebbero le prove
    // altrui.
    await sql`ALTER TABLE comunicazioni ADD COLUMN IF NOT EXISTS tenant_id BIGINT`;
    await sql`ALTER TABLE fatture ADD COLUMN IF NOT EXISTS tenant_id BIGINT`;
    await pulisci();
  });

  afterAll(async () => {
    // Solo le righe di questo file: le due tabelle restano, sono di altri.
    // (`tenant_eventi` è append-only per trigger: l'evento del ricalcolo
    // resta, ed è giusto così.)
    await pulisci();
    __impostaDriverPerTest(null);
    if (riservata) {
      await riservata`SELECT pg_advisory_unlock(${LOCK_TENANT_PG})`;
      riservata.release();
    }
  });

  it("somma gli allegati delle comunicazioni e le chiavi PDF/XML delle fatture, e non conta le righe di un'altra azienda", async () => {
    // Un allegato con `storageKey` e `size` (si conta dal record), uno senza
    // chiave (legacy inline: non si conta).
    await sql`INSERT INTO comunicazioni (sede_id, casella_id, message_id, mittente, received_at, tenant_id, allegati)
      VALUES (${SEDE_CAVIA}, 1, 'msg-cavia-1', 'a@b.it', NOW(), ${tenantCavia},
        ${sql.json([{ nome: "a.pdf", size: 40, storageKey: `tenant/${tenantCavia}/comunicazioni/1/1-aaaaaaaa.pdf` }] as any)})`;
    await sql`INSERT INTO comunicazioni (sede_id, casella_id, message_id, mittente, received_at, tenant_id, allegati)
      VALUES (${SEDE_CAVIA}, 1, 'msg-cavia-2', 'a@b.it', NOW(), ${tenantCavia},
        ${sql.json([{ nome: "b.pdf", size: 999, dataBase64: "QUJD" }] as any)})`;
    // Ruffino Group: stessa forma, altra azienda. Non deve entrare nel conto.
    await sql`INSERT INTO comunicazioni (sede_id, casella_id, message_id, mittente, received_at, tenant_id, allegati)
      VALUES (${SEDE_TENANT_1}, 1, 'msg-uno-1', 'a@b.it', NOW(), 1,
        ${sql.json([{ nome: "c.pdf", size: 7000, storageKey: "tenant/1/comunicazioni/1/1-cccccccc.pdf" }] as any)})`;

    // La fattura non registra la dimensione: le due chiavi si chiedono allo
    // storage con una `HEAD` (5 byte l'una nel driver finto).
    const pdf = `tenant/${tenantCavia}/fatture/1/1-dddddddd.pdf`;
    const xml = `tenant/${tenantCavia}/fatture/1/1-dddddddd.xml`;
    await sql`INSERT INTO fatture (sede_id, commessa_id, tipo, stato, pattuito_tipo, pattuito_cent, pdf_storage_key, xml_storage_key, tenant_id)
      VALUES (${SEDE_CAVIA}, 10, 'fattura', 'emessa', 'lordo', 100000, ${pdf}, ${xml}, ${tenantCavia})`;
    await sql`INSERT INTO fatture (sede_id, commessa_id, tipo, stato, pattuito_tipo, pattuito_cent, pdf_storage_key, xml_storage_key, tenant_id)
      VALUES (${SEDE_TENANT_1}, 10, 'fattura', 'emessa', 'lordo', 100000, 'tenant/1/fatture/1/9-eeeeeeee.pdf', NULL, 1)`;

    const teste = new Map<string, number>([[pdf, 5], [xml, 5]]);
    const driver: StorageDriver = {
      name: "local",
      async put() {}, async get() { return null; }, async openRead() { return null; }, async delete() {},
      async head(k) { const b = teste.get(k); return b == null ? null : { bytes: b }; },
    };
    __impostaDriverPerTest(driver);
    storeDi<any>(tenantCavia, "preventivi_documenti").length = 0;
    storeDi<any>(tenantCavia, "ticket_allegati").length = 0;
    try {
      const stato = await ricalcolaStorage(tenantCavia, "test");
      // 40 (allegato col size) + 5 (PDF) + 5 (XML); tre file, non cinque.
      expect(stato).toMatchObject({ tenantId: tenantCavia, bytes: 50, file: 3 });
      expect(stato.ricalcolatoIl).toBeInstanceOf(Date);
      // Il conto è finito anche nel ledger, non solo nel valore di ritorno.
      expect(await getTenantRepository().storageDi(tenantCavia)).toMatchObject({ bytes: 50, file: 3 });
    } finally {
      __impostaDriverPerTest(null);
    }
  });
});
