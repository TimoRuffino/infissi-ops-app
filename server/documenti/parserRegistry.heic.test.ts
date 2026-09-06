// La cascata di lettura con una foto HEIC (06/09/2026): si converte in JPEG
// in testa, poi l'OCR la legge come ogni altra foto e i riquadri delle
// parole ci sono. Un HEIC corrotto è «illeggibile» con il motivo. La prova
// con la foto vera vuole `sips` (macOS) e tesseract.

import { describe, expect, it } from "vitest";
import { heicDiProva } from "./heicDiProva";
import { disponibilitaOcr } from "./ocr";
import { estraiTestoDocumento } from "./parserRegistry";

const fotoVera = await heicDiProva(["CONFERMA D'ORDINE", "Totale imponibile EUR 1.234,00"]);
const binariPresenti = (await disponibilitaOcr()).disponibile;

describe("estraiTestoDocumento — HEIC", () => {
  it("un HEIC corrotto è illeggibile, con il motivo, senza chiamare l'OCR", async () => {
    const esito = await estraiTestoDocumento(Buffer.from("non è una foto"), "image/heic", "rotta.heic", {
      ocr: { lingue: "eng" },
    });
    expect(esito.esito).toBe("illeggibile");
    if (esito.esito === "illeggibile") {
      expect(esito.parser).toBe("immagine");
      expect(esito.motivo).toContain("Foto HEIC non convertibile");
    }
  });
});

describe.skipIf(!fotoVera || !binariPresenti)("estraiTestoDocumento — foto HEIC vera", { timeout: 120_000 }, () => {
  it("si converte in JPEG e l'OCR la legge, con i riquadri delle parole", async () => {
    const esito = await estraiTestoDocumento(fotoVera!, "image/heic", "IMG_0042.HEIC", { ocr: { lingue: "eng" } });
    expect(esito.esito).toBe("estratto");
    if (esito.esito !== "estratto") return;
    // Dopo l'OCR il parser riportato è quello del fallback, come per ogni foto.
    expect(esito.parser).toBe("pdf-ocr");
    expect(esito.ocr).not.toBeNull();
    const testo = esito.pagine.join("\n").toUpperCase();
    expect(testo).toContain("CONFERMA");
    expect(testo).toContain("IMPONIBILE");
    expect(esito.geometria?.[0]?.righe.length ?? 0).toBeGreaterThan(0);
  });
});
