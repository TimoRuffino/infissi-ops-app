// server/piattaforma/router.ts
// Le sole LETTURE del pannello piattaforma (WS6 spec §5.1): elenco delle
// aziende, scheda di una, un comando per id (per seguire ricalcolo e
// ripristino accodati). Le mutazioni (Task 7) vivono nello stesso router.
// Ogni procedura passa da `piattaformaProcedure` (server/_core/trpc.ts):
// nessun contesto tenant implicito (spec §3.1) — l'azienda si individua per
// `slug`, mai per `tenantId` (guardia confine.test.ts, già coperta dalla
// guardia globale di server/tenants/confine.test.ts).
import { z } from "zod";
import { oppureNotFound } from "../_core/permissions";
import { piattaformaProcedure, router } from "../_core/trpc";
import { SLUG_RE } from "../tenants/costanti";
import { getTenantRepository } from "../tenants/repository";
import { elencoAziende, schedaAzienda } from "./letture";

export const piattaformaRouter = router({
  /** L'elenco di tutte le aziende: abbonamento, spazio, Tars, worker sospesi, ultimo backup e proprietari (spec §5.1). */
  aziende: piattaformaProcedure.query(() => elencoAziende(new Date())),

  /** La scheda completa di un'azienda. Slug sconosciuto → NOT_FOUND «Risorsa non trovata.» */
  azienda: piattaformaProcedure
    .input(z.object({ slug: z.string().regex(SLUG_RE) }))
    .query(async ({ input }) => oppureNotFound(await schedaAzienda(input.slug, new Date()))),

  /** Un comando per id, per seguire l'esito di ricalcolo e ripristino accodati (`null` se non esiste). */
  comando: piattaformaProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) => getTenantRepository().comando(input.id)),
});
