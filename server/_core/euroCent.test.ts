import { describe, expect, it } from "vitest";
import { centToEuro, euroToCent, sommaCent } from "@shared/euroCent";

describe("euroCent", () => {
  it("arrotonda half-up al centesimo e torna indietro senza deriva", () => {
    expect(euroToCent(15395)).toBe(1539500);
    expect(euroToCent(8247.46)).toBe(824746);
    expect(euroToCent(0.005)).toBe(1);
    expect(euroToCent(1.005)).toBe(101);
    expect(centToEuro(824746)).toBe(8247.46);
  });
  it("rifiuta valori non finiti", () => {
    expect(() => euroToCent(Number.NaN)).toThrow("IMPORTO_NON_VALIDO");
    expect(() => euroToCent(Number.POSITIVE_INFINITY)).toThrow("IMPORTO_NON_VALIDO");
  });
  it("somma ignorando i vuoti e resta intera", () => {
    expect(sommaCent(100, null, undefined, 250)).toBe(350);
    expect(() => sommaCent(1.5)).toThrow("CENT_NON_INTERI");
  });
});
