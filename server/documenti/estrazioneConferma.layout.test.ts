// Layout REALI di conferme d'ordine (04/09/2026, quindici file di fornitori
// diversi), riprodotti come li restituisce la ricostruzione geometrica:
// righe a celle, valori sotto le etichette, riquadri totali senza etichetta
// accanto. Nomi dei clienti cambiati. Ciò che una persona ci legge in un
// secondo — fornitore, numero, riferimento, consegna, IMPONIBILE — deve
// leggerlo anche l'estrattore.

import { describe, expect, it } from "vitest";
import { estraiConfermaOrdine } from "./estrazioneConferma";

const contesto = { codiceOrdine: null, fornitoreNome: null, righeOrdine: [] as const };

describe("BT Glass — colonna sinistra e destra sulla stessa riga, totali a riquadro", () => {
  const pagina1 = [
    "BT GLASS Srl                                                     Spett.le",
    "Sede legale: Via C.M. Maggi , 41-20855 Lesmo (Mb) Italy          RUFFINO GROUP SRLS",
    "Tel. +39 039 6902848 - F.ax +39 039 6902943                      Via Francesco Crispi 135",
    "P.I. / CF 01057680165 - Cap.Soc 15.600,00 I.V.- REA MB1912045",
    "Destinazione merce",
    "Conferma d'ordine                                                RUFFINO GROUP SRLS",
    "N. 000183 del 12/03/2026                                         Via A. Casale 1",
    "Agente                DOOR DESIGN SRL                            19037   SANTO STEFANO DI MAGRA   SP",
    "Vs. riferimento:      Bianchi",
    "Banca:                INTESA SANPAOLO SPA",
    "Data consegna prevista:   20/04/26   Sett. 17 ARANCIONE",
    "Codice   Descrizione                     um   quantità   sconto        importo IVA",
    "G71      SISTEMA SCORREVOLE TUTTOVETRO   PZ   1,00   2.392,95 40,0 + 10,0   1.292,19 22",
  ].join("\n");
  const pagina2 = [
    "Vi preghiamo di provvedere al bonifico bancario per € 2.328,68",
    "pari al 30% dell'importo totale per poter procedere con la",
    "Note                                                    Totale righe       5.946,26",
    "Costi di trasporto indicativi.                          Spese trasporto      416,24",
    "                                                        Imposta            1.399,75",
    "                                                        Totale             7.762,25",
  ].join("\n");
  const e = estraiConfermaOrdine([pagina1, pagina2], contesto);

  it("fornitore in testa, non l'agente né il destinatario né la banca", () => {
    expect(e.fornitoreCitato?.valore).toBe("BT GLASS Srl");
  });
  it("numero e data del documento dalla riga «N. … del …»", () => {
    expect(e.numeroConferma?.valore).toBe("000183");
    expect(e.dataDocumento?.valore).toBe("2026-03-12");
  });
  it("il vostro riferimento è il valore accanto all'etichetta, non un'altra etichetta", () => {
    expect(e.riferimentoCliente?.valore).toBe("Bianchi");
  });
  it("consegna prevista con data e settimana", () => {
    expect(e.dateConsegna.map(d => d.valore)).toEqual(["2026-04-20"]);
    expect(e.settimaneConsegna.map(s => s.valore)).toEqual([17]);
  });
  it("imponibile = totale − imposta, con «Imposta» come etichetta dell'IVA", () => {
    expect(e.totaleDocumento?.valore).toBe(7762.25);
    expect(e.imponibileDocumento?.valore).toBe(6362.5);
  });
});

