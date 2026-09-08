/**
 * Geometria condivisa del marchio Wyndoor.
 *
 * Il segno normativo (l'anta fissa più l'anta in apertura, vedi
 * client/src/components/brand/WyndoorMark.tsx e client/public/favicon.svg)
 * vive in un riquadro 82×90 — più alto che largo — ancorato a (9, 5) nel
 * sistema di coordinate del tracciato: `viewBox="9 5 82 90"`.
 *
 * `inquadraturaIcona` calcola come inscrivere quel riquadro, centrato su
 * entrambi gli assi e con un margine (`RESPIRO_ICONA`) sul lato più lungo,
 * dentro un'icona quadrata di lato `lato` (apple-touch-icon a 180,
 * icon-192 a 192).
 *
 * La scala nasce dal lato PIÙ LUNGO del riquadro (qui: l'altezza, 90), mai
 * dalla larghezza da sola. Una versione precedente scalava sulla sola
 * larghezza (82) e applicava lo stesso fattore anche in verticale: un
 * riquadro non quadrato scalato così eccede lo slot quadrato sull'asse
 * lungo di circa il 10%, e quell'eccesso — con un offset calcolato
 * sull'angolo anziché centrato — si scaricava tutto sul margine inferiore
 * (margine superiore quasi doppio dell'inferiore sui PNG generati).
 * Scalare sul lato più lungo garantisce che ENTRAMBI gli assi restino
 * dentro lo slot quadrato; centrare esplicitamente ogni asse (invece di
 * ancorare un angolo) distribuisce il margine in modo simmetrico.
 *
 * Conseguenza voluta, non un difetto: poiché il segno è più alto (90) che
 * largo (82), il margine risulta esattamente RESPIRO_ICONA sull'asse
 * verticale (il lato lungo, quello che determina la scala) e MAGGIORE di
 * RESPIRO_ICONA sull'asse orizzontale (il lato corto, che eredita la
 * stessa scala pur avendo meno contenuto da riempire). Forzare lo stesso
 * respiro su entrambi gli assi deformerebbe il marchio: non è quello che
 * fa questa funzione, e non deve diventarlo.
 */
export interface RiquadroSegno {
  x: number;
  y: number;
  larghezza: number;
  altezza: number;
}

/** Riquadro canonico del segno: lo stesso viewBox="9 5 82 90" della favicon. */
export const RIQUADRO_SEGNO: RiquadroSegno = { x: 9, y: 5, larghezza: 82, altezza: 90 };

/** Margine, in proporzione al lato dell'icona, sul lato più lungo del segno. */
export const RESPIRO_ICONA = 0.12;

export interface InquadraturaIcona {
  scala: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Scala e offset per comporre `<g transform="translate(offsetX offsetY)
 * scale(scala)">` attorno al tracciato del segno (nelle coordinate del suo
 * viewBox), così che risulti centrato e inscritto in un'icona quadrata di
 * lato `lato`.
 */
export function inquadraturaIcona(lato: number): InquadraturaIcona {
  const { x, y, larghezza, altezza } = RIQUADRO_SEGNO;
  const contenuto = lato * (1 - RESPIRO_ICONA * 2);
  const scala = contenuto / Math.max(larghezza, altezza);
  const offsetX = (lato - larghezza * scala) / 2 - x * scala;
  const offsetY = (lato - altezza * scala) / 2 - y * scala;
  return { scala, offsetX, offsetY };
}
