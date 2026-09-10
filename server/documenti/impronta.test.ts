// L'impronta identifica il MODULO: due conferme dello stesso fornitore con
// clienti, prezzi e date diverse devono avere la stessa impronta, e due
// moduli diversi impronte diverse.
import { describe, expect, it } from "vitest";
import { improntaLayout } from "./impronta";

const alias = (cliente: string, numero: string, importo: string) => [
  [
    "ALIAS Srl Porte blindate",
    "Conferma Ordine",
    `2026 - CV ${numero} 23/02/2026`,
    "VS.RIFERIMENTO",
    cliente,
    "Codice        Descrizione                 UM    Quantita",
    "PORST-C013    PORTA BLIND.STEEL/C         NR    1,00",
    `Totale imponibile: EUR ${importo}`,
  ].join("\n"),
];

describe("improntaLayout", () => {
  it("due conferme dello stesso modulo hanno la stessa impronta", () => {
    // È il test che ha trovato il difetto della prima stesura: il nome del
    // cliente sta su una riga sua, non ha cifre, e finiva fra le etichette —
    // così l'impronta cambiava a ogni conferma e nessun profilo combaciava
    // mai. Di qui la regola della minuscola.
    expect(improntaLayout(alias("ROSSI MARIO", "1602923", "948,73"))).toBe(
      improntaLayout(alias("GIACOMAZZI GIULIO", "1684077", "12.340,00"))
    );
  });

  it("due moduli diversi hanno impronte diverse", () => {
    const pail = [
      [
        "PAIL SERRAMENTI",
        "conf. 26_29488",
        "Rif. cliente: ROSSI MARIO",
        "Art.     Descrizione        Q.tà",
        "PT100    PORTA INTERNA      2",
        "Imponibile 1.200,00",
      ].join("\n"),
    ];
    expect(improntaLayout(alias("ROSSI MARIO", "1602923", "948,73"))).not.toBe(
      improntaLayout(pail)
    );
  });

  it("l'impronta non contiene valori: cambiare solo le cifre non la muove", () => {
    const a = improntaLayout(alias("ROSSI MARIO", "1", "1,00"));
    const b = improntaLayout(alias("ROSSI MARIO", "999999999", "99.999,99"));
    expect(a).toBe(b);
  });

  it("un testo vuoto ha un'impronta stabile e non esplode", () => {
    expect(improntaLayout([])).toBe(improntaLayout([]));
    expect(improntaLayout([""])).toHaveLength(16);
  });
});
