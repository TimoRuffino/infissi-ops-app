// Geometria dell'icona del marchio: verifica pura sulla matematica di
// inquadraturaIcona, non sui PNG generati.
//
// Il riquadro del segno (viewBox="9 5 82 90" della favicon) non è quadrato:
// è più alto (90) che largo (82). Una versione precedente di questa
// funzione calcolava la scala sulla sola larghezza e applicava lo stesso
// fattore anche in verticale: il contenuto scalato eccedeva lo slot
// quadrato sull'asse lungo, e l'eccesso si scaricava tutto sul margine
// inferiore (l'unico offset ancorato all'angolo del viewBox, non centrato
// sull'asse). Questi test bloccano quella regressione verificando i
// margini per più lati dell'icona.
import { describe, expect, it } from "vitest";
import { inquadraturaIcona, RESPIRO_ICONA, RIQUADRO_SEGNO } from "./marchio";

/** Margini (in px dell'icona) fra il riquadro trasformato e i quattro lati. */
function margini(lato: number) {
  const { scala, offsetX, offsetY } = inquadraturaIcona(lato);
  const { x, y, larghezza, altezza } = RIQUADRO_SEGNO;
  return {
    sinistro: offsetX + x * scala,
    destro: lato - (offsetX + (x + larghezza) * scala),
    superiore: offsetY + y * scala,
    inferiore: lato - (offsetY + (y + altezza) * scala),
  };
}

const LATI = [180, 192];

describe("inquadraturaIcona", () => {
  it.each(LATI)("centra il segno su entrambi gli assi (lato %d)", (lato) => {
    const { sinistro, destro, superiore, inferiore } = margini(lato);
    expect(sinistro).toBeCloseTo(destro, 6);
    expect(superiore).toBeCloseTo(inferiore, 6);
  });

  it.each(LATI)(
    "rispetta esattamente il respiro dichiarato sul lato lungo del riquadro (lato %d)",
    (lato) => {
      // L'altezza (90) è il lato lungo di RIQUADRO_SEGNO (82×90): la scala
      // nasce da lei, quindi il margine verticale è esattamente RESPIRO_ICONA.
      const { superiore, inferiore } = margini(lato);
      expect(superiore).toBeCloseTo(lato * RESPIRO_ICONA, 6);
      expect(inferiore).toBeCloseTo(lato * RESPIRO_ICONA, 6);
    }
  );

  it.each(LATI)(
    "lascia più margine sul lato corto del riquadro che su quello lungo (lato %d)",
    (lato) => {
      const { sinistro, superiore } = margini(lato);
      expect(sinistro).toBeGreaterThan(superiore);
    }
  );

  it.each(LATI)("non fa mai uscire il segno dall'icona (lato %d)", (lato) => {
    const { sinistro, destro, superiore, inferiore } = margini(lato);
    expect(sinistro).toBeGreaterThanOrEqual(0);
    expect(destro).toBeGreaterThanOrEqual(0);
    expect(superiore).toBeGreaterThanOrEqual(0);
    expect(inferiore).toBeGreaterThanOrEqual(0);
  });
});
