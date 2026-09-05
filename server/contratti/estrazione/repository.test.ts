// Repository delle estrazioni del contratto (piano 3, Task 5): ogni lettura
// del PDF con l'LLM produce una proposta persistita qui. Stesso pattern di
// server/contratti/repository.test.ts: prima la memoria, poi Postgres
// (repository.pg.test.ts) sulle stesse regole.
import { describe, expect, it } from "vitest";
import type { CampoProposto, EstrazioneContratto, PropostaContratto } from "@shared/contratti/estrazione";
import { createMemoryEstrazioniRepository } from "./repository";
import type { EstrazionePersist } from "./repository";

const NOW = new Date("2026-09-04T10:00:00.000Z");
const DOPO = new Date("2026-09-04T11:00:00.000Z");

function campo<T>(valore: T): CampoProposto<T> {
  return { valore, evidenza: null, daVerificare: false, nota: null };
}

// Proposta volutamente piena di `null` e array vuoti: è quello che deve
// sopravvivere al giro JSONB (write con `sql.json`, read diretta di
// postgres-js), non solo i valori "comodi".
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

function estrazione(overrides: Partial<EstrazionePersist> = {}): EstrazionePersist {
  return {
    sedeId: 1,
    commessaId: 10,
    documentoId: 100,
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

describe("repository estrazioni (memoria)", () => {
  it("crea e rilegge un'estrazione: la proposta fa il giro JSONB con null e array vuoti intatti", async () => {
    const repo = createMemoryEstrazioniRepository();
    const creata = await repo.crea({ ...estrazione(), now: NOW });
    expect(creata.id).toBeGreaterThan(0);
    expect(creata.createdAt).toEqual(NOW);

    const riletta = await repo.perId(1, creata.id);
    expect(riletta).not.toBeNull();
    expect(riletta!.proposta).toEqual(proposta());
    expect(riletta!.proposta.posaCent.valore).toBeNull();
    expect(riletta!.proposta.righe[0].accessori).toEqual([]);
    expect(riletta!.proposta.controlli).toEqual([]);
    expect(riletta!.proposta.notePosa).toBeNull();
  });

  it("isola le sedi: perId di un'altra sede restituisce null", async () => {
    const repo = createMemoryEstrazioniRepository();
    const creata = await repo.crea({ ...estrazione({ sedeId: 1 }), now: NOW });
    expect(await repo.perId(2, creata.id)).toBeNull();
    expect(await repo.perId(1, creata.id)).not.toBeNull();
  });

  it("perId di un id inesistente restituisce null", async () => {
    const repo = createMemoryEstrazioniRepository();
    expect(await repo.perId(1, 999)).toBeNull();
  });

  it("aggiornaStato da un'altra sede rifiuta con NOT_FOUND", async () => {
    const repo = createMemoryEstrazioniRepository();
    const creata = await repo.crea({ ...estrazione({ sedeId: 1 }), now: NOW });
    await expect(
      repo.aggiornaStato({ sedeId: 2, id: creata.id, stato: "applicata", now: DOPO })
    ).rejects.toThrow("NOT_FOUND: Estrazione non trovata.");
  });

  it("aggiornaStato a 'applicata' valorizza applicataAt e applicataBy", async () => {
    const repo = createMemoryEstrazioniRepository();
    const creata = await repo.crea({ ...estrazione(), now: NOW });
    const aggiornata = await repo.aggiornaStato({
      sedeId: 1,
      id: creata.id,
      stato: "applicata",
      applicataBy: 42,
      now: DOPO,
    });
    expect(aggiornata.stato).toBe("applicata");
    expect(aggiornata.applicataAt).toEqual(DOPO);
    expect(aggiornata.applicataBy).toBe(42);
    expect(await repo.perId(1, creata.id)).toMatchObject({
      stato: "applicata",
      applicataAt: DOPO,
      applicataBy: 42,
    });
  });

  it("aggiornaStato a 'scartata' valorizza scartataMotivo", async () => {
    const repo = createMemoryEstrazioniRepository();
    const creata = await repo.crea({ ...estrazione(), now: NOW });
    const aggiornata = await repo.aggiornaStato({
      sedeId: 1,
      id: creata.id,
      stato: "scartata",
      scartataMotivo: "Contratto illeggibile",
      now: DOPO,
    });
    expect(aggiornata.stato).toBe("scartata");
    expect(aggiornata.scartataMotivo).toBe("Contratto illeggibile");
    expect(aggiornata.applicataAt).toBeNull();
  });

  it("ultimaPerDocumento dà la più recente indipendentemente dallo stato", async () => {
    const repo = createMemoryEstrazioniRepository();
    const prima = await repo.crea({ ...estrazione({ documentoId: 200 }), now: NOW });
    const seconda = await repo.crea({
      ...estrazione({ documentoId: 200, documentoChecksum: "checksum-diverso", stato: "scartata" }),
      now: DOPO,
    });
    const ultima = await repo.ultimaPerDocumento(1, 200);
    expect(ultima!.id).toBe(seconda.id);
    expect(ultima!.id).not.toBe(prima.id);
  });

  it("ultimaPerDocumento su un documento senza estrazioni restituisce null", async () => {
    const repo = createMemoryEstrazioniRepository();
    expect(await repo.ultimaPerDocumento(1, 999)).toBeNull();
  });

  it("riusabile trova la proposta con la stessa firma e ignora quella scartata", async () => {
    const repo = createMemoryEstrazioniRepository();
    // Stessa firma (documento, checksum, versione prompt), stato riusabile:
    // deve essere quella che `riusabile` restituisce...
    const buona = await repo.crea({
      ...estrazione({ documentoId: 300, documentoChecksum: "abc", promptVersione: "v1", stato: "proposta" }),
      now: NOW,
    });
    // ...anche se una scartata con la STESSA firma arriva dopo (id più alto):
    // `riusabile` non deve mai restituire una proposta scartata.
    await repo.crea({
      ...estrazione({ documentoId: 300, documentoChecksum: "abc", promptVersione: "v1", stato: "scartata" }),
      now: DOPO,
    });
    const trovata = await repo.riusabile(1, 300, "abc", "v1");
    expect(trovata!.id).toBe(buona.id);
    expect(trovata!.stato).toBe("proposta");
  });

  it("riusabile non trova nulla con un checksum o una versione di prompt diversi", async () => {
    const repo = createMemoryEstrazioniRepository();
    await repo.crea({
      ...estrazione({ documentoId: 300, documentoChecksum: "abc", promptVersione: "v1" }),
      now: NOW,
    });
    expect(await repo.riusabile(1, 300, "checksum-diverso", "v1")).toBeNull();
    expect(await repo.riusabile(1, 300, "abc", "v2")).toBeNull();
    expect(await repo.riusabile(2, 300, "abc", "v1")).toBeNull();
  });

  it("riusabile restituisce null quando l'unica estrazione con quella firma è scartata", async () => {
    const repo = createMemoryEstrazioniRepository();
    await repo.crea({
      ...estrazione({ documentoId: 300, documentoChecksum: "abc", promptVersione: "v1", stato: "scartata" }),
      now: NOW,
    });
    expect(await repo.riusabile(1, 300, "abc", "v1")).toBeNull();
  });

  it("perCommessa restituisce le estrazioni della sede, più recente prima", async () => {
    const repo = createMemoryEstrazioniRepository();
    const prima = await repo.crea({ ...estrazione({ commessaId: 55 }), now: NOW });
    const seconda = await repo.crea({ ...estrazione({ commessaId: 55 }), now: DOPO });
    await repo.crea({ ...estrazione({ commessaId: 56 }), now: DOPO });
    await repo.crea({ ...estrazione({ commessaId: 55, sedeId: 2 }), now: DOPO });
    const elenco = await repo.perCommessa(1, 55);
    expect(elenco.map(e => e.id)).toEqual([seconda.id, prima.id]);
  });
});
