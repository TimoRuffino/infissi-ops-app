import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { appRouter } from "../routers";
import { ficFatture, upsertFatture } from "./ficFatture";
import {
  ensureFicInvoiceAttachment,
  ensureFicInvoiceAttachments,
} from "./ficAllegati";
import { deleteDocumentoFic, findDocumentoFic } from "./preventiviContratti";

function ctx(sedeId: number): TrpcContext {
  return {
    user: {
      id: sedeId,
      openId: `fic-attachments-${sedeId}`,
      name: "Direzione",
      email: `fic-attachments-${sedeId}@example.test`,
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

async function setup(sedeId: number, ficId: number) {
  const caller = appRouter.createCaller(ctx(sedeId));
  const commessa = await caller.commesse.create({
    cliente: `Cliente PDF ${sedeId}`,
  });
  upsertFatture(
    [
      {
        id: ficId,
        numero: `${ficId}/PDF`,
        data: "2026-08-20",
        clienteNome: `Cliente PDF ${sedeId}`,
        clienteVat: null,
        clienteCf: null,
        importoNetto: 1_000,
        importoLordo: 1_220,
        rate: [],
      },
    ],
    sedeId
  );
  const fattura = ficFatture.find(
    item => item.sedeId === sedeId && item.id === ficId
  )!;
  fattura.commessaId = commessa.id;
  fattura.commessaMatch = "manuale";
  fattura.collegataAMano = true;
  return { caller, commessa, fattura };
}

describe("allegati fatture FiC", () => {
  it("ritenta dopo un errore e poi riusa lo stesso documento", async () => {
    const sedeId = 301;
    const ficId = 301_001;
    const { fattura } = await setup(sedeId, ficId);
    const downloadPdf = vi
      .fn()
      .mockRejectedValueOnce(new Error("download temporaneamente fallito"))
      .mockResolvedValue(Buffer.from("%PDF-1.4\nretry\n%%EOF", "ascii"));

    try {
      const failed = await ensureFicInvoiceAttachment({
        sedeId,
        fattura,
        createdBy: sedeId,
        downloadPdf,
      });
      expect(failed).toMatchObject({
        stato: "errore",
        documentoId: null,
      });
      expect(fattura.pdfSync.stato).toBe("errore");

      const first = await ensureFicInvoiceAttachment({
        sedeId,
        fattura,
        createdBy: sedeId,
        downloadPdf,
      });
      const second = await ensureFicInvoiceAttachment({
        sedeId,
        fattura,
        createdBy: sedeId,
        downloadPdf,
      });

      expect(first.stato).toBe("archiviata");
      expect(second.documentoId).toBe(first.documentoId);
      expect(findDocumentoFic(sedeId, ficId)?.id).toBe(first.documentoId);
      expect(fattura.pdfSync).toMatchObject({
        stato: "archiviata",
        ultimoErrore: null,
      });
      expect(downloadPdf).toHaveBeenCalledTimes(2);
    } finally {
      deleteDocumentoFic(sedeId, ficId);
    }
  });

  it("sposta lo stesso documento alla nuova commessa", async () => {
    const sedeId = 302;
    const ficId = 302_001;
    const {
      caller,
      commessa: oldCommessa,
      fattura,
    } = await setup(sedeId, ficId);
    const downloadPdf = vi
      .fn()
      .mockResolvedValue(Buffer.from("%PDF-1.4\nmove\n%%EOF", "ascii"));

    try {
      const first = await ensureFicInvoiceAttachment({
        sedeId,
        fattura,
        createdBy: sedeId,
        downloadPdf,
      });
      const newCommessa = await caller.commesse.create({
        cliente: "Nuova commessa PDF",
      });
      fattura.commessaId = newCommessa.id;

      const moved = await ensureFicInvoiceAttachment({
        sedeId,
        fattura,
        createdBy: sedeId,
        downloadPdf,
      });

      expect(moved.documentoId).toBe(first.documentoId);
      expect(findDocumentoFic(sedeId, ficId)?.commessaId).toBe(newCommessa.id);
      expect(
        (await caller.preventiviContratti.byCommessa(oldCommessa.id)).filter(
          (doc: any) => doc.source === "fic"
        )
      ).toHaveLength(0);
      expect(
        (await caller.preventiviContratti.byCommessa(newCommessa.id)).filter(
          (doc: any) => doc.source === "fic"
        )
      ).toHaveLength(1);
      expect(downloadPdf).toHaveBeenCalledTimes(2);
    } finally {
      deleteDocumentoFic(sedeId, ficId);
    }
  });

  it("il batch non riscarica i PDF gia archiviati", async () => {
    const sedeId = 303;
    const ficId = 303_001;
    const { fattura } = await setup(sedeId, ficId);
    const pdf = Buffer.from("%PDF-1.4\nbatch\n%%EOF", "ascii");

    try {
      await ensureFicInvoiceAttachment({
        sedeId,
        fattura,
        createdBy: sedeId,
        downloadPdf: async () => pdf,
      });
      const result = await ensureFicInvoiceAttachments({
        sedeId,
        createdBy: sedeId,
        downloadPdf: vi.fn().mockRejectedValue(new Error("non chiamare")),
      });

      expect(result).toEqual({ pdfArchiviati: 0, pdfFalliti: 0 });
    } finally {
      deleteDocumentoFic(sedeId, ficId);
    }
  });

  it("serializza due tentativi concorrenti senza duplicare il documento", async () => {
    const sedeId = 305;
    const ficId = 305_001;
    const { caller, commessa, fattura } = await setup(sedeId, ficId);
    let release!: (pdf: Buffer) => void;
    const gate = new Promise<Buffer>(resolve => {
      release = resolve;
    });
    const downloadPdf = vi.fn(() => gate);

    try {
      const firstPromise = ensureFicInvoiceAttachment({
        sedeId,
        fattura,
        createdBy: sedeId,
        downloadPdf,
      });
      await vi.waitFor(() => expect(downloadPdf).toHaveBeenCalledTimes(1));
      const secondPromise = ensureFicInvoiceAttachment({
        sedeId,
        fattura,
        createdBy: sedeId,
        downloadPdf,
      });
      await Promise.resolve();
      expect(downloadPdf).toHaveBeenCalledTimes(1);
      release(Buffer.from("%PDF-1.4\nconcurrent\n%%EOF", "ascii"));

      const [first, second] = await Promise.all([firstPromise, secondPromise]);
      expect(second.documentoId).toBe(first.documentoId);
      expect(
        (await caller.preventiviContratti.byCommessa(commessa.id)).filter(
          (doc: any) => doc.source === "fic"
        )
      ).toHaveLength(1);
    } finally {
      deleteDocumentoFic(sedeId, ficId);
    }
  });
});
