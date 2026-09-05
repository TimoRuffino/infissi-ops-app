import { describe, expect, it } from "vitest";

import { routeContractForLocation } from "./routeContract";
import {
  predictableMobileBackTarget,
  routePresentation,
} from "./shellPresentation";

describe("shell presentation", () => {
  it("derives the compact title from the authoritative route contract", () => {
    expect(routePresentation(routeContractForLocation("/kanban"))).toEqual({
      section: "Commesse",
      title: "Board operativo",
    });
    expect(routePresentation(routeContractForLocation("/commesse/42"))).toEqual(
      { section: "Commesse", title: "Commessa 360" }
    );
  });

  // Regressione: senza una entry dedicata, /fatturazione ricadeva sul
  // fallback generico ("Ruffino Flow" sia in sezione sia in titolo).
  it("mette Fatturazione sotto Economia, come Contabilità e Marginalità", () => {
    expect(
      routePresentation(routeContractForLocation("/fatturazione"))
    ).toEqual({ section: "Economia", title: "Fatturazione" });
  });

  it("uses deterministic hierarchy targets instead of browser history", () => {
    expect(predictableMobileBackTarget("/clienti/7?tab=contatti")).toBe(
      "/clienti"
    );
    expect(
      predictableMobileBackTarget(
        "/commesse/12/aperture/3/rilievo?modalita=campo"
      )
    ).toBe("/commesse/12");
    expect(
      predictableMobileBackTarget(
        "/preventivatori/punto-del-serramento/persiane"
      )
    ).toBe("/preventivatori");
    expect(predictableMobileBackTarget("/kanban")).toBeNull();
  });
});