describe("Gianesin — etichette su una riga e valori sulla riga sotto, colonna Consegna", () => {
  const pagina = [
    "Tipo                          Numero      Data",
    "CONFERMA ORDINE DI VENDITA",
    "A                             2600012     10/02/26",
    "                                                         Vostro Riferimento",
    "Sede Legale, Amministrativa e Operativa:                 VERDI",
    "Via Valdilocchi, 2 - 19126 LA SPEZIA (SP) - Tel. 0187 523433 - Fax 0187 270010",
    "www.ferramentafivizzanese.it   amministrazione@ferramentafivizzanese.it",
    "                                                         RUFFINO GROUP SRLS",
    "Riga   Codice           Descrizione                              U.M. Quantità   Prezzo      Sconti   Importo   IVA Consegna",
    "3      PRLAVL14AM.RAL   avv allum L14 12x55 coib MD term/allum   MQ   12,720     37,50000             477,00 22 11/02/26",
    "       1570x2700H -col A01 - pz 3",
    "Importo Merce   Sconto Cassa   Importo Netto   Importo Bolli   Sp. di Incasso   Totale Iva   Totale Fattura   Omaggi   Totale Generale",
    "680,25                         680,25                          7,74             151,36       839,35                    839,35",
  ].join("\n");
  const e = estraiConfermaOrdine([pagina], contesto);

  it("il vostro riferimento sta sotto l'etichetta, nella stessa colonna", () => {
    expect(e.riferimentoCliente?.valore).toBe("VERDI");
  });
  it("senza ragione sociale, il fornitore è il dominio del sito", () => {
    expect(e.fornitoreCitato?.valore).toBe("ferramentafivizzanese.it");
  });
  it("la data nella colonna Consegna è una consegna, quella in testa è del documento", () => {
    expect(e.dataDocumento?.valore).toBe("2026-02-10");
    expect(e.dateConsegna.map(d => d.valore)).toEqual(["2026-02-11"]);
  });
  it("imponibile per aritmetica dell'IVA quando le etichette stanno su un'altra riga", () => {
    expect(e.totaleDocumento?.valore).toBe(839.35);
    expect(e.imponibileDocumento?.valore).toBe(687.99);
    expect(e.imponibileDocumento?.evidenza.frammento).toContain("687.99 + IVA 22% 151.36 = 839.35");
  });
});

describe("Fivizzanese — lettera con prezzi IVA esclusa e firma in calce", () => {
  const pagina = [
    "www.ferramentafivizzanese.it",
    "Spett.",
    "RUFFINO",
    "Fivizzano, 02/02/2026",
    "Oggetto: Conferma ordine per la fornitura di N. 1 persiana. Rif. BIANCHJ",
    "Il prezzo indicato è al netto di ogni sconto:",
    "N. 1 Persiana   MISURA FINITA L 950 X H 2398 mm PORTA PERSIANA UN ANTA DX SPINGERE",
    "Prezzo netto cad.   € 463,00 (quattrocento sessantatré)",
    "TOTALE PERSIANE   € 463,00 (quattrocento sessantatré)",
    "IMBALLO 2%   €   9,00 (nove)",
    "TRASPORTO   € 10,00 (dieci)",
    "TOTALE FORNITURA   € 482,00 (quattrocento ottantadue)",
    "A vostro carico IVA",
    "Ferramenta Fivizzanese S.r.l",
    "Ferramenta Fivizzanese S.R.L. - Via Valdilocchi, 2 - 19126 La Spezia (SP)",
  ].join("\n");
  const e = estraiConfermaOrdine([pagina], contesto);

  it("«A vostro carico IVA»: il totale fornitura è l'imponibile, non c'è un totale ivato", () => {
    expect(e.imponibileDocumento?.valore).toBe(482);
    expect(e.totaleDocumento).toBeNull();
  });
  it("fornitore dalla firma in calce, riferimento dall'oggetto", () => {
    expect(e.fornitoreCitato?.valore).toBe("Ferramenta Fivizzanese S.r.l");
    expect(e.riferimentoCliente?.valore).toBe("BIANCHJ");
    expect(e.dataDocumento?.valore).toBe("2026-02-02");
  });
});

describe("Primed — data accanto a «Conferma d'ordine», numero nel «nostro riferimento»", () => {
  const pagina = [
    "Tipo documento        Data          Pagine",
    "Conferma d'ordine     16/05/2025    Pagina 1 di 1",
    "Destinatario",
    "R237 RUFFINO GROUP S.R.L.S.",
    "nostro riferimento n. OV-2025-WU/230417 del 10/03/2025 partenza del 22/05/2025",
    "ZANZARIERA AVVOLGENTE   PZ   2 SALA-CAMERA - ROSSI   0,00%",
    "Causale: VENDITA E MAT.INF.   Imponibile / Taxable Value €   403,37",
    "Doc. emesso da: extranet   Resa: Franco con addebito   IVA / VAT €   88,74",
    "Pagamento: BONIFICO BANCARIO 30 GG FM   Totale / Total amount €   492,11",
    "Primed s.r.l.   Tel +39 0995623969   Cap. Soc.: 98.000 i.v.",
  ].join("\n");
  const e = estraiConfermaOrdine([pagina], contesto);

  it("una data non è un numero di conferma", () => {
    expect(e.numeroConferma?.valore).toBe("OV-2025-WU/230417");
    expect(e.dataDocumento?.valore).toBe("2025-05-16");
  });
  it("imponibile e totale dalle etichette, fornitore dalla riga in calce", () => {
    expect(e.imponibileDocumento?.valore).toBe(403.37);
    expect(e.totaleDocumento?.valore).toBe(492.11);
    expect(e.fornitoreCitato?.valore).toBe("Primed s.r.l.");
  });
});

