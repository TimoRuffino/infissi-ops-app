// Richiede DATABASE_URL di test; senza, la suite è dichiarata skipped.
//   DATABASE_URL=postgres://postgres:test@localhost:55432/tars_test pnpm vitest run server/computo/repository.pg.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kvSql } from "../_core/persistence";
import { createPostgresComputiRepository } from "./repository";

const conDatabase = Boolean(process.env.DATABASE_URL && kvSql);

describe.skipIf(!conDatabase)("repository computi (PostgreSQL)", () => {
  const sql = kvSql!;
  const SEDE = 99320;
  const repo = createPostgresComputiRepository(sql);
  beforeAll(async () => {
    await repo.ensureSchema();
    await sql`DELETE FROM computi WHERE sede_id = ${SEDE}`;
  });
  afterAll(async () => {
    await sql`DELETE FROM computi WHERE sede_id = ${SEDE}`;
  });
  it("salva computo e voci, rilegge l'ultimo con le voci in ordine", async () => {
    const base = {
      sedeId: SEDE, commessaId: 992001, hashRighe: "h", hashParametri: "p", tariffeAl: "2026-09-03",
      zona: "D" as const, esito: "ok" as const, check1Cent: 10, check2Cent: 8, deiProdottiCent: 6, limiteCent: 8,
      detraibileCent: null, detrazioneStimataCent: null, avvertenze: ["a"], createdBy: 1,
      voci: [
        { gruppo: "opere" as const, codice: "posa", descrizione: "Posa", codiceDei: "M01024", unita: "h", prezzoUnitCent: 3650, quantita: 18, limiteCent: 131400, dettaglio: { ore: 18 }, ordine: 2, inclusa: true, inCheck1: true, inCheck2: false },
        { gruppo: "prodotti" as const, codice: "massimale_A", descrizione: "A", codiceDei: null, unita: "€/mq", prezzoUnitCent: 78000, quantita: 20.564, limiteCent: 1603992, dettaglio: {}, ordine: 1, inclusa: true, inCheck1: true, inCheck2: false },
      ],
    };
    await repo.salva({ computo: { ...base, hashRighe: "vecchio" }, now: new Date("2026-09-01T00:00:00Z") });
    const nuovo = await repo.salva({ computo: base, now: new Date("2026-09-03T00:00:00Z") });
    // La colonna è DATE: il driver la restituisce come Date, non come stringa.
    // Deve tornare "2026-09-03", non un formato locale (es. "Thu Sep 03").
    expect(nuovo.tariffeAl).toBe("2026-09-03");
    // Inserimento in blocco: le voci tornano dal RETURNING già ordinate per
    // `ordine` (le abbiamo passate al contrario) e con il JSONB riletto.
    expect(nuovo.voci.map(v => v.codice)).toEqual(["massimale_A", "posa"]);
    expect(nuovo.voci[1].dettaglio).toEqual({ ore: 18 });
    expect(nuovo.voci[0].dettaglio).toEqual({});
    expect(nuovo.voci[0].inCheck2).toBe(false);
    // Un computo senza voci non deve produrre un INSERT vuoto.
    const senzaVoci = await repo.salva({
      computo: { ...base, commessaId: 992002, voci: [] },
      now: new Date("2026-09-03T00:00:00Z"),
    });
    expect(senzaVoci.voci).toEqual([]);
    expect((await repo.ultimo(SEDE, 992002))?.voci).toEqual([]);
    const letto = await repo.ultimo(SEDE, 992001);
    expect(letto?.id).toBe(nuovo.id);
    expect(letto?.tariffeAl).toBe("2026-09-03");
    expect(letto?.voci.map(v => v.codice)).toEqual(["massimale_A", "posa"]);
    expect(letto?.voci[1].dettaglio).toEqual({ ore: 18 });
    expect(letto?.voci[0].inCheck2).toBe(false);
    expect(letto?.deiProdottiCent).toBe(6);
    expect(letto?.avvertenze).toEqual(["a"]);
    expect(await repo.ultimo(SEDE + 1, 992001)).toBeNull();

    // Intestazione: stesso record, senza toccare `computo_voci`.
    const intestazione = await repo.ultimoIntestazione(SEDE, 992001);
    expect(intestazione).toMatchObject({
      id: nuovo.id,
      hashRighe: "h",
      hashParametri: "p",
      esito: "ok",
      tariffeAl: "2026-09-03",
    });
    expect(intestazione).not.toHaveProperty("voci");
    expect(intestazione?.avvertenze).toEqual(["a"]);
    expect(await repo.ultimoIntestazione(SEDE + 1, 992001)).toBeNull();
  });
});
