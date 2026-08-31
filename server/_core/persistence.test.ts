import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  fallisceCommit: false,
  scritture: [] as unknown[][],
}));

vi.mock("postgres", () => ({
  default: () => {
    const sql: any = (parti: TemplateStringsArray, ...valori: unknown[]) => {
      if (parti.join("?").includes("INSERT INTO kv_store")) {
        database.scritture.push(valori);
      }
      return Promise.resolve([]);
    };
    sql.begin = async (operazione: (tx: typeof sql) => Promise<unknown>) => {
      if (database.fallisceCommit) throw new Error("commit interrotto");
      return operazione(sql);
    };
    sql.json = (valore: unknown) => valore;
    sql.end = async () => undefined;
    return sql;
  },
}));

describe("persistenza atomica multi-store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("DATABASE_URL", "postgres://test:pass@localhost/test");
    vi.resetModules();
    database.fallisceCommit = false;
    database.scritture = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("non perde il debounce precedente se l'operazione termina senza commit", async () => {
    const { bootstrapAll, conTransazioneStoreAtomica, persistedStore } = await import(
      "./persistence"
    );
    const store = persistedStore<{ id: number }>("persistence-no-commit");
    await bootstrapAll();
    store.items.push({ id: 1 });
    store.save();

    await conTransazioneStoreAtomica([store], async () => undefined);
    await vi.advanceTimersByTimeAsync(200);

    expect(database.scritture).toHaveLength(1);
  });

  it("ritenta il debounce precedente dopo un commit atomico fallito", async () => {
    const { bootstrapAll, conTransazioneStoreAtomica, persistedStore } = await import(
      "./persistence"
    );
    const store = persistedStore<{ id: number }>("persistence-commit-failed");
    await bootstrapAll();
    store.items.push({ id: 1 });
    store.save();
    database.fallisceCommit = true;

    await expect(
      conTransazioneStoreAtomica([store], async commit => commit())
    ).rejects.toThrow("commit interrotto");
    database.fallisceCommit = false;
    await vi.advanceTimersByTimeAsync(200);

    expect(database.scritture).toHaveLength(1);
  });
});
