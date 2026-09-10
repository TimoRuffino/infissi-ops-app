// L'anagrafica dei fornitori è un modulo foglia: la leggono il router, il
// riconoscitore e il pre-filtro della posta senza passare da nessun ciclo.
import { describe, expect, it } from "vitest";
import {
  applicaBackfillFornitori,
  fornitoriDiSede,
  fornitoreDiSedeById,
  storeFornitori,
} from "./anagrafica";

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

  it("i record salvati prima dei campi nuovi li ricevono col default", () => {
    // Il backfill di onLoad, sulla forma di un record legacy.
    const legacy: any = { id: 1, sedeId: SEDE, ragioneSociale: "Vecchio", categoria: "altro", attivo: true };
    applicaBackfillFornitori([legacy]);
    expect(legacy.chiavi).toEqual([]);
    expect(legacy.canale).toBe("mail");
    expect(legacy.portaleDomini).toEqual([]);
  });

  it("il backfill non sovrascrive quello che c'è già", () => {
    const pieno: any = {
      id: 2, sedeId: SEDE, ragioneSociale: "Wnd", categoria: "pvc", attivo: true,
      chiavi: ["wnd"], canale: "portale", portaleDomini: ["antenore.biz"],
    };
    applicaBackfillFornitori([pieno]);
    expect(pieno.chiavi).toEqual(["wnd"]);
    expect(pieno.canale).toBe("portale");
    expect(pieno.portaleDomini).toEqual(["antenore.biz"]);
  });
});
