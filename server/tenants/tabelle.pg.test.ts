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
//
// TUTTE le chiamate passano `soloTabelle` (Ruling R14): senza, questo file
// installerebbe un trigger BEFORE INSERT su OGNI tabella per sede presente nel
// database di prova — comprese quelle di altri file `.pg.test.ts` — e quei
// trigger sopravvivrebbero al DROP di `tenant_sedi` fatto da
// repository.pg.test.ts, facendo fallire ogni INSERT successivo dell'intera
// tornata. `afterAll` toglie comunque ciò che questo file installa.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kvSql } from "../_core/persistence";
import { preparaTenants } from "./boot";
import { righeTenantSedi } from "./regole";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";
import {
  applicaTenantIdAlleTabelle,
  backfillTenantIdSulleTabelle,
  TABELLE_PER_SEDE,
} from "./tabelle";

const conDatabase = Boolean(process.env.DATABASE_URL && kvSql);

/** Stesso numero in repository.pg.test.ts: i due file non si sovrappongono. */
const LOCK_TENANT_PG = 20260907;

// Due nomi dell'inventario che nessun altro test su Postgres tocca: `chat_messaggi`
// fa da cavia del DDL (creata minima qui e buttata via alla fine), `chat_letture`
// da tabella assente.
const CAVIA = "chat_messaggi";
const ASSENTE = "chat_letture";
/** Il recinto di questo file: nessuna tabella altrui viene toccata. */
const SOLO = { soloTabelle: [CAVIA, ASSENTE] } as const;
// Sede di prova del test "interruttore spento" (Task 12 fix round 1): un id
// che nessun altro test di questo file usa, per non interferire con le righe
// che gli altri `it` lasciano nello specchio.
const SEDE_PROVA_SPENTO = 9006;
/** Sede del test a lotti, anch'essa solo sua. */
const SEDE_LOTTI = 9007;

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
    // Le due tabelle di questo file e i loro trigger se ne vanno con loro; il
    // DROP TRIGGER è esplicito perché il recinto sia visibile anche a chi
    // legge solo l'afterAll. L'errore si ingoia di proposito: qualunque cosa
    // fallisca qui, il lock consultivo più sotto DEVE essere rilasciato,
    // altrimenti resta appeso il file che lo aspetta.
    for (const t of [CAVIA, ASSENTE]) {
      await sql.unsafe(`DROP TRIGGER IF EXISTS ${t}_tenant_id ON ${t}`).catch(() => undefined);
    }
    await sql`DROP TABLE IF EXISTS chat_messaggi`;
    // La funzione è condivisa da tutti i trigger `tenant_id`: si toglie solo
    // se nessun altro la usa (un boot vero sullo stesso database ne installa
    // su tutte le tabelle per sede, e DROP FUNCTION senza CASCADE fallirebbe).
    const usata = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM pg_trigger
      WHERE NOT tgisinternal AND tgfoid = to_regprocedure('tenant_id_dalla_sede()')`;
    if ((usata[0]?.n ?? 0) === 0) await sql`DROP FUNCTION IF EXISTS tenant_id_dalla_sede()`;
    if (riservata) {
      await riservata`SELECT pg_advisory_unlock(${LOCK_TENANT_PG})`;
      riservata.release();
    }
  });

  it("aggiunge colonna, indice e trigger; il trigger ricava tenant_id da tenant_sedi; il DDL non riscrive le righe", async () => {
    await sql`CREATE TABLE chat_messaggi (id BIGSERIAL PRIMARY KEY, sede_id BIGINT NOT NULL, testo TEXT)`;
    const repo = getTenantRepository();
    await repo.sincronizzaTenantSedi([
      { sedeId: 1, tenantId: 1 },
      { sedeId: 9005, tenantId: tenantCavia },
    ]);
    await sql`INSERT INTO chat_messaggi (sede_id, testo) VALUES (1, 'prima del trigger')`;

    const esito = await applicaTenantIdAlleTabelle(sql, SOLO);
    expect(esito.applicate).toContain(CAVIA);
    expect(esito.rinviate).toEqual([]);
    // Lo specchio è riportato nell'esito e coincide con il database.
    const quante = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM tenant_sedi`;
    expect(esito.specchio).toBe(quante[0].n);
    expect(esito.specchio).toBeGreaterThanOrEqual(2);

    // Il DDL NON tocca le righe (Ruling R14: il backfill è dopo il listen).
    const primaDelBackfill = await sql`SELECT tenant_id FROM chat_messaggi ORDER BY id`;
    expect(primaDelBackfill[0].tenant_id).toBeNull();
    const backfill = await backfillTenantIdSulleTabelle(sql, SOLO);
    expect(backfill.righe[CAVIA]).toBe(1);
    expect(backfill.totale).toBe(1);

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

    const bis = await applicaTenantIdAlleTabelle(sql, SOLO); // idempotente
    expect(bis.applicate).toContain(CAVIA);
    expect((await backfillTenantIdSulleTabelle(sql, SOLO)).righe[CAVIA]).toBe(0);
    await sql`DROP TABLE chat_messaggi`;
  });

  it("una tabella assente viene saltata e segnalata", async () => {
    await sql`DROP TABLE IF EXISTS chat_letture`;
    const esito = await applicaTenantIdAlleTabelle(sql, SOLO);
    expect(esito.assenti).toContain(ASSENTE);
    expect(esito.applicate).not.toContain(ASSENTE);
    // Nessun nome fuori dall'inventario finisce nell'esito, e con `soloTabelle`
    // nessun nome fuori dal recinto.
    for (const nome of [...esito.applicate, ...esito.assenti, ...esito.rinviate]) {
      expect(TABELLE_PER_SEDE).toContain(nome);
      expect(SOLO.soloTabelle).toContain(nome);
    }
    // Una tabella senza colonna non compare nemmeno nel backfill.
    expect((await backfillTenantIdSulleTabelle(sql, SOLO)).righe[ASSENTE]).toBeUndefined();
  });

  it("il backfill lavora a lotti e lascia fuori le sedi sconosciute", async () => {
    await sql`CREATE TABLE chat_messaggi (id BIGSERIAL PRIMARY KEY, sede_id BIGINT NOT NULL, testo TEXT)`;
    const repo = getTenantRepository();
    await repo.sincronizzaTenantSedi([{ sedeId: SEDE_LOTTI, tenantId: 1 }]);
    // Righe scritte PRIMA che la colonna esista: nessun trigger le ha viste.
    for (let i = 0; i < 5; i++) {
      await sql`INSERT INTO chat_messaggi (sede_id, testo) VALUES (${SEDE_LOTTI}, ${`riga ${i}`})`;
    }
    await sql`INSERT INTO chat_messaggi (sede_id, testo) VALUES (9078, 'sede sconosciuta')`;
    await applicaTenantIdAlleTabelle(sql, SOLO);

    // 5 righe da chiudere, lotti da 2: 2 + 2 + 1 + 0. La riga di sede
    // sconosciuta è esclusa dal lotto, altrimenti il ciclo girerebbe a vuoto.
    const primo = await backfillTenantIdSulleTabelle(sql, { ...SOLO, dimensioneLotto: 2 });
    expect(primo.righe[CAVIA]).toBe(5);
    expect(primo.totale).toBe(5);
    expect(typeof primo.ms[CAVIA]).toBe("number");
    const secondo = await backfillTenantIdSulleTabelle(sql, { ...SOLO, dimensioneLotto: 2 });
    expect(secondo.righe[CAVIA]).toBe(0);
    expect(secondo.totale).toBe(0);

    const conteggi = await sql`SELECT tenant_id, COUNT(*)::int AS n FROM chat_messaggi
      GROUP BY tenant_id ORDER BY tenant_id NULLS LAST`;
    expect(
      conteggi.map(r => [r.tenant_id == null ? null : Number(r.tenant_id), r.n])
    ).toEqual([
      [1, 5],
      [null, 1],
    ]);
    await sql`DROP TABLE chat_messaggi`;
  });

  it("senza lo specchio il DDL passa lo stesso e il trigger lascia NULL invece di rompere l'INSERT", async () => {
    await sql`CREATE TABLE chat_messaggi (id BIGSERIAL PRIMARY KEY, sede_id BIGINT NOT NULL, testo TEXT)`;
    await sql`DROP TABLE IF EXISTS tenant_sedi`;
    // Ruling R14: prima ci si fermava con un errore, e un trigger installato
    // senza specchio faceva fallire OGNI INSERT del CRM. Ora il trigger
    // cattura `undefined_table` e lascia NULL, come per una sede sconosciuta.
    const esito = await applicaTenantIdAlleTabelle(sql, SOLO);
    expect(esito.applicate).toContain(CAVIA);
    expect(esito.specchio).toBe(0);
    await sql`INSERT INTO chat_messaggi (sede_id, testo) VALUES (1, 'senza specchio')`;
    const righe = await sql`SELECT tenant_id FROM chat_messaggi`;
    expect(righe[0].tenant_id).toBeNull();
    // Anche il backfill si limita a dirlo, senza esplodere.
    expect((await backfillTenantIdSulleTabelle(sql, SOLO)).totale).toBe(0);

    await sql`DROP TABLE chat_messaggi`;
    // Ripristiniamo lo specchio per chi viene dopo.
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

      const esito = await applicaTenantIdAlleTabelle(sql, SOLO);
      expect(esito.applicate).toContain(CAVIA);
      expect(esito.specchio).toBeGreaterThanOrEqual(1);
      expect((await backfillTenantIdSulleTabelle(sql, SOLO)).righe[CAVIA]).toBe(1);

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
