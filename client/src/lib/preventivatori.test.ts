import { describe, expect, it } from "vitest";

import {
  areaMetriQuadri,
  AZIENDE_PREVENTIVATORE,
  filtraVociPreventivatore,
  millimetriDaInput,
  millimetriValidi,
  preventivatoreRouteFor,
  vociPreventivatore,
} from "./preventivatori";

describe("preventivatoreRouteFor", () => {
  it("risolve le due route esistenti senza inventarne altre", () => {
    expect(preventivatoreRouteFor("fivizzanese", "persiane")).toBe(
      "/preventivatori/fivizzanese/persiane"
    );
    expect(preventivatoreRouteFor("punto-del-serramento", "persiane")).toBe(
      "/preventivatori/punto-del-serramento/persiane"
    );
    expect(preventivatoreRouteFor("fivizzanese", "zanzariere")).toBeNull();
  });

  it("non deriva una route da un'azienda a catalogo senza calcolatore", () => {
    expect(preventivatoreRouteFor("alias", "blindati")).toBeNull();
  });
});

describe("vociPreventivatore", () => {
  it("elenca una voce per ogni coppia azienda/prodotto dichiarata", () => {
    const voci = vociPreventivatore();
    const attese = AZIENDE_PREVENTIVATORE.reduce(
      (acc, azienda) => acc + azienda.prodotti.length,
      0
    );

    expect(voci).toHaveLength(attese);
    // Nessuna voce inventa una route: o è quella del resolver, o è null.
    for (const voce of voci) {
      expect(voce.route).toBe(
        preventivatoreRouteFor(voce.aziendaId, voce.prodottoKey)
      );
    }
  });

  it("marca come non disponibile ciò che non ha un calcolatore", () => {
    const alias = vociPreventivatore().find(voce => voce.aziendaId === "alias");

    expect(alias?.route).toBeNull();
  });
});

describe("filtraVociPreventivatore", () => {
  it("cerca su azienda e prodotto ignorando maiuscole e spazi", () => {
    const voci = vociPreventivatore();

    expect(
      filtraVociPreventivatore(voci, "  FIVIZZ ").map(voce => voce.aziendaId)
    ).toEqual(["fivizzanese"]);
    expect(
      filtraVociPreventivatore(voci, "blindati").map(voce => voce.aziendaId)
    ).toEqual(["alias"]);
    expect(filtraVociPreventivatore(voci, "")).toHaveLength(voci.length);
    expect(filtraVociPreventivatore(voci, "zanzariere")).toEqual([]);
  });
});

describe("millimetriValidi", () => {
  it("accetta solo millimetri interi positivi", () => {
    expect(millimetriValidi("1200")).toBe(1200);
    expect(millimetriValidi("0")).toBeNull();
    expect(millimetriValidi("12,5")).toBeNull();
    expect(millimetriValidi(" 900 ")).toBe(900);
    expect(millimetriValidi("")).toBeNull();
    expect(millimetriValidi("abc")).toBeNull();
    expect(millimetriValidi("-100")).toBeNull();
  });
});

describe("millimetriDaInput", () => {
  // Confine di calcolo storico dei due preventivatori: virgola decimale
  // accettata, tutto il resto vale 0 e quindi non produce prezzo.
  it("conserva la lettura tollerante usata dai calcolatori", () => {
    expect(millimetriDaInput("1200")).toBe(1200);
    expect(millimetriDaInput("12,5")).toBe(12.5);
    expect(millimetriDaInput("12.5")).toBe(12.5);
    expect(millimetriDaInput("0")).toBe(0);
    expect(millimetriDaInput("")).toBe(0);
    expect(millimetriDaInput("-100")).toBe(0);
  });
});

describe("areaMetriQuadri", () => {
  it("converte millimetri per millimetri in metri quadri", () => {
    expect(areaMetriQuadri(1000, 2000)).toBe(2);
    expect(areaMetriQuadri(1200, 1500)).toBe(1.8);
    expect(areaMetriQuadri(0, 1500)).toBe(0);
  });
});
