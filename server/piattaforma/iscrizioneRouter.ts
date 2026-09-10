// server/piattaforma/iscrizioneRouter.ts
// Router pubblico dell'iscrizione «Prova gratuita» (ciclo di vita, D7),
// montato come `iscrizione`: la pagina /prova (fuori dalla shell, senza
// sessione) parla solo con questo router — stesso stile di `invitiRouter`.
//
// Tre difese: la disponibilità fail-closed (`iscrizioneDisponibile`), il
// limite per indirizzo (5 richieste l'ora: creare aziende è pesante), e un
// honeypot («sito»: un campo che una persona non vede e non compila — se
// arriva pieno si risponde ok senza fare nulla). La risposta è sempre la
// stessa: nessuna conferma di quali email esistono.
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { creaLimiteTentativi } from "../_core/limiteTentativi";
import { publicProcedure, router } from "../_core/trpc";
import { MESSAGGI_PIATTAFORMA } from "./costanti";
import { baseUrlDa, iscrizioneDisponibile, registraProva } from "./iscrizione";

const limiteIscrizioni = creaLimiteTentativi({
  finestraMs: 60 * 60 * 1000,
  massimo: 5,
  messaggio: MESSAGGI_PIATTAFORMA.troppiTentativi,
});

const chiaveIndirizzo = (req: { ip?: string }): string => `iscrizione:${req.ip || "?"}`;

/** Solo per i test: azzera il limitatore della pagina di iscrizione. */
export function __azzeraLimiteIscrizioniPerTest(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("TEST_ONLY");
  limiteIscrizioni.__azzeraTutto();
}

function assicuraDisponibile(): void {
  if (!iscrizioneDisponibile()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: MESSAGGI_PIATTAFORMA.iscrizioneNonDisponibile,
    });
  }
}

export const iscrizioneRouter = router({
  /** La pagina la chiama per decidere se mostrare il modulo o il messaggio di cortesia. */
  disponibile: publicProcedure.query(() => ({ attiva: iscrizioneDisponibile() })),

  registra: publicProcedure
    .input(
      z.object({
        azienda: z.string().trim().min(2).max(120),
        nome: z.string().trim().min(1).max(80),
        cognome: z.string().trim().min(1).max(80),
        email: z.string().trim().email(),
        telefono: z.string().trim().max(40).nullable().optional(),
        /** Honeypot: il modulo lo tiene nascosto e vuoto. */
        sito: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      assicuraDisponibile();
      const chiave = chiaveIndirizzo(ctx.req);
      limiteIscrizioni.verifica(chiave);
      limiteIscrizioni.fallito(chiave); // ogni richiesta consuma un colpo: qui non esiste un «tentativo riuscito» che azzera
      if (input.sito?.trim()) return { ok: true as const };
      try {
        return await registraProva({
          azienda: input.azienda,
          nome: input.nome,
          cognome: input.cognome,
          email: input.email,
          telefono: input.telefono ?? null,
          baseUrl: baseUrlDa(ctx.req),
        });
      } catch (e) {
        // Mai i dettagli verso l'anonimo: il log interno li ha già.
        console.error(`[iscrizione] registrazione fallita: ${e instanceof Error ? e.message : e}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: MESSAGGI_PIATTAFORMA.iscrizioneNonRiuscita,
        });
      }
    }),
});
