// Richiede DATABASE_URL di test; senza, la suite è dichiarata skipped.
//   DATABASE_URL=postgres://postgres:test@localhost:55432/tars_test pnpm vitest run server/contratti/estrazione/repository.pg.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CampoProposto, PropostaContratto } from "@shared/contratti/estrazione";
import { kvSql } from "../../_core/persistence";
import { createPostgresEstrazioniRepository } from "./repository";
import type { EstrazionePersist } from "./repository";

const conDatabase = Boolean(process.env.DATABASE_URL && kvSql);

function campo<T>(valore: T): CampoProposto<T> {
  return { valore, evidenza: null, daVerificare: false, nota: null };
}

// Come nel test in memoria: piena di `null` e array vuoti, perché è
// esattamente quello che deve sopravvivere al giro JSONB su Postgres.
function proposta(): PropostaContratto {
  return {
    righe: [
      {
        ordine: 1,
        categoria: campo("serramento_pvc"),
        tipologia: campo(null),
        descrizione: campo("Finestra 2 ante"),
        quantita: campo(2),
        larghezzaMm: campo(1200),
        altezzaMm: campo(1400),
        prezzoTotCent: campo(150000),
        oscuranteIntegrato: campo(null),
        oscuranteTipologia: campo(null),
        accessori: [],
        beneSignificativo: true,
        note: null,
        avvertenze: [],
      },
    ],
    pattuitoCent: campo(1500000),
    pattuitoTipo: campo("lordo"),
    posaInclusa: campo(true),
    posaCent: campo(null),
    notePosa: null,
    rate: campo([]),
    comuneCantiere: campo("Sarzana"),
    indirizzoCantiere: campo(null),
    provinciaCantiere: null,
    piano: campo(null),
    dataFirma: campo("2026-08-20"),
    riferimento: campo(null),
    clienteCitato: campo("Mario Rossi"),
    detrazioneTipo: campo(null),
    note: null,
    controlli: [],
    avvertenze: [],
  };
}

function estrazione(sedeId: number, overrides: Partial<EstrazionePersist> = {}): EstrazionePersist {
  return {
    sedeId,
    commessaId: 991101,
    documentoId: 991200,
    documentoChecksum: "checksum-abc",
    stato: "proposta",
    promptVersione: "v1",
    modello: "modello-x",
    runId: "run-1",
    pagine: 3,
    ocr: false,
    parser: "pdf-parse",
    proposta: proposta(),
    createdBy: 7,
    applicataAt: null,
    applicataBy: null,
    scartataMotivo: null,
    ...overrides,
  };
}

