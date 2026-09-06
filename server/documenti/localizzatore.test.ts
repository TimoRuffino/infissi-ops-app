// Localizzatore delle evidenze (06/09/2026): da «dove nel testo» a «dove
// nella pagina». Funzioni pure su una geometria costruita a mano: nessun
// PDF, nessun binario.

import { describe, expect, it } from "vitest";
import type { GeometriaPagina } from "@shared/documenti/evidenze";
import { annotaEvidenza, localizzaFrammento, localizzaOffset } from "./localizzatore";

const riga = (
  inizio: number,
  y0: number,
  parole: Array<[string, number, number]>
): GeometriaPagina["righe"][number] => {
  let scarto = 0;
  const tratti = parole.map(([testo, x0, x1]) => {
    const t = { testo, inizio: scarto, fine: scarto + testo.length, x0, x1 };
    scarto += testo.length + 1;
    return t;
  });
  return { inizio, y0, y1: y0 + 20, tratti };
};

const testo = [
  "Sconto 5% -388,11",
  "Totale merce 7.762,25",
  "Totale imponibile 7.762,25",
  "IVA 22% 1.707,70",
  "Totale documento 9.469,95",
];
const inizi = testo.reduce<number[]>(
  (acc, _r, i) => [...acc, i === 0 ? 0 : acc[i - 1] + testo[i - 1].length + 1],
  []
);
const geo: GeometriaPagina = {
  larghezza: 1000,
  altezza: 1000,
  allineata: true,
  righe: [
    riga(inizi[0], 100, [["Sconto", 50, 110], ["5%", 120, 150], ["-388,11", 800, 900]]),
    riga(inizi[1], 130, [["Totale", 50, 110], ["merce", 120, 180], ["7.762,25", 800, 900]]),
    riga(inizi[2], 160, [["Totale", 50, 110], ["imponibile", 120, 220], ["7.762,25", 800, 900]]),
    riga(inizi[3], 190, [["IVA", 50, 90], ["22%", 100, 140], ["1.707,70", 800, 900]]),
    riga(inizi[4], 220, [["Totale", 50, 110], ["documento", 120, 220], ["9.469,95", 800, 900]]),
  ],
};
const pagina = testo.join("\n");

describe("localizzaOffset — geometria allineata", () => {
  it("lo stesso «7.762,25» su due righe: gli scarti scelgono la riga letta", () => {
    const inizio = pagina.indexOf("7.762,25", pagina.indexOf("imponibile"));
    const pos = localizzaOffset(geo, inizio, inizio + "7.762,25".length)!;
    expect(pos.grado).toBe("riquadro");
    expect(pos.frammento).toEqual({ x: 0.8, y: 0.16, w: 0.1, h: 0.02 });
    expect(pos.riga).toMatchObject({ x: 0.05, y: 0.16, h: 0.02 });
    // Due righe sopra e due sotto: dalla riga «Sconto» alla riga «Totale documento».
    expect(pos.contesto).toMatchObject({ x: 0, w: 1, y: 0.1, h: 0.14 });
  });

  it("in cima alla pagina il contesto si ferma alla prima riga", () => {
    const pos = localizzaOffset(geo, 0, 6)!;
    // Righe 0..2: da 100 a 180 su 1000.
    expect(pos.contesto).toMatchObject({ y: 0.1, h: 0.08 });
  });

  it("fuori dal testo → null, e su una geometria non allineata → null", () => {
    expect(localizzaOffset(geo, 10_000, 10_010)).toBeNull();
    expect(localizzaOffset({ ...geo, allineata: false }, 0, 6)).toBeNull();
  });
});

describe("localizzaFrammento — geometria non allineata (trascrizione del modello)", () => {
  const nonAllineata = { ...geo, allineata: false };

  it("trova le parole con cifre esatte e una lettera di scarto", () => {
    const pos = localizzaFrammento(nonAllineata, "Totale imponibbile 7.762,25")!;
    expect(pos.grado).toBe("riquadro");
    expect(pos.frammento).toEqual({ x: 0.05, y: 0.16, w: 0.85, h: 0.02 });
  });

  it("una cifra diversa non è la stessa cosa, e un frammento vuoto non trova niente", () => {
    expect(localizzaFrammento(nonAllineata, "Totale imponibile 7.762,26")).toBeNull();
    expect(localizzaFrammento(nonAllineata, "   ")).toBeNull();
  });

  it("un frammento più lungo della riga si accontenta della parte che trova sulla stessa riga", () => {
    const pos = localizzaFrammento(nonAllineata, "IVA 22% 1.707,70 Totale documento");
    expect(pos?.grado).toBe("riquadro");
    expect(pos?.riga).toMatchObject({ y: 0.19 });
  });
});

describe("annotaEvidenza", () => {
  it("senza geometria è la pagina intera; con posizione è il riquadro; con frammento sintetico è la pagina", () => {
    expect(annotaEvidenza(undefined, { pagina: 1, frammento: "x" })).toEqual({ grado: "pagina" });
    expect(annotaEvidenza([null], { pagina: 1, frammento: "x" })).toEqual({ grado: "pagina" });
    const inizio = pagina.indexOf("1.707,70");
    expect(
      annotaEvidenza([geo], {
        pagina: 1,
        frammento: "IVA 22% 1.707,70",
        posizione: { inizio, fine: inizio + 8 },
      }).grado
    ).toBe("riquadro");
    expect(
      annotaEvidenza([geo], { pagina: 1, frammento: "somma di 3 conferme nel file: 1 + 2 + 3" })
        .grado
    ).toBe("pagina");
  });

  it("con una posizione che non regge cade sul frammento, poi sulla pagina", () => {
    const daFrammento = annotaEvidenza([geo], {
      pagina: 1,
      frammento: "Totale documento 9.469,95",
      posizione: { inizio: 99_999, fine: 100_005 },
    });
    expect(daFrammento.grado).toBe("riquadro");
    expect(daFrammento.riga).toMatchObject({ y: 0.22 });
    expect(annotaEvidenza([geo], { pagina: 2, frammento: "Totale" })).toEqual({ grado: "pagina" });
  });
});
