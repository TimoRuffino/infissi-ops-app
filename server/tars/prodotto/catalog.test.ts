// T8 — guardie strutturali del SafeProductCatalog: il catalogo descrive il
// prodotto e non può MAI trasportare sorgenti, segreti, percorsi o R4.

import { describe, expect, it } from "vitest";
import { REGISTRO_AZIONI } from "../azioni/registry";
import { catalogoProdottoSicuro } from "./catalog";

describe("SafeProductCatalog", () => {
  const catalogo = catalogoProdottoSicuro();
  const serializzato = JSON.stringify(catalogo);

  it("è versionato e copre domini, route, state machine, azioni e capability", () => {
    expect(catalogo.versione).toMatch(/^\d+\.\d+\.\d+$/);
    expect(catalogo.domini.length).toBeGreaterThanOrEqual(8);
    expect(catalogo.routeLogiche).toContain("board-commesse");
    expect(catalogo.stateMachine.commessa).toContain("misure_esecutive");
    expect(catalogo.azioniTars).toHaveLength(REGISTRO_AZIONI.length);
    expect(catalogo.capability).toContain("commessa.read");
    expect(catalogo.versioni.registroAzioni).toBeTruthy();
  });

  it("non contiene percorsi assoluti, env, segreti, chiavi o contenuti di file", () => {
    expect(serializzato).not.toMatch(/\/Users\/|\/home\/|[A-Z]:\\\\/);
    expect(serializzato).not.toMatch(/process\.env|DATABASE_URL|OPENAI_API_KEY/);
    expect(serializzato).not.toMatch(/sk-[A-Za-z0-9]|BEGIN [A-Z]+ KEY/);
    expect(serializzato).not.toMatch(/password|token|secret/i);
    expect(serializzato).not.toMatch(/import |require\(|=>\s*\{/);
  });

  it("non espone strumenti R4 e marca gli indisponibili con il blocco", () => {
    expect(catalogo.azioniTars.every(a => a.rischio !== "R4")).toBe(true);
    expect(
      catalogo.azioniIndisponibili.every(voce => voce.motivo.length > 30)
    ).toBe(true);
    const nomi = new Set(catalogo.azioniTars.map(a => a.nome));
    expect(
      catalogo.azioniIndisponibili.every(voce => !nomi.has(voce.nome))
    ).toBe(true);
  });

  it("gli importi e i dati cliente non hanno posto nel catalogo", () => {
    expect(serializzato).not.toMatch(/€|\beuro\b|\biban\b/i);
    expect(serializzato).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
  });
});