describe("Alias a griglia — etichette in riga, valori sotto, data documento accanto alla settimana", () => {
  const pagina = [
    "Conferma Ordine                                          Pagina   1 / 2",
    "                                                         Spettabile   006604",
    "                                                         RUFFINO GROUP SRLS",
    "ALIAS Srl Porte blindate",
    "Via E.Berlinguer, 22                                     Codice fiscale   01500270119",
    "N.DOCUMENTO              Approntamento [1]               CAUSALE",
    "2026 - CV 003746         del 23/02/2026   2026 Settimana 21   001 Ordine Italia",
    "AGENTE                   Compilatore conferma            VS.RIFERIMENTO",
    "DE - DOOR DESIGN S.R.L.  Veronica Gregori                BIANCHI GIUL",
    "Tot. Imponibile   948,73",
    "Tot. Imposta   208,72",
    "Tot. Ordine   1.157,45",
  ].join("\n");
  const e = estraiConfermaOrdine([pagina], contesto);

  it("il fornitore non è l'agente sotto l'etichetta AGENTE", () => {
    expect(e.fornitoreCitato?.valore).toBe("ALIAS Srl Porte blindate");
  });
  it("il vostro riferimento è sotto la sua etichetta, nella terza colonna", () => {
    expect(e.riferimentoCliente?.valore).toBe("BIANCHI GIUL");
  });
  it("«del 23/02/2026» è la data del documento anche con «Settimana 21» accanto", () => {
    expect(e.dataDocumento?.valore).toBe("2026-02-23");
    expect(e.dateConsegna).toEqual([]);
    expect(e.settimaneApprontamento?.map(s => s.valore)).toEqual([21]);
    expect(e.numeroConferma?.valore).toBe("CV 003746");
  });
});

describe("rumore da OCR", () => {
  it("un intero nudo non è un totale né un'IVA: partita IVA e aliquota non entrano nei conti", () => {
    const e = estraiConfermaOrdine(
      [
        [
          "Totale Iva   Consegna   3",
          "Partita IVA 04500270111",
          "Aliquota IVA   22   Imponibile   157,95",
          "IVA 22%   34,75",
          "Totale   192,70",
        ].join("\n"),
      ],
      contesto
    );
    expect(e.imponibileDocumento?.valore).toBe(157.95);
    expect(e.totaleDocumento?.valore).toBe(192.7);
  });

  it("«Totale (iva esclusa)» è un imponibile, non il totale", () => {
    const e = estraiConfermaOrdine(
      [["Totale (iva esclusa) €3.299,70", "IVA 22% €725,93", "Totale documento €4.025,63"].join("\n")],
      contesto
    );
    expect(e.imponibileDocumento?.valore).toBe(3299.7);
    expect(e.totaleDocumento?.valore).toBe(4025.63);
  });

  it("il CAP del destinatario dopo «Conferma d'ordine» non è il numero della conferma", () => {
    const e = estraiConfermaOrdine(
      [
        [
          "CONFERMA D'ORDINE                       Spett.le RUFFINO GROUP SRLS",
          "                                        19124 LA SPEZIA SP",
          "Numero documento 2026013149 del 30/07/2026",
        ].join("\n"),
      ],
      contesto
    );
    expect(e.numeroConferma?.valore ?? null).not.toBe("19124");
  });

  it("«Bonifico Bancario Intestato a …» non è il fornitore", () => {
    const e = estraiConfermaOrdine(
      [
        [
          "Bonifico Bancario Intestato a BANCA POPOLARE SPA",
          "Spett.le RUFFINO GROUP SRLS",
          "Primed s.r.l.   Tel +39 0995623969",
        ].join("\n"),
      ],
      contesto
    );
    expect(e.fornitoreCitato?.valore).toBe("Primed s.r.l.");
  });

  it("una frase delle condizioni non è un riferimento cliente", () => {
    const e = estraiConfermaOrdine(
      ["In caso di Vs. rif. eventuali obblighi di pagamento nei termini indicati restano dovuti"],
      contesto
    );
    expect(e.riferimentoCliente ?? null).toBeNull();
  });
});
