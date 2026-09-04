// Richiede DATABASE_URL di test; senza, la suite è dichiarata skipped.
//   DATABASE_URL=postgres://postgres:test@localhost:55432/tars_test pnpm vitest run server/fatture/repository.pg.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kvSql } from "../_core/persistence";
import { createPostgresFattureRepository, type FattureRepository } from "./repository";

const conDatabase = Boolean(process.env.DATABASE_URL && kvSql);

const ora = new Date("2026-09-04T09:00:00Z");
const SEDE_A = 99410;
const SEDE_B = 99411;
const fattura = (sedeId: number = SEDE_A) => ({
  sedeId, commessaId: 10, computoId: null, hashRighe: "h", tipo: "fattura" as const, notaCreditoDi: null, stato: "bozza" as const,
  ficDocumentId: null, numero: null, data: null, clienteSnapshot: null, pattuitoTipo: "lordo" as const, pattuitoCent: 100000,
  imponibileCent: 0, ivaCent: 0, totaleCent: 0, deltaPattuitoCent: 0, markupCent: 0, stornoCent: 0, diciture: [], note: null,
  intestazioneCantiere: null, detrazioneTipo: "nessuna" as const, pdfStorageKey: null, xmlStorageKey: null, xmlSha256: null, documentoId: null,
  eiStatusFic: null, eiErrore: null, inviataDryRun: false, scavalcoLimiti: false, scavalcoMotivo: null, createdBy: 5, emessaDa: null, emessaAt: null,
});
const riga = (ordine: number) => ({ ordine, tipo: "bene" as const, descrizione: `r${ordine}`, quantita: 1, prezzoUnitCent: 100, importoCent: 100, aliquota: 22 as const, voceComputoCodice: null, rigaCommessaId: null, limiteCent: null, beneSignificativo: true, derivata: false });
const scadenza = (numero: number) => ({ numero, quotaPct: 50, data: "2026-09-04", importoCent: 50, descrizione: null });

