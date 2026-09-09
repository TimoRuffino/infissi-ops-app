/**
 * Portare un pannello «sotto gli occhi» senza spostare la cornice.
 *
 * `scrollIntoView` scorre TUTTI gli antenati scorrevoli, compresi quelli con
 * `overflow: hidden` e il documento stesso. Nel regime desktop (≥ 1200 px)
 * la cornice del CRM non deve scorrere mai — html e body hanno
 * `overflow: hidden`, scorre solo il `main` — ma `scrollIntoView` la
 * trascinava comunque in su, di quanto bastava a portare il pannello al bordo
 * della finestra: sparivano il margine e la barra di contesto, e la rotella
 * non poteva riportarli giù. Qui si scorre UN contenitore solo: il primo
 * antenato che scorre davvero (`overflow-y: auto | scroll`), oppure il
 * documento quando non ce n'è (sotto i 1200 px il `main` non scorre).
 */

export type NodoScorribile = {
  tagName: string;
  parentElement: NodoScorribile | null;
};

/** Sotto la soglia il nodo è «già in cima»: non si tocca nulla. */
const TOLLERANZA_PX = 4;

/**
 * Il primo antenato che scorre per davvero. `null` vuol dire «il documento»:
 * body e html non contano come contenitori, perché il loro overflow è quello
 * della finestra e si governa con `window.scrollTo`.
 */
export function contenitoreScorrevole<N extends NodoScorribile>(
  nodo: N,
  leggiOverflowY: (n: N) => string
): N | null {
  let corrente = nodo.parentElement as N | null;
  while (corrente) {
    const tag = corrente.tagName.toUpperCase();
    if (tag === "BODY" || tag === "HTML") return null;
    const overflowY = leggiOverflowY(corrente);
    if (overflowY === "auto" || overflowY === "scroll") return corrente;
    corrente = corrente.parentElement as N | null;
  }
  return null;
}

/**
 * Di quanto deve scorrere il contenitore perché il bordo alto del nodo
 * coincida col suo (al netto dello `scroll-padding-top`, che è il posto di
 * una toolbar appiccicosa). Zero se è già lì.
 */
export function spostamentoInCima(misure: {
  nodoTop: number;
  contenitoreTop: number;
  scrollPaddingTop: number;
}): number {
  const delta = misure.nodoTop - misure.contenitoreTop - misure.scrollPaddingTop;
  return Math.abs(delta) <= TOLLERANZA_PX ? 0 : delta;
}

function scrollPaddingTopDi(elemento: Element): number {
  const valore = parseFloat(getComputedStyle(elemento).scrollPaddingTop);
  return Number.isFinite(valore) ? valore : 0;
}

/** Porta `nodo` in cima al SUO contenitore scorrevole, e a quello soltanto. */
export function portaInCima(nodo: HTMLElement): void {
  const ridotto =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const behavior: ScrollBehavior = ridotto ? "auto" : "smooth";
  const contenitore = contenitoreScorrevole(
    nodo,
    el => getComputedStyle(el).overflowY
  );
  const nodoTop = nodo.getBoundingClientRect().top;

  if (contenitore) {
    const delta = spostamentoInCima({
      nodoTop,
      contenitoreTop: contenitore.getBoundingClientRect().top,
      scrollPaddingTop: scrollPaddingTopDi(contenitore),
    });
    if (delta !== 0) contenitore.scrollBy({ top: delta, behavior });
    return;
  }

  const delta = spostamentoInCima({
    nodoTop,
    contenitoreTop: 0,
    scrollPaddingTop: scrollPaddingTopDi(document.documentElement),
  });
  if (delta !== 0) window.scrollBy({ top: delta, behavior });
}
