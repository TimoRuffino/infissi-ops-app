// Chat aziendale — API.
//
// Tutto è sede-scoped come il resto del CRM: un canale di un'altra sede è
// `NOT_FOUND`, non `FORBIDDEN`, così un id non conferma l'esistenza di una
// conversazione altrui.
//
// Il client non può scrivere messaggi di sistema: `autoreId` viene sempre
// dalla sessione. I messaggi con autore nullo li produce solo il server
// (`chat/annunci.ts`).

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { DEFAULT_SEDE_ID } from "./sedi";
import { getUtentiStore } from "./utenti";
import {
  canaleGenerale,
  chiaveDiretta,
  leggiMessaggi,
  listaCanali,
  scriviMessaggio,
  segnaLetto,
  trovaCanale,
  trovaOCreaCanale,
} from "../chat/store";

const MAX_TESTO = 4_000;

function nomeUtente(utente: any): string {
  return (
    [utente?.nome, utente?.cognome].filter(Boolean).join(" ") ||
    utente?.name ||
    "Utente"
  );
}

function utenteDellaSede(utenteId: number, sedeId: number) {
  return getUtentiStore().find(
    (u: any) =>
      Number(u.id) === Number(utenteId) &&
      u.attivo !== false &&
      Array.isArray(u.sediIds) &&
      u.sediIds.includes(sedeId)
  );
}

async function canaleAccessibile(
  canaleId: number,
  sedeId: number,
  utenteId: number
) {
  const canale = await trovaCanale(sedeId, canaleId);
  if (
    !canale ||
    (canale.tipo !== "generale" && !canale.membriIds.includes(utenteId))
  ) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Canale non trovato." });
  }
  return canale;
}

export const chatRouter = router({
  canali: protectedProcedure.query(async ({ ctx }) => {
    const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
    const utenteId = ctx.user?.id ?? 0;
    return listaCanali({ sedeId, utenteId });
  }),

  // Le persone con cui si può aprire una conversazione: la rubrica interna
  // della sede, senza sé stessi.
  interlocutori: protectedProcedure.query(({ ctx }) => {
    const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
    return getUtentiStore()
      .filter(
        (u: any) =>
          u.attivo !== false &&
          Number(u.id) !== Number(ctx.user?.id) &&
          Array.isArray(u.sediIds) &&
          u.sediIds.includes(sedeId)
      )
      .map((u: any) => ({ id: u.id, nome: nomeUtente(u), ruolo: u.ruolo ?? null }));
  }),

  apriDiretta: protectedProcedure
    .input(z.object({ utenteId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
      const io = ctx.user?.id ?? 0;
      const altro = utenteDellaSede(input.utenteId, sedeId);
      if (!altro) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Utente non trovato in questa sede.",
        });
      }
      return trovaOCreaCanale({
        sedeId,
        tipo: "diretto",
        chiave: chiaveDiretta(io, input.utenteId),
        nome: nomeUtente(altro),
        membriIds: [io, input.utenteId],
      });
    }),

  messaggi: protectedProcedure
    .input(
      z.object({
        canaleId: z.number().int().positive(),
        limite: z.number().int().min(1).max(200).optional(),
        primaDiId: z.number().int().positive().nullable().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
      await canaleAccessibile(input.canaleId, sedeId, ctx.user?.id ?? 0);
      return leggiMessaggi({
        sedeId,
        canaleId: input.canaleId,
        limite: input.limite,
        primaDiId: input.primaDiId ?? null,
      });
    }),

  invia: protectedProcedure
    .input(
      z.object({
        canaleId: z.number().int().positive(),
        testo: z.string().trim().min(1).max(MAX_TESTO),
        commessaId: z.number().int().positive().nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
      const utenteId = ctx.user?.id ?? 0;
      await canaleAccessibile(input.canaleId, sedeId, utenteId);
      const messaggio = await scriviMessaggio({
        sedeId,
        canaleId: input.canaleId,
        autoreId: utenteId,
        autoreNome: nomeUtente(ctx.user),
        testo: input.testo,
        commessaId: input.commessaId ?? null,
      });
      // Chi scrive ha letto: senza, il proprio messaggio conterebbe come
      // non letto al primo caricamento della lista.
      await segnaLetto({
        sedeId,
        canaleId: input.canaleId,
        utenteId,
        finoAId: messaggio.id,
      });
      return messaggio;
    }),

  segnaLetto: protectedProcedure
    .input(
      z.object({
        canaleId: z.number().int().positive(),
        finoAId: z.number().int().nonnegative(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
      const utenteId = ctx.user?.id ?? 0;
      await canaleAccessibile(input.canaleId, sedeId, utenteId);
      await segnaLetto({
        sedeId,
        canaleId: input.canaleId,
        utenteId,
        finoAId: input.finoAId,
      });
      return { success: true as const };
    }),

  generale: protectedProcedure.query(({ ctx }) =>
    canaleGenerale(ctx.sedeId ?? DEFAULT_SEDE_ID)
  ),
});
