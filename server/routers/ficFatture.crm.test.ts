// Task 12: le fatture emesse dal CRM (piano 2) nel sync FiC esistente.
//
// Un documento FiC il cui id coincide con una fattura già emessa dal CRM
// nasce collegato — commessaMatch "crm" — salta il match automatico e non
// riscarica un secondo PDF: il CRM li ha già scritti lui. Si corregge solo
// con una nota di credito, mai scollegando.

import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import {
  _setScaricaFatturaPdfForTests,
  collegaFattureAutomatiche,
  ficFatture,
  scollegaFatturaDaCommessa,
  upsertDocumentiEmessi,
  upsertFatture,
  verificaRicollegamentoCrm,
  type CollegamentoCrmFic,
  type DocumentoEmessoFicInput,
} from "./ficFatture";
import { ensureFicInvoiceAttachments } from "./ficAllegati";
import { collegamentiCrmPerFic, segnalaTotaliDiversi } from "./fattureInCloud";
import {
  _resetFattureRepositoryForTests,
  getFattureRepository,
} from "../fatture/repository";

function ctx(sedeId: number): TrpcContext {
  return {
    user: {
      id: sedeId,
      openId: `fic-crm-${sedeId}`,
      name: "Direzione",
      email: `fic-crm-${sedeId}@example.test`,
      loginMethod: "local",
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as any,
    req: { protocol: "http", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    sedeId,
    sediIds: [sedeId],
  };
}

// Stesso giro di `fatturaBase` in ficFatture.test.ts, ma con `tipo` e
// `importoIva`: quella è pensata per `upsertFatture` (che li riempie da
// sola), questa chiama `upsertDocumentiEmessi` direttamente — il quarto
// parametro (`collegamentiCrm`) non passa da `upsertFatture`.
function rigaFic(
  id: number,
  extra: Partial<DocumentoEmessoFicInput> = {}
): DocumentoEmessoFicInput {
  return {
    id,
    tipo: "invoice",
    numero: `${id}/A`,
    data: "2026-09-01",
    clienteNome: "Cliente CRM",
    clienteVat: null,
    clienteCf: null,
    importoNetto: 1000,
    importoIva: 220,
    importoLordo: 1220,
    rate: [],
    ...extra,
  };
}

function trova(sedeId: number, ficId: number) {
  return ficFatture.find(f => f.sedeId === sedeId && f.id === ficId)!;
}

// Stessa forma di `fattura()` in fatture/repository.test.ts: tutti i campi
// di FatturaPersist, con un ficDocumentId/totaleCent da sovrascrivere caso
// per caso.
const oraCrm = new Date("2026-09-04T09:00:00Z");
function fatturaCrmPersist(over: Partial<Record<string, unknown>> = {}) {
  return {
    sedeId: 1,
    commessaId: 10,
    computoId: null,
    hashRighe: null,
    tipo: "fattura" as const,
    notaCreditoDi: null,
    stato: "emessa" as const,
    ficDocumentId: null,
    numero: "12/2026",
    data: "2026-09-04",
    clienteSnapshot: null,
    pattuitoTipo: "lordo" as const,
    pattuitoCent: 100_000,
    imponibileCent: 0,
    ivaCent: 0,
    totaleCent: 100_000,
    deltaPattuitoCent: 0,
    markupCent: 0,
    stornoCent: 0,
    diciture: [],
    note: null,
    intestazioneCantiere: null,
    detrazioneTipo: "nessuna" as const,
    pdfStorageKey: null,
    xmlStorageKey: null,
    xmlSha256: null,
    documentoId: null,
    eiStatusFic: null,
    eiErrore: null,
    inviataDryRun: false,
    scavalcoLimiti: false,
    scavalcoMotivo: null,
    createdBy: 1,
    emessaDa: 1,
    emessaAt: oraCrm,
    ...over,
  } as any;
}

describe("fatture FiC emesse dal CRM (commessaMatch crm)", () => {
  it("una riga nuova il cui id è nella mappa nasce collegata, senza match automatico e col PDF già archiviato", () => {
    const sedeId = 941;
    const ficId = 941_001;
    const mappa = new Map<number, CollegamentoCrmFic>([
      [ficId, { commessaId: 10, fatturaId: 1, totaleCent: 122_000 }],
    ]);

    upsertDocumentiEmessi([rigaFic(ficId)], sedeId, null, mappa);
    const f = trova(sedeId, ficId);

    expect(f.commessaId).toBe(10);
    expect(f.commessaMatch).toBe("crm");
    expect(f.collegataAMano).toBe(false);
    expect(f.pdfSync).toMatchObject({ stato: "archiviata", ultimoErrore: null });
  });

  it("una riga il cui id non è nella mappa segue il percorso di sempre", () => {
    const sedeId = 942;
    const ficId = 942_001;

    upsertDocumentiEmessi([rigaFic(ficId)], sedeId, null, new Map());
    const f = trova(sedeId, ficId);

    expect(f.commessaId).toBeNull();
    expect(f.commessaMatch).toBe("nessuno");
    expect(f.pdfSync.stato).toBe("non_collegata");
  });

  it("una riga esistente ancora 'nessuno' si promuove a crm quando il suo id compare in un sync successivo", () => {
    const sedeId = 943;
    const ficId = 943_001;

    // Primo giro: il documento arriva prima che l'emissione CRM registri
    // il proprio ficDocumentId — resta "nessuno", come una fattura FiC
    // qualunque.
    upsertDocumentiEmessi([rigaFic(ficId)], sedeId, null);
    expect(trova(sedeId, ficId).commessaMatch).toBe("nessuno");

    // Secondo giro: ora la mappa lo conosce.
    const mappa = new Map<number, CollegamentoCrmFic>([
      [ficId, { commessaId: 77, fatturaId: 2, totaleCent: 122_000 }],
    ]);
    upsertDocumentiEmessi([rigaFic(ficId)], sedeId, "sync-2", mappa);
    const f = trova(sedeId, ficId);

    expect(f.commessaId).toBe(77);
    expect(f.commessaMatch).toBe("crm");
    expect(f.pdfSync.stato).toBe("archiviata");
  });

  it("non scavalca una riga già collegata (a mano o da un match precedente)", () => {
    const sedeId = 944;
    const ficId = 944_001;

    upsertDocumentiEmessi([rigaFic(ficId)], sedeId, null);
    const f = trova(sedeId, ficId);
    f.commessaId = 55;
    f.commessaMatch = "manuale";
    f.collegataAMano = true;

    const mappa = new Map<number, CollegamentoCrmFic>([
      [ficId, { commessaId: 10, fatturaId: 1, totaleCent: 122_000 }],
    ]);
    upsertDocumentiEmessi([rigaFic(ficId)], sedeId, "sync-2", mappa);

    expect(f.commessaId).toBe(55);
    expect(f.commessaMatch).toBe("manuale");
    expect(f.collegataAMano).toBe(true);
  });

  it("collegaFattureAutomatiche non tocca una riga crm", () => {
    const sedeId = 945;
    const ficId = 945_001;
    const mappa = new Map<number, CollegamentoCrmFic>([
      [ficId, { commessaId: 10, fatturaId: 1, totaleCent: 122_000 }],
    ]);
    upsertDocumentiEmessi([rigaFic(ficId)], sedeId, null, mappa);
    const prima = { ...trova(sedeId, ficId) };

    const esito = collegaFattureAutomatiche(sedeId);

    expect(esito).toEqual({ collegate: 0, ambigue: 0, incerte: 0 });
    const dopo = trova(sedeId, ficId);
    expect(dopo.commessaId).toBe(prima.commessaId);
    expect(dopo.commessaMatch).toBe("crm");
  });

  it("scollegaFatturaDaCommessa rifiuta una riga crm: si corregge con una nota di credito", async () => {
    const sedeId = 946;
    const ficId = 946_001;
    const mappa = new Map<number, CollegamentoCrmFic>([
      [ficId, { commessaId: 10, fatturaId: 1, totaleCent: 122_000 }],
    ]);
    upsertDocumentiEmessi([rigaFic(ficId)], sedeId, null, mappa);
    const f = trova(sedeId, ficId);

    await expect(
      scollegaFatturaDaCommessa({ fattura: f, sedeId })
    ).rejects.toThrow(
      /PRECONDIZIONE: fattura emessa dal CRM: si corregge con una nota di credito\./
    );

    // Nessun effetto collaterale: il tentativo rifiutato non lascia la
    // fattura a metà scollegata.
    expect(f.commessaId).toBe(10);
    expect(f.commessaMatch).toBe("crm");
  });

  it("una riga FiC non-crm si scollega come sempre (nessuna regressione)", async () => {
    const sedeId = 947;
    const ficId = 947_001;
    const caller = appRouter.createCaller(ctx(sedeId));
    const commessa = await caller.commesse.create({
      cliente: `Cliente non-crm ${sedeId}`,
    });
    upsertFatture([rigaFic(ficId)], sedeId);
    const f = trova(sedeId, ficId);
    f.commessaId = commessa.id;
    f.commessaMatch = "manuale";
    f.collegataAMano = true;

    const { commessaPrecedente } = await scollegaFatturaDaCommessa({
      fattura: f,
      sedeId,
      eliminaAllegato: false,
    });

    expect(commessaPrecedente).toBe(commessa.id);
    expect(f.commessaId).toBeNull();
    expect(f.commessaMatch).toBe("nessuno");
  });

  it("ensureFicInvoiceAttachments non scarica il PDF di una riga crm", async () => {
    const sedeId = 948;
    const ficId = 948_001;
    const caller = appRouter.createCaller(ctx(sedeId));
    const commessa = await caller.commesse.create({
      cliente: `Cliente PDF CRM ${sedeId}`,
    });
    const mappa = new Map<number, CollegamentoCrmFic>([
      [ficId, { commessaId: commessa.id, fatturaId: 1, totaleCent: 122_000 }],
    ]);
    upsertDocumentiEmessi([rigaFic(ficId)], sedeId, null, mappa);
    const downloadPdf = vi.fn(async () => Buffer.from("%PDF-1.4\n%%EOF"));

    const risultato = await ensureFicInvoiceAttachments({
      sedeId,
      createdBy: null,
      downloadPdf,
    });

    expect(downloadPdf).not.toHaveBeenCalled();
    expect(risultato).toEqual({ pdfArchiviati: 0, pdfFalliti: 0 });
    expect(trova(sedeId, ficId).pdfSync.stato).toBe("archiviata");
  });

  it("ensureFicInvoiceAttachments ripara pdfSync di una riga crm senza scaricare, se lo trova non archiviato", async () => {
    const sedeId = 949;
    const ficId = 949_001;
    const caller = appRouter.createCaller(ctx(sedeId));
    const commessa = await caller.commesse.create({
      cliente: `Cliente PDF CRM riparo ${sedeId}`,
    });
    const mappa = new Map<number, CollegamentoCrmFic>([
      [ficId, { commessaId: commessa.id, fatturaId: 1, totaleCent: 122_000 }],
    ]);
    upsertDocumentiEmessi([rigaFic(ficId)], sedeId, null, mappa);
    const f = trova(sedeId, ficId);
    f.pdfSync = { stato: "errore", ultimoTentativoAt: new Date(), ultimoErrore: "boh" };
    const downloadPdf = vi.fn(async () => Buffer.from("%PDF-1.4\n%%EOF"));

    const risultato = await ensureFicInvoiceAttachments({
      sedeId,
      createdBy: null,
      downloadPdf,
    });

    expect(downloadPdf).not.toHaveBeenCalled();
    expect(risultato).toEqual({ pdfArchiviati: 0, pdfFalliti: 0 });
    expect(f.pdfSync).toMatchObject({ stato: "archiviata", ultimoErrore: null });
  });

  it("verificaRicollegamentoCrm (R23) rifiuta di spostare una riga crm su un'altra commessa", () => {
    expect(() =>
      verificaRicollegamentoCrm({ commessaMatch: "crm", commessaId: 10 }, 99)
    ).toThrow(
      /PRECONDIZIONE: fattura emessa dal CRM: si corregge con una nota di credito\./
    );
  });

  it("verificaRicollegamentoCrm (R23) non lancia ri-collegando alla stessa commessa, né per una riga non-crm", () => {
    expect(() =>
      verificaRicollegamentoCrm({ commessaMatch: "crm", commessaId: 10 }, 10)
    ).not.toThrow();
    expect(() =>
      verificaRicollegamentoCrm({ commessaMatch: "manuale", commessaId: 10 }, 99)
    ).not.toThrow();
  });

  it("la mutation collega rifiuta di spostare una riga crm su un'altra commessa (R23)", async () => {
    const sedeId = 950;
    const ficId = 950_001;
    const caller = appRouter.createCaller(ctx(sedeId));
    const commessaOriginale = await caller.commesse.create({
      cliente: `Cliente crm originale ${sedeId}`,
    });
    const commessaAltra = await caller.commesse.create({
      cliente: `Cliente crm altra ${sedeId}`,
    });
    const mappa = new Map<number, CollegamentoCrmFic>([
      [ficId, { commessaId: commessaOriginale.id, fatturaId: 1, totaleCent: 122_000 }],
    ]);
    upsertDocumentiEmessi([rigaFic(ficId)], sedeId, null, mappa);

    await expect(
      caller.ficFatture.collega({ ficId, commessaId: commessaAltra.id })
    ).rejects.toThrow(
      /PRECONDIZIONE: fattura emessa dal CRM: si corregge con una nota di credito\./
    );

    const f = trova(sedeId, ficId);
    expect(f.commessaId).toBe(commessaOriginale.id);
    expect(f.commessaMatch).toBe("crm");
  });

  it("la mutation collega verso la STESSA commessa e' un no-op per una riga crm (niente PDF, niente declassamento)", async () => {
    const sedeId = 951;
    const ficId = 951_001;
    const caller = appRouter.createCaller(ctx(sedeId));
    const commessa = await caller.commesse.create({
      cliente: `Cliente crm no-op ${sedeId}`,
    });
    const mappa = new Map<number, CollegamentoCrmFic>([
      [ficId, { commessaId: commessa.id, fatturaId: 1, totaleCent: 122_000 }],
    ]);
    upsertDocumentiEmessi([rigaFic(ficId)], sedeId, null, mappa);
    const downloadPdf = vi.fn(async () => Buffer.from("%PDF-1.4\n%%EOF"));
    _setScaricaFatturaPdfForTests(downloadPdf);

    try {
      const esito = await caller.ficFatture.collega({
        ficId,
        commessaId: commessa.id,
      });

      expect(downloadPdf).not.toHaveBeenCalled();
      expect(esito.success).toBe(true);
      expect(esito.pdf).toEqual({ stato: "archiviata", documentoId: null, errore: null });
      const f = trova(sedeId, ficId);
      expect(f.commessaId).toBe(commessa.id);
      expect(f.commessaMatch).toBe("crm");
      expect(f.collegataAMano).toBe(false);
    } finally {
      _setScaricaFatturaPdfForTests(null);
    }
  });
});

describe("segnalaTotaliDiversi: avviso quando FiC e CRM non dicono la stessa cifra", () => {
  it("appende un evento sulla fattura CRM quando lo scarto supera 1 euro", async () => {
    _resetFattureRepositoryForTests();
    const repo = getFattureRepository();
    const sedeId = 1;
    const now = new Date("2026-09-04T09:00:00Z");
    const f = await repo.crea({
      fattura: fatturaCrmPersist({ sedeId, ficDocumentId: 5001, totaleCent: 100_000 }),
      righe: [],
      riepilogo: [],
      scadenze: [],
      now,
    });

    const esito = await segnalaTotaliDiversi(
      sedeId,
      [{ id: 5001, importoLordo: 1001.02 }],
      new Map([[5001, { commessaId: 10, fatturaId: f.id, totaleCent: 100_000 }]])
    );

    expect(esito).toEqual({ segnalate: 1, errori: 0 });
    const eventi = await repo.eventi(sedeId, f.id);
    expect(eventi).toHaveLength(1);
    expect(eventi[0]).toMatchObject({
      tipo: "modificata",
      payload: {
        avviso: "Totale FiC diverso dal totale emesso",
        ficLordoCent: 100_102,
        totaleCent: 100_000,
      },
    });
  });

  it("non segnala uno scarto di esattamente 1 euro (100 centesimi, non 'più di')", async () => {
    _resetFattureRepositoryForTests();
    const repo = getFattureRepository();
    const sedeId = 1;
    const now = new Date("2026-09-04T09:00:00Z");
    const f = await repo.crea({
      fattura: fatturaCrmPersist({ sedeId, ficDocumentId: 5002, totaleCent: 100_000 }),
      righe: [],
      riepilogo: [],
      scadenze: [],
      now,
    });

    const esito = await segnalaTotaliDiversi(
      sedeId,
      [{ id: 5002, importoLordo: 1001.0 }],
      new Map([[5002, { commessaId: 10, fatturaId: f.id, totaleCent: 100_000 }]])
    );

    expect(esito).toEqual({ segnalate: 0, errori: 0 });
    expect(await repo.eventi(sedeId, f.id)).toEqual([]);
  });

  it("ignora una riga il cui id non è nella mappa, senza toccare il repository", async () => {
    _resetFattureRepositoryForTests();
    const repo = getFattureRepository();
    const sedeId = 1;

    await expect(
      segnalaTotaliDiversi(sedeId, [{ id: 9999, importoLordo: 5000 }], new Map())
    ).resolves.toEqual({ segnalate: 0, errori: 0 });
  });

  it("un appendEvento fallito su una fattura non nasconde l'avviso delle altre (Promise.allSettled)", async () => {
    _resetFattureRepositoryForTests();
    const repo = getFattureRepository();
    const sedeId = 1;
    const now = new Date("2026-09-04T09:00:00Z");
    const fOk = await repo.crea({
      fattura: fatturaCrmPersist({ sedeId, ficDocumentId: 5003, totaleCent: 100_000 }),
      righe: [],
      riepilogo: [],
      scadenze: [],
      now,
    });
    const fRotta = await repo.crea({
      fattura: fatturaCrmPersist({ sedeId, ficDocumentId: 5004, totaleCent: 200_000 }),
      righe: [],
      riepilogo: [],
      scadenze: [],
      now,
    });
    const appendOriginale = repo.appendEvento;
    repo.appendEvento = evento =>
      evento.fatturaId === fRotta.id
        ? Promise.reject(new Error("scrittura fallita"))
        : appendOriginale(evento);

    const esito = await segnalaTotaliDiversi(
      sedeId,
      [
        { id: 5003, importoLordo: 1001.02 },
        { id: 5004, importoLordo: 2001.02 },
      ],
      new Map([
        [5003, { commessaId: 10, fatturaId: fOk.id, totaleCent: 100_000 }],
        [5004, { commessaId: 10, fatturaId: fRotta.id, totaleCent: 200_000 }],
      ])
    );

    expect(esito).toEqual({ segnalate: 1, errori: 1 });
    expect(await repo.eventi(sedeId, fOk.id)).toHaveLength(1);
    expect(await repo.eventi(sedeId, fRotta.id)).toEqual([]);
  });
});

describe("collegamentiCrmPerFic: la mappa CRM↔FiC copre tutte le fatture del giro", () => {
  // Ruling R37: la mappa nasceva da `lista({ sedeId, stati })`, che si
  // ferma a 200 righe ordinate per id DESC. Con più di 200 fatture emesse
  // in una sede, le più VECCHIE uscivano dalla mappa: al sync successivo
  // sarebbero tornate «nessuno», ricandidate al match automatico e a un
  // secondo download del PDF. Ora la lettura è per ficDocumentId, senza
  // tetto: chiede solo i documenti che questo giro sta davvero upsertando.
  it("con 201 fatture in memoria anche la più vecchia resta collegata (commessaMatch crm)", async () => {
    _resetFattureRepositoryForTests();
    const repo = getFattureRepository();
    const sedeId = 952;
    const now = new Date("2026-09-04T09:00:00Z");
    const primoFicId = 952_001;
    const ids: number[] = [];
    for (let i = 0; i < 201; i++) {
      const ficDocumentId = primoFicId + i;
      await repo.crea({
        fattura: fatturaCrmPersist({ sedeId, commessaId: 10 + i, ficDocumentId, totaleCent: 122_000 }),
        righe: [],
        riepilogo: [],
        scadenze: [],
        now,
      });
      ids.push(ficDocumentId);
    }

    const mappa = await collegamentiCrmPerFic(sedeId, ids);

    expect(mappa.size).toBe(201);
    // La più vecchia: quella che il tetto di 200 tagliava via.
    expect(mappa.get(primoFicId)).toMatchObject({ commessaId: 10, totaleCent: 122_000 });

    upsertDocumentiEmessi([rigaFic(primoFicId)], sedeId, null, mappa);
    const f = trova(sedeId, primoFicId);
    expect(f.commessaMatch).toBe("crm");
    expect(f.commessaId).toBe(10);
  });

  it("chiede solo gli id del giro, salta le fatture di un'altra sede e gli stati non emessi", async () => {
    _resetFattureRepositoryForTests();
    const repo = getFattureRepository();
    const sedeId = 953;
    const now = new Date("2026-09-04T09:00:00Z");
    const emessa = await repo.crea({
      fattura: fatturaCrmPersist({ sedeId, ficDocumentId: 953_001 }),
      righe: [], riepilogo: [], scadenze: [], now,
    });
    // Stessa sede, ancora in emissione: il documento su FiC può esistere
    // ma la fattura non è ancora quella che il sync deve collegare.
    await repo.crea({
      fattura: fatturaCrmPersist({ sedeId, stato: "in_emissione", ficDocumentId: 953_002 }),
      righe: [], riepilogo: [], scadenze: [], now,
    });
    // Altra sede: non deve comparire nemmeno chiedendone l'id.
    await repo.crea({
      fattura: fatturaCrmPersist({ sedeId: sedeId + 1, ficDocumentId: 953_003 }),
      righe: [], riepilogo: [], scadenze: [], now,
    });

    const mappa = await collegamentiCrmPerFic(sedeId, [953_001, 953_002, 953_003, 953_999]);

    expect([...mappa.keys()]).toEqual([953_001]);
    expect(mappa.get(953_001)!.fatturaId).toBe(emessa.id);
    // Nessun id da chiedere: nessuna query, mappa vuota.
    expect((await collegamentiCrmPerFic(sedeId, [])).size).toBe(0);
  });
});