describe.skipIf(!conDatabase)("repository estrazioni (PostgreSQL)", () => {
  const sql = kvSql!;
  const SEDE = 99320;
  const repo = createPostgresEstrazioniRepository(sql);

  beforeAll(async () => {
    await repo.ensureSchema();
  });
  beforeEach(async () => {
    await sql`DELETE FROM contratto_estrazioni WHERE sede_id = ${SEDE} OR sede_id = ${SEDE + 1}`;
  });
  afterAll(async () => {
    await sql`DELETE FROM contratto_estrazioni WHERE sede_id = ${SEDE} OR sede_id = ${SEDE + 1}`;
  });

  it("crea e rilegge un'estrazione: la proposta fa il giro JSONB con null e array vuoti intatti", async () => {
    const now = new Date("2026-09-04T10:00:00.000Z");
    const creata = await repo.crea({ ...estrazione(SEDE), now });
    expect(creata.id).toBeGreaterThan(0);
    expect(creata.createdAt).toEqual(now);
    expect(creata.applicataAt).toBeNull();
    expect(creata.scartataMotivo).toBeNull();

    const riletta = await repo.perId(SEDE, creata.id);
    expect(riletta).not.toBeNull();
    expect(riletta!.proposta).toEqual(proposta());
    expect(riletta!.proposta.posaCent.valore).toBeNull();
    expect(riletta!.proposta.righe[0].accessori).toEqual([]);
    expect(riletta!.proposta.controlli).toEqual([]);
    expect(riletta!.proposta.notePosa).toBeNull();
    expect(await repo.perId(SEDE + 1, creata.id)).toBeNull();
  });

  it("aggiornaStato da un'altra sede rifiuta con NOT_FOUND", async () => {
    const now = new Date();
    const creata = await repo.crea({ ...estrazione(SEDE), now });
    await expect(
      repo.aggiornaStato({ sedeId: SEDE + 1, id: creata.id, stato: "applicata", now })
    ).rejects.toThrow("NOT_FOUND: Estrazione non trovata.");
  });

  it("aggiornaStato a 'applicata' valorizza applicataAt e applicataBy", async () => {
    const now = new Date("2026-09-04T10:00:00.000Z");
    const dopo = new Date("2026-09-04T11:00:00.000Z");
    const creata = await repo.crea({ ...estrazione(SEDE), now });
    const aggiornata = await repo.aggiornaStato({
      sedeId: SEDE,
      id: creata.id,
      stato: "applicata",
      applicataBy: 42,
      now: dopo,
    });
    expect(aggiornata.stato).toBe("applicata");
    expect(aggiornata.applicataAt).toEqual(dopo);
    expect(aggiornata.applicataBy).toBe(42);
    expect(await repo.perId(SEDE, creata.id)).toMatchObject({
      stato: "applicata",
      applicataBy: 42,
    });
  });

  it("aggiornaStato a 'scartata' valorizza scartataMotivo", async () => {
    const now = new Date();
    const creata = await repo.crea({ ...estrazione(SEDE), now });
    const aggiornata = await repo.aggiornaStato({
      sedeId: SEDE,
      id: creata.id,
      stato: "scartata",
      scartataMotivo: "Contratto illeggibile",
      now,
    });
    expect(aggiornata.stato).toBe("scartata");
    expect(aggiornata.scartataMotivo).toBe("Contratto illeggibile");
  });

  it("ultimaPerDocumento dà la più recente indipendentemente dallo stato", async () => {
    const now = new Date("2026-09-04T10:00:00.000Z");
    const dopo = new Date("2026-09-04T11:00:00.000Z");
    const prima = await repo.crea({ ...estrazione(SEDE, { documentoId: 991201 }), now });
    const seconda = await repo.crea({
      ...estrazione(SEDE, { documentoId: 991201, documentoChecksum: "checksum-diverso", stato: "scartata" }),
      now: dopo,
    });
    const ultima = await repo.ultimaPerDocumento(SEDE, 991201);
    expect(ultima!.id).toBe(seconda.id);
    expect(ultima!.id).not.toBe(prima.id);
  });

  it("riusabile trova la proposta con la stessa firma e ignora quella scartata", async () => {
    const now = new Date("2026-09-04T10:00:00.000Z");
    const dopo = new Date("2026-09-04T11:00:00.000Z");
    const buona = await repo.crea({
      ...estrazione(SEDE, { documentoId: 991202, documentoChecksum: "abc", promptVersione: "v1", stato: "proposta" }),
      now,
    });
    // Stessa firma, ma scartata e più recente: `riusabile` deve comunque
    // restituire quella buona, non questa.
    await repo.crea({
      ...estrazione(SEDE, { documentoId: 991202, documentoChecksum: "abc", promptVersione: "v1", stato: "scartata" }),
      now: dopo,
    });
    const trovata = await repo.riusabile(SEDE, 991202, "abc", "v1");
    expect(trovata!.id).toBe(buona.id);
    expect(trovata!.stato).toBe("proposta");
    expect(await repo.riusabile(SEDE, 991202, "checksum-sbagliato", "v1")).toBeNull();
    expect(await repo.riusabile(SEDE, 991202, "abc", "v2")).toBeNull();
  });

  it("perCommessa restituisce le estrazioni della sede, più recente prima", async () => {
    const now = new Date("2026-09-04T10:00:00.000Z");
    const dopo = new Date("2026-09-04T11:00:00.000Z");
    const prima = await repo.crea({ ...estrazione(SEDE, { commessaId: 991300 }), now });
    const seconda = await repo.crea({ ...estrazione(SEDE, { commessaId: 991300 }), now: dopo });
    await repo.crea({ ...estrazione(SEDE, { commessaId: 991301 }), now: dopo });
    await repo.crea({ ...estrazione(SEDE + 1, { commessaId: 991300 }), now: dopo });
    const elenco = await repo.perCommessa(SEDE, 991300);
    expect(elenco.map(e => e.id)).toEqual([seconda.id, prima.id]);
  });
});
