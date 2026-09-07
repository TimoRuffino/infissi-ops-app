// server/_core/idGlobali.test.ts
// Guardia STRUTTURALE (Task 4): ogni store per tenant genera i suoi id con
// `prossimoId()`/`riservaIdFinoA()` (server/_core/persistence.ts), mai con un
// contatore locale — un `let nextId` a livello di modulo è condiviso da TUTTE
// le istanze della famiglia (una per tenant): l'ultimo tenant caricato
// vincerebbe, e gli id di tenant diversi potrebbero collidere.
//
// Sul modello di server/tenants/confine.test.ts: legge i sorgenti e fallisce
// se qualcuno reintroduce il pattern vietato.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileSorgente, relativo } from "./sorgentiDiProva";

// Store dichiarati `{ ambito: "globale" }` (una sola istanza per
// installazione, non per tenant): un contatore locale lì non collide con
// nessun altro tenant. `sedi.ts`/`utenti.ts` sono globali di fatto — la
// dichiarazione esplicita dell'ambito è Task 5 — e `featureFlags.ts` lo è già.
const AMMESSI = new Set([
  "server/routers/sedi.ts",
  "server/routers/utenti.ts",
  "server/platform/featureFlags.ts",
]);

// Repository in memoria delle tabelle SQL: non sono `persistedStore` (niente
// famiglie per tenant), sono il ripiego locale di uno `store: Repository`
// dietro Postgres, con un contatore chiuso dentro la funzione factory — vive
// e muore con quella singola istanza, non a livello di modulo condiviso fra
// tenant.
const NON_STORE =
  /server\/(actionCenter|authz|computo|contratti|events|notifications|reminders|tars\/proattivita)\//;

// Pattern che rivela contatori di id calcolati inline, con le tre forme
// di arrow supportate dal repo: `x => x.id`, `(x) => x.id`, `(x: any) => x.id`.
// Non-greedy e semicolon-bounded per evitare false negative su funzioni tipizzate.
const PATTERN_VIETATO = /\blet next[A-Za-z]*Id\b|Math\.max\([^;]*?\.map\([^;]*?\.id\)[^;]*\+\s*1/;

describe("id globali", () => {
  it("nessun contatore di id locale nei moduli con store per tenant", () => {
    const colpevoli = fileSorgente(["server"])
      .filter(f => !/\.test\.ts$/.test(f) && !NON_STORE.test(f) && !AMMESSI.has(relativo(f)))
      .filter(f =>
        PATTERN_VIETATO.test(
          readFileSync(f, "utf8")
        )
      )
      .map(relativo)
      .filter(f => f !== "server/_core/persistence.ts");
    expect(colpevoli).toEqual([]);
  });

  it("la regex riconosce le tre forme di arrow del repo", () => {
    // Untyped: `x => x.id`
    expect(
      PATTERN_VIETATO.test(
        "nextId = items.length ? Math.max(...items.map(x => x.id)) + 1 : 1"
      )
    ).toBe(true);

    // Parenthesized: `(x) => x.id`
    expect(
      PATTERN_VIETATO.test(
        "Math.max(...loaded.map((x) => x.id)) + 1"
      )
    ).toBe(true);

    // Typed: `(x: any) => x.id`
    expect(
      PATTERN_VIETATO.test(
        "Math.max(...loaded.map((x: any) => x.id)) + 1"
      )
    ).toBe(true);

    // Legitimate use of prossimoId() should not match
    expect(
      PATTERN_VIETATO.test("store.prossimoId()")
    ).toBe(false);
  });
});
