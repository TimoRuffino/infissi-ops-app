// Su PostgreSQL vero, come server/tenants/repository.pg.test.ts (stesso
// container Docker):
//   docker run -d --name perf-pg-test -e POSTGRES_PASSWORD=test \
//     -e POSTGRES_DB=perf_test -p 55433:5432 postgres:16-alpine
//   DATABASE_URL=postgres://postgres:test@localhost:55433/perf_test \
//     pnpm vitest run server/tenants/ripristino.pg.test.ts
//
// Qui si prova la sola cosa che in memoria non si vede: il ripristino scrive
// DAVVERO il blob dell'istanza in `kv_store`, subito e sotto la chiave della
// sua azienda. In memoria `flushSave` non fa nulla, quindi un test senza
// database direbbe «sostituito» senza che un byte sia mai arrivato al disco.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bootstrapAll,
  kvSql,
  leggiBlobDaDb,
  persistedStore,
  sostituisciStore,
  storeDi,
  __resetPersistenzaPerTest,
} from "../_core/persistence";

const conDatabase = Boolean(process.env.DATABASE_URL && kvSql);

/** Numero suo: gli altri file .pg del tenant usano 20260907. */
const LOCK_RIPRISTINO_PG = 20260908;

describe.skipIf(!conDatabase)("ripristino su Postgres", () => {
  const sql = kvSql!;
  let riservata: Awaited<ReturnType<typeof sql.reserve>> | null = null;

  beforeAll(async () => {
    // Le chiavi qui sotto sono solo di questo file, ma il lock consultivo su
    // una connessione riservata tiene comunque il passo con gli altri .pg del
    // tenant, che vitest esegue in parallelo.
    riservata = await sql.reserve();
    await riservata`SELECT pg_advisory_lock(${LOCK_RIPRISTINO_PG})`;
    // `bootstrapAll` crea `kv_store` da sé (ensureSchema); la pulizia va fatta
    // dopo, altrimenti la tabella potrebbe non esistere ancora.
    __resetPersistenzaPerTest();
  });

  afterAll(async () => {
    await sql`DELETE FROM kv_store WHERE key IN ('rip_pg', 'tenant:2:rip_pg')`;
    __resetPersistenzaPerTest();
    if (riservata) {
      await riservata`SELECT pg_advisory_unlock(${LOCK_RIPRISTINO_PG})`;
      riservata.release();
    }
  });

  it("sostituisciStore scrive subito il blob sotto la chiave dell'azienda, e sostituisce invece di aggiungere", async () => {
    persistedStore<any>("rip_pg");
    await bootstrapAll({ tenantIds: [1, 2] });
    await sql`DELETE FROM kv_store WHERE key IN ('rip_pg', 'tenant:2:rip_pg')`;

    await sostituisciStore(2, "rip_pg", [{ id: 5 }]);
    // Nessun `flushAll()` e nessuna attesa del debounce: la riga c'è già.
    expect(await leggiBlobDaDb("tenant:2:rip_pg")).toEqual([{ id: 5 }]);
    expect(storeDi(2, "rip_pg")).toEqual([{ id: 5 }]);
    // L'azienda 1 tiene la chiave nuda e non è stata toccata: il ripristino
    // di un'azienda non scrive negli archivi di un'altra.
    expect(await leggiBlobDaDb("rip_pg")).toBeNull();

    // Un secondo giro con MENO record: il blob deve rimpicciolirsi, non
    // accodarsi (è una sostituzione, non un merge).
    await sostituisciStore(2, "rip_pg", []);
    expect(await leggiBlobDaDb("tenant:2:rip_pg")).toEqual([]);
  });
});
