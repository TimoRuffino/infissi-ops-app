import { describe, expect, it } from "vitest";
import { dataDaSettimanaIso, estraiRigheMerce } from "./estrazioneMerce";

describe("estraiRigheMerce", () => {
  it("riconosce i tre disegni comuni e scarta totali, indirizzi e pagamenti", () => {
    const pagina = [
      "TESCONI SRL - Via Roma 12, 55100 Lucca - P.IVA 01234567890",
      "Conferma d'ordine n. 4471 del 01/09/2026",
      "Vs. rif. COM-2026-001 - Consegna prevista: settimana 38",
      "Pos  Descrizione                              Q.tà  UM   Prezzo    Importo",
      "10   Finestra 2 ante PVC bianco 1200x1400       2    pz   350,00    700,00",
      "20   Portafinestra 1 anta PVC 800x2200          1    pz   420,00    420,00",
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
  it("il lunedì della settimana ISO nell'anno del documento", () => {
    // La settimana 38 del 2026 inizia lunedì 14 settembre.
    expect(dataDaSettimanaIso(38, new Date("2026-09-01T00:00:00Z"))).toBe("2026-09-14");
    // La settimana 1 del 2027 inizia lunedì 4 gennaio 2027.
    expect(dataDaSettimanaIso(1, new Date("2027-01-02T00:00:00Z"))).toBe("2027-01-04");
  });

  it("una settimana già passata da mesi vale per l'anno dopo; valori assurdi danno null", () => {
    expect(dataDaSettimanaIso(3, new Date("2026-09-01T00:00:00Z"))).toBe("2027-01-18");
    expect(dataDaSettimanaIso(0, new Date("2026-09-01T00:00:00Z"))).toBeNull();
    expect(dataDaSettimanaIso(54, new Date("2026-09-01T00:00:00Z"))).toBeNull();
  });
});
