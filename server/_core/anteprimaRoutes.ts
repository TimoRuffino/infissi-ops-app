// La rotta che serve al browser una pagina resa di un documento del
// fascicolo (anteprime delle evidenze, 06/09/2026): sorella di quella del
// file in commessaFileRoutes.ts, stesse guardie nello stesso ordine —
// stessa origine, richiesta cross-site bloccata, sessione, documento nella
// sede attiva o 404. Dietro FLAG_ANTEPRIME_EVIDENZE: spento, la rotta non
// esiste (404).
//
// Differenza voluta dal file: la pagina resa è immutabile per impronta,
// quindi porta un ETag e una cache privata di un giorno — la vignetta si
// riapre spesso e non deve riscaricare la stessa immagine.

import type { Express, Request } from "express";
import { ANTEPRIME_VERSIONE, leggiAnteprima } from "../documenti/anteprime";
import { interruttoreAttivo } from "../platform/interruttori";
import { getDocumentoCommessaById } from "../routers/preventiviContratti";
import { createContext } from "./context";

function sameOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function isCrossSiteRequest(req: Request): boolean {
  const secFetchSite = req.get("sec-fetch-site");
  if (!secFetchSite) return false;
  return secFetchSite.toLowerCase() === "cross-site";
}

export function registerAnteprimaRoutes(app: Express): void {
  app.get("/api/documenti/:documentoId/pagina/:pagina", async (req, res, next) => {
    try {
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      if (!sameOrigin(req) || isCrossSiteRequest(req)) {
        res.status(403).json({ error: "Cross-origin request blocked" });
        return;
      }
      if (!interruttoreAttivo("anteprimeEvidenze")) {
        res.status(404).end();
        return;
      }
      const context = await createContext({ req, res });
      if (!context.user || context.sedeId == null) {
        res.status(401).json({ error: "Autenticazione richiesta" });
        return;
      }
      const documentoId = Number(req.params.documentoId);
      const pagina = Number(req.params.pagina);
      if (!Number.isSafeInteger(documentoId) || !Number.isSafeInteger(pagina) || pagina < 1) {
        res.status(404).end();
        return;
      }
      const documento = getDocumentoCommessaById(documentoId, context.sedeId);
      if (!documento) {
        res.status(404).end();
        return;
      }
      const etag = `"anteprima:${documento.checksum ?? documentoId}:${pagina}:${ANTEPRIME_VERSIONE}"`;
      if (req.headers["if-none-match"] === etag) {
        res.setHeader("ETag", etag);
        res.setHeader("Cache-Control", "private, max-age=86400");
        res.status(304).end();
        return;
      }
      const letta = await leggiAnteprima(documentoId, context.sedeId, pagina);
      if (letta.esito === "fuori_intervallo") {
        res.status(404).end();
        return;
      }
      if (letta.esito === "non_disponibile") {
        if (letta.codice === "documento" || letta.codice === "spento") {
          res.status(404).end();
          return;
        }
        res.status(503).json({ error: letta.motivo });
        return;
      }
      res.setHeader("Content-Type", letta.mimeType);
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.setHeader("ETag", etag);
      res.setHeader("Content-Length", letta.buffer.length);
      res.end(letta.buffer);
    } catch (error) {
      next(error);
    }
  });
}
