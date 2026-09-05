// Router tRPC della lettura automatica del contratto PDF (piano 3): stato
// della disponibilità, esecuzione, applicazione e scarto della proposta.
// Stesso pattern di contratti.ts e fatture.ts — il router valida con zod,
// autorizza e delega al servizio di dominio
// (server/contratti/estrazione/servizio.ts): nessuna regola di lettura
// vive qui (v. CLAUDE.md, «Agente AI» — vale anche per il codice umano).
//
// Dietro due interruttori, come fatture.ts fa con limiti: FLAG_CONTRATTO_
// ESTRAZIONE via `procedureConInterruttore` (kill switch della feature, in
// middleware, prima di qualunque input) e FLAG_LIMITI via
// `assicuraInterruttore` dentro ogni handler — la lettura automatica non
// ha senso senza il contratto strutturato e il computo dei limiti su cui
// si fonda.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { procedureConInterruttore, router } from "../_core/trpc";
import { assicuraInterruttore } from "../platform/interruttori";
import { authorizeCoreOperation, effectiveCapabilitySet } from "../authz/enforcement";
import { contrattoInputSchema, rigaInputSchema } from "../contratti/servizio";
import {
  applicaEstrazione,
  disponibilitaEstrazione,
  eseguiEstrazioneContratto,
  scartaEstrazione,
  ultimaEstrazione,
} from "../contratti/estrazione/servizio";
import { erroreServizioComeTrpc } from "./contratti";
import { getCommessaById } from "./commesse";
import { DEFAULT_SEDE_ID } from "./sedi";

const procedura = procedureConInterruttore("contrattoEstrazione");

function sedeCorrente(ctx: { sedeId: number | null }): number {
  return ctx.sedeId ?? DEFAULT_SEDE_ID;
}

function commessaInSede(commessaId: number, sedeId: number): void {
  const commessa: any = getCommessaById(commessaId);
  if (!commessa || (commessa.sedeId ?? DEFAULT_SEDE_ID) !== sedeId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Commessa non trovata." });
  }
}

export const estrazioniContrattoRouter = router({
  stato: procedura
    .input(z.object({ commessaId: z.number().int(), documentoId: z.number().int() }))
    .query(async ({ input, ctx }) => {
      assicuraInterruttore("limiti");
      const sedeId = sedeCorrente(ctx);
      commessaInSede(input.commessaId, sedeId);
      await authorizeCoreOperation({
        ctx,
        endpoint: "estrazioniContratto.stato",
        capability: "contratto.read",
        resourceType: "contratto",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      const disponibilita = disponibilitaEstrazione();
      const [ultima, caps] = await Promise.all([
        ultimaEstrazione(sedeId, input.commessaId, input.documentoId),
        effectiveCapabilitySet(ctx, ["contratto.manage"]),
      ]);
      return {
        disponibile: disponibilita.disponibile,
        motivo: disponibilita.motivo,
        modello: disponibilita.modello,
        ultima,
        puoApplicare: caps.has("contratto.manage"),
      };
    }),

  esegui: procedura
    .input(
      z.object({
        commessaId: z.number().int(),
        documentoId: z.number().int(),
        forza: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      assicuraInterruttore("limiti");
      const sedeId = sedeCorrente(ctx);
      commessaInSede(input.commessaId, sedeId);
      await authorizeCoreOperation({
        ctx,
        endpoint: "estrazioniContratto.esegui",
        capability: "contratto.manage",
        resourceType: "contratto",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      try {
        return await eseguiEstrazioneContratto({
          sedeId,
          commessaId: input.commessaId,
          documentoId: input.documentoId,
          actorUserId: ctx.user.id,
          forza: input.forza,
        });
      } catch (errore) {
        erroreServizioComeTrpc(errore);
      }
    }),

  applica: procedura
    .input(
      z.object({
        commessaId: z.number().int(),
        estrazioneId: z.number().int(),
        contratto: contrattoInputSchema,
        righe: z.array(rigaInputSchema).max(200),
      })
    )
    .mutation(async ({ input, ctx }) => {
      assicuraInterruttore("limiti");
      const sedeId = sedeCorrente(ctx);
      commessaInSede(input.commessaId, sedeId);
      await authorizeCoreOperation({
        ctx,
        endpoint: "estrazioniContratto.applica",
        capability: "contratto.manage",
        resourceType: "contratto",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      try {
        return await applicaEstrazione({
          sedeId,
          commessaId: input.commessaId,
          estrazioneId: input.estrazioneId,
          contratto: input.contratto,
          righe: input.righe,
          actorUserId: ctx.user.id,
          actorNome: ctx.user.name,
        });
      } catch (errore) {
        erroreServizioComeTrpc(errore);
      }
    }),

  // Niente commessaId: lo scarto scopa per sede tramite il repository
  // (`perId(sedeId, estrazioneId)`), stessa garanzia — un'estrazione di
  // un'altra sede resta NOT_FOUND senza bisogno di un secondo controllo qui.
  scarta: procedura
    .input(
      z.object({
        estrazioneId: z.number().int(),
        // Stesso limite del motivo delle note di credito e dello scavalco
        // dei limiti in fatture.ts: un motivo è una riga, non una relazione.
        motivo: z.string().trim().max(300).nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      assicuraInterruttore("limiti");
      const sedeId = sedeCorrente(ctx);
      await authorizeCoreOperation({
        ctx,
        endpoint: "estrazioniContratto.scarta",
        capability: "contratto.manage",
        resourceType: "contratto",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      try {
        return await scartaEstrazione({
          sedeId,
          estrazioneId: input.estrazioneId,
          motivo: input.motivo ?? null,
          actorUserId: ctx.user.id,
        });
      } catch (errore) {
        erroreServizioComeTrpc(errore);
      }
    }),
});
