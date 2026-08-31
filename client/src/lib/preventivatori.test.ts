import { describe, expect, it } from "vitest";

import {
  AZIENDE_PREVENTIVATORE,
  filtraVociPreventivatore,
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
