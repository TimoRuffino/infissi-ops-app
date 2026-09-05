import { describe, expect, it } from "vitest";
import type { RigaFattura } from "@shared/fatturazione/tipi";
import { indirizzoCliente, intestazioneStampa, righeStampa } from "./fatturaStampaView";

function riga(p: Partial<RigaFattura> & { id: number; ordine: number; tipo: RigaFattura["tipo"] }): RigaFattura {
  return {
    fatturaId: 1, descrizione: `riga ${p.id}`, quantita: 1, prezzoUnitCent: 1000, importoCent: 1000,
    aliquota: 22, voceComputoCodice: null, rigaCommessaId: null, limiteCent: null,
    beneSignificativo: false, derivata: false, ...p,
  };
}

describe("righeStampa", () => {
  it("segue l'ordine del documento e distingue testi e voci", () => {
    const out = righeStampa([
      riga({ id: 3, ordine: 3, tipo: "servizio", quantita: 2.5, prezzoUnitCent: 123456, importoCent: 308640, aliquota: 10 }),
      riga({ id: 1, ordine: 1, tipo: "intestazione", descrizione: "Beni Significativi:", aliquota: null }),
      riga({ id: 2, ordine: 2, tipo: "bene", quantita: 1, prezzoUnitCent: 50000, importoCent: 50000 }),
      riga({ id: 4, ordine: 4, tipo: "nota", descrizione: "(seguirà ddt)", aliquota: null }),
    ]);
    expect(out.map(r => r.chiave)).toEqual([1, 2, 3, 4]);
    expect(out[0]).toEqual({ tipo: "testo", chiave: 1, testo: "Beni Significativi:" });
    expect(out[1]).toMatchObject({ tipo: "voce", quantita: "1", importo: "€ 500,00", aliquota: "22 %" });
    expect(out[2]).toMatchObject({ tipo: "voce", quantita: "2,5", prezzoUnit: "€ 1.234,56", importo: "€ 3.086,40", aliquota: "10 %" });
    expect(out[3]).toEqual({ tipo: "testo", chiave: 4, testo: "(seguirà ddt)" });
  });
});

describe("intestazioneStampa", () => {
  it("bozza senza numero, fattura emessa con numero e data", () => {
    expect(intestazioneStampa({ tipo: "fattura", stato: "bozza", numero: null, data: null })).toEqual({ titolo: "Bozza di fattura", bozza: true });
    expect(intestazioneStampa({ tipo: "fattura", stato: "emessa", numero: "12/2026", data: "2026-09-05" })).toEqual({ titolo: "Fattura n. 12/2026 del 05/09/2026", bozza: false });
    expect(intestazioneStampa({ tipo: "nota_credito", stato: "bozza", numero: null, data: null }).titolo).toBe("Bozza di nota di credito");
    expect(intestazioneStampa({ tipo: "fattura", stato: "annullata", numero: null, data: null }).bozza).toBe(true);
  });
});

describe("indirizzoCliente", () => {
  it("compone via, cap, città e provincia saltando i vuoti", () => {
    expect(indirizzoCliente({ indirizzo: "Via Alta 80", cap: "19038", citta: "Sarzana", provincia: "SP" })).toBe("Via Alta 80, 19038 Sarzana (SP)");
    expect(indirizzoCliente({ indirizzo: "", cap: "", citta: "Sarzana", provincia: "" })).toBe("Sarzana");
    expect(indirizzoCliente(null)).toBe("");
  });
});
