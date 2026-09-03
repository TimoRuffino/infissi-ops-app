// Servire un allegato di una comunicazione al browser.
//
// Il server sapeva già leggerli — `leggiAllegatoRaw` li prende dallo storage,
// o li ripesca da IMAP o da Meta quando lo storage non li ha — ma non esisteva
// nessuna rotta HTTP: nell'email l'allegato si vedeva elencato con nome e peso
// e non si poteva aprire. Un nome di file non è un allegato.
//
// Stesso guscio dei documenti di commessa, e per le stesse ragioni: sessione
// obbligatoria, sede dal contesto e mai dall'URL, niente richieste cross-site,
// nome del file codificato in intestazione, e `no-store` perché un allegato è
// posta di un cliente e non va lasciato nella cache del disco.

import type { Express, Request, Response, NextFunction } from "express";

import { createContext } from "./context";
import { leggiAllegatoRaw } from "../comunicazioni/allegati";
import { getLiveComunicazione } from "../comunicazioni/comunicazioni";

/**
 * `filename*` di RFC 5987: i nomi arrivano dalla posta e contengono accenti,
 * spazi e virgolette. Metterli grezzi in intestazione rompe la risposta.
 */
function nomeInIntestazione(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, c =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/**
 * Una richiesta partita da un altro sito non deve poter leggere la posta:
 * il cookie di sessione viaggerebbe lo stesso.
 */
function daAltroSito(req: Request): boolean {
  const sito = req.headers["sec-fetch-site"];
  if (typeof sito === "string") return sito === "cross-site";
  const origine = req.headers.origin;
  if (!origine) return false;
  try {
    return new URL(origine).host !== req.headers.host;
  } catch {
    return true;
  }
}

export function registerAllegatoMailRoutes(app: Express) {
  app.get(
    "/api/comunicazioni/:comunicazioneId/allegati/:indice",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        if (daAltroSito(req)) {
          res.status(403).json({ error: "Richiesta cross-origin bloccata" });
          return;
        }
        const contesto = await createContext({ req, res });
        if (!contesto.user || contesto.sedeId == null) {
          res.status(401).json({ error: "Autenticazione richiesta" });
          return;
        }

        const comunicazioneId = Number(req.params.comunicazioneId);
        const indice = Number(req.params.indice);
        if (
          !Number.isSafeInteger(comunicazioneId) ||
          !Number.isSafeInteger(indice) ||
          indice < 0
        ) {
          res.status(404).end();
          return;
        }

        // Sede dal contesto: una comunicazione di un'altra sede non esiste,
        // e non deve nemmeno distinguersi da un id inventato.
        const comunicazione = await getLiveComunicazione(
          comunicazioneId,
          contesto.sedeId
        );
        if (!comunicazione || indice >= comunicazione.allegati.length) {
          res.status(404).end();
          return;
        }

        let raw;
        try {
          raw = await leggiAllegatoRaw(comunicazione, indice);
        } catch (errore: any) {
          // Un allegato non recuperabile è normale, non un guasto: lo storage
          // locale non li conserva, e Meta scarta i media dopo un mese. Si
          // dice cosa è successo, senza far pensare a un errore del CRM.
          res.status(410).json({
            error:
              typeof errore?.message === "string"
                ? errore.message
                : "Allegato non più recuperabile.",
          });
          return;
        }

        const nome = nomeInIntestazione(raw.nome);
        res.setHeader(
          "Content-Type",
          raw.mimeType || "application/octet-stream"
        );
        res.setHeader(
          "Content-Disposition",
          `${req.query.download === "1" ? "attachment" : "inline"}; filename*=UTF-8''${nome}`
        );
        res.setHeader("Content-Length", raw.buffer.length);
        res.setHeader("Cache-Control", "private, no-store");
        res.end(raw.buffer);
      } catch (errore) {
        next(errore);
      }
    }
  );
}
