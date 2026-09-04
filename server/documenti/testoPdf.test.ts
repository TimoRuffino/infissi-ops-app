import { describe, expect, it } from "vitest";
import {
  celleDiRiga,
  pagineDaDocumento,
  righeDaElementi,
  type ElementoTesto,
} from "./testoPdf";

/** Un frammento come lo consegna pdf.js: origine (x, y), larghezza (4,5 pt a carattere), altezza. */
function el(str: string, x: number, y: number, altezza = 8, width?: number): ElementoTesto {
  return {
    str,
    transform: [altezza, 0, 0, altezza, x, y],
    width: width ?? str.length * 4.5,
    height: altezza,
  };
}

const celle = (riga: string) => celleDiRiga(riga).map(c => c.testo);

describe("righeDaElementi — righe dalla geometria dei frammenti", () => {
  it("rimette etichette e valori sulla stessa riga anche se il flusso li separa", () => {
    // Il riquadro totali di BT Glass: pdf.js emette prima tutti gli importi e
    // poi tutte le etichette; nel PDF stanno affiancati riga per riga.
    const righe = righeDaElementi([
      el("5.946,26", 300, 100),
      el("416,24", 300, 88),
      el("7.762,25", 300, 64),
      el("1.399,75", 300, 76),
      el("Totale", 200, 64),
      el("Imposta", 200, 76),
      el("Spese trasporto", 200, 88),
      el("Totale righe", 200, 100),
    ]).split("\n");
    expect(righe.map(celle)).toEqual([
      ["Totale righe", "5.946,26"],
      ["Spese trasporto", "416,24"],
      ["Imposta", "1.399,75"],
      ["Totale", "7.762,25"],
    ]);
  });

  it("incolla i pezzi contigui di una parola e separa con uno spazio i vuoti piccoli", () => {
    // «000183» spezzato in due frammenti attaccati; poi «del» a uno spazio.
    const testo = righeDaElementi([
      el("N.", 50, 500),
      el("0001", 62, 500, 8, 18),
      el("83", 80, 500, 8, 9),
      el("del", 92, 500),
      el("12/03/2026", 110, 500),
    ]);
    expect(testo.trim()).toBe("N. 000183 del 12/03/2026");
  });

  it("mette la colonna destra sulla stessa riga della sinistra, come celle", () => {
    const righe = righeDaElementi([
      el("Spett.le", 400, 700),
      el("BT GLASS Srl", 50, 700),
      el("RUFFINO GROUP SRLS", 400, 690),
      el("Sede legale: Via C.M. Maggi, 41", 50, 690),
    ]).split("\n");
    expect(righe.map(celle)).toEqual([
      ["BT GLASS Srl", "Spett.le"],
      ["Sede legale: Via C.M. Maggi, 41", "RUFFINO GROUP SRLS"],
    ]);
  });

  it("allinea un valore sotto la sua etichetta anche se la riga sotto comincia altrove", () => {
    // Alias: una riga di etichette, poi una riga di valori nelle stesse colonne.
    const righe = righeDaElementi([
      el("AGENTE", 40, 500),
      el("Compilatore conferma", 220, 500),
      el("VS.RIFERIMENTO", 400, 500),
      el("DE - DOOR DESIGN S.R.L.", 40, 490),
      el("Veronica Gregori", 220, 490),
      el("GIACOMAZZI GIUL", 400, 490),
      // Gianesin: l'etichetta è sola nella colonna destra, il valore sotto.
      el("Vostro Riferimento", 300, 400),
      el("Sede Legale, Amministrativa e Operativa:", 40, 390),
      el("GIANESIN", 300, 390),
    ]).split("\n");
    expect(righe[0].indexOf("VS.RIFERIMENTO")).toBe(righe[1].indexOf("GIACOMAZZI"));
    expect(righe[0].indexOf("Compilatore")).toBe(righe[1].indexOf("Veronica"));
    expect(Math.abs(righe[2].indexOf("Vostro") - righe[3].indexOf("GIANESIN"))).toBeLessThanOrEqual(1);
  });

  it("tollera piccoli scarti di quota (apici, corpi diversi) senza spezzare la riga", () => {
    const testo = righeDaElementi([
      el("Data consegna prevista:", 50, 300, 7),
      el("20/04/26", 170, 301, 9),
      el("Sett.", 240, 300, 7),
      el("17", 268, 300.5, 9),
    ]);
    expect(celle(testo)).toEqual(["Data consegna prevista:", "20/04/26", "Sett. 17"]);
  });

  it("scarta frammenti vuoti o senza coordinate e non ripete il testo disegnato due volte", () => {
    const testo = righeDaElementi([
      el("   ", 10, 10),
      { str: "senza quota", transform: [8, 0, 0, 8, Number.NaN, 10], width: 40, height: 8 },
      el("Totale", 10, 10),
      el("Totale", 10, 10),
    ]);
    expect(testo.trim()).toBe("Totale");
  });

  it("legge tutte le pagine di un documento e libera ogni pagina", async () => {
    const liberate: number[] = [];
    const pdf = {
      numPages: 2,
      getPage: async (numero: number) => ({
        getTextContent: async () => ({
          items: [
            el(`pagina ${numero}`, 10, 100),
            { type: "beginMarkedContent" },
            el("riga sotto", 10, 80),
          ],
        }),
        cleanup: () => {
          liberate.push(numero);
        },
      }),
    };
    const pagine = await pagineDaDocumento(pdf);
    expect(pagine.map(p => p.split("\n").map(r => r.trim()))).toEqual([
      ["pagina 1", "riga sotto"],
      ["pagina 2", "riga sotto"],
    ]);
    expect(liberate).toEqual([1, 2]);
  });
});

describe("celleDiRiga", () => {
  it("separa le celle su tre o più spazi e ricorda dove cominciano", () => {
    expect(celleDiRiga("  Vs. riferimento:   De Petris      SP")).toEqual([
      { testo: "Vs. riferimento:", inizio: 2 },
      { testo: "De Petris", inizio: 21 },
      { testo: "SP", inizio: 36 },
    ]);
    expect(celleDiRiga("")).toEqual([]);
  });
});
