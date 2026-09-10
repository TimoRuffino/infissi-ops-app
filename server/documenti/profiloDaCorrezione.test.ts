// Dalla correzione all'ancora: la persona dice qual è il valore giusto, il
// codice guarda dove sta e registra l'ETICHETTA che lo precede. Nel profilo
// non finisce mai il valore.
import { describe, expect, it } from "vitest";
import { derivaAncore } from "./profiloDaCorrezione";

const PAGINA = [
  "ALIAS Srl Porte blindate",
  "Conferma Ordine",
  "2026 - CV 1602923 23/02/2026",
  "VS.RIFERIMENTO   GIACOMAZZI GIULIO",
  "Totale imponibile: EUR 948,73",
].join("\n");

describe("derivaAncore", () => {
  it("registra l'etichetta che precede il valore, non il valore", () => {
    const ancore = derivaAncore([PAGINA], [
      { campo: "numeroConferma", valore: "1602923" },
    ]);
    expect(ancore).toHaveLength(1);
    expect(ancore[0]).toMatchObject({
      campo: "numeroConferma",
      posizione: "dopo_etichetta",
      forma: "numero",
      pagina: 1,
    });
    expect(ancore[0].etichetta.toLowerCase()).toContain("cv");
    // La regola che rende la forma promuovibile: nel profilo non c'è il valore.
    expect(JSON.stringify(ancore)).not.toContain("1602923");
  });

  it("riconosce la forma di un importo e la sua etichetta", () => {
    const ancore = derivaAncore([PAGINA], [
      { campo: "imponibileDocumento", valore: "948,73" },
    ]);
    expect(ancore[0].forma).toBe("importo");
    expect(ancore[0].etichetta.toLowerCase()).toContain("imponibile");
    expect(JSON.stringify(ancore)).not.toContain("948,73");
  });

  it("un valore in una cella a destra dell'etichetta si registra come tale", () => {
    const ancore = derivaAncore([PAGINA], [
      { campo: "riferimentoCliente", valore: "GIACOMAZZI GIULIO" },
    ]);
    expect(ancore[0].posizione).toBe("cella_a_destra");
    expect(ancore[0].etichetta.toLowerCase()).toContain("riferimento");
  });

  it("un valore che il foglio non porta non produce nessuna ancora", () => {
    expect(
      derivaAncore([PAGINA], [{ campo: "numeroConferma", valore: "NON C'È" }])
    ).toEqual([]);
  });

  it("un valore senza niente prima non produce ancora: non c'è appiglio", () => {
    expect(
      derivaAncore(["1602923"], [{ campo: "numeroConferma", valore: "1602923" }])
    ).toEqual([]);
  });
});
