import { describe, expect, it } from "vitest";
import {
  contenitoreScorrevole,
  spostamentoInCima,
  type NodoScorribile,
} from "./scorrimento";

/**
 * Un albero finto: niente DOM in questo ambiente (vitest gira in `node`),
 * quindi la catena degli antenati e la lettura di `overflow-y` sono
 * iniettate. È proprio la decisione «chi scorre» che qui va inchiodata.
 */
function catena(
  ...livelli: Array<{ nome: string; overflowY: string }>
): { nodo: NodoScorribile; overflow: (n: NodoScorribile) => string } {
  const mappa = new Map<NodoScorribile, string>();
  let genitore: NodoScorribile | null = null;
  // Dal più esterno (html) al più interno (il nodo da portare in vista).
  for (const livello of [...livelli].reverse()) {
    const corrente: NodoScorribile = {
      tagName: livello.nome.toUpperCase(),
      parentElement: genitore,
    };
    mappa.set(corrente, livello.overflowY);
    genitore = corrente;
  }
  return { nodo: genitore!, overflow: n => mappa.get(n) ?? "visible" };
}

describe("contenitoreScorrevole", () => {
  it("sceglie il primo antenato che scorre davvero, e non quelli con overflow hidden", () => {
    const { nodo, overflow } = catena(
      { nome: "div", overflowY: "visible" }, // il nodo
      { nome: "div", overflowY: "visible" },
      { nome: "main", overflowY: "auto" }, // l'area di lavoro
      { nome: "div", overflowY: "hidden" }, // la cornice: NON deve scorrere
      { nome: "body", overflowY: "hidden" },
      { nome: "html", overflowY: "hidden" }
    );
    const scelto = contenitoreScorrevole(nodo, overflow);
    expect(scelto?.tagName).toBe("MAIN");
  });

  it("ignora la cornice con overflow hidden anche quando sta sotto il nodo e sopra il main", () => {
    const { nodo, overflow } = catena(
      { nome: "div", overflowY: "visible" },
      { nome: "section", overflowY: "hidden" }, // un riquadro che ritaglia
      { nome: "main", overflowY: "scroll" },
      { nome: "body", overflowY: "visible" }
    );
    expect(contenitoreScorrevole(nodo, overflow)?.tagName).toBe("MAIN");
  });

  it("risponde null quando scorre il documento: body e html non contano come contenitori", () => {
    const { nodo, overflow } = catena(
      { nome: "div", overflowY: "visible" },
      { nome: "main", overflowY: "visible" }, // sotto i 1200 px il main non scorre
      { nome: "div", overflowY: "visible" },
      { nome: "body", overflowY: "auto" },
      { nome: "html", overflowY: "auto" }
    );
    expect(contenitoreScorrevole(nodo, overflow)).toBeNull();
  });

  it("overflow clip non è un contenitore scorrevole", () => {
    const { nodo, overflow } = catena(
      { nome: "div", overflowY: "visible" },
      { nome: "div", overflowY: "clip" },
      { nome: "body", overflowY: "visible" }
    );
    expect(contenitoreScorrevole(nodo, overflow)).toBeNull();
  });
});

describe("spostamentoInCima", () => {
  it("è la distanza fra il bordo alto del nodo e quello del contenitore, meno lo scroll-padding", () => {
    expect(
      spostamentoInCima({ nodoTop: 500, contenitoreTop: 88, scrollPaddingTop: 0 })
    ).toBe(412);
    expect(
      spostamentoInCima({ nodoTop: 500, contenitoreTop: 0, scrollPaddingTop: 64 })
    ).toBe(436);
  });

  it("risponde 0 quando il nodo è già in cima: non si tocca nulla", () => {
    expect(
      spostamentoInCima({ nodoTop: 91, contenitoreTop: 88, scrollPaddingTop: 0 })
    ).toBe(0);
    expect(
      spostamentoInCima({ nodoTop: 85, contenitoreTop: 88, scrollPaddingTop: 0 })
    ).toBe(0);
  });

  it("può essere negativo: il nodo sta sopra e il contenitore torna indietro", () => {
    expect(
      spostamentoInCima({ nodoTop: 10, contenitoreTop: 88, scrollPaddingTop: 0 })
    ).toBe(-78);
  });
});
