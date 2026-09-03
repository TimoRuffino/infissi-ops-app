// Come si scrive un blob JSONB senza serializzarlo tre volte, verificato su
// PostgreSQL vero.
//
// La scrittura atomica degli store congelava ogni collezione con
// `JSON.parse(JSON.stringify(items))` prima del BEGIN: serve una fotografia
// immutabile, perché un `await` fra due store non deve poter osservare
// revisioni diverse degli array vivi. Il prezzo erano tre passate sincrone
// sulla stessa collezione — stringify, parse, e di nuovo stringify dentro il
// driver — e su qualche megabyte sono centinaia di millisecondi in cui il
// processo non risponde a nessuno.
//
// Una passata sola basta: la stringa È già la fotografia. Ma il modo di
// mandarla conta, e `server/chat/store.ts` porta le cicatrici di quello
// sbagliato. Questi casi dicono, su un database vero e non a memoria, quale
// forma finisce in un array e quale in una stringa:
//
//   sql.json(oggetto)        -> array    (com'era)
//   ${stringa}::jsonb        -> STRINGA  (la trappola, con migrazione di
//                                         riparazione in chat/store.ts)
//   ${stringa}::text::jsonb  -> array    (com'è ora)
//
// Il `::text` di troppo non è ornamentale: senza, postgres-js deduce che il
// parametro è jsonb e codifica la stringa COME stringa JSON. Con, il
// parametro resta testo e a interpretarlo è Postgres.
//
//   docker run -d --name perf-pg-test -e POSTGRES_PASSWORD=test \
//     -e POSTGRES_DB=perf_test -p 55433:5432 postgres:16-alpine
//   DATABASE_URL=postgres://postgres:test@localhost:55433/perf_test \
//     pnpm test -- server/_core/jsonbSnapshot.pg.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  bootstrapAll,
  kvSql,
  persistedStore,
  saveStoresAtomically,
} from "./persistence";

const conDatabase = Boolean(process.env.DATABASE_URL && kvSql);

/** Una collezione qualunque, con le forme che gli store usano davvero. */
const ITEMS = [
  { id: 1, nome: "Rossi", importo: 1250.5, tags: ["a", "b"], nested: { x: 1 } },
  { id: 2, nome: "Bianchi", importo: null, tags: [], nested: { x: null } },
];

