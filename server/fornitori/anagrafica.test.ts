// L'anagrafica dei fornitori è un modulo foglia: la leggono il router, il
// riconoscitore e il pre-filtro della posta senza passare da nessun ciclo.
import { describe, expect, it } from "vitest";
import { fornitoriDiSede, fornitoreDiSedeById, storeFornitori } from "./anagrafica";

const SEDE = 96_401;

function seminaPerTest(): number {
  const id = storeFornitori.prossimoId();
  const now = new Date();
  storeFornitori.items.push({
    id,
    sedeId: SEDE,
    ragioneSociale: "Vetreria Bianchi",
    categoria: "vetro",
    attivo: true,
    createdAt: now,
    updatedAt: now,
  } as any);
  return id;
}

describe("anagrafica fornitori", () => {
  it("legge i fornitori di una sede e non quelli delle altre", () => {
    const id = seminaPerTest();
    expect(fornitoriDiSede(SEDE).map(f => f.id)).toContain(id);
    expect(fornitoriDiSede(SEDE + 1).map(f => f.id)).not.toContain(id);
  });

  it("un fornitore di un'altra sede non si risolve", () => {
    const id = seminaPerTest();
    expect(fornitoreDiSedeById(id, SEDE)?.ragioneSociale).toBe("Vetreria Bianchi");
    expect(fornitoreDiSedeById(id, SEDE + 1)).toBeNull();
  });
});
