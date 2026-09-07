// Su PostgreSQL vero, come server/tenants/repository.pg.test.ts:
//   docker run -d --name perf-pg-test -e POSTGRES_PASSWORD=test \
//     -e POSTGRES_DB=perf_test -p 55433:5432 postgres:16-alpine
//   DATABASE_URL=postgres://postgres:test@localhost:55433/perf_test \
//     pnpm vitest run server/tenants/tabelle.pg.test.ts
//
// Questo file e repository.pg.test.ts lavorano sullo STESSO database e sulle
// stesse tabelle del control plane (repository.pg.test.ts le lascia cadere in
// beforeAll/afterAll): vitest esegue i file in parallelo, quindi entrambi
// prendono lo stesso lock consultivo di Postgres su una connessione riservata
// e si aspettano a vicenda. Senza, il DROP di un file arriverebbe in mezzo
// alle prove dell'altro.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kvSql } from "../_core/persistence";
import { preparaTenants } from "./boot";
import { righeTenantSedi } from "./regole";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";
import { applicaTenantIdAlleTabelle, TABELLE_PER_SEDE } from "./tabelle";

const conDatabase = Boolean(process.env.DATABASE_URL && kvSql);

/** Stesso numero in repository.pg.test.ts: i due file non si sovrappongono. */
const LOCK_TENANT_PG = 20260907;

// Due nomi dell'inventario che nessun altro test su Postgres tocca: `chat_messaggi`
// fa da cavia del DDL (creata minima qui e buttata via alla fine), `chat_letture`
// da tabella assente.
const CAVIA = "chat_messaggi";
const ASSENTE = "chat_letture";
// Sede di prova del test "interruttore spento" (Task 12 fix round 1): un id
// che nessun altro test di questo file usa, per non interferire con le righe
// che gli altri `it` lasciano nello specchio.
const SEDE_PROVA_SPENTO = 9006;

