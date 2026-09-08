import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storageProbe = vi.hoisted(() => ({ fail: false }));

vi.mock("../_core/fileStorage", async importOriginal => {
  const actual = await importOriginal<typeof import("../_core/fileStorage")>();
  // Il gancio quota (WS4 §6) non ha un driver reale sotto in questo file
  // (`putFile` è interamente rimpiazzato): per i test R10 lo replichiamo qui,
  // chiamando davvero la funzione registrata con `impostaVerificaQuota` prima
  // di controllare `storageProbe.fail` — stesso ordine del `putFile` reale.
  let quotaHook: Parameters<typeof actual.impostaVerificaQuota>[0] = null;
  return {
    ...actual,
    impostaVerificaQuota: (v: Parameters<typeof actual.impostaVerificaQuota>[0]) => {
      quotaHook = v;
    },
    putFile: vi.fn(async (...args: Parameters<typeof actual.putFile>) => {
      if (quotaHook) {
        const buffer = args[4];
        const rifiuto = await quotaHook(1, buffer?.length ?? 0);
        if (rifiuto) throw new actual.ErroreQuotaStorage(rifiuto.messaggio);
      }
      if (storageProbe.fail) throw new Error("storage non disponibile");
      return {
        storageKey: "preventivi_documenti/test/fattura.pdf",
        checksum: "a".repeat(64),
      };
    }),
  };
});

import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { ErroreQuotaStorage, impostaVerificaQuota } from "../_core/fileStorage";
import {
  migraTipiDocumento,
  validaAllegatoFascicolo,
  validaUploadManualeFascicolo,
} from "./preventiviContratti";
import {
  archiviaAllegatoComunicazione,
  caricaDocumentoCommessaDaBuffer,
  deleteDocumentoFic,
  findDocumentoFic,
  getDocumentiDiCommessa,
  registraDocumentoFatturaCrm,
  StorageAllegatoTemporaneamenteNonDisponibile,
  upsertDocumentoFic,
} from "./preventiviContratti";

