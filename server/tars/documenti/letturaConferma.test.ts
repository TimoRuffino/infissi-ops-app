// Leggere e capire la conferma allegata: il PDF che cita la commessa
// scioglie il dubbio del nome file; la scansione illeggibile lo dichiara
// invece di inventare; l'imponibile è il numero che conta.

import { describe, expect, it } from "vitest";
import {
  leggiConfermaAllegata,
  type DipendenzeLettura,
} from "./letturaConferma";

const comunicazione: any = {
  id: 900,
  sedeId: 1,
  canale: "email",
  mittente: "ordini@tesconi.it",
  mittenteNome: "Tesconi",
  allegati: [{ nome: "Conferma_4471.pdf", mimeType: "application/pdf", size: 1000 }],
};

function deps(parziale: Partial<DipendenzeLettura> = {}): DipendenzeLettura {
  return {
    leggiAllegato: async () => ({
      buffer: Buffer.from("%PDF-1.4"),
      nome: "Conferma_4471.pdf",
      mimeType: "application/pdf",
    }),
    estraiTesto: async () => ({
      pagine: [
        "TESCONI SRL — Conferma d'ordine n. 4471 del 28/08/2026",
        "Rif. vostro ordine COM-2026-010",
        "Consegna prevista: 20/09/2026",
        "Totale imponibile: € 3.500,00  IVA 22%: € 770,00  Totale documento: € 4.270,00",
      ],
      daOcr: false,
      avvertenze: [],
    }),
    ...parziale,
  };
}

describe("leggiConfermaAllegata", () => {
  it("legge fornitore, riferimento, consegna e imponibile; riconosce la commessa citata", async () => {
    const lettura = await leggiConfermaAllegata({
      comunicazione,
      allegatoIndex: 0,
      codiceCommessa: "COM-2026-010",
      deps: deps(),
    });

    expect(lettura.fonteTesto).toBe("testo_pdf");
    expect(lettura.citaLaCommessa).toBe(true);
    expect(lettura.estrazione?.imponibileDocumento?.valore).toBe(3500);
    expect(lettura.estrazione?.totaleDocumento?.valore).toBe(4270);
    expect(lettura.estrazione?.dateConsegna[0]?.valore).toBe("2026-09-20");
    // L'imponibile c'è: nessuna avvertenza sul costo da confermare a mano.
    expect(lettura.avvertenze.join(" ")).not.toContain("non l'imponibile");
  });

  it("un documento che parla di un'altra commessa non la conferma", async () => {
    const lettura = await leggiConfermaAllegata({
      comunicazione,
      allegatoIndex: 0,
      codiceCommessa: "COM-2026-999",
      deps: deps(),
    });
    expect(lettura.citaLaCommessa).toBe(false);
  });

  it("dall'OCR il testo si usa, ma l'avvertenza dice di verificare gli importi", async () => {
    const lettura = await leggiConfermaAllegata({
      comunicazione,
      allegatoIndex: 0,
      codiceCommessa: "COM-2026-010",
      deps: deps({
        estraiTesto: async () => ({
          pagine: ["Conferma ordine COM-2026-010 Totale imponibile 1.000,00"],
          daOcr: true,
          avvertenze: [],
        }),
      }),
    });
    expect(lettura.fonteTesto).toBe("ocr");
    expect(lettura.citaLaCommessa).toBe(true);
    expect(lettura.avvertenze.join(" ")).toContain("OCR");
  });

  it("scansione illeggibile: lo dichiara e non inventa nessun dato", async () => {
    const lettura = await leggiConfermaAllegata({
      comunicazione,
      allegatoIndex: 0,
      codiceCommessa: "COM-2026-010",
      deps: deps({
        estraiTesto: async () => ({
          pagine: null,
          motivo: "PDF scansionato e OCR non riuscito.",
        }),
      }),
    });
    expect(lettura.fonteTesto).toBe("nessuna");
    expect(lettura.estrazione).toBeNull();
    expect(lettura.citaLaCommessa).toBe(false);
    expect(lettura.avvertenze.join(" ")).toContain("a mano");
  });

  it("totale senza imponibile: avverte che il costo va confermato, non lo scorpora", async () => {
    const lettura = await leggiConfermaAllegata({
      comunicazione,
      allegatoIndex: 0,
      deps: deps({
        estraiTesto: async () => ({
          pagine: ["Conferma ordine 4471", "Totale documento: € 4.270,00"],
          daOcr: false,
          avvertenze: [],
        }),
      }),
    });
    expect(lettura.estrazione?.totaleDocumento?.valore).toBe(4270);
    expect(lettura.estrazione?.imponibileDocumento).toBeNull();
    expect(lettura.avvertenze.join(" ")).toContain("non l'imponibile");
  });
});