describe.skipIf(!conDatabase)("tenant_id sulle tabelle per sede", () => {
  const sql = kvSql!;
  let riservata: Awaited<ReturnType<typeof sql.reserve>> | null = null;
  let tenantCavia = 0;

  beforeAll(async () => {
    riservata = await sql.reserve();
    await riservata`SELECT pg_advisory_lock(${LOCK_TENANT_PG})`;
    await sql`DROP TABLE IF EXISTS chat_messaggi`;
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.ensureSchema();
    await repo.assicuraTenantPredefinito();
    await repo.caricaCache();
    tenantCavia =
      repo.perSlug("cavia-tabelle")?.id ??
      (await repo.inserisci({ slug: "cavia-tabelle", nome: "Cavia Tabelle" })).id;
  });

  afterAll(async () => {
    await sql`DROP TABLE IF EXISTS chat_messaggi`;
    if (riservata) {
      await riservata`SELECT pg_advisory_unlock(${LOCK_TENANT_PG})`;
      riservata.release();
    }
  });

  it("aggiunge colonna, indice e trigger; il trigger ricava tenant_id da tenant_sedi; il backfill chiude i NULL", async () => {
    await sql`CREATE TABLE chat_messaggi (id BIGSERIAL PRIMARY KEY, sede_id BIGINT NOT NULL, testo TEXT)`;
    const repo = getTenantRepository();
    await repo.sincronizzaTenantSedi([
      { sedeId: 1, tenantId: 1 },
      { sedeId: 9005, tenantId: tenantCavia },
    ]);
    await sql`INSERT INTO chat_messaggi (sede_id, testo) VALUES (1, 'prima del trigger')`;

    const esito = await applicaTenantIdAlleTabelle(sql);
    expect(esito.applicate).toContain(CAVIA);
    expect(esito.backfill[CAVIA]).toBe(1);

    await sql`INSERT INTO chat_messaggi (sede_id, testo) VALUES (9005, 'dopo il trigger')`;
    await sql`INSERT INTO chat_messaggi (sede_id, testo) VALUES (9077, 'sede ignota')`;
    const righe = await sql`SELECT sede_id, tenant_id FROM chat_messaggi ORDER BY id`;
    expect(
      righe.map(r => [Number(r.sede_id), r.tenant_id == null ? null : Number(r.tenant_id)])
    ).toEqual([
      [1, 1],
      [9005, tenantCavia],
      [9077, null],
    ]);

    // Indice presente e colonna nullable: la migrazione è additiva.
    const indici = await sql`SELECT indexname FROM pg_indexes WHERE tablename = ${CAVIA}`;
    expect(indici.map(r => r.indexname)).toContain(`${CAVIA}_tenant_id_idx`);
    const colonna = await sql`SELECT is_nullable FROM information_schema.columns
      WHERE table_name = ${CAVIA} AND column_name = 'tenant_id'`;
    expect(colonna[0]?.is_nullable).toBe("YES");

    const bis = await applicaTenantIdAlleTabelle(sql); // idempotente
    expect(bis.applicate).toContain(CAVIA);
    expect(bis.backfill[CAVIA]).toBe(0);
    await sql`DROP TABLE chat_messaggi`;
  });

  it("una tabella assente viene saltata e segnalata", async () => {
    await sql`DROP TABLE IF EXISTS chat_letture`;
    const esito = await applicaTenantIdAlleTabelle(sql);
    expect(esito.assenti).toContain(ASSENTE);
    expect(esito.applicate).not.toContain(ASSENTE);
    expect(esito.backfill[ASSENTE]).toBeUndefined();
    // Nessun nome fuori dall'inventario finisce nell'esito.
    for (const nome of [...esito.applicate, ...esito.assenti]) {
      expect(TABELLE_PER_SEDE).toContain(nome);
    }
  });

  it("senza lo specchio non installa nulla: si ferma prima dei trigger", async () => {
    await sql`DROP TABLE IF EXISTS tenant_sedi`;
    await expect(applicaTenantIdAlleTabelle(sql)).rejects.toThrow(/tenant_sedi assente/);
    // Un trigger che legge una tabella inesistente romperebbe ogni INSERT:
    // meglio fermarsi. Ripristiniamo lo specchio per chi viene dopo.
    resetTenantRepositoryForTesting();
    await getTenantRepository().ensureSchema();
    expect((await sql`SELECT to_regclass('tenant_sedi') AS r`)[0]?.r).not.toBeNull();
  });

  // Task 12 fix round 1 (Ruling R13): a interruttore spento, `preparaTenants()`
  // semina comunque la riga del tenant 1 nel control plane, così lo specchio
  // e il backfill del deploy spento (spec §7.1, §8) hanno qualcosa da
  // riempire PRIMA che l'interruttore si accenda mai. Tolgo qui la riga del
  // tenant 1 che `beforeAll` ha già seminato (con una chiamata diretta al
  // repository, non con `preparaTenants`): così è DAVVERO `preparaTenants`,
  // a interruttore spento, a doverla riseminare, non un residuo del setup —
  // se la guardia del flag tornasse a precedere `assicuraTenantPredefinito`
  // (la regressione da cui nasce questo round), `repo.perId(1)` qui
  // sotto resterebbe `null`. Uso lo stesso `sql`/lock/CAVIA del describe.
  it("interruttore spento: preparaTenants risemina il tenant 1, lo specchio registra una sede nuova e il backfill chiude il NULL", async () => {
    await sql`DELETE FROM tenants WHERE id = 1`;
    try {
      process.env.FLAG_MULTI_AZIENDA = "off";
      const ids = await preparaTenants();
      expect(ids).toEqual([1]);
      const repo = getTenantRepository();
      expect(repo.perId(1)?.slug).toBe("ruffino-group");

      // Come farebbe completaTenants con lo store `sedi` vero: una sede
      // senza tenantId esplicito ricade sul tenant 1 (righeTenantSedi).
      await repo.sincronizzaTenantSedi(righeTenantSedi([{ id: SEDE_PROVA_SPENTO }]));
      expect(await repo.tenantSedi()).toContainEqual({ sedeId: SEDE_PROVA_SPENTO, tenantId: 1 });

      // La riga nasce PRIMA del trigger (la tabella non ha ancora
      // tenant_id): solo il backfill, non il trigger, può chiuderla.
      await sql`CREATE TABLE chat_messaggi (id BIGSERIAL PRIMARY KEY, sede_id BIGINT NOT NULL, testo TEXT)`;
      await sql`INSERT INTO chat_messaggi (sede_id, testo)
        VALUES (${SEDE_PROVA_SPENTO}, 'scritta prima del backfill, a interruttore spento')`;

      const esito = await applicaTenantIdAlleTabelle(sql);
      expect(esito.applicate).toContain(CAVIA);
      expect(esito.backfill[CAVIA]).toBe(1);

      const righe = await sql`SELECT sede_id, tenant_id FROM chat_messaggi ORDER BY id`;
      expect(righe.map(r => [Number(r.sede_id), Number(r.tenant_id)])).toEqual([
        [SEDE_PROVA_SPENTO, 1],
      ]);
      await sql`DROP TABLE chat_messaggi`;
    } finally {
      delete process.env.FLAG_MULTI_AZIENDA;
    }
  });
});
