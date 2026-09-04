// Repository di fatture, righe, riepilogo IVA, scadenze, eventi e
// configurazione per sede: suite in memoria (stesso comportamento della
// suite Postgres in repository.pg.test.ts, senza database).
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryFattureRepository, type FattureRepository } from "./repository";
import { versioneFattureCommessa } from "./versioni";

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
const clienteSnapshot = {
  clienteId: 501, nome: "Mario Rossi", tipo: "privato" as const, codiceFiscale: "RSSMRA80A01H501U",
  partitaIva: null, indirizzo: "Via Roma 1", cap: "54100", citta: "Massa", provincia: "MS",
  email: "mario.rossi@example.com", pec: null, codiceDestinatario: "0000000", ficEntityId: null,
  praticaEdilizia: "nessuna" as const,
};

describe("repository fatture (memoria)", () => {
  let repo: FattureRepository;
  beforeEach(() => { repo = createMemoryFattureRepository(); });

  it("crea, rilegge per id/commessa e isola la sede", async () => {
    const f = await repo.crea({ fattura: fattura(), righe: [riga(2), riga(1)], riepilogo: [{ aliquota: 10, imponibileCent: 100, impostaCent: 10 }, { aliquota: 22, imponibileCent: 200, impostaCent: 44 }], scadenze: [scadenza(1), scadenza(2)], now: ora });
    expect(f.id).toBeGreaterThan(0);
    expect(f.revisione).toBe(1);
    expect(f.righe.map(r => r.ordine)).toEqual([1, 2]);
    // Aliquota decrescente (22 poi 10), a prescindere dall'ordine in
    // ingresso: stessa convenzione usata dalla lettura Postgres.
    expect(f.riepilogo.map(r => r.aliquota)).toEqual([22, 10]);
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

  // Ruling R37: la mappa CRM↔FiC del sync non ha un tetto di 200 righe.
  it("perFicDocumentIds legge per id, senza limite e isolando la sede", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 201; i++) {
      const f = await repo.crea({ fattura: fattura(), righe: [riga(1)], riepilogo: [], scadenze: [], now: ora });
      await repo.aggiornaStato({ sedeId: 1, id: f.id, patch: { stato: "emessa", ficDocumentId: 6000 + i }, now: ora });
      ids.push(6000 + i);
    }
    const altraSede = await repo.crea({ fattura: fattura(2), righe: [], riepilogo: [], scadenze: [], now: ora });
    await repo.aggiornaStato({ sedeId: 2, id: altraSede.id, patch: { ficDocumentId: 6999 }, now: ora });

    const trovate = await repo.perFicDocumentIds(1, [...ids, 6999, 12345]);
    expect(trovate).toHaveLength(201);
    expect(trovate.map(f => f.ficDocumentId)).toContain(6000);
    expect(trovate.map(f => f.ficDocumentId)).not.toContain(6999);
    // Come `lista`: niente righe nel risultato.
    expect(trovate.every(f => f.righe.length === 0)).toBe(true);
    expect(await repo.perFicDocumentIds(1, [])).toEqual([]);
  });

  it("config: default poi salvataggio per sede", async () => {
    const c = await repo.config(1);
    expect(c.metodoPagamento).toBe("MP05");
    expect(c.scopeScritturaOk).toBe(false);
    // R17: le spese di documentazione detrazione, 150,00 € salvo diverso valore di sede.
    expect(c.speseDocumentazioneCent).toBe(15000);
    const salvata = await repo.salvaConfig({ ...c, iban: "IT00X", vatIdsFic: { 22: 3, 10: 4 }, speseDocumentazioneCent: 20000 });
    expect((await repo.config(1)).vatIdsFic).toEqual({ 22: 3, 10: 4 });
    expect((await repo.config(1)).speseDocumentazioneCent).toBe(20000);
    expect((await repo.config(2)).iban).toBeNull();
    expect((await repo.config(2)).speseDocumentazioneCent).toBe(15000);
    expect(salvata.updatedAt).toBeInstanceOf(Date);
  });

  // Le fatture scritte prima che lo snapshot avesse `praticaEdilizia`
  // (JSONB già in archivio) devono rileggersi complete: il campo torna
  // col suo default, non `undefined`.
  it("uno snapshot senza praticaEdilizia si completa con «nessuna»", async () => {
    const { praticaEdilizia: _tolto, ...storico } = clienteSnapshot;
    const f = await repo.crea({
      fattura: { ...fattura(), clienteSnapshot: storico as typeof clienteSnapshot },
      righe: [], riepilogo: [], scadenze: [], now: ora,
    });
    expect(f.clienteSnapshot).toEqual(clienteSnapshot);
    expect((await repo.perId(1, f.id))?.clienteSnapshot?.praticaEdilizia).toBe("nessuna");

    const dopoStato = await repo.aggiornaStato({
      sedeId: 1, id: f.id, patch: { clienteSnapshot: storico as typeof clienteSnapshot }, now: ora,
    });
    expect(dopoStato.clienteSnapshot?.praticaEdilizia).toBe("nessuna");
  });

  it("lista filtra per stato e tipo, più recente prima", async () => {
    const a = await repo.crea({ fattura: fattura(), righe: [], riepilogo: [], scadenze: [], now: ora });
    const b = await repo.crea({ fattura: { ...fattura(), tipo: "nota_credito", notaCreditoDi: a.id }, righe: [], riepilogo: [], scadenze: [], now: new Date(ora.getTime() + 1000) });
    expect((await repo.lista({ sedeId: 1 })).map(f => f.id)).toEqual([b.id, a.id]);
    expect((await repo.lista({ sedeId: 1, tipo: "nota_credito" })).map(f => f.id)).toEqual([b.id]);
    expect(await repo.lista({ sedeId: 1, stati: ["emessa"] })).toEqual([]);
  });

  it("clienteSnapshot e diciture: round-trip completo, anche dopo aggiornaStato", async () => {
    const f = await repo.crea({
      fattura: { ...fattura(), clienteSnapshot, diciture: ["intervento_manutenzione", "copia_ade"] },
      righe: [], riepilogo: [], scadenze: [], now: ora,
    });
    expect(f.clienteSnapshot).toEqual(clienteSnapshot);
    expect(f.diciture).toEqual(["intervento_manutenzione", "copia_ade"]);
    const riletta = await repo.perId(1, f.id);
    expect(riletta?.clienteSnapshot).toEqual(clienteSnapshot);
    expect(riletta?.diciture).toEqual(["intervento_manutenzione", "copia_ade"]);

    // Un primo aggiornaStato tocca pdfStorageKey; un secondo, con solo
    // clienteSnapshot nel patch, non deve azzerarlo (senzaUndefined
    // filtra le chiavi assenti prima dell'Object.assign).
    await repo.aggiornaStato({ sedeId: 1, id: f.id, patch: { pdfStorageKey: "fatture/2026/f1.pdf" }, now: ora });
    const aggiornata = await repo.aggiornaStato({
      sedeId: 1, id: f.id, patch: { clienteSnapshot: { ...clienteSnapshot, ficEntityId: 42 } }, now: ora,
    });
    expect(aggiornata.clienteSnapshot).toEqual({ ...clienteSnapshot, ficEntityId: 42 });
    expect(aggiornata.pdfStorageKey).toBe("fatture/2026/f1.pdf");
    const rilettaDopo = await repo.perId(1, f.id);
    expect(rilettaDopo?.clienteSnapshot).toEqual({ ...clienteSnapshot, ficEntityId: 42 });
    expect(rilettaDopo?.pdfStorageKey).toBe("fatture/2026/f1.pdf");
    // diciture non era mai nel patch: deve restare quella creata sopra.
    expect(rilettaDopo?.diciture).toEqual(["intervento_manutenzione", "copia_ade"]);
  });

  // Ruling R35: il lease dell'emissione. `atteso` rende `aggiornaStato` un
  // compare-and-swap — scrive solo se la riga è ancora in quello stato e a
  // quella revisione — e incrementa la revisione da sé.
  it("aggiornaStato con `atteso` è un compare-and-swap: incrementa la revisione e rifiuta la seconda", async () => {
    const f = await repo.crea({ fattura: fattura(), righe: [], riepilogo: [], scadenze: [], now: ora });
    expect(f.revisione).toBe(1);

    const presa = await repo.aggiornaStato({
      sedeId: 1, id: f.id, patch: { stato: "in_emissione" },
      atteso: { stato: "bozza", revisione: 1 }, now: ora,
    });
    expect(presa.stato).toBe("in_emissione");
    expect(presa.revisione).toBe(2);

    // La seconda chiamata ha in mano la revisione di prima: CONFLITTO,
    // nessuna scrittura.
    await expect(
      repo.aggiornaStato({
        sedeId: 1, id: f.id, patch: { stato: "in_emissione" },
        atteso: { stato: "bozza", revisione: 1 }, now: ora,
      })
    ).rejects.toThrow(/^CONFLITTO/);
    expect((await repo.perId(1, f.id))?.revisione).toBe(2);

    // Stato giusto ma revisione vecchia, e viceversa: entrambi CONFLITTO.
    await expect(
      repo.aggiornaStato({
        sedeId: 1, id: f.id, patch: { eiErrore: "x" },
        atteso: { stato: "in_emissione", revisione: 1 }, now: ora,
      })
    ).rejects.toThrow(/^CONFLITTO/);
    await expect(
      repo.aggiornaStato({
        sedeId: 1, id: f.id, patch: { eiErrore: "x" },
        atteso: { stato: "emessa", revisione: 2 }, now: ora,
      })
    ).rejects.toThrow(/^CONFLITTO/);
    expect((await repo.perId(1, f.id))?.eiErrore).toBeNull();

    // Un'altra sede non vede la fattura: NOT_FOUND, mai CONFLITTO.
    await expect(
      repo.aggiornaStato({
        sedeId: 2, id: f.id, patch: { stato: "in_emissione" },
        atteso: { stato: "in_emissione", revisione: 2 }, now: ora,
      })
    ).rejects.toThrow(/^NOT_FOUND/);
  });

  it("senza `atteso` aggiornaStato non tocca la revisione (contratto R1 invariato)", async () => {
    const f = await repo.crea({ fattura: fattura(), righe: [], riepilogo: [], scadenze: [], now: ora });
    const dopo = await repo.aggiornaStato({ sedeId: 1, id: f.id, patch: { eiErrore: "guasto" }, now: ora });
    expect(dopo.revisione).toBe(1);
  });

  // Fix round 1 (Task 17, item 5c): parità col backend Postgres, che salta
  // sia l'UPDATE sia il bump quando il patch non ha nessuna colonna da
  // scrivere — un patch vuoto non è una scrittura.
  it("aggiornaScadenza tocca la versione fatture-di-commessa solo quando scrive davvero", async () => {
    const f = await repo.crea({ fattura: fattura(), righe: [], riepilogo: [], scadenze: [scadenza(1)], now: ora });
    const primaDelPatch = versioneFattureCommessa(1, 10); // commessaId di fattura()

    await repo.aggiornaScadenza({ sedeId: 1, fatturaId: f.id, numero: 1, patch: {} });
    expect(versioneFattureCommessa(1, 10)).toBe(primaDelPatch);

    await repo.aggiornaScadenza({ sedeId: 1, fatturaId: f.id, numero: 1, patch: { ficPaymentId: 77, stato: "pagata" } });
    expect(versioneFattureCommessa(1, 10)).not.toBe(primaDelPatch);
  });
});
