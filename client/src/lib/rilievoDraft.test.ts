import { describe, expect, it } from "vitest";

import { parseRilievoDraft, serializeRilievoDraft } from "./rilievoDraft";

describe("rilievo draft", () => {
  it("mantiene misure, checklist e note in un round trip", () => {
    const draft = {
      measures: { larghezzaLuce: "1200", falsotelaioPresente: "si" },
      nodiCritici: ["Muratura irregolare"],
      accessibilita: ["Solo pedonale"],
      verso: "interno",
      tipoRilievo: "tecnico",
      noteGenerali: "Verificare il davanzale.",
    };

    expect(parseRilievoDraft(serializeRilievoDraft(draft))).toEqual(draft);
  });

  it("tratta il valore legacy non JSON come nota generale", () => {
    expect(parseRilievoDraft("Nota rilievo precedente")).toEqual({
      measures: {},
      nodiCritici: [],
      accessibilita: [],
      verso: "interno",
      tipoRilievo: "tecnico",
      noteGenerali: "Nota rilievo precedente",
    });
  });

  it("normalizza forme non valide senza propagare valori arbitrari", () => {
    expect(
      parseRilievoDraft(
        JSON.stringify({
          measures: { larghezzaLuce: 1200, altezzaLuce: "1400" },
          nodiCritici: ["Cappotto termico", 42],
          accessibilita: "Solo pedonale",
          verso: 3,
          tipoRilievo: null,
          noteGenerali: false,
        })
      )
    ).toEqual({
      measures: { altezzaLuce: "1400" },
      nodiCritici: ["Cappotto termico"],
      accessibilita: [],
      verso: "interno",
      tipoRilievo: "tecnico",
      noteGenerali: "",
    });
  });
});