describe.skipIf(!conDatabase)("scrittura JSONB — quale forma regge", () => {
  const sql = kvSql!;

  beforeAll(async () => {
    await sql`DROP TABLE IF EXISTS prova_jsonb`;
    await sql`CREATE TABLE prova_jsonb (key TEXT PRIMARY KEY, data JSONB NOT NULL)`;
  });

  afterAll(async () => {
    await sql`DROP TABLE IF EXISTS prova_jsonb`;
  });

  async function tipo(key: string): Promise<string> {
    const [riga] = await sql`
      SELECT jsonb_typeof(data) AS t FROM prova_jsonb WHERE key = ${key}`;
    return riga.t as string;
  }

  async function leggi(key: string): Promise<unknown> {
    const [riga] = await sql`SELECT data FROM prova_jsonb WHERE key = ${key}`;
    return riga.data;
  }

  async function stessoContenuto(a: string, b: string): Promise<boolean> {
    const [riga] = await sql`
      SELECT (SELECT data FROM prova_jsonb WHERE key = ${a})
           = (SELECT data FROM prova_jsonb WHERE key = ${b}) AS uguali`;
    return riga.uguali as boolean;
  }

  it("sql.json() sull'oggetto vivo scrive un array — è la forma di prima", async () => {
    await sql`INSERT INTO prova_jsonb (key, data)
      VALUES ('json', ${sql.json(ITEMS as any)})`;
    expect(await tipo("json")).toBe("array");
    expect(await leggi("json")).toEqual(ITEMS);
  });

  it("la stringa castata solo a ::jsonb è la trappola: diventa una stringa jsonb", async () => {
    await sql`INSERT INTO prova_jsonb (key, data)
      VALUES ('trappola', ${JSON.stringify(ITEMS)}::jsonb)`;
    expect(await tipo("trappola")).toBe("string");
    expect(await leggi("trappola")).not.toEqual(ITEMS);
  });

  it("con ::text::jsonb il parametro resta testo e Postgres lo interpreta", async () => {
    await sql`INSERT INTO prova_jsonb (key, data)
      VALUES ('testo', ${JSON.stringify(ITEMS)}::text::jsonb)`;
    expect(await tipo("testo")).toBe("array");
    expect(await leggi("testo")).toEqual(ITEMS);
  });

  it("una passata sola dà lo stesso jsonb di tre", async () => {
    await sql`INSERT INTO prova_jsonb (key, data)
      VALUES ('tre', ${sql.json(JSON.parse(JSON.stringify(ITEMS)))})`;
    expect(await stessoContenuto("tre", "testo")).toBe(true);
  });

  it("le date sopravvivono al giro come ISO, in entrambe le forme", async () => {
    const conData = [{ id: 1, quando: new Date("2026-09-01T08:00:00.000Z") }];
    await sql`INSERT INTO prova_jsonb (key, data)
      VALUES ('data-tre', ${sql.json(JSON.parse(JSON.stringify(conData)))})`;
    await sql`INSERT INTO prova_jsonb (key, data)
      VALUES ('data-una', ${JSON.stringify(conData)}::text::jsonb)`;
    expect(await stessoContenuto("data-tre", "data-una")).toBe(true);
    expect(await leggi("data-una")).toEqual([
      { id: 1, quando: "2026-09-01T08:00:00.000Z" },
    ]);
  });

  it("i casi limite di JSON.stringify si comportano uguale nelle due forme", async () => {
    // `undefined` sparisce, le date diventano stringhe, i numeri restano
    // numeri: è quello che gli store si aspettano da anni, e non cambia.
    const strani = [
      { id: 1, vuoto: undefined, zero: 0, falso: false, nulla: null },
      { id: 2, testo: 'virgolette " e \\ backslash', accenti: "perché" },
    ];
    await sql`INSERT INTO prova_jsonb (key, data)
      VALUES ('strani-tre', ${sql.json(JSON.parse(JSON.stringify(strani)))})`;
    await sql`INSERT INTO prova_jsonb (key, data)
      VALUES ('strani-una', ${JSON.stringify(strani)}::text::jsonb)`;
    expect(await stessoContenuto("strani-tre", "strani-una")).toBe(true);
  });
});

// Il contratto sopra vale per una INSERT scritta a mano. Questo caso prova il
// percorso vero — `saveStoresAtomically` sugli store registrati — perché è lì
// che una regressione farebbe danno: non un test rosso, ma una colonna piena
// di stringhe jsonb da riparare a posteriori.
describe.skipIf(!conDatabase)("saveStoresAtomically — scrive array, non stringhe", () => {
  const sql = kvSql!;
  const CHIAVE_A = "prova_atomica_a";
  const CHIAVE_B = "prova_atomica_b";
  const storeA = persistedStore<{ id: number; nome: string }>(CHIAVE_A);
  const storeB = persistedStore<{ id: number; quando: Date }>(CHIAVE_B);

  beforeAll(async () => {
    await bootstrapAll();
  });

  afterAll(async () => {
    await sql`DELETE FROM kv_store WHERE key IN (${CHIAVE_A}, ${CHIAVE_B})`;
  });

  it("entrambi gli store finiscono in colonna come array leggibili", async () => {
    storeA.items.push({ id: 1, nome: "Rossi" }, { id: 2, nome: "Bianchi" });
    storeB.items.push({ id: 9, quando: new Date("2026-09-01T08:00:00.000Z") });

    await saveStoresAtomically([storeA, storeB]);

    const righe = await sql`
      SELECT key, jsonb_typeof(data) AS tipo, data
      FROM kv_store WHERE key IN (${CHIAVE_A}, ${CHIAVE_B}) ORDER BY key`;
    expect(righe.map(r => r.tipo)).toEqual(["array", "array"]);
    expect(righe[0].data).toEqual([
      { id: 1, nome: "Rossi" },
      { id: 2, nome: "Bianchi" },
    ]);
    expect(righe[1].data).toEqual([
      { id: 9, quando: "2026-09-01T08:00:00.000Z" },
    ]);
  });

  it("la fotografia è quella del commit: le modifiche dopo non ci entrano", async () => {
    const prima = storeA.items.length;
    await saveStoresAtomically([storeA]);
    storeA.items.push({ id: 3, nome: "Verdi" });
    const [riga] = await sql`SELECT data FROM kv_store WHERE key = ${CHIAVE_A}`;
    expect((riga.data as unknown[]).length).toBe(prima);
  });
});
