import { describe, expect, it } from "vitest";
import { estraiRigheMerce } from "./estrazioneMerce";

// Righe a CELLE, come le ricostruisce la geometria del PDF (tre spazi fra le
// colonne). Layout reali del 04/09/2026, nomi dei clienti cambiati.

describe("estraiRigheMerce — righe a celle", () => {
  it("BT Glass: codice | descrizione | um | quantità | prezzi; tre sistemi uguali si sommano", () => {
    const righe = estraiRigheMerce([
      [
        "Codice   Descrizione                     um   quantità   sconto        importo IVA",
        "G71      SISTEMA SCORREVOLE TUTTOVETRO   PZ   1,00   2.392,95 40,0 + 10,0   1.292,19 22",
        "1",
        "Larghezza=2385; Altezza=2867; ALTEZZA CENTRO",
        "G71      SISTEMA SCORREVOLE TUTTOVETRO   PZ   1,00   2.541,00 40,0 + 10,0   1.372,14 22",
        "G71      SISTEMA SCORREVOLE TUTTOVETRO   PZ   1,00   4.905,60 40,0 + 10,0   2.649,02 22",
        "60-00406   LAMIERA A DISEGNO   ML   4,70   30,00   40,0   84,51 22",
        "60-00228   TUBOLARE ALLUMINIO 60 x 40 mm   VG   2,00   168,00   40,0   201,60 22",
        "40-000002   GABBIA IN LEGNO PER TRASP. TRATTATA   N   2,00   120,00   240,00 22",
        "Totale righe   5.946,26",
      ].join("\n"),
    ]);
    expect(righe.map(r => [r.nome, r.quantita])).toEqual([
      ["G71 SISTEMA SCORREVOLE TUTTOVETRO", 3],
      ["60-00406 LAMIERA A DISEGNO (4,70 ML)", 1],
      ["60-00228 TUBOLARE ALLUMINIO 60 x 40 mm", 2],
    ]);
  });

  it("Gianesin: posizione | codice | descrizione | MQ | metri quadri, e i pezzi nella riga sotto", () => {
    const righe = estraiRigheMerce([
      [
        "Riga   Codice           Descrizione                              U.M. Quantità   Prezzo      Importo   IVA Consegna",
        "3      PRLAVL14AM.RAL   avv allum L14 12x55 coib MD term/allum   MQ   12,720     37,50000    477,00 22 11/02/26",
        "       1570x2700H -col A01 - pz 3",
        "6      PRLAVL14AM.RAL   avv allum L14 12x55 coib MD term/allum   MQ   2,880      37,50000    108,00 22 11/02/26",
        "       1065x2700H -col A01",
      ].join("\n"),
    ]);
    expect(righe.map(r => [r.nome, r.quantita])).toEqual([
      ["PRLAVL14AM.RAL avv allum L14 12x55 coib MD term/allum (12,720 MQ) 1570x2700H -col A01", 3],
      ["PRLAVL14AM.RAL avv allum L14 12x55 coib MD term/allum (2,880 MQ)", 1],
    ]);
  });

  it("Primed: quantità prima dell'unità o con il subcliente accanto; opzioni e code non sono merce", () => {
    const righe = estraiRigheMerce([
      [
        "ZANZARIERA AVVOLGENTE   PZ   2 SALA-CAMERA - ROSSI   0,00%",
        "SWITCH [ 4   1200   2350",
        "-MAGGIORAZIONE ZANZ.   PZ   2   0,00%",
        "FRIZIONATA-AMBRA,EV-",
        "PZ   2   8,80000   17,60",
        "Pos   Descrizione                        Q.tà   UM   Prezzo",
        "10    Finestra 2 ante PVC 1200x1400      2      pz   350,00",
      ].join("\n"),
    ]);
    expect(righe.map(r => [r.nome, r.quantita])).toEqual([
      ["ZANZARIERA AVVOLGENTE", 2],
      ["Finestra 2 ante PVC 1200x1400", 2],
    ]);
  });

  it("una frase (condizioni, oggetto della lettera) non diventa merce", () => {
    expect(
      estraiRigheMerce([
        [
          "Oggetto: Conferma ordine per la fornitura di N. 1 persiana. Rif. BIANCHJ",
          "Ai sensi e per gli effetti degli artt. 1341 e 1342 c.c., le parti approvano specificamente   PZ   2",
          "documento e dei relativi disegni allegati che potrete spedire via fax al   422",
        ].join("\n"),
      ])
    ).toEqual([]);
  });
});
