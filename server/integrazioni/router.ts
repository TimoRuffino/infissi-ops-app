// Il router unico del collegamento (WS5, spec §3.3).
//
// Ogni procedura applica la guardia DELL'ADATTATORE, non una guardia unica:
// oggi FiC, backup e mail sono `adminProcedure`, i calendari
// `protectedProcedure`. Appiattire la differenza sarebbe allargare o
// restringere permessi di nascosto.

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { tenantIdDellaSede } from "../tenants/contesto";
import type { Adattatore, Chiave, Ctx } from "./contratto";
import { passiAttivazione, segnaSaltata } from "./attivazione";
import { invalidaVerifica, verificaConCache } from "./cache";
import { statiDiTutti } from "./errori";
import { REGISTRO, adattatoreDi } from "./registro";

const chiaveSchema = z.enum([
  "fic",
  "email",
  "whatsapp",
  "calendario",
  "backup",
  "agente",
]);

/**
 * Risolve l'adattatore e applica la sua guardia.
 *
 * Chiave sconosciuta e permesso negato danno lo STESSO `NOT_FOUND`: un
 * `FORBIDDEN` distinguerebbe «esiste ma non puoi» da «non esiste», ed è
 * un'informazione che non serve a chi ha diritto e serve a chi enumera.
 */
export function risolvi(ctx: Ctx, chiave: Chiave): Adattatore {
  const a = adattatoreDi(chiave);
  const direzione = ctx.user?.role === "admin";
  if (!a || (a.permesso === "direzione" && !direzione) || !sedeSua(a, ctx)) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Integrazione non trovata.",
    });
  }
  return a;
}

/**
 * La sede attiva è davvero di chi sta chiedendo?
 *
 * Il contesto la risolve già dentro le sedi ammesse dell'azienda, quindi in
 * produzione la risposta è sempre sì: questa è difesa in profondità, e vale
 * il costo perché un adattatore lavora sulla sede senza poterla verificare —
 * un `sedeId` di un'altra azienda non darebbe errore, mostrerebbe i dati
 * sbagliati dentro la pagina giusta. `NOT_FOUND` come sempre: l'id di una
 * sede altrui non riceve nemmeno conferma di esistere.
 */
function sedeSua(a: Adattatore, ctx: Ctx): boolean {
  if (a.ambito !== "sede" || ctx.sedeId == null) return true;
  if (ctx.sediIds.length > 0 && !ctx.sediIds.includes(ctx.sedeId)) return false;
  // Una sede che non esiste (i contesti di prova, le installazioni a sede
  // unica) risponde col tenant predefinito: non è un confine attraversato.
  return ctx.tenantId == null || tenantIdDellaSede(ctx.sedeId) === ctx.tenantId;
}

/** La sede su cui l'adattatore lavora: `null` per quelli ad ambito azienda. */
function sedeDi(a: Adattatore, ctx: Ctx): number | null {
  return a.ambito === "sede" ? ctx.sedeId : null;
}

export const integrazioniRouter = router({
  /** Sola lettura: nessuna chiamata esterna, regge il caricamento pagina. */
  elenco: protectedProcedure.query(async ({ ctx }) => {
    const visibili = REGISTRO.filter(
      a => a.permesso !== "direzione" || ctx.user?.role === "admin"
    );
    // `allSettled`, non `all`: un adattatore che lancia diventa la sua riga
    // «stato non disponibile», e le altre cinque restano leggibili (spec §9).
    return statiDiTutti(visibili, a => a.stato(ctx));
  }),

  verifica: protectedProcedure
    .input(z.object({ chiave: chiaveSchema }))
    .mutation(({ ctx, input }) => {
      const a = risolvi(ctx, input.chiave);
      return verificaConCache(ctx.tenantId, input.chiave, sedeDi(a, ctx), () =>
        a.verifica(ctx)
      );
    }),

  avvia: protectedProcedure
    .input(z.object({ chiave: chiaveSchema, opzioni: z.unknown().optional() }))
    .mutation(({ ctx, input }) => {
      const a = risolvi(ctx, input.chiave);
      if (!a.avvia) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Questa integrazione non si collega.",
        });
      }
      // L'esito di prima non vale più: chi ricollega ha appena cambiato la
      // verità che la cache stava conservando.
      invalidaVerifica(ctx.tenantId, input.chiave, sedeDi(a, ctx));
      return a.avvia(ctx, input.opzioni);
    }),

  completa: protectedProcedure
    .input(z.object({ chiave: chiaveSchema, esito: z.unknown() }))
    .mutation(async ({ ctx, input }) => {
      const a = risolvi(ctx, input.chiave);
      if (!a.completa) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Questa integrazione non si completa.",
        });
      }
      await a.completa(ctx, input.esito);
      invalidaVerifica(ctx.tenantId, input.chiave, sedeDi(a, ctx));
      return { ok: true as const };
    }),

  scollega: protectedProcedure
    .input(z.object({ chiave: chiaveSchema }))
    .mutation(async ({ ctx, input }) => {
      const a = risolvi(ctx, input.chiave);
      if (!a.scollega) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Questa integrazione non si scollega.",
        });
      }
      await a.scollega(ctx);
      invalidaVerifica(ctx.tenantId, input.chiave, sedeDi(a, ctx));
      return { ok: true as const };
    }),

  attivazione: protectedProcedure.query(({ ctx }) => passiAttivazione(ctx)),

  salta: protectedProcedure
    .input(z.object({ chiave: chiaveSchema }))
    .mutation(({ ctx, input }) => {
      // `risolvi` applica la guardia: non si salta un passo che non si vede.
      risolvi(ctx, input.chiave);
      segnaSaltata(input.chiave);
      return { ok: true as const };
    }),
});
