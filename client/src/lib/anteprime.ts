// Anteprime delle evidenze («Dove l'ho letto», 06/09/2026): gli URL delle
// pagine rese e del PDF alla pagina, e il calcolo del ritaglio che la
// vignetta mostra. Funzioni pure, testate in vitest: il componente le
// applica e basta.
//
// Regole del ritaglio (spec §2): il ritaglio è la fascia di contesto (due
// righe sopra e due sotto la riga letta), a scala naturale o poco sotto e
// mai ingrandito oltre 1,25×; se la riga resterebbe più piccola del testo
// dell'interfaccia, la scala sale e la finestra si centra sul frammento,
// con i bordi sfumati a dire che c'è altro. «Pagina intera» mostra la
// pagina a tutta larghezza, con il rettangolo dove sta il frammento.

import type { FonteTesto, GradoPosizione, PosizioneEvidenza } from "@shared/documenti/evidenze";

export const LARGHEZZA_VIGNETTA_MIN = 480;
export const LARGHEZZA_VIGNETTA_MAX = 640;
export const SCALA_MASSIMA = 1.25;

export function urlPaginaDocumento(documentoId: number, pagina: number): string {
  return `/api/documenti/${documentoId}/pagina/${pagina}`;
}

/** Il visore del browser apre il PDF alla pagina: `#page=N` è lo standard dei PDF Open Parameters. */
export function urlPdfAllaPagina(documentoId: number, pagina: number): string {
  return `/api/documenti/${documentoId}/file#page=${Math.max(1, Math.floor(pagina))}`;
}

export type Ritaglio = {
  scala: number;
  larghezza: number;
  altezza: number;
  offsetX: number;
  offsetY: number;
  rettangolo: { left: number; top: number; width: number; height: number } | null;
  sfumaSinistra: boolean;
  sfumaDestra: boolean;
};

function clamp(valore: number, minimo: number, massimo: number): number {
  return Math.min(Math.max(valore, minimo), Math.max(minimo, massimo));
}

export function calcolaRitaglio(input: {
  posizione: PosizioneEvidenza | null;
  paginaIntera: boolean;
  larghezzaImmagine: number;
  altezzaImmagine: number;
  larghezzaVista: number;
  altezzaMassima: number;
  altezzaRigaMinima: number;
  scalaMassima?: number;
}): Ritaglio {
  const W = Math.max(1, input.larghezzaImmagine);
  const H = Math.max(1, input.altezzaImmagine);
  const V = Math.max(1, input.larghezzaVista);
  const scalaMassima = input.scalaMassima ?? SCALA_MASSIMA;
  const posizione = input.posizione;
  const frammento = posizione?.frammento ?? null;
  const fascia = posizione?.contesto ?? posizione?.riga ?? posizione?.frammento ?? null;
  const rettangoloA = (scala: number, offsetX: number, offsetY: number) =>
    frammento
      ? {
          left: frammento.x * W * scala - offsetX,
          top: frammento.y * H * scala - offsetY,
          width: frammento.w * W * scala,
          height: frammento.h * H * scala,
        }
      : null;

  if (input.paginaIntera || !posizione || posizione.grado === "pagina" || !fascia) {
    const scala = V / W;
    const altezza = Math.min(input.altezzaMassima, H * scala);
    // Con un frammento noto la pagina intera parte già dal suo punto.
    const offsetY = frammento
      ? clamp((frammento.y + frammento.h / 2) * H * scala - altezza / 2, 0, H * scala - altezza)
      : 0;
    return {
      scala,
      larghezza: V,
      altezza,
      offsetX: 0,
      offsetY,
      rettangolo: rettangoloA(scala, 0, offsetY),
      sfumaSinistra: false,
      sfumaDestra: false,
    };
  }

  let scala = Math.min(scalaMassima, V / (fascia.w * W));
  const riga = posizione.riga ?? posizione.frammento ?? null;
  if (riga && riga.h * H * scala < input.altezzaRigaMinima) {
    scala = Math.min(scalaMassima, input.altezzaRigaMinima / (riga.h * H));
  }
  const larghezzaContenuto = fascia.w * W * scala;
  const larghezzaTotale = W * scala;
  let offsetX: number;
  let sfumaSinistra = false;
  let sfumaDestra = false;
  if (larghezzaContenuto <= V) {
    // La fascia ci sta: si centra, e il resto della riga fa da contesto.
    offsetX = clamp(fascia.x * W * scala - (V - larghezzaContenuto) / 2, 0, larghezzaTotale - V);
  } else {
    const centro = frammento ? frammento.x + frammento.w / 2 : fascia.x + fascia.w / 2;
    offsetX = clamp(centro * W * scala - V / 2, 0, larghezzaTotale - V);
    sfumaSinistra = offsetX > 0.5;
    sfumaDestra = offsetX + V < larghezzaTotale - 0.5;
  }
  const altezza = Math.min(input.altezzaMassima, fascia.h * H * scala);
  const offsetY = clamp(fascia.y * H * scala, 0, Math.max(0, H * scala - altezza));
  return {
    scala,
    larghezza: V,
    altezza,
    offsetX,
    offsetY,
    rettangolo: rettangoloA(scala, offsetX, offsetY),
    sfumaSinistra,
    sfumaDestra,
  };
}

/**
 * Quanto larga conviene fare la vignetta (fra 480 e 640 px) perché la riga
 * letta resti leggibile senza tagliare la fascia: la larghezza che la
 * fascia occuperebbe alla scala minima di lettura.
 */
export function larghezzaConsigliata(input: {
  posizione: PosizioneEvidenza | null;
  larghezzaImmagine: number;
  altezzaImmagine: number;
  altezzaRigaMinima: number;
}): number {
  const fascia = input.posizione?.contesto ?? input.posizione?.riga ?? null;
  const riga = input.posizione?.riga ?? null;
  if (!fascia || !riga) return LARGHEZZA_VIGNETTA_MIN;
  const scalaRiga = Math.min(SCALA_MASSIMA, input.altezzaRigaMinima / Math.max(1e-6, riga.h * input.altezzaImmagine));
  const necessaria = fascia.w * input.larghezzaImmagine * scalaRiga;
  return Math.round(clamp(necessaria, LARGHEZZA_VIGNETTA_MIN, LARGHEZZA_VIGNETTA_MAX));
}

export function etichettaFonte(fonte: FonteTesto | null | undefined, confidenzaOcr?: number | null): string {
  switch (fonte) {
    case "testo_pdf":
      return "testo nativo";
    case "ocr":
      return confidenzaOcr != null ? `OCR ${Math.round(confidenzaOcr)}%` : "OCR";
    case "visione":
      return "trascrizione del modello";
    default:
      return "fonte non registrata";
  }
}

export function etichettaGrado(grado: GradoPosizione | null | undefined): string {
  switch (grado) {
    case "riquadro":
      return "riquadro";
    case "zona":
      return "zona";
    default:
      return "pagina intera";
  }
}
