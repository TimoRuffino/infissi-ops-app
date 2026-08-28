import { describe, expect, it } from "vitest";
import { annoCommessa } from "./annoCommessa";

describe("anno di una commessa", () => {
  it("preferisce la data di apertura", () => {
    expect(
      annoCommessa({
        dataApertura: "2024-03-01",
        codice: "COM-2026-0012",
        createdAt: new Date("2026-08-01"),
      })
    ).toBe(2024);
  });

  it("ripiega sul codice quando l'apertura manca", () => {
    expect(
      annoCommessa({ codice: "COM-2025-0007", createdAt: new Date("2026-01-01") })
    ).toBe(2025);
    // Anche in minuscolo: i codici importati non sono tutti uguali.
    expect(annoCommessa({ codice: "com-2023-0001" })).toBe(2023);
  });

  it("ripiega su createdAt quando non c'è né apertura né codice utile", () => {
    expect(annoCommessa({ codice: "X-1", createdAt: "2022-11-30T10:00:00Z" })).toBe(
      2022
    );
  });

  it("restituisce null quando non c'è niente di leggibile", () => {
    expect(annoCommessa({})).toBeNull();
    expect(annoCommessa({ dataApertura: "", codice: "", createdAt: "boh" })).toBeNull();
  });
});
