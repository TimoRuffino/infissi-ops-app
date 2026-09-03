import { describe, expect, it } from "vitest";
import { createMemoryContrattiRepository } from "./repository";
import type { ContrattoPersist, RigaPersist } from "./repository";

const NOW = new Date("2026-09-03T10:00:00.000Z");
function contratto(sedeId = 1, commessaId = 10): ContrattoPersist {
  return {
    commessaId, sedeId, pattuitoCent: 1539500, pattuitoTipo: "lordo", posaInclusa: true,
    notePosa: null, comuneCantiere: "Sarzana", codiceIstat: null, zonaClimatica: "D",
    zonaManuale: false, piano: 2, distanzaKm: 18, detrazioneTipo: "ristrutturazione",
    detrazioneImmobile: "prima_casa", detrazionePct: 50, dataFirma: "2026-08-20",
    rate: [{ numero: 1, quotaPct: 50, giorni: 0, data: null, descrizione: "all'ordine" }],
    opzioniComputo: { rilievo: "foro", speseProfessionali: false, eventuali: [] },
    hashRighe: "h1", hashParametri: "p1", origine: "manuale", documentoId: null,
    createdBy: 7, updatedBy: 7,
  };
}
function riga(commessaId = 10, ordine = 1): RigaPersist {
  return {
    sedeId: 1, commessaId, ordine, categoria: "serramento_pvc", tipologia: "portafinestra_2_ante",
    oscuranteIntegrato: null, oscuranteTipologia: null, descrizione: "Portafinestra 2 ante", quantita: 3,
    larghezzaMm: 1900, altezzaMm: 2400, mq: 13.68, misuraDei: null, prezzoUnitCent: null,
    prezzoTotCent: 824746, beneSignificativo: true, accessori: [{ codice: "ribalta", quantita: 3 }],
    note: null, origine: "manuale", evidenza: null,
  };
}

describe("repository contratti (memoria)", () => {
  it("salva e rilegge contratto e righe nell'ordine dichiarato", async () => {
    const repo = createMemoryContrattiRepository();
    const esito = await repo.salva({ contratto: contratto(), righe: [riga(10, 2), riga(10, 1)], now: NOW });
    expect(esito.contratto.createdAt).toEqual(NOW);
    expect(esito.righe.map(r => r.ordine)).toEqual([1, 2]);
    expect(esito.righe[0].id).toBeGreaterThan(0);
    expect(await repo.getContratto(1, 10)).toMatchObject({ pattuitoCent: 1539500, zonaClimatica: "D" });
    expect((await repo.listRighe(1, 10)).map(r => r.accessori)).toEqual([[{ codice: "ribalta", quantita: 3 }], [{ codice: "ribalta", quantita: 3 }]]);
  });
  it("sostituisce le righe a ogni salvataggio e aggiorna il contratto", async () => {
    const repo = createMemoryContrattiRepository();
    await repo.salva({ contratto: contratto(), righe: [riga(), riga(10, 2)], now: NOW });
    const dopo = new Date("2026-09-04T10:00:00.000Z");
    const esito = await repo.salva({ contratto: { ...contratto(), pattuitoCent: 1600000 }, righe: [riga()], now: dopo });
    expect(esito.righe).toHaveLength(1);
    expect(esito.contratto.createdAt).toEqual(NOW);
    expect(esito.contratto.updatedAt).toEqual(dopo);
    expect(esito.contratto.pattuitoCent).toBe(1600000);
  });
  it("isola le sedi: la sede 2 non vede la commessa della sede 1", async () => {
    const repo = createMemoryContrattiRepository();
    await repo.salva({ contratto: contratto(1, 10), righe: [riga()], now: NOW });
    expect(await repo.getContratto(2, 10)).toBeNull();
    expect(await repo.listRighe(2, 10)).toEqual([]);
  });
  it("rifiuta un salvataggio da un'altra sede sulla stessa commessa", async () => {
    const repo = createMemoryContrattiRepository();
    await repo.salva({ contratto: contratto(1, 10), righe: [], now: NOW });
    await expect(
      repo.salva({ contratto: { ...contratto(1, 10), sedeId: 2 }, righe: [], now: NOW })
    ).rejects.toThrow("NOT_FOUND");
  });
  it("scrive su ogni riga la sede del contratto, ignorando quella passata dal chiamante", async () => {
    const repo = createMemoryContrattiRepository();
    // riga() genera sempre sedeId: 1: qui il contratto è della sede 2, la
    // riga deve comunque finire con sedeId 2, non con quello (sbagliato) 1.
    const esito = await repo.salva({ contratto: contratto(2, 20), righe: [riga(20, 1)], now: NOW });
    expect(esito.righe[0].sedeId).toBe(2);
    expect((await repo.listRighe(2, 20))[0].sedeId).toBe(2);
  });
});
