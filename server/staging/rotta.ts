// server/staging/rotta.ts
import { timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { ambienteStaging } from "../_core/ambiente";

/**
 * Accesso di prova per staging: un link con token apre la sessione
 * dell'utente demo (l'admin di bootstrap) senza digitare una password —
 * gli agenti non possono digitarne, e il link si può incollare nel pannello
 * Browser. Doppio gate: la rotta ESISTE solo se AMBIENTE=staging e il
 * token d'ambiente è impostato (≥32 caratteri). Qualunque fallimento è un
 * 404 senza dettagli; il token non finisce mai nei log.
 */
export function montaRottaStaging(app: Express): boolean {
  const atteso = process.env.STAGING_ACCESSO_TOKEN ?? "";
  if (!ambienteStaging() || atteso.length < 32) return false;

  app.get("/api/staging/entra", async (req: Request, res: Response) => {
    try {
      const fornito = String((req.query as any).token ?? "");
      const a = Buffer.from(fornito);
      const b = Buffer.from(atteso);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        res.status(404).end();
        return;
      }
      const { getUtentiStore } = await import("../routers/utenti");
      const email = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@ruffinogroup.it").toLowerCase();
      const utente = (getUtentiStore() as any[]).find(
        u => u.attivo && String(u.email).toLowerCase() === email
      );
      if (!utente) {
        res.status(404).end();
        return;
      }
      const { apriSessioneLocale } = await import("../localAuth");
      await apriSessioneLocale({ req, res }, utente);
      res.redirect(302, "/");
    } catch {
      // Express 4 non cattura la promise rifiutata: senza questo catch il
      // processo cadrebbe (v. server/_core/rotteAnonime.ts).
      if (!res.headersSent) res.status(404).end();
    }
  });
  return true;
}
