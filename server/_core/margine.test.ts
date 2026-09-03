import { describe, expect, it } from "vitest";
import { calcolaMargine } from "./margine";

describe("calcolaMargine", () => {
  it("ignora costi FiC esterni e calcola il margine dai soli costi della commessa", () => {
    // Una regressione che reintroducesse le fatture d'acquisto nel margine
    // farebbe risultare 2.000 € di costi e 7.000 € di margine.
    const risultato = calcolaMargine(
      {
        importoTotale: 12_200,
        pattuitoImponibile: 10_000,
        costi: [],
        costoPosaStimato: 1_000,
      },
      [{ id: 9, importo: 2_000 } as any]
    );

    expect(risultato.costiFornitore).toBe(0);
    expect(risultato.margineLordo).toBe(9_000);
  });

  it("il margine è imponibile contro imponibile: il pattuito lordo non entra nel calcolo", () => {
    // Direzione 03/09/2026: «il pattuito da FiC va sempre visto IVA
    // inclusa, il margine va calcolato IVA esclusa». Con 12.200 lordi
    // (10.000 + IVA) e 6.000 di costo imponibile il margine è 4.000, non
    // 6.200: usare il lordo gonfierebbe di tutta l'IVA sulle vendite.
    const risultato = calcolaMargine({
      importoTotale: 12_200,
      pattuitoImponibile: 10_000,
      costi: [{ id: 1, importo: 6_000 }],
      costoPosaStimato: null,
    });

    expect(risultato.ricavi).toBe(10_000);
    expect(risultato.pattuitoLordo).toBe(12_200);
    expect(risultato.fonteRicavi).toBe("fic_imponibile");
    expect(risultato.margineLordo).toBe(4_000);
    expect(risultato.marginePerc).toBeCloseTo(0.4, 5);
    expect(risultato.datiIncompleti).toBe(false);
  });

  it("ogni costo dice da quale conferma d'ordine è nato (null = a mano)", () => {
    const risultato = calcolaMargine({
      pattuitoImponibile: 10_000,
      costi: [
        { id: 1, importo: 3_500, documentoId: 77 },
        { id: 2, importo: 200 },
      ],
    });
    expect(risultato.costi.map(c => c.documentoId)).toEqual([77, null]);
    expect(risultato.costiFornitore).toBe(3_700);
  });

  it("senza fattura collegata non c'è imponibile: margine incompleto, nessuna aliquota inventata", () => {
    const risultato = calcolaMargine({
      importoTotale: 12_200,
      pattuitoImponibile: null,
      costi: [{ id: 1, importo: 6_000 }],
    });

    expect(risultato.ricavi).toBeNull();
    expect(risultato.fonteRicavi).toBe("assente");
    expect(risultato.margineLordo).toBeNull();
    expect(risultato.marginePerc).toBeNull();
    expect(risultato.datiIncompleti).toBe(true);
    // Il lordo resta leggibile per la scheda, ma non è un ricavo di margine.
    expect(risultato.pattuitoLordo).toBe(12_200);
  });
});
