import { describe, expect, it } from "vitest";
import { classificaRigheFic, confrontaLati, latoCrm } from "./confronto";

// Forma della fattura 128/2026 (caso reale, importi veri, cliente anonimo) contro una bozza CRM «grezza».
const righeFic = [
  { descrizione: "Fattura per la prossima fornitura e posa di:", quantita: 1, prezzoUnit: 0, aliquota: 10 },
  { descrizione: "Beni Significativi: Serramenti in PVC", quantita: 1, prezzoUnit: 0, aliquota: 22 },
  { descrizione: "N. Finestra a 1 anta a battente. L1150 x H1790. Coprifili inclusi", quantita: 1, prezzoUnit: 591.97, aliquota: 22 },
  { descrizione: "Rilievo tecnico delle misure esecutive presso il cantiere delle finestre.", quantita: 1, prezzoUnit: 40, aliquota: 10 },
  { descrizione: "Progettazione dell'intervento con analisi nodi di posa", quantita: 1, prezzoUnit: 30, aliquota: 10 },
  { descrizione: "Sviluppo ordine", quantita: 1, prezzoUnit: 30, aliquota: 10 },
  { descrizione: "Protezione pavimento e arredamento per la posa delle finestre.", quantita: 1, prezzoUnit: 40, aliquota: 10 },
  { descrizione: "Rimozione delle finestre compreso abbassamento al piano strada", quantita: 1, prezzoUnit: 50, aliquota: 10 },
  { descrizione: "Smaltimento e trasporto in discarica di finestre.", quantita: 1, prezzoUnit: 70, aliquota: 10 },
  { descrizione: "Trasporto, Carico, Scarico e tiro al piano a spalla d'uomo delle finestre", quantita: 1, prezzoUnit: 100, aliquota: 10 },
  { descrizione: "POSA IN OPERA certificata", quantita: 1, prezzoUnit: 250, aliquota: 10 },
  { descrizione: "Spese professionali BC", quantita: 1, prezzoUnit: 100, aliquota: 22 },
  { descrizione: "Tot. imponibile fattura: € 1.301,97", quantita: 1, prezzoUnit: 0, aliquota: 22 },
  { descrizione: "Detrazione per diversa imputazione iva beni significativi", quantita: 1, prezzoUnit: -610, aliquota: 22 },
  { descrizione: "Riaddebito per diversa imputazione iva agevolatabeni significativi", quantita: 1, prezzoUnit: 610, aliquota: 10 },
];

describe("classificaRigheFic", () => {
  it("legge la fattura vera: beni, servizi per voce, spese, storno e imponibile", () => {
    const fic = classificaRigheFic(righeFic);
    expect(fic.beniSignificativiCent).toBe(59197);
    expect(fic.speseCent).toBe(10000);
    expect(fic.serviziCent).toBe(61000);
    expect(fic.servizi).toMatchObject({ rilievo: 4000, progettazione: 3000, sviluppo_ordine: 3000, protezione: 4000, rimozione_serramenti: 5000, smaltimento: 7000, tiro_piano: 10000, posa: 25000 });
    expect(fic.markupCent).toBe(0);
    expect(fic.stornoCent).toBe(61000);
    expect(fic.imponibileCent).toBe(130197);
    expect(fic.nonClassificate).toEqual([]);
  });

  it("i beni al 10 % sono autonomi, il markup si riconosce anche scritto «Mark-up»", () => {
    const fic = classificaRigheFic([
      { descrizione: "N.2 Persiana a 2 ante", quantita: 1, prezzoUnit: 1312, aliquota: 10 },
      { descrizione: "Mark-up servizi di vendita", quantita: 1, prezzoUnit: 300, aliquota: 10 },
      { descrizione: "Voce strana", quantita: 2, prezzoUnit: 5, aliquota: 4 },
    ]);
    expect(fic.beniAutonomiCent).toBe(131200);
    expect(fic.markupCent).toBe(30000);
    expect(fic.nonClassificate).toHaveLength(1);
    expect(fic.imponibileCent).toBe(131200 + 30000 + 1000);
  });
});

describe("latoCrm + confrontaLati", () => {
  const riga = (tipo: any, importoCent: number, extra: any = {}) => ({
    id: 1, fatturaId: 1, ordine: 1, tipo, descrizione: "", quantita: 1, prezzoUnitCent: importoCent, importoCent,
    aliquota: 22, voceComputoCodice: null, rigaCommessaId: null, limiteCent: null, beneSignificativo: true, derivata: false, ...extra,
  });
  it("mette a confronto blocco per blocco e servizio per servizio, con il delta dal lato della fattura vera", () => {
    const crm = latoCrm({
      imponibileCent: 108713, markupCent: -95325, stornoCent: 0,
      righe: [
        riga("bene", 77508), riga("bene", 13750, { beneSignificativo: false }), riga("bene", 15000, { voceComputoCodice: "spese_professionali" }),
        riga("servizio", 8000, { voceComputoCodice: "rilievo_foro" }), riga("servizio", 32800, { voceComputoCodice: "posa" }), riga("servizio", 5000, { voceComputoCodice: "trasporto" }),
      ],
    } as any);
    expect(crm.servizi).toEqual({ rilievo: 8000, posa: 32800, tiro_piano: 5000 });
    const voci = confrontaLati(crm, classificaRigheFic(righeFic));
    const per = (v: string) => voci.find(x => x.voce === v)!;
    expect(per("beni_significativi")).toMatchObject({ crmCent: 77508, ficCent: 59197, deltaCent: -18311 });
    expect(per("beni_autonomi")).toMatchObject({ crmCent: 13750, ficCent: 0 });
    expect(per("spese")).toMatchObject({ crmCent: 15000, ficCent: 10000, deltaCent: -5000 });
    expect(per("markup")).toMatchObject({ crmCent: -95325, ficCent: 0 });
    expect(per("posa")).toMatchObject({ crmCent: 32800, ficCent: 25000 });
    expect(per("rilievo")).toMatchObject({ crmCent: 8000, ficCent: 4000 });
    expect(per("progettazione")).toMatchObject({ crmCent: 0, ficCent: 3000 });
    // L'ordine: blocchi prima, poi i servizi nell'ordine del documento.
    expect(voci.slice(0, 7).map(v => v.voce)).toEqual(["beni_significativi", "beni_autonomi", "spese", "servizi", "markup", "storno", "imponibile"]);
    expect(voci[7].voce).toBe("rilievo");
  });
});
