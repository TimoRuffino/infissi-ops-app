import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z } from "zod";
import {
  COMMESSA_UPLOAD_MAX_BYTES,
  normalizzaMimeUploadCommessa,
} from "@shared/commessaUpload";
import { createContext } from "./context";
import {
  caricaDocumentoCommessaDaBuffer,
  DOC_TIPI,
  apriDocumentoCommessaDaStorage,
  getDocumentoCommessaById,
  StorageAllegatoTemporaneamenteNonDisponibile,
} from "../routers/preventiviContratti";

const uploadMetadataSchema = z.object({
  commessaId: z.coerce.number().int().positive(),
  nome: z.string().min(1).max(255),
  tipo: z.enum(DOC_TIPI),
  mimeType: z.string().min(1).max(100),
  note: z.string().max(2_000).optional(),
});

function sameOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function decodeHeader(value: string | undefined): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodeHeaderFilename(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, char =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function contentRange(
  rangeHeader: string | undefined,
  totalBytes: number
): { start: number; end: number } | null {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
  if (!match) return null;
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : totalBytes - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= totalBytes ||
    requestedEnd < start
  ) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, totalBytes - 1) };
}

function isCrossSiteRequest(req: Request): boolean {
  const secFetchSite = req.get("sec-fetch-site");
  if (!secFetchSite) return false;
  return secFetchSite.toLowerCase() === "cross-site";
}

function releaseUploadSlot(res: Response): void {
  const rel = (res as any).locals.commessaUploadSlotRelease;
  if (typeof rel === "function") {
    rel();
    (res as any).locals.commessaUploadSlotRelease = undefined;
  }
}

export function registerCommessaFileRoutes(app: Express): void {
  const rawUpload = express.raw({
    limit: COMMESSA_UPLOAD_MAX_BYTES,
    type: () => true,
  });
  let uploadAttivi = 0;
  const acquireUploadSlot = () => {
    if (uploadAttivi >= 1) return null;
    uploadAttivi += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      uploadAttivi = Math.max(0, uploadAttivi - 1);
    };
  };

  app.post(
    "/api/commesse/:commessaId/documenti/file",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!sameOrigin(req)) {
          res.status(403).json({ error: "Cross-origin request blocked" });
          return;
        }
        const context = await createContext({ req, res });
        if (!context.user || context.sedeId == null) {
          res.status(401).json({ error: "Autenticazione richiesta" });
          return;
        }
        res.locals.commessaUploadContext = context;
        next();
      } catch (error) {
        next(error);
      }
    },
    (_req: Request, res: Response, next: NextFunction) => {
      const release = acquireUploadSlot();
      if (!release) {
        res.status(429).json({
          error: "Un altro file grande è già in caricamento. Riprova tra poco.",
        });
        return;
      }
      (res as any).locals.commessaUploadSlotRelease = release;
      next();
    },
    rawUpload,
    async (req: Request, res: Response) => {
      try {
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          res.status(400).json({ error: "File mancante." });
          return;
        }
        const nome = decodeHeader(req.get("x-file-name"));
        const reportedMime = decodeHeader(req.get("x-file-mime-type"));
        const metadata = uploadMetadataSchema.parse({
          commessaId: req.params.commessaId,
          nome,
          tipo: req.get("x-document-type"),
          mimeType: normalizzaMimeUploadCommessa(nome, reportedMime),
          note: decodeHeader(req.get("x-file-note")) || undefined,
        });
        const context = res.locals.commessaUploadContext;
        const documento = await caricaDocumentoCommessaDaBuffer({
          ...metadata,
          buffer: req.body,
          sedeId: context.sedeId,
          createdBy: context.user.id ?? null,
        });
        res.status(201).json(documento);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Caricamento non riuscito.";
        const status =
          message === "Commessa non trovata"
            ? 404
            : error instanceof StorageAllegatoTemporaneamenteNonDisponibile
              ? 503
              : 400;
        res.status(status).json({ error: message });
      } finally {
        releaseUploadSlot(res);
      }
    },
    (
      error: { type?: string },
      _req: Request,
      res: Response,
      next: NextFunction
    ) => {
      if (error?.type === "entity.too.large") {
        res.status(413).json({ error: "Il file supera il limite di 250 MB." });
        releaseUploadSlot(res);
        return;
      }
      releaseUploadSlot(res);
      next(error);
    }
  );

  app.get(
    "/api/documenti/:documentoId/file",
    async (req, res, next) => {
      try {
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        if (isCrossSiteRequest(req)) {
          res.status(403).json({ error: "Cross-origin request blocked" });
          return;
        }
        const context = await createContext({ req, res });
        if (!context.user || context.sedeId == null) {
          res.status(401).json({ error: "Autenticazione richiesta" });
          return;
        }

        const documentoId = Number(req.params.documentoId);
        if (!Number.isSafeInteger(documentoId)) {
          res.status(404).end();
          return;
        }

        const documento = getDocumentoCommessaById(documentoId, context.sedeId);
        if (!documento) {
          res.status(404).end();
          return;
        }

        const rawRangeHeader =
          typeof req.headers.range === "string" ? req.headers.range : undefined;
        const requestedRange = contentRange(rawRangeHeader, documento.size);
        if (rawRangeHeader && !requestedRange) {
          res.setHeader("Content-Range", `bytes */${documento.size}`);
          res.status(416).end();
          return;
        }

        const contenuto = await apriDocumentoCommessaDaStorage(
          documentoId,
          context.sedeId,
          requestedRange ?? undefined
        );
        if (!contenuto) {
          res.status(404).end();
          return;
        }

        const { stream, contentLength, totalBytes } = contenuto;
        const disposition =
          req.query.download === "1" ? "attachment" : "inline";
        const encodedName = encodeHeaderFilename(documento.nome);
        res.setHeader(
          "Content-Type",
          documento.mimeType || "application/octet-stream"
        );
        res.setHeader(
          "Content-Disposition",
          `${disposition}; filename*=UTF-8''${encodedName}`
        );
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "private, no-store");

        if (requestedRange) {
          res.status(206);
          res.setHeader(
            "Content-Range",
            `bytes ${requestedRange.start}-${requestedRange.end}/${totalBytes}`
          );
        }
        res.setHeader("Content-Length", contentLength);
        stream.on("error", error => {
          next(error);
        });
        stream.pipe(res);
      } catch (error) {
        next(error);
      }
    }
  );
}
