// Quale delle due conferme è la revisione dell'altra — e soprattutto: quando
// NON si può dire.
//
// Fino al 10/09/2026 lo decideva `piuRecente`, che guarda quando il worker ha
// archiviato il file. Su un giro di archiviazione in blocco quell'ordine è
// rumore: i quattro documenti di COM-2026-092 sono entrati in sedici minuti,
// e il CRM ha eletto l'ultimo processato — il più basso dei quattro.
import { describe, expect, it } from "vitest";
import { revisionePerData } from "./revisioneConferma";

describe("revisionePerData", () => {
  it("date diverse: vince la più recente, ed è una prova", () => {
    expect(revisionePerData("2026-07-02", "2026-06-30")).toBe("nuovo");
    expect(revisionePerData("2026-06-30", "2026-07-02")).toBe("originale");
  });

  it("stessa data: nessuna prova, e non si inventa un vincitore", () => {
    // È il caso vero: tutte le copie di ogni ordine hanno la stessa
    // dataDocumento, perché è la data dell'ORDINE, non della revisione.
    expect(revisionePerData("2026-06-16", "2026-06-16")).toBe("nessuna_prova");
  });

  it("una data che manca non è una prova", () => {
    expect(revisionePerData(null, "2026-06-16")).toBe("nessuna_prova");
    expect(revisionePerData("2026-06-16", null)).toBe("nessuna_prova");
    expect(revisionePerData(null, null)).toBe("nessuna_prova");
    expect(revisionePerData("", "2026-06-16")).toBe("nessuna_prova");
  });

  it("una data che non si legge non è una prova", () => {
    expect(revisionePerData("boh", "2026-06-16")).toBe("nessuna_prova");
    expect(revisionePerData("2026-06-16", "31/02/2026")).toBe("nessuna_prova");
    expect(revisionePerData("2026-02-31", "2026-06-16")).toBe("nessuna_prova");
  });
});
