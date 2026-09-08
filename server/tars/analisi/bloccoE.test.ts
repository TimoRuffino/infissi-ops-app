// Blocco E del piano «Tars più intelligente»: il consuntivo, i silenzi, le
// cause, le garanzie, il confronto fra sedi, le dodici proposte e l'analisi
// che si sveglia quando succede qualcosa.

import { describe, expect, it } from "vitest";
import { fattoNuovo, INTERVALLO_MINIMO_MS } from "./worker";
import type { RecordAnalisiAzienda } from "./types";

function analisi(contatori: Record<string, number>): RecordAnalisiAzienda {
  return {
    id: 1,
    sedeId: 1,
    giorno: "2026-09-08",
    versione: "1.2.0",
    stato: "pronta",
    esito: {
      versione: "1.2.0",
      fonte: "modello",
      modello: null,
      sintesi: "",
      punti: [],
      proposte: [],
      domande: [],
      avvertenze: [],
      contatori,
      fattiConsiderati: 0,
    },
    errore: null,
    richiestaDa: null,
    tentativi: 1,
    generataAt: new Date("2026-09-08T07:00:00Z"),
  } as any;
}

describe("l'analisi si sveglia quando succede qualcosa (punto 5)", () => {
  it("una consegna che salta la rifà prima delle quattro ore", () => {
    expect(fattoNuovo(analisi({ merceInRitardo: 1 }), { merceInRitardo: 2 })).toBe(
      "merceInRitardo"
    );
  });

  it("una fonte che si spegne pure", () => {
    expect(fattoNuovo(analisi({ fontiCieche: 0 }), { fontiCieche: 1 })).toBe("fontiCieche");
  });

  it("un numero che migliora non sveglia niente: non c'è nuovo lavoro", () => {
    expect(fattoNuovo(analisi({ merceInRitardo: 3 }), { merceInRitardo: 1 })).toBeNull();
  });

  it("i contatori che non sono nella lista non svegliano", () => {
    expect(fattoNuovo(analisi({ commesseAttive: 10 }), { commesseAttive: 40 })).toBeNull();
  });

  it("un contatore che prima non esisteva non è un peggioramento provato", () => {
    expect(fattoNuovo(analisi({}), { merceInRitardo: 5 })).toBeNull();
  });

  it("fra due analisi passa comunque almeno mezz'ora", () => {
    expect(INTERVALLO_MINIMO_MS).toBe(30 * 60 * 1000);
  });
});
