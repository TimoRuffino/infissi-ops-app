import { describe, expect, it } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TarsAgentCardView } from "@/components/tars/TarsAgentCard";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
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

  it("renderizza uno skeleton durante il caricamento senza chiamarlo degradato", () => {
    const markup = renderToStaticMarkup(
      createElement(TarsAgentCardView, {
        direzione: true,
        gate: {
          risolto: false,
          tarsAcceso: false,
          statoAbilitato: false,
          costiAbilitati: false,
        },
        statoAgente: "caricamento",
        interruttori: undefined,
        stato: undefined,
        costi: undefined,
        costiErrore: false,
        onRetryCosti: () => undefined,
      })
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain("Caricamento stato Tars");
    expect(markup).toContain("animate-pulse");
    expect(markup).not.toContain("Degradato");
  });

  it("renderizza l'errore costi con retry e stato complessivo degradato", () => {
    const markup = renderToStaticMarkup(
      createElement(TarsAgentCardView, {
        direzione: true,
        gate: {
          risolto: true,
          tarsAcceso: true,
          statoAbilitato: true,
          costiAbilitati: true,
        },
        statoAgente: "degradato",
        interruttori: { tars: true },
        stato: { provider: "openai", modello: "gpt-test" },
        costi: undefined,
        costiErrore: true,
        onRetryCosti: () => undefined,
      })
    );

    expect(markup).toContain("Degradato");
    expect(markup).toContain("Consumi non disponibili");
    expect(markup).toContain(">Riprova</button>");
  });

  it("mostra diagnostici reali del governor e il trigger con target 44px", () => {
    const markup = renderToStaticMarkup(
      createElement(TarsAgentCardView, {
        direzione: true,
        gate: {
          risolto: true,
          tarsAcceso: true,
          statoAbilitato: true,
          costiAbilitati: true,
        },
        statoAgente: "disponibile",
        interruttori: { tars: true, tarsReadTools: true },
        stato: {
          provider: "openai",
          modello: "gpt-test",
          strumentiDisponibili: [{ nome: "cerca_commesse" }],
          run: { totale: 4, degradati: 1, ultimo: null },
        },
        costi: {
          provider: { tipo: "openai", budget: { giornalieroUsd: 10 } },
          budgetConfigurato: {
            perRunUsd: 0.12,
            giornalieroUsd: 10,
            mensileUsd: 100,
          },
          motivoBudgetNonValido: "Budget non valido per il mese corrente",
          riepilogo: {
            spesaGiornoUsd: 2,
            spesaMeseUsd: 15,
            residuoGiornoUsd: 8,
            residuoMeseUsd: 85,
            chiamateGiorno: 3,
            runGiorno: 2,
            costoMedioRunUsd: 0.5,
            costoMassimoRunUsd: 0.9,
            tokenGiorno: { input: 10, cached: 20, output: 30 },
          },
        },
        costiErrore: false,
        onRetryCosti: () => undefined,
        dettagliApertiIniziali: true,
      })
    );

    expect(markup).toContain("Limite per run");
    expect(markup).toContain("0,12");
    expect(markup).toContain("Token oggi");
    expect(markup).toContain("10 input");
    expect(markup).toContain("Provider");
    expect(markup).toContain("Disponibile");
    expect(markup).toContain("Budget / disponibilità");
    expect(markup).toContain("Configurato");
    expect(markup).toContain("Budget non valido per il mese corrente");
    expect(markup).toContain("Circuito");
    expect(markup).toContain("Gestito dal governor");

    const trigger = markup.match(
      /<button[^>]*class="[^"]*min-h-11[^"]*"[^>]*>[\s\S]*?Diagnostica, strumenti e interruttori[\s\S]*?<\/button>/
    )?.[0];
    expect(trigger).toBeDefined();
    expect(trigger).not.toContain("h-9");
  });
});
