import type { FatturaFic } from "./ficFatture";
import { ficFatture, saveFicFatture } from "./ficFatture";
import { scaricaFatturaPdf } from "./fattureInCloud";
import { findDocumentoFic, upsertDocumentoFic } from "./preventiviContratti";

export type FicPdfEnsureResult = {
  stato: "archiviata" | "errore" | "non_collegata";
  documentoId: number | null;
  errore: string | null;
};

type DownloadFicPdf = (
  sedeId: number,
  ficId: number,
  signal?: AbortSignal
) => Promise<Buffer>;

function errorePdfSanitizzato(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Errore sconosciuto sul PDF.";
  return message
    .replace(/https?:\/\/\S+/gi, "[URL rimossa]")
    .replace(/bearer\s+\S+/gi, "Bearer [rimosso]")
    .slice(0, 300);
}

type EnsureFicInvoiceAttachmentInput = {
  sedeId: number;
  fattura: FatturaFic;
  createdBy: number | null;
  signal?: AbortSignal;
  downloadPdf?: DownloadFicPdf;
};

const attachmentQueues = new Map<string, Promise<FicPdfEnsureResult>>();

async function ensureFicInvoiceAttachmentUnlocked(
  input: EnsureFicInvoiceAttachmentInput
): Promise<FicPdfEnsureResult> {
  if (input.fattura.sedeId !== input.sedeId) {
    throw new Error("Fattura non trovata");
  }
  if (input.fattura.commessaId == null) {
    input.fattura.pdfSync = {
      stato: "non_collegata",
      ultimoTentativoAt: input.fattura.pdfSync.ultimoTentativoAt,
      ultimoErrore: null,
    };
    saveFicFatture();
    return {
      stato: "non_collegata",
      documentoId: null,
      errore: null,
    };
  }
  const commessaId = input.fattura.commessaId;

  const existing = findDocumentoFic(input.sedeId, input.fattura.id);
  if (
    existing?.commessaId === commessaId &&
    (!!existing.storageKey || !!existing.dataBase64)
  ) {
    const changed =
      input.fattura.pdfSync.stato !== "archiviata" ||
      input.fattura.pdfSync.ultimoErrore != null;
    input.fattura.pdfSync.stato = "archiviata";
    input.fattura.pdfSync.ultimoErrore = null;
    if (changed) saveFicFatture();
    return {
      stato: "archiviata",
      documentoId: existing.id,
      errore: null,
    };
  }

  const now = new Date();
  input.fattura.pdfSync = {
    stato: "in_attesa",
    ultimoTentativoAt: now,
    ultimoErrore: null,
  };
  saveFicFatture();

  try {
    const download = input.downloadPdf ?? scaricaFatturaPdf;
    const pdf = await download(input.sedeId, input.fattura.id, input.signal);
    if (input.signal?.aborted) throw input.signal.reason;
    const documento = await upsertDocumentoFic({
      sedeId: input.sedeId,
      ficId: input.fattura.id,
      commessaId,
      numero: input.fattura.numero,
      data: input.fattura.data,
      pdf,
      createdBy: input.createdBy,
    });
    input.fattura.pdfSync = {
      stato: "archiviata",
      ultimoTentativoAt: now,
      ultimoErrore: null,
    };
    saveFicFatture();
    return {
      stato: "archiviata",
      documentoId: documento.id,
      errore: null,
    };
  } catch (error) {
    if (input.signal?.aborted) throw input.signal.reason;
    const errore = errorePdfSanitizzato(error);
    input.fattura.pdfSync = {
      stato: "errore",
      ultimoTentativoAt: now,
      ultimoErrore: errore,
    };
    saveFicFatture();
    return {
      stato: "errore",
      documentoId: existing?.id ?? null,
      errore,
    };
  }
}

export function ensureFicInvoiceAttachment(
  input: EnsureFicInvoiceAttachmentInput
): Promise<FicPdfEnsureResult> {
  const key = `${input.sedeId}:${input.fattura.id}`;
  const previous = attachmentQueues.get(key);
  const current = (previous ?? Promise.resolve(null))
    .catch(() => null)
    .then(() => ensureFicInvoiceAttachmentUnlocked(input));
  attachmentQueues.set(key, current);
  void current.then(
    () => {
      if (attachmentQueues.get(key) === current) attachmentQueues.delete(key);
    },
    () => {
      if (attachmentQueues.get(key) === current) attachmentQueues.delete(key);
    }
  );
  return current;
}

export async function ensureFicInvoiceAttachments(input: {
  sedeId: number;
  createdBy: number | null;
  signal?: AbortSignal;
  downloadPdf?: DownloadFicPdf;
}): Promise<{ pdfArchiviati: number; pdfFalliti: number }> {
  let pdfArchiviati = 0;
  let pdfFalliti = 0;
  const collegate = ficFatture.filter(
    fattura =>
      fattura.sedeId === input.sedeId &&
      fattura.tipo === "invoice" &&
      fattura.presenteInFic &&
      fattura.commessaId != null
  );

  for (const fattura of collegate) {
    if (input.signal?.aborted) throw input.signal.reason;
    // Le fatture emesse dal CRM (piano 2) arrivano già con il PDF nel
    // fascicolo: lo archivia `registraDocumentoFatturaCrm` all'emissione,
    // con un source/sourceRef diversi da quelli che `findDocumentoFic` sa
    // cercare. Riscaricarle da FiC ci metterebbe un secondo file.
    if (fattura.commessaMatch === "crm") {
      if (fattura.pdfSync.stato !== "archiviata") {
        fattura.pdfSync.stato = "archiviata";
        fattura.pdfSync.ultimoTentativoAt = null;
        fattura.pdfSync.ultimoErrore = null;
        saveFicFatture();
      }
      continue;
    }
    const existing = findDocumentoFic(input.sedeId, fattura.id);
    if (
      existing?.commessaId === fattura.commessaId &&
      (!!existing.storageKey || !!existing.dataBase64) &&
      fattura.pdfSync.stato === "archiviata"
    ) {
      continue;
    }
    const result = await ensureFicInvoiceAttachment({
      ...input,
      fattura,
    });
    if (result.stato === "archiviata") pdfArchiviati++;
    else if (result.stato === "errore") pdfFalliti++;
  }

  return { pdfArchiviati, pdfFalliti };
}
