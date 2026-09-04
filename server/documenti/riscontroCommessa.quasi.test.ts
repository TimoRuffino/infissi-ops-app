import { describe, expect, it } from "vitest";
import { riscontroCommessaNelTesto } from "./riscontroCommessa";

// Le scansioni passano dall'OCR e i fornitori scrivono i nomi a mano
// («Rif. POCCJ» per un cliente Pocci, 04/09/2026): un carattere sbagliato su
// un cognome lungo non deve far perdere il riscontro.

describe("riscontroCommessaNelTesto — nomi quasi uguali", () => {
  it("accetta un carattere di differenza su un cognome di almeno sei lettere", () => {
    const r = riscontroCommessaNelTesto(
      "Oggetto: Conferma ordine per la fornitura di N. 1 persiana. Rif. BIANCHJ",
      { codice: "COM-2026-010", cliente: "Bianchi Mario" }
    );
    expect(r.ok).toBe(true);
    expect(r.prove).toEqual(["cliente ~bianchi"]);
  });

  it("non si accontenta su cognomi corti o con due errori", () => {
    expect(
      riscontroCommessaNelTesto("Rif. ROSSJ", { codice: null, cliente: "Rossi Anna" }).ok
    ).toBe(false);
    expect(
      riscontroCommessaNelTesto("Rif. BIANCAA", { codice: null, cliente: "Bianchi Mario" }).ok
    ).toBe(false);
  });

  it("il nome esatto resta la prova preferita", () => {
    const r = riscontroCommessaNelTesto("Vs. riferimento: Bianchi", {
      codice: null,
      cliente: "Bianchi Mario",
    });
    expect(r.prove).toEqual(["cliente bianchi"]);
  });
});
