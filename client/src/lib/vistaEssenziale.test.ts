import { describe, expect, it } from "vitest";
import { TENANT_PIATTAFORMA_ID, vistaEssenziale } from "./piattaforma";

describe("vistaEssenziale", () => {
  it("la piattaforma (tenant 1) vede tutto", () => {
    expect(vistaEssenziale({ id: TENANT_PIATTAFORMA_ID })).toBe(false);
  });

  it("un'azienda cliente vede solo l'indispensabile", () => {
    expect(vistaEssenziale({ id: 2 })).toBe(true);
    expect(vistaEssenziale({ id: 41 })).toBe(true);
  });

  it("finché l'azienda non è nota la vista è essenziale: si scopre, non si copre", () => {
    expect(vistaEssenziale(undefined)).toBe(true);
    expect(vistaEssenziale(null)).toBe(true);
  });
});
