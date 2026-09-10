import { afterEach, describe, expect, it } from "vitest";
import { ambienteStaging } from "./ambiente";

const originale = process.env.AMBIENTE;
afterEach(() => {
  if (originale === undefined) delete process.env.AMBIENTE;
  else process.env.AMBIENTE = originale;
});

describe("ambienteStaging", () => {
  it("è falso senza AMBIENTE (fail-closed: assente = produzione)", () => {
    delete process.env.AMBIENTE;
    expect(ambienteStaging()).toBe(false);
  });
  it("è vero solo per il valore staging, tollerando maiuscole e spazi", () => {
    process.env.AMBIENTE = "staging";
    expect(ambienteStaging()).toBe(true);
    process.env.AMBIENTE = " Staging ";
    expect(ambienteStaging()).toBe(true);
  });
  it("qualunque altro valore vale produzione", () => {
    for (const v of ["produzione", "true", "1", "stagin", "staging2"]) {
      process.env.AMBIENTE = v;
      expect(ambienteStaging()).toBe(false);
    }
  });
  it("rilegge la variabile a ogni chiamata (nessuna cache)", () => {
    process.env.AMBIENTE = "staging";
    expect(ambienteStaging()).toBe(true);
    delete process.env.AMBIENTE;
    expect(ambienteStaging()).toBe(false);
  });
});
