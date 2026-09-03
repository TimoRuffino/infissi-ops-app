// Contratto strutturato della commessa: il router valida e autorizza, il
// servizio decide (server/contratti/servizio.ts). Ogni procedura nasce
// dietro FLAG_LIMITI. Sede isolata: NOT_FOUND, mai dettagli.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { procedureConInterruttore, router } from "../_core/trpc";
import { authorizeCoreOperation, effectiveCapabilitySet } from "../authz/enforcement";
import {
  contrattoInputSchema,
  leggiContratto,
  rigaInputSchema,
  salvaContratto,
} from "../contratti/servizio";
import { getCommessaById } from "./commesse";
import { DEFAULT_SEDE_ID } from "./sedi";

const procedura = procedureConInterruttore("limiti");

function sedeCorrente(ctx: { sedeId: number | null }): number {
  return ctx.sedeId ?? DEFAULT_SEDE_ID;
}

function commessaInSede(commessaId: number, sedeId: number): void {
  const commessa: any = getCommessaById(commessaId);
  if (!commessa || (commessa.sedeId ?? DEFAULT_SEDE_ID) !== sedeId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Commessa non trovata." });
  }
}

/** Gli errori del servizio hanno un prefisso: qui diventano codici tRPC. */
export function erroreServizioComeTrpc(errore: unknown): never {
  const messaggio = String((errore as any)?.message ?? "Operazione non riuscita.");
  if (messaggio.startsWith("NOT_FOUND: ")) {
    throw new TRPCError({ code: "NOT_FOUND", message: messaggio.slice("NOT_FOUND: ".length) });
  }
  if (messaggio.startsWith("VALIDAZIONE: ")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: messaggio.slice("VALIDAZIONE: ".length) });
  }
  if ((errore as any)?.name === "ZodError") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Dati del contratto non validi." });
  }
  throw errore;
}

export const contrattiRouter = router({
  get: procedura
    .input(z.object({ commessaId: z.number().int() }))
    .query(async ({ input, ctx }) => {
      const sedeId = sedeCorrente(ctx);
      commessaInSede(input.commessaId, sedeId);
      await authorizeCoreOperation({
        ctx,
        endpoint: "contratti.get",
        capability: "contratto.read",
        resourceType: "contratto",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      const caps = await effectiveCapabilitySet(ctx, ["contratto.manage"]);
      const letto = await leggiContratto(sedeId, input.commessaId);
      return { ...letto, puoModificare: caps.has("contratto.manage") };
    }),

  salva: procedura
    .input(
      z.object({
        commessaId: z.number().int(),
        contratto: contrattoInputSchema,
        righe: z.array(rigaInputSchema).max(200),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const sedeId = sedeCorrente(ctx);
      commessaInSede(input.commessaId, sedeId);
      await authorizeCoreOperation({
        ctx,
        endpoint: "contratti.salva",
        capability: "contratto.manage",
        resourceType: "contratto",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      try {
        return await salvaContratto({
          sedeId,
          commessaId: input.commessaId,
          contratto: input.contratto,
          righe: input.righe,
          actorUserId: ctx.user?.id ?? null,
        });
      } catch (errore) {
        erroreServizioComeTrpc(errore);
      }
    }),
});
