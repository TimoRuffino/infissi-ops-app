// Punto 26 del piano «Tars più intelligente»: due documenti dello stesso
// tipo con contenuto diverso sono due versioni, non un duplicato. Il
// fascicolo non si tocca: si dice quale vale.

import { describe, expect, it } from "vitest";
import { catenePerTipo, statoVersioni } from "./versioniDocumenti";

const doc = (patch: Record<string, unknown> = {}) => ({
  id: 1,
  tipo: "misure",
  nome: "Misure esecutive Rossi 2026-09-01.pdf",
  dataDocumento: "2026-09-01",
  createdAt: new Date("2026-09-01T10:00:00Z"),
  checksum: "aaa",
  ...patch,
});

describe("catene di versioni", () => {
  it("due misure diverse: vale la più recente, l'altra è superata", () => {
    const [catena] = catenePerTipo([
      doc(),
      doc({ id: 2, checksum: "bbb", dataDocumento: "2026-09-06", nome: "Misure esecutive Rossi 2026-09-06.pdf" }),
    ]);
    expect(catena.tipo).toBe("misure");
    expect(catena.vigente.id).toBe(2);
    expect(catena.superate.map(d => d.id)).toEqual([1]);
  });

  it("lo stesso file caricato due volte non è una versione nuova", () => {
    expect(catenePerTipo([doc(), doc({ id: 2 })])).toEqual([]);
  });

  it("un solo documento del tipo non fa catena", () => {
    expect(catenePerTipo([doc()])).toEqual([]);
  });

  it("foto, DDT e fatture sono molti per natura, non versioni", () => {
    for (const tipo of ["foto", "ddt_consegna", "fattura", "conferma_ordine", "altro"]) {
      expect(
        catenePerTipo([doc({ tipo }), doc({ id: 2, tipo, checksum: "bbb" })])
      ).toEqual([]);
    }
  });

  it("senza data del documento decide la data di caricamento", () => {
    const [catena] = catenePerTipo([
      doc({ dataDocumento: null }),
      doc({ id: 2, checksum: "bbb", dataDocumento: null, createdAt: new Date("2026-09-07T10:00:00Z") }),
    ]);
    expect(catena.vigente.id).toBe(2);
  });

  it("le catene più lunghe vengono prima", () => {
    const catene = catenePerTipo([
      doc({ tipo: "preventivo" }),
      doc({ id: 2, tipo: "preventivo", checksum: "bbb", dataDocumento: "2026-09-02" }),
      doc({ id: 3, tipo: "misure", checksum: "ccc" }),
      doc({ id: 4, tipo: "misure", checksum: "ddd", dataDocumento: "2026-09-03" }),
      doc({ id: 5, tipo: "misure", checksum: "eee", dataDocumento: "2026-09-04" }),
    ]);
    expect(catene[0].tipo).toBe("misure");
    expect(catene[0].superate).toHaveLength(2);
  });
});

describe("stato per documento", () => {
  it("dice quale vale e da chi è superato", () => {
    const stato = statoVersioni([
      doc(),
      doc({ id: 2, checksum: "bbb", dataDocumento: "2026-09-06" }),
    ]);
    expect(stato.get(2)).toEqual({ vigente: true, superatoDa: null, quante: 2 });
    expect(stato.get(1)).toEqual({ vigente: false, superatoDa: 2, quante: 2 });
  });

  it("un documento senza catena non compare: non c'è niente da dire", () => {
    expect(statoVersioni([doc()]).size).toBe(0);
  });
});
