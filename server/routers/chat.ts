// Chat aziendale — API.
//
// Il canale generale è per sede: è il registro di un ufficio. Le conversazioni
// dirette no — appartengono a due persone, seguono loro e non lo showroom in
// cui stanno lavorando, così chi è a Sarzana può scrivere a chi è alla Spezia.
// Un canale che non ti riguarda resta `NOT_FOUND` e non `FORBIDDEN`: un id non
// deve poter confermare l'esistenza di una conversazione altrui.
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
  canaleDiMessaggio,
  canaleDiretto,
  canaleGenerale,
  commutaReazione,
  leggiMessaggi,
  listaCanali,
  scriviMessaggio,
  segnaLetto,
  totaleNonLetti,
  trovaCanale,
} from "../chat/store";
import { getSediStore } from "./sedi";

const MAX_TESTO = 4_000;

function nomeUtente(utente: any): string {
  return (
    [utente?.nome, utente?.cognome].filter(Boolean).join(" ") ||
    utente?.name ||
    "Utente"
  );
}

async function canaleAccessibile(
  canaleId: number,
  sedeId: number,
  utenteId: number
) {
  const canale = await trovaCanale(sedeId, canaleId);
  // Il generale appartiene alla sede; una conversazione diretta appartiene
  // alle due persone, e per quella conta solo l'appartenenza.
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
    const canali = await listaCanali({ sedeId, utenteId });
    const utenti = getUtentiStore();
    // Il nome di una conversazione diretta dipende da chi guarda: la stessa
    // riga è "Alessandro" per me e "Timothy" per lui. Memorizzarne uno solo
    // mostrava a uno dei due il proprio nome.
    return canali.map(canale => {
      if (canale.tipo !== "diretto") return { ...canale, altroUtenteId: null };
      const altroId =
        canale.membriIds.find(id => id !== utenteId) ??
        canale.membriIds[0] ??
        null;
      const altro = utenti.find((u: any) => Number(u.id) === Number(altroId));
      return {
        ...canale,
        altroUtenteId: altroId,
        nome: altroId === 0 ? "Tars" : altro ? nomeUtente(altro) : canale.nome,
      };
    });
  }),

  /** Non letti su tutto: alimenta il badge nel menu laterale. */
  nonLetti: protectedProcedure.query(({ ctx }) =>
    totaleNonLetti({
      sedeId: ctx.sedeId ?? DEFAULT_SEDE_ID,
      utenteId: ctx.user?.id ?? 0,
    })
  ),

  /**
   * La rubrica interna: TUTTE le persone attive dell'azienda, non solo quelle
   * della sede attiva.
   *
   * Il confine di sede protegge i dati business — commesse, fatture, clienti.
   * Non ha senso su una conversazione fra due colleghi: chi lavora a Sarzana
   * deve poter scrivere a chi sta alla Spezia senza cambiare showroom.
   * La sede altrui viene mostrata come etichetta, perché sapere da dove
   * risponde una persona è utile.
   */
  interlocutori: protectedProcedure.query(({ ctx }) => {
    const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
    const sedi = new Map(
      getSediStore().map((sede: any) => [sede.id, sede.nome as string])
    );
    return getUtentiStore()
      .filter(
        (u: any) => u.attivo !== false && Number(u.id) !== Number(ctx.user?.id)
      )
      .map((u: any) => {
        const sue: number[] = Array.isArray(u.sediIds) ? u.sediIds : [];
        return {
          id: u.id,
          nome: nomeUtente(u),
          ruolo: Array.isArray(u.ruoli) ? (u.ruoli[0] ?? null) : (u.ruolo ?? null),
          // Etichetta solo quando NON condividete la sede attiva: dirlo
          // sempre sarebbe rumore.
          sede: sue.includes(sedeId)
            ? null
            : (sue.map(id => sedi.get(id)).filter(Boolean).join(", ") || null),
        };
      })
      .sort((a: any, b: any) => a.nome.localeCompare(b.nome, "it"));
  }),

  apriDiretta: protectedProcedure
    .input(z.object({ utenteId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const io = ctx.user?.id ?? 0;
      const altro = getUtentiStore().find(
        (u: any) =>
          Number(u.id) === Number(input.utenteId) && u.attivo !== false
      );
      if (!altro) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Utente non trovato.",
        });
      }
      // Il nome memorizzato è quello dell'altra persona vista da chi apre;
      // `canali` lo risolve comunque per chi guarda, quindi non conta chi
      // dei due arriva per primo.
      return canaleDiretto({ a: io, b: input.utenteId, nome: nomeUtente(altro) });
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

  reagisci: protectedProcedure
    .input(
      z.object({
        messaggioId: z.number().int().positive(),
        // Elenco chiuso: una emoji arbitraria dal client sarebbe testo non
        // fidato salvato e poi ridistribuito a tutti.
        emoji: z.enum(["👍", "🎉", "😂", "❤️", "👀", "🙏"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
      const utenteId = ctx.user?.id ?? 0;
      const canaleId = await canaleDiMessaggio(input.messaggioId);
      if (canaleId == null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Messaggio non trovato.",
        });
      }
      await canaleAccessibile(canaleId, sedeId, utenteId);
      return commutaReazione({
        messaggioId: input.messaggioId,
        utenteId,
        emoji: input.emoji,
      });
    }),

  generale: protectedProcedure.query(({ ctx }) =>
    canaleGenerale(ctx.sedeId ?? DEFAULT_SEDE_ID)
  ),
});
