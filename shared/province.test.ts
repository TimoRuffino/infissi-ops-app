import { describe, expect, it } from "vitest";
import { PROVINCE, etichettaProvincia, siglaProvincia, siglaProvinciaValida } from "./province";

describe("province", () => {
  it("107 sigle di due maiuscole, senza doppioni, in ordine di nome", () => {
    expect(PROVINCE).toHaveLength(107);
    const sigle = PROVINCE.map(p => p.sigla);
    expect(new Set(sigle).size).toBe(sigle.length);
    for (const s of sigle) expect(s).toMatch(/^[A-Z]{2}$/);
    const nomi = PROVINCE.map(p => p.nome);
    expect([...nomi].sort((a, b) => a.localeCompare(b, "it"))).toEqual(nomi);
  });

  it("normalizza e rifiuta", () => {
    expect(siglaProvincia(" to ")).toBe("TO");
    expect(siglaProvincia("Torino")).toBeNull();
    expect(siglaProvincia("XX")).toBeNull();
    expect(siglaProvincia("")).toBeNull();
    expect(siglaProvinciaValida("sp")).toBe(true);
    expect(siglaProvinciaValida("OT")).toBe(false);
    expect(etichettaProvincia("SP")).toBe("SP — La Spezia");
    expect(etichettaProvincia("ZZ")).toBe("ZZ");
  });
});
