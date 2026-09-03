import { describe, expect, it } from "vitest";
import { OPZIONI_COMPUTO_DEFAULT, type CodiceOpera } from "@shared/limiti/tipi";
import { hashParametri, hashRighe } from "./hash";

const riga = {
  ordine: 1, categoria: "serramento_pvc" as const, tipologia: "finestra_2_ante", oscuranteIntegrato: null,
  oscuranteTipologia: null,
  quantita: 2, larghezzaMm: 1660, altezzaMm: 1540, misuraDei: null, prezzoTotCent: 300000,
  beneSignificativo: true, accessori: [{ codice: "ribalta", quantita: 2 }, { codice: "coprifili_80", quantita: 12 }],
};

describe("hash del contratto", () => {
  it("è stabile rispetto all'ordine degli accessori e delle righe", () => {
    const a = hashRighe([riga, { ...riga, ordine: 2, quantita: 1 }]);
    const b = hashRighe([{ ...riga, ordine: 2, quantita: 1 }, { ...riga, accessori: [...riga.accessori].reverse() }]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cambia quando cambia una misura, un prezzo o l'oscurante, non quando cambia la descrizione", () => {
    const base = hashRighe([riga]);
    expect(hashRighe([{ ...riga, altezzaMm: 1541 }])).not.toBe(base);
    expect(hashRighe([{ ...riga, prezzoTotCent: 300001 }])).not.toBe(base);
    expect(hashRighe([{ ...riga, oscuranteTipologia: "C25089-a" }])).not.toBe(base);
    expect(hashRighe([{ ...riga, note: "x" } as any])).toBe(base);
  });

  it("i parametri hanno un hash proprio, incluse le opzioni del computo", () => {
    const p = {
      pattuitoCent: 1539500, pattuitoTipo: "lordo" as const, posaInclusa: true, zonaClimatica: "D" as const,
      piano: 2, distanzaKm: 18, detrazioneTipo: "ristrutturazione" as const, detrazioneImmobile: "prima_casa" as const,
      detrazionePct: 50, opzioniComputo: OPZIONI_COMPUTO_DEFAULT,
    };
    expect(hashParametri(p)).toBe(hashParametri({ ...p }));
    expect(hashParametri({ ...p, piano: 5 })).not.toBe(hashParametri(p));

    // Un'opzione del computo cambia l'hash: rilievo, spese professionali, eventuali.
    expect(hashParametri({ ...p, opzioniComputo: { ...p.opzioniComputo, rilievo: "pezzo" } })).not.toBe(hashParametri(p));
    expect(hashParametri({ ...p, opzioniComputo: { ...p.opzioniComputo, speseProfessionali: true } })).not.toBe(hashParametri(p));
    const conEventuali = { ...p, opzioniComputo: { ...p.opzioniComputo, eventuali: ["posa", "dime"] as CodiceOpera[] } };
    expect(hashParametri(conEventuali)).not.toBe(hashParametri(p));

    // Ma l'ORDINE delle eventuali non conta: è un insieme, non una sequenza.
    const conEventualiInvertiti = { ...p, opzioniComputo: { ...p.opzioniComputo, eventuali: ["dime", "posa"] as CodiceOpera[] } };
    expect(hashParametri(conEventuali)).toBe(hashParametri(conEventualiInvertiti));
  });
});
