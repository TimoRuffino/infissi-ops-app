// normalizzaStorico: la lettura tollerante dello storico jsonb, qualunque
// forma abbia preso (array corretto, stringa doppio-codificata, array misto
// creato dall'append SQL su una stringa — incidente produzione 01/09/2026:
// new Date(undefined) → Invalid Date → toISOString() esplodeva a ogni
// reconcile dell'osservatore).

import { describe, expect, it } from "vitest";
import { normalizzaStorico } from "./repository";

const EVENTO = {
  tipo: "aperta",
  fingerprint: "fp-1",
  at: "2026-09-01T01:53:38.616Z",
};

describe("normalizzaStorico", () => {
  it("un array corretto passa invariato", () => {
    const eventi = normalizzaStorico([EVENTO]);
    expect(eventi).toHaveLength(1);
    expect(eventi[0].tipo).toBe("aperta");
    expect(eventi[0].at.toISOString()).toBe(EVENTO.at);
  });

  it("una STRINGA doppio-codificata viene spacchettata", () => {
    const eventi = normalizzaStorico(JSON.stringify([EVENTO]));
    expect(eventi).toHaveLength(1);
    expect(eventi[0].fingerprint).toBe("fp-1");
  });

  it("un array MISTO [stringa, evento] recupera entrambi i lati", () => {
    const eventi = normalizzaStorico([
      JSON.stringify([EVENTO]),
      { tipo: "auto_risolta", fingerprint: "fp-2", at: "2026-09-01T08:00:00.000Z" },
    ]);
    expect(eventi.map(e => e.tipo)).toEqual(["aperta", "auto_risolta"]);
  });

  it("eventi illeggibili si scartano, MAI una Invalid Date", () => {
    const eventi = normalizzaStorico([
      { tipo: "aperta" }, // senza at
      { at: "2026-09-01T08:00:00.000Z" }, // senza tipo
      { tipo: "aggiornata", at: "non-una-data" },
      "non-json",
      42,
      null,
      EVENTO,
    ]);
    expect(eventi).toHaveLength(1);
    for (const evento of eventi) {
      expect(() => evento.at.toISOString()).not.toThrow();
    }
  });

  it("null/undefined/oggetti estranei producono uno storico vuoto", () => {
    expect(normalizzaStorico(null)).toEqual([]);
    expect(normalizzaStorico(undefined)).toEqual([]);
    expect(normalizzaStorico("\"non-array\"")).toEqual([]);
  });
});
