import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  derivaGateQueryAgente,
  derivaStatoAgente,
  etichettaAmbitoCosti,
  formattaCostoUsd,
  percentualeBudget,
} from "./tarsAgentView";

describe("vista tecnica dell'agente Tars", () => {
  it("deriva spento, disponibile e degradato dal gate e dallo stato", () => {
    expect(
      derivaStatoAgente({
        interruttori: undefined,
        stato: undefined,
        erroreStato: false,
      })
    ).toBe("caricamento");
    expect(
      derivaStatoAgente({
        interruttori: { tars: false },
        stato: undefined,
        erroreStato: false,
      })
    ).toBe("spento");
    expect(
      derivaStatoAgente({
        interruttori: { tars: true },
        stato: { provider: "openai" },
        erroreStato: false,
      })
    ).toBe("disponibile");
    expect(
      derivaStatoAgente({
        interruttori: { tars: true },
        stato: { provider: "openai" },
        erroreStato: false,
        erroreCosti: true,
      })
    ).toBe("degradato");
    expect(
      derivaStatoAgente({
        interruttori: { tars: true },
        stato: undefined,
        erroreStato: true,
      })
    ).toBe("degradato");
    expect(
      derivaStatoAgente({
        interruttori: { tars: true },
        stato: { provider: "finto" },
        erroreStato: false,
      })
    ).toBe("degradato");
  });

  it("non abilita le query Tars prima del gate e nasconde i costi fuori da Direzione", () => {
    expect(derivaGateQueryAgente(undefined, true)).toEqual({
      risolto: false,
      tarsAcceso: false,
      statoAbilitato: false,
      costiAbilitati: false,
    });
    expect(derivaGateQueryAgente({ tars: false }, true)).toEqual({
      risolto: true,
      tarsAcceso: false,
      statoAbilitato: false,
      costiAbilitati: false,
    });
    expect(derivaGateQueryAgente({ tars: true }, false)).toEqual({
      risolto: true,
      tarsAcceso: true,
      statoAbilitato: true,
      costiAbilitati: false,
    });
    expect(derivaGateQueryAgente({ tars: true }, true)).toEqual({
      risolto: true,
      tarsAcceso: true,
      statoAbilitato: true,
      costiAbilitati: true,
    });
  });

  it("formatta importi e percentuali senza NaN", () => {
    expect(formattaCostoUsd(12.5)).toBe("12,50 USD");
    expect(formattaCostoUsd(null)).toBe("—");
    expect(formattaCostoUsd(Number.NaN)).toBe("—");
    expect(percentualeBudget(2, 10)).toBe(20);
    expect(percentualeBudget(12, 10)).toBe(100);
    expect(percentualeBudget(null, 10)).toBeNull();
    expect(percentualeBudget(1, 0)).toBeNull();
  });

  it("dichiara sempre che i consumi sono globali a tutte le sedi", () => {
    expect(etichettaAmbitoCosti()).toBe("Consumi globali · tutte le sedi");
  });

  it("mantiene visibili i diagnostici del governor e un trigger di almeno 44px", () => {
    const source = readFileSync(
      new URL("../components/tars/TarsAgentCard.tsx", import.meta.url),
      "utf8"
    );
    expect(source).toContain("perRunUsd");
    expect(source).toContain("tokenGiorno");
    expect(source).toContain("motivoBudgetNonValido");
    expect(source).toContain("Circuito");
    expect(source).toContain("min-h-11");
  });
});
