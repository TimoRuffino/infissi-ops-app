import { describe, expect, it } from "vitest";
import { riferimentiOrdineDocumento, riscontroCommessaNelTesto } from "./riscontroCommessa";

describe("riferimentiOrdineDocumento — numeri corti", () => {
  it("un CAP o un anno letti come numero di conferma non diventano un riferimento d'ordine", () => {
    // Brianzatende, 04/09/2026: «19124» (CAP di La Spezia) faceva di due ordini un duplicato.
    expect(riferimentiOrdineDocumento({ nomeFile: "2026013149.pdf", numeroConferma: "19124" })).toEqual([
      "2026013149",
    ]);
    expect(riferimentiOrdineDocumento({ nomeFile: "conferma.pdf", numeroConferma: "2026" })).toEqual([]);
    expect(riferimentiOrdineDocumento({ nomeFile: "conferma.pdf", numeroConferma: "003746" })).toEqual([
      "003746",
    ]);
    expect(riferimentiOrdineDocumento({ nomeFile: "conferma.pdf", numeroConferma: "CV 003746" })).toEqual([
      "cv003746",
    ]);
  });
});

// Le scansioni passano dall'OCR e i fornitori scrivono i nomi a mano
// («Rif. POCCJ» per un cliente Pocci, 04/09/2026): un carattere sbagliato su
// un cognome lungo non deve far perdere il riscontro.

describe("riscontroCommessaNelTesto — nomi quasi uguali", () => {
  it("accetta un carattere di differenza su un cognome di almeno sei lettere", () => {
    const r = riscontroCommessaNelTesto(
      "Oggetto: Conferma ordine per la fornitura di N. 1 persiana. Rif. PEDRINJ",
      { codice: "COM-2026-010", cliente: "Pedrini Mario" }
    );
    expect(r.ok).toBe(true);
    expect(r.prove).toEqual(["cliente ~pedrini"]);
  });

  it("non si accontenta su cognomi corti o con due errori", () => {
    expect(
      riscontroCommessaNelTesto("Rif. ROSSJ", { codice: null, cliente: "Rossi Anna" }).ok
    ).toBe(false);
    expect(
      riscontroCommessaNelTesto("Rif. PEDRAAA", { codice: null, cliente: "Pedrini Mario" }).ok
    ).toBe(false);
  });

  it("il nome esatto resta la prova preferita", () => {
    const r = riscontroCommessaNelTesto("Vs. riferimento: Pedrini", {
      codice: null,
      cliente: "Pedrini Mario",
    });
    expect(r.prove).toEqual(["cliente pedrini"]);
  });

  it("un cognome fra i più diffusi vale solo con il nome accanto (04/09/2026)", () => {
    expect(
      riscontroCommessaNelTesto("Vs. riferimento: Bianchi", { codice: null, cliente: "Bianchi Mario" }).ok
    ).toBe(false);
    const pieno = riscontroCommessaNelTesto("Vs. riferimento: Bianchi Mario", {
      codice: null,
      cliente: "Bianchi Mario",
    });
    expect(pieno.prove).toEqual(["cliente bianchi mario"]);
  });
});
