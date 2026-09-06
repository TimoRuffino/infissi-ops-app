// Anteprime delle evidenze (06/09/2026): gli estrattori scrivono la posizione
// del match e il localizzatore la trasforma in un'area della pagina. Il
// testo e la geometria vengono dalla stessa ricostruzione dei frammenti
// (righeConGeometriaDaElementi), come in produzione per un PDF nativo.

import { describe, expect, it } from "vitest";
import { annotaAreeEstrazione, estraiConfermaOrdine } from "./estrazioneConferma";
import { annotaAreeMerce, estraiRigheMerce } from "./estrazioneMerce";
import { evidenzeDelRiscontro, riscontroCommessaNelTesto } from "./riscontroCommessa";
import { righeConGeometriaDaElementi, type ElementoTesto } from "./testoPdf";

const el = (str: string, x: number, y: number): ElementoTesto => ({
  str,
  transform: [8, 0, 0, 8, x, y],
  width: str.length * 4.5,
  height: 8,
});
const misure = {
  larghezza: 600,
  altezza: 800,
  aVista: (x: number, y: number): [number, number] => [x, 800 - y],
};

const { testo, righe } = righeConGeometriaDaElementi(
  [
    el("CONFERMA D'ORDINE n. CO-556 del 19/02/2026", 40, 760),
    el("Vs. riferimento: GIACOMAZZI GIULIA", 40, 740),
    el("Pos", 40, 720), el("Descrizione", 70, 720), el("Q.tà", 330, 720), el("UM", 380, 720), el("Prezzo", 430, 720),
    el("10", 40, 700), el("Finestra 2 ante PVC 1200x1400", 70, 700), el("2", 330, 700), el("pz", 380, 700), el("350,00", 430, 700),
    el("Totale merce", 40, 660), el("7.762,25", 400, 660),
    el("Totale imponibile", 40, 640), el("7.762,25", 400, 640),
    el("IVA 22%", 40, 620), el("1.707,70", 400, 620),
    el("Totale documento", 40, 600), el("9.469,95", 400, 600),
  ],
  misure
);
const geometria = [{ larghezza: 600, altezza: 800, allineata: true, righe }];
const rigaCon = (parola: string) => righe.findIndex(r => r.tratti.some(t => t.testo.includes(parola)));

describe("le evidenze delle conferme portano la posizione e l'area", () => {
  it("l'imponibile punta alla riga «Totale imponibile», non a «Totale merce»", () => {
    const grezza = estraiConfermaOrdine([testo], { codiceOrdine: null, fornitoreNome: null, righeOrdine: [] });
    expect(grezza.imponibileDocumento?.valore).toBe(7762.25);
    expect(grezza.imponibileDocumento?.evidenza.posizione).toBeTruthy();
    const estrazione = annotaAreeEstrazione(grezza, geometria);
    const ev = estrazione.imponibileDocumento!.evidenza;
    expect(ev.area?.grado).toBe("riquadro");
    expect(ev.area?.riga?.y).toBeCloseTo(righe[rigaCon("imponibile")].y0 / 800, 3);
    expect(ev.area?.riga?.y).not.toBeCloseTo(righe[rigaCon("merce")].y0 / 800, 3);
    expect(estrazione.numeroConferma?.evidenza.area?.grado).toBe("riquadro");
    expect(estrazione.totaleDocumento?.evidenza.area?.grado).toBe("riquadro");
  });

  it("senza geometria le aree valgono «pagina» e i valori restano quelli", () => {
    const grezza = estraiConfermaOrdine([testo], { codiceOrdine: null, fornitoreNome: null, righeOrdine: [] });
    const estrazione = annotaAreeEstrazione(grezza, undefined);
    expect(estrazione.imponibileDocumento?.valore).toBe(grezza.imponibileDocumento?.valore);
    expect(estrazione.imponibileDocumento?.evidenza.area).toEqual({ grado: "pagina" });
  });

  it("le righe di merce si localizzano sulla loro riga", () => {
    const merce = annotaAreeMerce(estraiRigheMerce([testo]), geometria);
    expect(merce.length).toBeGreaterThan(0);
    expect(merce[0].nome).toContain("Finestra");
    expect(merce[0].area?.grado).toBe("riquadro");
    expect(merce[0].area?.riga?.y).toBeCloseTo(righe[rigaCon("Finestra")].y0 / 800, 3);
    expect(testo.slice(merce[0].posizione.inizio, merce[0].posizione.fine)).toContain("Finestra 2 ante");
  });

  it("le prove del riscontro ritrovano il cognome nel testo, con gli scarti veri", () => {
    const riscontro = riscontroCommessaNelTesto([testo], {
      codice: "COM-2026-393",
      cliente: "Giacomazzi Giulia",
      cognome: "Giacomazzi",
    });
    expect(riscontro.ok).toBe(true);
    const evidenze = evidenzeDelRiscontro([testo], riscontro);
    expect(evidenze.length).toBeGreaterThan(0);
    const cliente = evidenze.find(e => e.prova.startsWith("cliente"))!;
    expect(cliente.pagina).toBe(1);
    expect(testo.slice(cliente.posizione.inizio, cliente.posizione.fine).toLowerCase()).toContain("giacomazzi");
  });

  it("una prova con refuso e un ordine noto si ritrovano lo stesso", () => {
    const pagina = "Rif. cliente: GIACOMAZI Mario\nOrdine n. 26/34169 del 02/09/2026";
    // Un carattere di scarto sul cognome dell'anagrafica («giacomazzi»), come fa il riscontro.
    const conRefuso = evidenzeDelRiscontro([pagina], { prove: ["cliente ~giacomazzi", "ordine 2634169"] });
    expect(conRefuso.map(e => pagina.slice(e.posizione.inizio, e.posizione.fine))).toEqual(["GIACOMAZI", "26/34169"]);
    expect(evidenzeDelRiscontro([pagina], { prove: ["codice COM-2026-001"] })).toEqual([]);
  });
});
