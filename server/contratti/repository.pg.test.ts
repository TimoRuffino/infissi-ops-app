// Richiede DATABASE_URL di test; senza, la suite è dichiarata skipped.
//   DATABASE_URL=postgres://postgres:test@localhost:55432/tars_test pnpm vitest run server/contratti/repository.pg.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kvSql } from "../_core/persistence";
import { createPostgresContrattiRepository } from "./repository";

const conDatabase = Boolean(process.env.DATABASE_URL && kvSql);

describe.skipIf(!conDatabase)("repository contratti (PostgreSQL)", () => {
  const sql = kvSql!;
  const SEDE = 99310;
  const repo = createPostgresContrattiRepository(sql);
  beforeAll(async () => {
    await repo.ensureSchema();
    await sql`DELETE FROM commessa_righe WHERE sede_id = ${SEDE}`;
    await sql`DELETE FROM commessa_contratti WHERE sede_id = ${SEDE}`;
  });
  afterAll(async () => {
    await sql`DELETE FROM commessa_righe WHERE sede_id = ${SEDE}`;
    await sql`DELETE FROM commessa_contratti WHERE sede_id = ${SEDE}`;
  });

  it("upsert del contratto e sostituzione delle righe nella stessa transazione", async () => {
    const now = new Date("2026-09-03T10:00:00.000Z");
    const base = {
      commessaId: 991001, sedeId: SEDE, pattuitoCent: 1539500, pattuitoTipo: "lordo" as const,
      posaInclusa: true, notePosa: null, comuneCantiere: "Sarzana", codiceIstat: null,
      zonaClimatica: "D" as const, zonaManuale: false, piano: 2, distanzaKm: 18,
      detrazioneTipo: "ristrutturazione" as const, detrazioneImmobile: "prima_casa" as const,
      detrazionePct: 50, dataFirma: "2026-08-20", rate: [],
      opzioniComputo: { rilievo: "foro" as const, speseProfessionali: false, eventuali: [] },
      hashRighe: "h", hashParametri: "p",
      origine: "manuale" as const, documentoId: null, createdBy: 1, updatedBy: 1,
    };
    const riga = {
      sedeId: SEDE, commessaId: 991001, ordine: 1, categoria: "serramento_pvc" as const,
      tipologia: "finestra_2_ante", oscuranteIntegrato: null, oscuranteTipologia: null, descrizione: "Finestra", quantita: 2,
      larghezzaMm: 1660, altezzaMm: 1540, mq: 5.1128, misuraDei: null, prezzoUnitCent: null,
      prezzoTotCent: 300000, beneSignificativo: true, accessori: [{ codice: "ribalta", quantita: 2 }],
      note: null, origine: "manuale" as const, evidenza: null,
    };
    // Inserimento in blocco: due righe in una sola INSERT. La prima ha
    // `evidenza` null e la seconda un oggetto — l'ordine peggiore per
    // l'inferenza di tipo dell'helper multi-riga di postgres-js.
    const primo = await repo.salva({
      contratto: base,
      righe: [riga, { ...riga, ordine: 2, evidenza: { pagina: 3, frammento: "riga 2" } }],
      now,
    });
    expect(primo.righe).toHaveLength(2);
    expect(primo.righe.map(r => r.ordine)).toEqual([1, 2]);
    expect(primo.righe[0].evidenza).toBeNull();
    expect(primo.righe[1].evidenza).toEqual({ pagina: 3, frammento: "riga 2" });
    expect(primo.righe[0].accessori).toEqual([{ codice: "ribalta", quantita: 2 }]);
    expect(primo.righe.every(r => r.sedeId === SEDE && r.commessaId === 991001)).toBe(true);
    expect((await repo.listRighe(SEDE, 991001)).map(r => r.evidenza)).toEqual([
      null,
      { pagina: 3, frammento: "riga 2" },
    ]);
    const secondo = await repo.salva({ contratto: { ...base, pattuitoCent: 1600000 }, righe: [riga], now: new Date("2026-09-04T10:00:00.000Z") });
    expect(secondo.righe).toHaveLength(1);
    expect(secondo.contratto.pattuitoCent).toBe(1600000);
    expect(secondo.contratto.createdAt).toEqual(now);
    expect(secondo.contratto.dataFirma).toBe("2026-08-20");
    const righeSalvate = await repo.listRighe(SEDE, 991001);
    expect(righeSalvate[0].accessori).toEqual([{ codice: "ribalta", quantita: 2 }]);
    expect(righeSalvate[0].mq).toBe(5.1128);
    expect(await repo.getContratto(SEDE + 1, 991001)).toBeNull();
  });

  it("rifiuta un upsert da un'altra sede sulla stessa commessa", async () => {
    const now = new Date();
    const c = {
      commessaId: 991002, sedeId: SEDE, pattuitoCent: 100, pattuitoTipo: "imponibile" as const,
      posaInclusa: false, notePosa: null, comuneCantiere: null, codiceIstat: null, zonaClimatica: null,
      zonaManuale: false, piano: null, distanzaKm: null, detrazioneTipo: "nessuna" as const,
      detrazioneImmobile: null, detrazionePct: null, dataFirma: null, rate: [],
      opzioniComputo: { rilievo: "foro" as const, speseProfessionali: false, eventuali: [] },
      hashRighe: "h", hashParametri: "p", origine: "manuale" as const, documentoId: null, createdBy: null, updatedBy: null,
    };
    await repo.salva({ contratto: c, righe: [], now });
    await expect(repo.salva({ contratto: { ...c, sedeId: SEDE + 1 }, righe: [], now })).rejects.toThrow("NOT_FOUND");
  });
});
