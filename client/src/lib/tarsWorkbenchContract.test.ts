import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sorgente = readFileSync(
  new URL("../pages/Tars.tsx", import.meta.url),
  "utf8"
);

describe("confine operativo della workbench Tars", () => {
  it("non interroga i costi né contiene diagnostica tecnica", () => {
    expect(sorgente).not.toContain("tars.costi");
    expect(sorgente).not.toMatch(/\bprovider\b/i);
    expect(sorgente).not.toMatch(/\bmodell[oi]\b|\bmodels?\b/i);
    expect(sorgente).not.toMatch(/\bcosti?\b|\bcosts?\b/i);
    expect(sorgente).not.toMatch(/\bbudget\b/i);
    expect(sorgente).not.toContain("strumentiDisponibili");
    expect(sorgente).not.toMatch(/strumenti attivi|run in sede|\btools?\b/i);
  });
});
