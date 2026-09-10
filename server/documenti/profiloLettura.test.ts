// L'ancora vince sul generico quando trova; quando non trova, il generico
// resta. Un profilo che svuota un campo sarebbe un costo fornitore mancante.
import { describe, expect, it } from "vitest";
import type { AncoraCampo } from "@shared/documenti/profilo";
import { estraiConfermaOrdine } from "./estrazioneConferma";
import { applicaAncore } from "./profiloLettura";

const PAGINE = [
  [
    "ALIAS Srl Porte blindate",
    "Nostro rif. 777888 del 01/03/2026",
    "2026 - CV 1602923 23/02/2026",
    "Totale imponibile: EUR 948,73",
  ].join("\n"),
];

const contesto = { codiceOrdine: null, fornitoreNome: null, righeOrdine: [] };

describe("applicaAncore", () => {
  it("l'ancora porta il valore che indica, con la sua evidenza", () => {
    const generico = estraiConfermaOrdine(PAGINE, contesto);
    const ancore: AncoraCampo[] = [
      { campo: "numeroConferma", etichetta: "CV", posizione: "dopo_etichetta", forma: "numero", pagina: 1 },
    ];
    const conProfilo = applicaAncore(generico, PAGINE, ancore);
    expect(conProfilo.numeroConferma?.valore).toBe("1602923");
    expect(conProfilo.numeroConferma?.evidenza.pagina).toBe(1);
    expect(conProfilo.numeroConferma?.evidenza.frammento).toContain("1602923");
  });

  it("un'ancora che non trova niente non svuota il campo del generico", () => {
    const generico = estraiConfermaOrdine(PAGINE, contesto);
    const prima = generico.imponibileDocumento?.valore ?? null;
    const ancore: AncoraCampo[] = [
      { campo: "imponibileDocumento", etichetta: "NON ESISTE", posizione: "dopo_etichetta", forma: "importo", pagina: 1 },
    ];
    const dopo = applicaAncore(generico, PAGINE, ancore);
    expect(dopo.imponibileDocumento?.valore ?? null).toBe(prima);
  });

  it("la forma attesa salta la parola e prende il numero", () => {
    const generico = estraiConfermaOrdine(PAGINE, contesto);
    // Dopo «imponibile» c'è «: EUR », poi la cifra.
    const ancore: AncoraCampo[] = [
      { campo: "imponibileDocumento", etichetta: "imponibile", posizione: "dopo_etichetta", forma: "importo", pagina: 1 },
    ];
    expect(applicaAncore(generico, PAGINE, ancore).imponibileDocumento?.valore).toBe(948.73);
  });

  it("nessuna ancora: l'estrazione torna identica", () => {
    const generico = estraiConfermaOrdine(PAGINE, contesto);
    expect(applicaAncore(generico, PAGINE, [])).toEqual(generico);
  });
});
