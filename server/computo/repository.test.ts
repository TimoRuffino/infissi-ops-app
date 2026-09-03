import { describe, expect, it } from "vitest";
import { createMemoryComputiRepository, type ComputoPersist } from "./repository";

const NOW = new Date("2026-09-03T10:00:00.000Z");
const computo = (commessaId = 10, hashRighe = "h1"): ComputoPersist => ({
  sedeId: 1, commessaId, hashRighe, hashParametri: "p1", tariffeAl: "2026-09-03", zona: "D",
  esito: "ok", check1Cent: 2000000, check2Cent: 1800000, deiProdottiCent: 1750000, limiteCent: 1800000,
  detraibileCent: 1399545, detrazioneStimataCent: 699773, avvertenze: [], createdBy: 5,
  voci: [{ gruppo: "prodotti", codice: "massimale_A", descrizione: "A", codiceDei: null, unita: "€/mq", prezzoUnitCent: 78000, quantita: 20.564, limiteCent: 1603992, dettaglio: { zona: "D" }, ordine: 1, inclusa: true, inCheck1: true, inCheck2: false }],
});

describe("repository computi (memoria)", () => {
  it("salva con id progressivo e restituisce l'ultimo per commessa e sede", async () => {
    const repo = createMemoryComputiRepository();
    const primo = await repo.salva({ computo: computo(), now: NOW });
    const secondo = await repo.salva({ computo: computo(10, "h2"), now: new Date("2026-09-04T10:00:00.000Z") });
    expect(secondo.id).toBeGreaterThan(primo.id);
    expect((await repo.ultimo(1, 10))?.hashRighe).toBe("h2");
    expect((await repo.ultimo(1, 10))?.voci[0].codice).toBe("massimale_A");
    expect((await repo.ultimo(1, 10))?.tariffeAl).toBe("2026-09-03");
    expect(await repo.ultimo(2, 10)).toBeNull();
  });
});
