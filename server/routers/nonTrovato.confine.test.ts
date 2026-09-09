// Guardia STRUTTURALE (WS3 spec §8): nei router un record assente o di
// un'altra sede dà NOT_FOUND, mai un `Error` generico (500). Le 98 coppie
// «throw new Error("… non trovato") + assertSedeScope» sono diventate
// `recordOppureNotFound`/`oppureNotFound`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileSorgente, relativo } from "../_core/sorgentiDiProva";

const RE = /throw new Error\((["'`])[^"'`]*non trovat/i;

describe("router senza Error generici di «non trovato»", () => {
  it("nessun router lancia Error('… non trovato')", () => {
    const colpevoli = fileSorgente(["server/routers"])
      .filter(f => !f.endsWith(".test.ts"))
      .filter(f => RE.test(readFileSync(f, "utf8")))
      .map(relativo);
    expect(colpevoli).toEqual([]);
  });
});
