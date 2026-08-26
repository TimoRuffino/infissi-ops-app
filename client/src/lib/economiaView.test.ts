import { describe, expect, it } from "vitest";
import {
  etichettaAffidabilita,
  percentualeCopertura,
  statoScostamentoIncassi,
  statoCopertura,
} from "./economiaView";

describe("presentazione break-even", () => {
  it("limita la barra tra zero e cento", () => {
    expect(percentualeCopertura(2_000, 5_000)).toBe(40);
    expect(percentualeCopertura(8_000, 5_000)).toBe(100);
    expect(percentualeCopertura(-50, 5_000)).toBe(0);
    expect(percentualeCopertura(100, 0)).toBe(0);
  });

  it("traduce l'affidabilita in testo operativo", () => {
    expect(etichettaAffidabilita("alta")).toBe("Affidabilita alta");
    expect(etichettaAffidabilita("media")).toBe("Affidabilita media");
    expect(etichettaAffidabilita("insufficiente")).toBe("Dati insufficienti");
  });

  it("distingue obiettivo raggiunto, da coprire e dati mancanti", () => {
    expect(statoCopertura("dati_insufficienti", null)).toBe("insufficiente");
    expect(statoCopertura("disponibile", 0)).toBe("raggiunto");
    expect(statoCopertura("disponibile", 1_000)).toBe("da_coprire");
  });
});

describe("confronto incassi", () => {
  it("distingue allineamento, scostamento e dati incompleti", () => {
    expect(statoScostamentoIncassi(0, 0, true)).toBe("allineato");
    expect(statoScostamentoIncassi(100, 0, true)).toBe("da_verificare");
    expect(statoScostamentoIncassi(0, 2, true)).toBe("dati_incompleti");
    expect(statoScostamentoIncassi(0, 0, false)).toBe(
      "dati_non_disponibili"
    );
  });

  it("tollera solo differenze tecniche minime", () => {
    expect(statoScostamentoIncassi(0.25, 0, true)).toBe("allineato");
    expect(statoScostamentoIncassi(0.51, 0, true)).toBe("da_verificare");
    expect(statoScostamentoIncassi(1_000, 0, true)).toBe("da_verificare");
  });
});
