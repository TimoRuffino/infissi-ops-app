// I tipi documento vivevano in due liste: una nel router e una copiata a mano
// dentro CommessaDetail, con un commento che dichiarava il contrario. Le due
// erano già divergenti nelle etichette, e accorpare «ordine» nel server non
// cambiava il menu a tendina. Da qui in poi la lista è una sola.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DOC_TIPI, DOC_TIPO_LABEL } from "@shared/docTipi";

function sorgente(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("tipi documento — una lista sola", () => {
  it("etichetta ogni tipo, senza voci orfane", () => {
    expect(Object.keys(DOC_TIPO_LABEL).sort()).toEqual([...DOC_TIPI].sort());
  });

  it("non offre più «ordine»: è accorpato nella conferma", () => {
    expect(DOC_TIPI).not.toContain("ordine");
    expect(DOC_TIPI).toContain("conferma_ordine");
  });

  it("la scheda commessa usa la lista condivisa, non una sua copia", () => {
    const source = sorgente("../pages/CommessaDetail.tsx");

    expect(source).toMatch(/from "@shared\/docTipi"/);
    // Nessuna seconda mappa locale che possa divergere di nuovo.
    expect(source).not.toMatch(/const DOC_TIPO_LABEL/);
  });
});
