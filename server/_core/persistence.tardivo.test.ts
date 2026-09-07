import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Il caso reale del 04/09/2026: `fic_pagamenti_links` vive in un modulo
// importato solo in modo dinamico, quindi il suo persistedStore si
// registrava DOPO bootstrapAll. Restava «non caricato» e ogni salvataggio
// veniva rinviato per sempre («save deferred … bootstrap not complete yet»
// una volta al secondo, per ore). Uno store tardivo deve caricarsi da solo e
// poi salvare normalmente.

const database = vi.hoisted(() => ({
  righe: new Map<string, unknown[]>(),
  scritture: [] as Array<{ key: string; items: unknown }>,
}));

vi.mock("postgres", () => ({
  default: () => {
    const sql: any = (parti: TemplateStringsArray, ...valori: unknown[]) => {
      const testo = parti.join("?");
      if (testo.includes("INSERT INTO kv_store")) {
        database.scritture.push({ key: String(valori[0]), items: valori[1] });
        return Promise.resolve([]);
      }
      if (testo.includes("SELECT data FROM kv_store")) {
        const dati = database.righe.get(String(valori[0]));
        return Promise.resolve(dati ? [{ data: dati }] : []);
      }
      return Promise.resolve([]);
    };
    sql.begin = async (operazione: (tx: typeof sql) => Promise<unknown>) => operazione(sql);
    sql.json = (valore: unknown) => valore;
    sql.end = async () => undefined;
    return sql;
  },
}));

describe("store registrato dopo bootstrapAll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("DATABASE_URL", "postgres://test:pass@localhost/test");
    vi.resetModules();
    database.righe.clear();
    database.scritture = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("si carica da solo dal DB e poi salva, invece di rinviare per sempre", async () => {
    const { bootstrapAll, persistedStore } = await import("./persistence");
    persistedStore<{ id: number }>("tardivo-precoce");
    await bootstrapAll();

    database.righe.set("tardivo-links", [{ id: 7, nota: "dal db" }]);
    const caricati: unknown[][] = [];
    const tardivo = persistedStore<{ id: number; nota?: string }>(
      "tardivo-links",
      items => caricati.push([...items])
    );
    await vi.advanceTimersByTimeAsync(10);

    expect(caricati).toEqual([[{ id: 7, nota: "dal db" }]]);
    expect(tardivo.items).toEqual([{ id: 7, nota: "dal db" }]);

    tardivo.items.push({ id: 8 });
    tardivo.save();
    await vi.advanceTimersByTimeAsync(250);

    expect(database.scritture.map(s => s.key)).toEqual(["tardivo-links"]);
    expect(database.scritture[0].items).toEqual([{ id: 7, nota: "dal db" }, { id: 8 }]);
  });

  it("non perde gli elementi messi in memoria prima che il caricamento finisca", async () => {
    const { bootstrapAll, persistedStore } = await import("./persistence");
    await bootstrapAll();

    database.righe.set("tardivo-corsa", [{ id: 1 }]);
    const store = persistedStore<{ id: number }>("tardivo-corsa");
    // Il modulo scrive subito, prima che il SELECT torni.
    store.items.push({ id: 99 });
    store.save();
    await vi.advanceTimersByTimeAsync(1500);

    expect(store.items).toEqual([{ id: 1 }, { id: 99 }]);
    expect(database.scritture.at(-1)?.items).toEqual([{ id: 1 }, { id: 99 }]);
  });

  it("uno store registrato prima del bootstrap si carica come sempre, senza doppio caricamento", async () => {
    const { bootstrapAll, persistedStore } = await import("./persistence");
    database.righe.set("normale", [{ id: 3 }]);
    let caricamenti = 0;
    const store = persistedStore<{ id: number }>("normale", () => {
      caricamenti += 1;
    });
    await bootstrapAll();
    await vi.advanceTimersByTimeAsync(10);

    expect(caricamenti).toBe(1);
    expect(store.items).toEqual([{ id: 3 }]);
  });
});
