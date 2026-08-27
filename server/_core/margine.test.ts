import { describe, expect, it } from "vitest";
import { calcolaMargine } from "./margine";

describe("calcolaMargine", () => {
  it("ignora costi FiC esterni e calcola il margine dai soli costi della commessa", () => {
    // Una regressione che reintroducesse le fatture d'acquisto nel margine
    // farebbe risultare 2.000 € di costi e 7.000 € di margine.
    const risultato = calcolaMargine(
      { importoTotale: 10_000, costi: [], costoPosaStimato: 1_000 },
      [{ id: 9, importo: 2_000 } as any]
    );

    expect(risultato.costiFornitore).toBe(0);
    expect(risultato.margineLordo).toBe(9_000);
  });
});
