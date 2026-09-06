import { describe, expect, it } from "vitest";
import {
  calcolaRitaglio,
  etichettaFonte,
  etichettaGrado,
  larghezzaConsigliata,
  urlPaginaDocumento,
  urlPdfAllaPagina,
} from "./anteprime";

const posizione = {
  grado: "riquadro" as const,
  frammento: { x: 0.8, y: 0.16, w: 0.1, h: 0.02 },
  riga: { x: 0.05, y: 0.16, w: 0.85, h: 0.02 },
  contesto: { x: 0, y: 0.1, w: 1, h: 0.14 },
};

describe("calcolaRitaglio", () => {
  it("la fascia di contesto entra tutta nella vista quando ci sta, con il rettangolo sul frammento", () => {
    const r = calcolaRitaglio({
      posizione,
      paginaIntera: false,
      larghezzaImmagine: 1240,
      altezzaImmagine: 1754,
      larghezzaVista: 480,
      altezzaMassima: 400,
      altezzaRigaMinima: 12,
    });
    expect(r.scala).toBeCloseTo(480 / 1240, 4);
    expect(r.offsetX).toBe(0);
    expect(r.offsetY).toBeCloseTo(0.1 * 1754 * r.scala, 3);
    expect(r.altezza).toBeCloseTo(0.14 * 1754 * r.scala, 3);
    expect(r.rettangolo!.left).toBeCloseTo(0.8 * 1240 * r.scala, 3);
    expect(r.rettangolo!.top).toBeCloseTo((0.16 - 0.1) * 1754 * r.scala, 3);
    expect(r.sfumaSinistra).toBe(false);
    expect(r.sfumaDestra).toBe(false);
  });

  it("se la riga resterebbe illeggibile la scala sale e la finestra si centra sul frammento", () => {
    const r = calcolaRitaglio({
      posizione,
      paginaIntera: false,
      larghezzaImmagine: 1240,
      altezzaImmagine: 1754,
      larghezzaVista: 320,
      altezzaMassima: 400,
      altezzaRigaMinima: 14,
    });
    expect(0.02 * 1754 * r.scala).toBeGreaterThanOrEqual(14 - 1e-6);
    expect(r.offsetX).toBeGreaterThan(0);
    expect(r.sfumaSinistra).toBe(true);
    // Il frammento resta dentro la vista.
    expect(r.rettangolo!.left).toBeGreaterThanOrEqual(0);
    expect(r.rettangolo!.left + r.rettangolo!.width).toBeLessThanOrEqual(320 + 1e-6);
  });

  it("se la fascia non ci sta ma la riga sì, mostra la riga intera: etichetta e valore insieme", () => {
    // Riga da x=0,07 larga 0,74; a 1240 px e scala forzata dalla riga (13/(0,015·1754)=0,494) la riga è 453 px, la fascia intera 613.
    const r = calcolaRitaglio({
      posizione: {
        grado: "riquadro",
        frammento: { x: 0.72, y: 0.6, w: 0.09, h: 0.015 },
        riga: { x: 0.07, y: 0.6, w: 0.74, h: 0.015 },
        contesto: { x: 0, y: 0.55, w: 1, h: 0.1 },
      },
      paginaIntera: false,
      larghezzaImmagine: 1240,
      altezzaImmagine: 1754,
      larghezzaVista: 480,
      altezzaMassima: 400,
      altezzaRigaMinima: 13,
    });
    const larghezzaRiga = 0.74 * 1240 * r.scala;
    expect(larghezzaRiga).toBeLessThanOrEqual(480);
    // L'inizio della riga è dentro la vista, e anche la sua fine.
    const inizioRiga = 0.07 * 1240 * r.scala - r.offsetX;
    expect(inizioRiga).toBeGreaterThanOrEqual(0);
    expect(inizioRiga + larghezzaRiga).toBeLessThanOrEqual(480 + 1e-6);
    expect(r.sfumaSinistra).toBe(true);
  });

  it("non ingrandisce mai oltre 1,25 volte", () => {
    const r = calcolaRitaglio({
      posizione,
      paginaIntera: false,
      larghezzaImmagine: 300,
      altezzaImmagine: 400,
      larghezzaVista: 640,
      altezzaMassima: 400,
      altezzaRigaMinima: 40,
    });
    expect(r.scala).toBeCloseTo(1.25, 6);
  });

  it("pagina intera: tutta la larghezza, altezza limitata, e parte dal frammento", () => {
    const r = calcolaRitaglio({
      posizione,
      paginaIntera: true,
      larghezzaImmagine: 1240,
      altezzaImmagine: 1754,
      larghezzaVista: 480,
      altezzaMassima: 400,
      altezzaRigaMinima: 12,
    });
    expect(r.offsetX).toBe(0);
    expect(r.altezza).toBe(400);
    expect(r.scala).toBeCloseTo(480 / 1240, 4);
    expect(r.offsetY).toBeGreaterThanOrEqual(0);
    expect(r.rettangolo).not.toBeNull();
  });

  it("senza posizione, o con grado «pagina», è la pagina intera dall'alto", () => {
    const r = calcolaRitaglio({
      posizione: { grado: "pagina" },
      paginaIntera: false,
      larghezzaImmagine: 1000,
      altezzaImmagine: 500,
      larghezzaVista: 500,
      altezzaMassima: 400,
      altezzaRigaMinima: 12,
    });
    expect(r).toMatchObject({ scala: 0.5, offsetX: 0, offsetY: 0, altezza: 250, rettangolo: null });
  });
});

describe("larghezzaConsigliata ed etichette", () => {
  it("resta fra 480 e 640 e cresce quando la fascia è larga alla scala di lettura", () => {
    expect(larghezzaConsigliata({ posizione: null, larghezzaImmagine: 1240, altezzaImmagine: 1754, altezzaRigaMinima: 13 })).toBe(480);
    const larga = larghezzaConsigliata({ posizione, larghezzaImmagine: 1240, altezzaImmagine: 1754, altezzaRigaMinima: 13 });
    expect(larga).toBeGreaterThanOrEqual(480);
    expect(larga).toBeLessThanOrEqual(640);
  });

  it("gli URL puntano alla pagina resa e al PDF alla pagina giusta", () => {
    expect(urlPaginaDocumento(12, 3)).toBe("/api/documenti/12/pagina/3");
    expect(urlPdfAllaPagina(12, 3)).toBe("/api/documenti/12/file#page=3");
    expect(urlPdfAllaPagina(12, 0)).toBe("/api/documenti/12/file#page=1");
  });

  it("le etichette dicono fonte e grado a parole", () => {
    expect(etichettaFonte("testo_pdf")).toBe("testo nativo");
    expect(etichettaFonte("ocr", 91.4)).toBe("OCR 91%");
    expect(etichettaFonte("visione")).toBe("trascrizione del modello");
    expect(etichettaFonte(null)).toBe("fonte non registrata");
    expect(etichettaGrado("riquadro")).toBe("riquadro");
    expect(etichettaGrado(null)).toBe("pagina intera");
  });
});
