import { describe, expect, it } from "vitest";
import { dataDaSettimanaIso, estraiRigheMerce } from "./estrazioneMerce";

describe("estraiRigheMerce", () => {
  it("riconosce i disegni comuni e scarta totali, indirizzi e pagamenti", () => {
    const pagina = [
      "TESCONI SRL - Via Roma 12, 55100 Lucca - P.IVA 01234567890",
      "Conferma d'ordine n. 4471 del 01/09/2026",
      "Vs. rif. COM-2026-001 - Consegna prevista: settimana 38",
      "Pos  Descrizione                              Q.tà  UM   Prezzo    Importo",
      "10   Finestra 2 ante PVC bianco 1200x1400       2    pz   350,00    700,00",
      "20 Portafinestra 1 anta PVC 800x2200 1 pz 420,00 420,00",
      "3 pz Zanzariera a rullo 1200x1400",
      "Persiana alluminio 2 ante 1200x1400 q.tà 2",
      "Trasporto e imballo 1 pz 80,00",
      "Totale imponibile: EUR 3.500,00",
      "IVA 22%: EUR 770,00",
      "Totale documento: EUR 4.270,00",
      "Pagamento: bonifico 30 gg - IBAN IT00 X000 0000 0000 0000 0000 000",
    ].join("\n");

    const righe = estraiRigheMerce([pagina]);
    expect(righe.map(r => [r.nome, r.quantita])).toEqual([
      ["Finestra 2 ante PVC bianco 1200x1400", 2],
      ["Portafinestra 1 anta PVC 800x2200", 1],
      ["Zanzariera a rullo 1200x1400", 3],
      ["Persiana alluminio 2 ante 1200x1400", 2],
    ]);
    expect(righe[0].pagina).toBe(1);
    expect(righe[0].evidenza).toContain("Finestra 2 ante");
  });

  it("legge il layout a colonne di Alias come lo restituisce il parser (04/09/2026)", () => {
    // Testo REALE della conferma «Ordini_di_Vendi_1602923(1).pdf» dopo
    // pdf.js: unità e quantità incollate, anche a rovescio, o nella riga sotto.
    const pagina1 = [
      "Conferma Ordine",
      "ALIAS Srl Porte blindate",
      "Via E.Berlinguer, 22",
      "VS.RIFERIMENTO",
      "GIACOMAZZI GIUL",
      "Approntamento [1]",
      "2026 Settimana 21",
      "IVAImporto% Sc.PrezzoQuantitàUMCodice / Descrizione / Note List.",
      "Descrizione Valore Prezzo",
      "KPO44 KIT PORTA",
      "26C0374604 - 003460 - .",
      "NR 1,00 22 99819,47",
      "1 ANTA STEEL /C DX 445,00MODELLO PORTA NETTO",
      "1870 750LUCE NOMINALE PORTA H x L",
      "50,00 15,003,0 70x10x2250 COPRIF.70 L3000 MATRIX BIANCO 141,00NUMERO COPRIFILI INT",
      "TIPO 'A' CHIAVE-GAMBO / 40. 30+GAMBO / 5 10,00CILINDRO / NUM.CHIAVI NETTO",
      "2 NPD C2TENUTA ARIA-ACQUA-VENTO",
      "NR 1,00PORST-C013 PORTA BLIND.STEEL/C < 1900",
      "NR 1,00FCO013 FALSO COMMESSA H<1900",
      "NR 1,00COI3 SET COPRIFILI INTERNO",
      "NR 1,00COE3 SET COPRIFILI ESTERNO",
    ].join("\n");
    const pagina2 = [
      "KRR4 KIT RIVESTIMENTI",
      "26C0374606 - 000147 - .",
      "NR 1,00 150,00 50,00",
      "15,00",
      "NR 1,00RIS3 RIV.INTERNO SCIOLTO",
      "2212,7550,00",
      "1,00NR253003 POMOLO C.PORTA O GIR. ALL.BRONZATO 0130,00",
      "226,3850,00",
      "1,00NR266003 ROSETTA MANIGLIA/POMOLO",
      "ALL.BRONZAT",
      "1,00NR267402 SOTTOROSET.POM.FIS.LAT.TONDO/QUADR",
      "2240,001,00NRSPESE_TR Spese Trasporto 40,00",
      "Tot. Merce 908,73",
      "Tot. Imponibile 948,73",
      "Tot. Ordine 1.157,45",
    ].join("\n");

    const righe = estraiRigheMerce([pagina1, pagina2]);
    expect(righe.map(r => [r.nome, r.quantita])).toEqual([
      ["KPO44 KIT PORTA", 1],
      ["PORST-C013 PORTA BLIND.STEEL/C < 1900", 1],
      ["FCO013 FALSO COMMESSA H<1900", 1],
      ["COI3 SET COPRIFILI INTERNO", 1],
      ["COE3 SET COPRIFILI ESTERNO", 1],
      ["KRR4 KIT RIVESTIMENTI", 1],
      ["RIS3 RIV.INTERNO SCIOLTO", 1],
      ["253003 POMOLO C.PORTA O GIR. ALL.BRONZATO", 1],
      ["266003 ROSETTA MANIGLIA/POMOLO", 1],
      ["267402 SOTTOROSET.POM.FIS.LAT.TONDO/QUADR", 1],
    ]);
    expect(righe[5].pagina).toBe(2);
  });

  it("senza righe riconoscibili restituisce vuoto, non rumore", () => {
    expect(
      estraiRigheMerce([
        "Conferma d'ordine n. 9\nTotale documento: EUR 4.270,00\nGrazie per l'ordine.",
      ])
    ).toEqual([]);
  });

  it("non ripete la stessa merce due volte e non supera il tetto", () => {
    const righe = Array.from({ length: 60 }, (_, i) => `${i + 1} pz Finestra modello ${i % 45}`);
    const lette = estraiRigheMerce([righe.join("\n")]);
    expect(lette.length).toBeLessThanOrEqual(40);
    expect(new Set(lette.map(r => r.nome.toLowerCase())).size).toBe(lette.length);
  });
});

describe("dataDaSettimanaIso", () => {
  it("il lunedì della settimana ISO nell'anno del documento, o in quello dichiarato", () => {
    // La settimana 38 del 2026 inizia lunedì 14 settembre.
    expect(dataDaSettimanaIso(38, new Date("2026-09-01T00:00:00Z"))).toBe("2026-09-14");
    // La settimana 1 del 2027 inizia lunedì 4 gennaio 2027.
    expect(dataDaSettimanaIso(1, new Date("2027-01-02T00:00:00Z"))).toBe("2027-01-04");
    // «2026 Settimana 21» (Alias): 18 maggio 2026, anche se il riferimento è dopo.
    expect(dataDaSettimanaIso(21, new Date("2026-09-01T00:00:00Z"), 2026)).toBe("2026-05-18");
  });

  it("una settimana già passata da mesi vale per l'anno dopo; valori assurdi danno null", () => {
    expect(dataDaSettimanaIso(3, new Date("2026-09-01T00:00:00Z"))).toBe("2027-01-18");
    expect(dataDaSettimanaIso(0, new Date("2026-09-01T00:00:00Z"))).toBeNull();
    expect(dataDaSettimanaIso(54, new Date("2026-09-01T00:00:00Z"))).toBeNull();
  });
});