function ctx(sedeId: number): TrpcContext {
  return {
    user: {
      id: sedeId,
      openId: `storage-fic-${sedeId}`,
      name: "Direzione",
      email: `storage-fic-${sedeId}@example.test`,
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
    tenantId: 1,
    tenant: null,
  };
}

const MEBIBYTE = 1024 * 1024;

describe("upload manuale del fascicolo commessa", () => {
  beforeEach(() => {
    storageProbe.fail = false;
  });

  it("accetta fino a 250 MB e i formati video comuni", () => {
    for (const mimeType of ["video/mp4", "video/quicktime", "video/webm"]) {
      expect(() =>
        validaUploadManualeFascicolo(250 * MEBIBYTE, mimeType)
      ).not.toThrow();
    }
  });

  it("rifiuta il primo byte oltre 250 MB e i formati attivi", () => {
    expect(() =>
      validaUploadManualeFascicolo(250 * MEBIBYTE + 1, "video/mp4")
    ).toThrow(/250 MB/);
    expect(() => validaUploadManualeFascicolo(1, "text\/html")).toThrow(
      /non consentito/
    );
  });

  // Ruling R37: l'XML della fattura elettronica vive nello storage
  // `fatture_xml` ed è servito da `fatture.documento`, non dal fascicolo.
  // Nessun percorso del CRM lo carica come allegato: l'allowlist non deve
  // offrire una porta che nessuno usa (l'anteprima del client apre gli
  // allegati in un iframe con un blob: dell'origine dell'app).
  it("rifiuta l'XML: non è un allegato del fascicolo, né a mano né dai canali", () => {
    for (const mimeType of ["application/xml", "text/xml"]) {
      expect(() => validaUploadManualeFascicolo(1, mimeType)).toThrow(
        /non consentito/
      );
      expect(() =>
        validaAllegatoFascicolo(Buffer.from("<x/>"), mimeType)
      ).toThrow(/non consentito/);
    }
  });

  it("rifiuta base64 malformato senza creare metadati vuoti", async () => {
    const sedeId = 309;
    const caller = appRouter.createCaller(ctx(sedeId));
    const commessa = await caller.commesse.create({ cliente: "Base64 rotto" });

    await expect(
      caller.preventiviContratti.upload({
        commessaId: commessa.id,
        nome: "rotto.pdf",
        tipo: "preventivo",
        mimeType: "application/pdf",
        size: 1,
        dataBase64: "=",
      })
    ).rejects.toThrow(/base64 non valido/i);

    await expect(
      caller.preventiviContratti.byCommessa(commessa.id)
    ).resolves.toHaveLength(0);
  });

  it("non riversa nel JSONB un file grande quando lo storage non risponde", async () => {
    const sedeId = 308;
    const caller = appRouter.createCaller(ctx(sedeId));
    const commessa = await caller.commesse.create({ cliente: "Video grande" });
    storageProbe.fail = true;

    await expect(
      caller.preventiviContratti.upload({
        commessaId: commessa.id,
        nome: "cantiere.mp4",
        tipo: "altro",
        mimeType: "video/mp4",
        size: 10 * MEBIBYTE + 1,
        dataBase64: Buffer.alloc(10 * MEBIBYTE + 1).toString("base64"),
      })
    ).rejects.toThrow(/storage documenti non è disponibile/);

    await expect(
      caller.preventiviContratti.byCommessa(commessa.id)
    ).resolves.toHaveLength(0);
  });
});

describe("storage documenti FiC", () => {
  beforeEach(() => {
    storageProbe.fail = false;
  });

  it("non crea fallback base64 quando putFile fallisce", async () => {
    const sedeId = 304;
    const ficId = 304_001;
    const caller = appRouter.createCaller(ctx(sedeId));
    const commessa = await caller.commesse.create({ cliente: "Storage FiC" });
    storageProbe.fail = true;

    await expect(
      upsertDocumentoFic({
        sedeId,
        ficId,
        commessaId: commessa.id,
        numero: "304/PDF",
        data: "2026-08-20",
        pdf: Buffer.from("%PDF-1.4\nno fallback\n%%EOF", "ascii"),
        createdBy: sedeId,
      })
    ).rejects.toBeInstanceOf(StorageAllegatoTemporaneamenteNonDisponibile);
    expect(findDocumentoFic(sedeId, ficId)).toBeNull();
  });

  it("trova il sourceRef FiC soltanto nella sede proprietaria", async () => {
    const sedeId = 306;
    const ficId = 306_001;
    const caller = appRouter.createCaller(ctx(sedeId));
    const commessa = await caller.commesse.create({ cliente: "Scope PDF FiC" });

    try {
      const documento = await upsertDocumentoFic({
        sedeId,
        ficId,
        commessaId: commessa.id,
        numero: "306/PDF",
        data: "2026-08-20",
        pdf: Buffer.from("%PDF-1.4\nscope\n%%EOF", "ascii"),
        createdBy: sedeId,
      });

      expect(documento.sourceRef).toBe(`fic:${sedeId}:${ficId}`);
      expect(findDocumentoFic(sedeId, ficId)?.id).toBe(documento.id);
      expect(findDocumentoFic(sedeId + 1, ficId)).toBeNull();
    } finally {
      deleteDocumentoFic(sedeId, ficId);
    }
  });
});

// ── Gate documentale: il documento c'è ma il CRM lo dà per mancante ────────
//
// Segnalazione dal campo: «mi dice manca fattura ma la fattura c'è».
// Il gate contava solo i documenti caricati MENTRE la commessa era nello
// stato che li chiede, e una fattura arriva quasi sempre prima di quello
// stato — a maggior ragione quella importata da Fatture in Cloud, che entra
// quando gira la sincronizzazione.
describe("gate documentale — documenti caricati prima dello stato che li chiede", () => {
  const SEDE = 90501;
  const caller = () => appRouter.createCaller(ctx(SEDE));

  const pdf = Buffer.from("%PDF-1.4 finto").toString("base64");

  async function commessaConDocumento(tipo: "fattura" | "contratto") {
    const commessa = await caller().commesse.create({
      cliente: `Gate ${tipo} ${Math.random()}`,
    });
    await caller().preventiviContratti.upload({
      commessaId: commessa.id,
      nome: `${tipo}.pdf`,
      tipo,
      mimeType: "application/pdf",
      size: 14,
      dataBase64: pdf,
    });
    return commessa;
  }

  /** Avanza fino allo stato voluto scavalcando i gate intermedi. */
  async function portaA(commessaId: number, stati: readonly string[]) {
    for (const stato of stati) {
      await caller().commesse.update({
        id: commessaId,
        stato: stato as any,
        force: true,
      });
    }
  }

  it("una fattura caricata in preventivo vale per il gate di fatture_pagamento", async () => {
    const commessa = await commessaConDocumento("fattura");
    await portaA(commessa.id, [
      "misure_esecutive",
      "aggiornamento_contratto",
      "fatture_pagamento",
    ]);

    const gate = await caller().preventiviContratti.statoGate(commessa.id);
    expect(gate?.stato).toBe("fatture_pagamento");
    expect(gate?.required.find(r => r.tipo === "fattura")?.satisfied).toBe(true);
    expect(gate?.canAdvance).toBe(true);
  });

  it("la stessa fattura non copre il gate successivo, che ne chiede una nuova", async () => {
    // `fattura` è richiesta due volte: a fatture_pagamento e di nuovo a
    // ordini_ultimazione. La seconda volta serve un documento nuovo, o il
    // saldo — altrimenti il gate non chiederebbe mai niente.
    const commessa = await commessaConDocumento("fattura");
    await portaA(commessa.id, [
      "misure_esecutive",
      "aggiornamento_contratto",
      "fatture_pagamento",
      "da_ordinare",
      "produzione",
      "ordini_ultimazione",
    ]);

    const gate = await caller().preventiviContratti.statoGate(commessa.id);
    expect(gate?.stato).toBe("ordini_ultimazione");
    expect(gate?.canAdvance).toBe(false);
  });

  it("a «da ordinare» chiede una cosa sola: la conferma d'ordine", async () => {
    const commessa = await caller().commesse.create({
      cliente: `Gate ordine ${Math.random()}`,
    });
    await caller().preventiviContratti.upload({
      commessaId: commessa.id,
      nome: "conferma.pdf",
      tipo: "conferma_ordine",
      mimeType: "application/pdf",
      size: 14,
      dataBase64: pdf,
    });
    await portaA(commessa.id, [
      "misure_esecutive",
      "aggiornamento_contratto",
      "fatture_pagamento",
      "da_ordinare",
    ]);

    const gate = await caller().preventiviContratti.statoGate(commessa.id);
    expect(gate?.stato).toBe("da_ordinare");
    // Ordine e conferma erano due voci per lo stesso documento: la rail ne
    // mostrava due, una verde e una arancione, e sembrava mancasse qualcosa.
    expect(gate?.required.map(r => r.tipo)).toEqual(["conferma_ordine"]);
    expect(gate?.canAdvance).toBe(true);
  });

  it("un contratto firmato in preventivo non vale come aggiornamento del contratto", async () => {
    const commessa = await commessaConDocumento("contratto");
    await portaA(commessa.id, ["misure_esecutive", "aggiornamento_contratto"]);

    const gate = await caller().preventiviContratti.statoGate(commessa.id);
    expect(gate?.stato).toBe("aggiornamento_contratto");
    expect(gate?.canAdvance).toBe(false);
  });
});

// I documenti già archiviati come «Ordine fornitore» non vanno persi: il
// tipo è stato accorpato, quindi al bootstrap prendono quello che resta.
describe("migrazione dei tipi documento accorpati", () => {
  function documento(id: number, tipo: string) {
    return { id, commessaId: 1, nome: `doc-${id}.pdf`, tipo } as any;
  }

  it("porta i vecchi «ordine» sotto la conferma d'ordine", () => {
    const caricati = [
      documento(1, "ordine"),
      documento(2, "conferma_ordine"),
      documento(3, "fattura"),
    ];

    expect(migraTipiDocumento(caricati)).toBe(true);
    expect(caricati.map(d => d.tipo)).toEqual([
      "conferma_ordine",
      "conferma_ordine",
      "fattura",
    ]);
  });

  it("non riscrive uno store già migrato", () => {
    const caricati = [documento(1, "conferma_ordine"), documento(2, "fattura")];

    expect(migraTipiDocumento(caricati)).toBe(false);
  });
});

// Fix round 1 (R10): quattro dei cinque siti di upload del brief vivono qui.
// Ognuno avvolgeva `putFile` in un try/catch pensato SOLO per un guasto
// infrastrutturale dello storage — e ricadeva su un fallback (rilancio
// generico, o base64 inline) che avrebbe inghiottito anche `ErroreQuotaStorage`
// (WS4 §6). Il fix propaga quell'errore per primo, prima di ogni fallback.
describe("quota che blocca — ErroreQuotaStorage si propaga oltre il fallback (R10)", () => {
  const pdf = Buffer.from("%PDF-1.4\nquota\n%%EOF", "ascii");

  afterEach(() => {
    impostaVerificaQuota(null);
  });

  it("archiviaAllegatoComunicazione: rifiuta, non archivia nulla", async () => {
    const sedeId = 411;
    const caller = appRouter.createCaller(ctx(sedeId));
    const commessa = await caller.commesse.create({ cliente: "Quota comunicazione" });

    impostaVerificaQuota(async () => ({ messaggio: "Spazio esaurito: prova" }));

    const promessa = archiviaAllegatoComunicazione({
      sedeId,
      comunicazioneId: 411_001,
      allegatoIndex: 0,
      commessaId: commessa.id,
      nome: "allegato.pdf",
      tipo: "altro",
      mimeType: "application/pdf",
      buffer: pdf,
      createdBy: sedeId,
    });
    await expect(promessa).rejects.toBeInstanceOf(ErroreQuotaStorage);
    await expect(promessa).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Spazio esaurito: prova",
    });

    expect(getDocumentiDiCommessa(commessa.id)).toHaveLength(0);
  });

  it("upsertDocumentoFic: rifiuta, non crea il documento FiC", async () => {
    const sedeId = 412;
    const ficId = 412_001;
    const caller = appRouter.createCaller(ctx(sedeId));
    const commessa = await caller.commesse.create({ cliente: "Quota FiC" });

    impostaVerificaQuota(async () => ({ messaggio: "Spazio esaurito: prova" }));

    const promessa = upsertDocumentoFic({
      sedeId,
      ficId,
      commessaId: commessa.id,
      numero: "412/PDF",
      data: "2026-08-20",
      pdf,
      createdBy: sedeId,
    });
    await expect(promessa).rejects.toBeInstanceOf(ErroreQuotaStorage);
    await expect(promessa).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Spazio esaurito: prova",
    });

    expect(findDocumentoFic(sedeId, ficId)).toBeNull();
  });

  it("registraDocumentoFatturaCrm: rifiuta anche per un PDF piccolo, non ricade sul base64 inline", async () => {
    const sedeId = 413;
    const caller = appRouter.createCaller(ctx(sedeId));
    const commessa = await caller.commesse.create({ cliente: "Quota fattura CRM" });

    impostaVerificaQuota(async () => ({ messaggio: "Spazio esaurito: prova" }));

    // Il PDF sta ben sotto COMMESSA_UPLOAD_INLINE_FALLBACK_MAX_BYTES: prima
    // del fix questo caso NON lanciava affatto, ricadeva sul fallback inline.
    const promessa = registraDocumentoFatturaCrm({
      sedeId,
      commessaId: commessa.id,
      fatturaId: 413_001,
      numero: "413/1",
      tipo: "fattura",
      pdf,
      createdBy: sedeId,
    });
    await expect(promessa).rejects.toBeInstanceOf(ErroreQuotaStorage);
    await expect(promessa).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Spazio esaurito: prova",
    });

    expect(getDocumentiDiCommessa(commessa.id)).toHaveLength(0);
  });

  it("caricaDocumentoCommessaDaBuffer: rifiuta anche per un file piccolo, non ricade sul base64 inline", async () => {
    const sedeId = 414;
    const caller = appRouter.createCaller(ctx(sedeId));
    const commessa = await caller.commesse.create({ cliente: "Quota upload manuale" });

    impostaVerificaQuota(async () => ({ messaggio: "Spazio esaurito: prova" }));

    const promessa = caricaDocumentoCommessaDaBuffer({
      commessaId: commessa.id,
      nome: "manuale.pdf",
      tipo: "altro",
      mimeType: "application/pdf",
      buffer: pdf,
      sedeId,
      createdBy: sedeId,
    });
    await expect(promessa).rejects.toBeInstanceOf(ErroreQuotaStorage);
    await expect(promessa).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Spazio esaurito: prova",
    });

    expect(getDocumentiDiCommessa(commessa.id)).toHaveLength(0);
  });
});