describe.skipIf(!conDatabase)("repository fatture (PostgreSQL)", () => {
  const sql = kvSql!;
  const repo: FattureRepository = createPostgresFattureRepository(sql);

  beforeAll(async () => {
    await repo.ensureSchema();
    await sql`DELETE FROM fatture WHERE sede_id IN (${SEDE_A}, ${SEDE_B})`;
    await sql`DELETE FROM fatturazione_config WHERE sede_id IN (${SEDE_A}, ${SEDE_B})`;
  });
  afterAll(async () => {
    await sql`DELETE FROM fatture WHERE sede_id IN (${SEDE_A}, ${SEDE_B})`;
    await sql`DELETE FROM fatturazione_config WHERE sede_id IN (${SEDE_A}, ${SEDE_B})`;
  });

  it("crea, rilegge per id/commessa e isola la sede", async () => {
    const f = await repo.crea({ fattura: fattura(), righe: [riga(2), riga(1)], riepilogo: [{ aliquota: 22, imponibileCent: 200, impostaCent: 44 }], scadenze: [scadenza(1), scadenza(2)], now: ora });
    expect(f.id).toBeGreaterThan(0);
    expect(f.revisione).toBe(1);
    expect(f.righe.map(r => r.ordine)).toEqual([1, 2]);
    expect((await repo.perId(SEDE_A, f.id))?.scadenze).toHaveLength(2);
    expect(await repo.perId(SEDE_B, f.id)).toBeNull();
    expect(await repo.perCommessa(SEDE_A, 10)).toHaveLength(1);
    expect(await repo.perCommessa(SEDE_B, 10)).toHaveLength(0);
  });

  it("aggiornaBozza rispetta la revisione e conserva lo stato delle scadenze già collegate", async () => {
    const f = await repo.crea({ fattura: fattura(), righe: [riga(1)], riepilogo: [], scadenze: [scadenza(1)], now: ora });
    await repo.aggiornaScadenza({ sedeId: SEDE_A, fatturaId: f.id, numero: 1, patch: { ficPaymentId: 77, stato: "pagata" } });
    const g = await repo.aggiornaBozza({ sedeId: SEDE_A, id: f.id, revisioneAttesa: 1, patch: { note: "ok", totaleCent: 999 }, righe: [riga(1), riga(2)], riepilogo: [], scadenze: [scadenza(1), scadenza(2)], now: ora });
    expect(g.revisione).toBe(2);
    expect(g.note).toBe("ok");
    expect(g.righe).toHaveLength(2);
    expect(g.scadenze.find(s => s.numero === 1)?.ficPaymentId).toBe(77);
    expect(g.scadenze.find(s => s.numero === 1)?.stato).toBe("pagata");
    await expect(repo.aggiornaBozza({ sedeId: SEDE_A, id: f.id, revisioneAttesa: 1, patch: {}, righe: [], riepilogo: [], scadenze: [], now: ora })).rejects.toThrow(/^CONFLITTO/);
    await expect(repo.aggiornaBozza({ sedeId: SEDE_B, id: f.id, revisioneAttesa: 2, patch: {}, righe: [], riepilogo: [], scadenze: [], now: ora })).rejects.toThrow(/^NOT_FOUND/);
  });

  it("aggiornaStato, perFicDocumentId, daSondare, eventi", async () => {
    const f = await repo.crea({ fattura: fattura(), righe: [], riepilogo: [], scadenze: [], now: ora });
    await repo.aggiornaStato({ sedeId: SEDE_A, id: f.id, patch: { stato: "emessa", ficDocumentId: 4242, numero: "12/2026", data: "2026-09-04", inviataDryRun: true }, now: ora });
    expect((await repo.perFicDocumentId(SEDE_A, 4242))?.id).toBe(f.id);
    expect((await repo.daSondare()).map(x => x.id)).toContain(f.id);
    await repo.aggiornaStato({ sedeId: SEDE_A, id: f.id, patch: { stato: "consegnata" }, now: ora });
    expect((await repo.daSondare()).map(x => x.id)).not.toContain(f.id);
    await repo.appendEvento({ fatturaId: f.id, sedeId: SEDE_A, tipo: "creata_fic", payload: { ficDocumentId: 4242 }, actorUserId: 5 });
    const eventi = await repo.eventi(SEDE_A, f.id);
    expect(eventi.map(e => e.tipo)).toEqual(["creata_fic"]);
    expect(await repo.eventi(SEDE_B, f.id)).toEqual([]);
  });

  it("config: default poi salvataggio per sede", async () => {
    const c = await repo.config(SEDE_A);
    expect(c.metodoPagamento).toBe("MP05");
    expect(c.scopeScritturaOk).toBe(false);
    const salvata = await repo.salvaConfig({ ...c, iban: "IT00X", vatIdsFic: { 22: 3, 10: 4 } });
    expect((await repo.config(SEDE_A)).vatIdsFic).toEqual({ 22: 3, 10: 4 });
    expect((await repo.config(SEDE_B)).iban).toBeNull();
    expect(salvata.updatedAt).toBeInstanceOf(Date);
  });

  it("lista filtra per stato e tipo, più recente prima", async () => {
    const a = await repo.crea({ fattura: fattura(), righe: [], riepilogo: [], scadenze: [], now: ora });
    const b = await repo.crea({ fattura: { ...fattura(), tipo: "nota_credito", notaCreditoDi: a.id }, righe: [], riepilogo: [], scadenze: [], now: new Date(ora.getTime() + 1000) });
    const lista = await repo.lista({ sedeId: SEDE_A });
    // La suite Postgres condivide lo stato fra i casi (beforeAll pulisce
    // una sola volta, non beforeEach): altre fatture di SEDE_A esistono
    // già dai test precedenti, quindi qui non si verifica l'uguaglianza
    // con l'intera lista, solo che b precede a (più recente prima).
    expect(lista.findIndex(f => f.id === b.id)).toBeLessThan(lista.findIndex(f => f.id === a.id));
    expect((await repo.lista({ sedeId: SEDE_A, tipo: "nota_credito" })).map(f => f.id)).toEqual([b.id]);
    // Nessuna fattura di questa suite resta in "emessa": il test
    // precedente la sposta a "consegnata" prima di finire.
    expect(await repo.lista({ sedeId: SEDE_A, stati: ["emessa"] })).toEqual([]);
    // Le liste non portano le righe: un `crea` con righe (nel primo test
    // di questa suite) non deve trapelare nel risultato di `lista`.
    expect(lista.every(f => f.righe.length === 0 && f.riepilogo.length === 0 && f.scadenze.length === 0)).toBe(true);
  });

  it("due righe con derivata diverse e aliquota null tornano com'erano", async () => {
    const f = await repo.crea({
      fattura: fattura(),
      righe: [
        { ordine: 1, tipo: "intestazione", descrizione: "Cantiere", quantita: 1, prezzoUnitCent: 0, importoCent: 0, aliquota: null, voceComputoCodice: null, rigaCommessaId: null, limiteCent: null, beneSignificativo: false, derivata: false },
        { ordine: 2, tipo: "markup", descrizione: "Markup 8%", quantita: 1, prezzoUnitCent: 800, importoCent: 800, aliquota: 22, voceComputoCodice: null, rigaCommessaId: null, limiteCent: null, beneSignificativo: false, derivata: true },
      ],
      riepilogo: [], scadenze: [], now: ora,
    });
    expect(f.righe[0].aliquota).toBeNull();
    expect(f.righe[0].derivata).toBe(false);
    expect(f.righe[1].aliquota).toBe(22);
    expect(f.righe[1].derivata).toBe(true);
    // Rilettura: lo stesso bulk insert misto (NULL su una riga, valore
    // sull'altra; booleano true su una riga, false sull'altra) deve
    // tornare identico anche dopo un giro completo su Postgres, non solo
    // nel RETURNING del comando appena eseguito.
    const riletta = await repo.perId(SEDE_A, f.id);
    expect(riletta?.righe[0].aliquota).toBeNull();
    expect(riletta?.righe[0].derivata).toBe(false);
    expect(riletta?.righe[1].aliquota).toBe(22);
    expect(riletta?.righe[1].derivata).toBe(true);
  });

  it("il DATE della scadenza torna come YYYY-MM-DD", async () => {
    const f = await repo.crea({ fattura: fattura(), righe: [], riepilogo: [], scadenze: [scadenza(1)], now: ora });
    // La colonna è DATE: il driver la restituisce come Date, non come
    // stringa. Deve tornare "2026-09-04", non un formato locale.
    expect(f.scadenze[0].data).toBe("2026-09-04");
    const riletta = await repo.perId(SEDE_A, f.id);
    expect(riletta?.scadenze[0].data).toBe("2026-09-04");
  });
});
