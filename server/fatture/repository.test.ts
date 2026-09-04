// Repository di fatture, righe, riepilogo IVA, scadenze, eventi e
// configurazione per sede: suite in memoria (stesso comportamento della
// suite Postgres in repository.pg.test.ts, senza database).
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryFattureRepository, type FattureRepository } from "./repository";

const ora = new Date("2026-09-04T09:00:00Z");
const fattura = (sedeId = 1) => ({
  sedeId, commessaId: 10, computoId: null, hashRighe: "h", tipo: "fattura" as const, notaCreditoDi: null, stato: "bozza" as const,
  ficDocumentId: null, numero: null, data: null, clienteSnapshot: null, pattuitoTipo: "lordo" as const, pattuitoCent: 100000,
  imponibileCent: 0, ivaCent: 0, totaleCent: 0, deltaPattuitoCent: 0, markupCent: 0, stornoCent: 0, diciture: [], note: null,
  intestazioneCantiere: null, detrazioneTipo: "nessuna" as const, pdfStorageKey: null, xmlStorageKey: null, xmlSha256: null, documentoId: null,
  eiStatusFic: null, eiErrore: null, inviataDryRun: false, scavalcoLimiti: false, scavalcoMotivo: null, createdBy: 5, emessaDa: null, emessaAt: null,
});
const riga = (ordine: number) => ({ ordine, tipo: "bene" as const, descrizione: `r${ordine}`, quantita: 1, prezzoUnitCent: 100, importoCent: 100, aliquota: 22 as const, voceComputoCodice: null, rigaCommessaId: null, limiteCent: null, beneSignificativo: true, derivata: false });
const scadenza = (numero: number) => ({ numero, quotaPct: 50, data: "2026-09-04", importoCent: 50, descrizione: null });

describe("repository fatture (memoria)", () => {
  let repo: FattureRepository;
  beforeEach(() => { repo = createMemoryFattureRepository(); });

  it("crea, rilegge per id/commessa e isola la sede", async () => {
    const f = await repo.crea({ fattura: fattura(), righe: [riga(2), riga(1)], riepilogo: [{ aliquota: 22, imponibileCent: 200, impostaCent: 44 }], scadenze: [scadenza(1), scadenza(2)], now: ora });
    expect(f.id).toBeGreaterThan(0);
    expect(f.revisione).toBe(1);
    expect(f.righe.map(r => r.ordine)).toEqual([1, 2]);
    expect((await repo.perId(1, f.id))?.scadenze).toHaveLength(2);
    expect(await repo.perId(2, f.id)).toBeNull();
    expect(await repo.perCommessa(1, 10)).toHaveLength(1);
    expect(await repo.perCommessa(2, 10)).toHaveLength(0);
  });

  it("aggiornaBozza rispetta la revisione e conserva lo stato delle scadenze già collegate", async () => {
    const f = await repo.crea({ fattura: fattura(), righe: [riga(1)], riepilogo: [], scadenze: [scadenza(1)], now: ora });
    await repo.aggiornaScadenza({ sedeId: 1, fatturaId: f.id, numero: 1, patch: { ficPaymentId: 77, stato: "pagata" } });
    const g = await repo.aggiornaBozza({ sedeId: 1, id: f.id, revisioneAttesa: 1, patch: { note: "ok", totaleCent: 999 }, righe: [riga(1), riga(2)], riepilogo: [], scadenze: [scadenza(1), scadenza(2)], now: ora });
    expect(g.revisione).toBe(2);
    expect(g.note).toBe("ok");
    expect(g.righe).toHaveLength(2);
    expect(g.scadenze.find(s => s.numero === 1)?.ficPaymentId).toBe(77);
    expect(g.scadenze.find(s => s.numero === 1)?.stato).toBe("pagata");
    await expect(repo.aggiornaBozza({ sedeId: 1, id: f.id, revisioneAttesa: 1, patch: {}, righe: [], riepilogo: [], scadenze: [], now: ora })).rejects.toThrow(/^CONFLITTO/);
    await expect(repo.aggiornaBozza({ sedeId: 2, id: f.id, revisioneAttesa: 2, patch: {}, righe: [], riepilogo: [], scadenze: [], now: ora })).rejects.toThrow(/^NOT_FOUND/);
  });

  it("aggiornaStato, perFicDocumentId, daSondare, eventi", async () => {
    const f = await repo.crea({ fattura: fattura(), righe: [], riepilogo: [], scadenze: [], now: ora });
    await repo.aggiornaStato({ sedeId: 1, id: f.id, patch: { stato: "emessa", ficDocumentId: 4242, numero: "12/2026", data: "2026-09-04", inviataDryRun: true }, now: ora });
    expect((await repo.perFicDocumentId(1, 4242))?.id).toBe(f.id);
    expect((await repo.daSondare()).map(x => x.id)).toEqual([f.id]);
    await repo.aggiornaStato({ sedeId: 1, id: f.id, patch: { stato: "consegnata" }, now: ora });
    expect(await repo.daSondare()).toHaveLength(0);
    await repo.appendEvento({ fatturaId: f.id, sedeId: 1, tipo: "creata_fic", payload: { ficDocumentId: 4242 }, actorUserId: 5 });
    const eventi = await repo.eventi(1, f.id);
    expect(eventi.map(e => e.tipo)).toEqual(["creata_fic"]);
    expect(await repo.eventi(2, f.id)).toEqual([]);
  });

  it("config: default poi salvataggio per sede", async () => {
    const c = await repo.config(1);
    expect(c.metodoPagamento).toBe("MP05");
    expect(c.scopeScritturaOk).toBe(false);
    const salvata = await repo.salvaConfig({ ...c, iban: "IT00X", vatIdsFic: { 22: 3, 10: 4 } });
    expect((await repo.config(1)).vatIdsFic).toEqual({ 22: 3, 10: 4 });
    expect((await repo.config(2)).iban).toBeNull();
    expect(salvata.updatedAt).toBeInstanceOf(Date);
  });

  it("lista filtra per stato e tipo, più recente prima", async () => {
    const a = await repo.crea({ fattura: fattura(), righe: [], riepilogo: [], scadenze: [], now: ora });
    const b = await repo.crea({ fattura: { ...fattura(), tipo: "nota_credito", notaCreditoDi: a.id }, righe: [], riepilogo: [], scadenze: [], now: new Date(ora.getTime() + 1000) });
    expect((await repo.lista({ sedeId: 1 })).map(f => f.id)).toEqual([b.id, a.id]);
    expect((await repo.lista({ sedeId: 1, tipo: "nota_credito" })).map(f => f.id)).toEqual([b.id]);
    expect(await repo.lista({ sedeId: 1, stati: ["emessa"] })).toEqual([]);
  });
});
