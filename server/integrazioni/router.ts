// Il router unico del collegamento (WS5, spec §3.3).
//
// Ogni procedura applica la guardia DELL'ADATTATORE, non una guardia unica:
// oggi FiC, backup e mail sono `adminProcedure`, i calendari
// `protectedProcedure`. Appiattire la differenza sarebbe allargare o
// restringere permessi di nascosto.

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import type { Adattatore, Chiave, Ctx } from "./contratto";
import { passiAttivazione, segnaSaltata } from "./attivazione";
import { verificaConCache } from "./cache";
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
  if (!a || (a.permesso === "direzione" && !direzione)) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Integrazione non trovata.",
    });
  }
  return a;
}

export const integrazioniRouter = router({
  /** Sola lettura: nessuna chiamata esterna, regge il caricamento pagina. */
  elenco: protectedProcedure.query(async ({ ctx }) => {
    const visibili = REGISTRO.filter(
      a => a.permesso !== "direzione" || ctx.user?.role === "admin"
    );
    return Promise.all(visibili.map(a => a.stato(ctx)));
  }),

  verifica: protectedProcedure
    .input(z.object({ chiave: chiaveSchema }))
    .mutation(({ ctx, input }) => {
      const a = risolvi(ctx, input.chiave);
      const sede = a.ambito === "sede" ? ctx.sedeId : null;
      return verificaConCache(input.chiave, sede, () => a.verifica(ctx));
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
