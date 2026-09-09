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

/**
 * Lock consultivo tutto suo: le chiavi `kv_store` di questo file sono solo
 * sue, quindi NON deve serializzarsi con `repository.pg.test.ts` e
 * `tabelle.pg.test.ts` (che condividono il 20260907 perché condividono le
 * tabelle del control plane). Un numero diverso è esattamente questo: quei
 * file possono girare in parallelo a questo senza pestarsi.
 */
const LOCK_RIPRISTINO_PG = 20260908;

describe.skipIf(!conDatabase)("ripristino su Postgres", () => {
  const sql = kvSql!;
  let riservata: Awaited<ReturnType<typeof sql.reserve>> | null = null;

  beforeAll(async () => {
    // Il lock sta su una connessione riservata (le altre del pool servono le
    // scritture del test) e vale contro un'altra copia di QUESTO file, non
    // contro gli altri .pg del tenant.
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

  it("se l'INSERT fallisce l'errore arriva a chi ha chiesto il ripristino e il blob resta quello di prima", async () => {
    // La famiglia `rip_pg` è già registrata dal test precedente: qui basta
    // riportare la riga a uno stato noto.
    await bootstrapAll({ tenantIds: [1, 2] });
    await sostituisciStore(2, "rip_pg", [{ id: 1 }]);
    expect(await leggiBlobDaDb("tenant:2:rip_pg")).toEqual([{ id: 1 }]);

    // Un vincolo che rende impossibile scrivere PROPRIO quella chiave: è il
    // modo deterministico di far fallire l'INSERT senza spegnere il database.
    // `NOT VALID` perché la riga violante esiste già e la validazione
    // all'indietro farebbe fallire l'ALTER, non la scrittura che ci interessa;
    // sugli INSERT/UPDATE successivi il vincolo vale comunque.
    await sql`ALTER TABLE kv_store ADD CONSTRAINT rip_blocco CHECK (key <> 'tenant:2:rip_pg') NOT VALID`;
    try {
      // Il salvataggio con debounce, qui, avrebbe loggato e riaccodato: il
      // ripristino no, altrimenti dichiarerebbe «sostituito» un archivio che
      // in `kv_store` è ancora quello vecchio.
      await expect(sostituisciStore(2, "rip_pg", [{ id: 9 }])).rejects.toThrow(/rip_blocco/);
      expect(await leggiBlobDaDb("tenant:2:rip_pg")).toEqual([{ id: 1 }]);
    } finally {
      await sql`ALTER TABLE kv_store DROP CONSTRAINT rip_blocco`;
    }
  });
});
