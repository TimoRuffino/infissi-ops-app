// Computo limiti della commessa: lettura per chi legge il contratto,
// esecuzione per chi lo gestisce. Dietro FLAG_LIMITI; sede isolata.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { procedureConInterruttore, router } from "../_core/trpc";
import { authorizeCoreOperation, effectiveCapabilitySet } from "../authz/enforcement";
import { eseguiComputo, ultimoComputo } from "../computo/servizio";
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

export const computoRouter = router({
  ultimo: procedura
    .input(z.object({ commessaId: z.number().int() }))
    .query(async ({ input, ctx }) => {
      const sedeId = sedeCorrente(ctx);
      commessaInSede(input.commessaId, sedeId);
      await authorizeCoreOperation({
        ctx, endpoint: "computo.ultimo", capability: "contratto.read",
        resourceType: "computo", resource: { sedeId }, legacyAllowed: "capability",
      });
      const caps = await effectiveCapabilitySet(ctx, ["computo.run"]);
      const stato = await ultimoComputo(sedeId, input.commessaId);
      return { ...stato, puoEseguire: caps.has("computo.run") };
    }),

  esegui: procedura
    .input(z.object({ commessaId: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const sedeId = sedeCorrente(ctx);
      commessaInSede(input.commessaId, sedeId);
      await authorizeCoreOperation({
        ctx, endpoint: "computo.esegui", capability: "computo.run",
        resourceType: "computo", resource: { sedeId }, legacyAllowed: "capability",
      });
      try {
        return await eseguiComputo({ sedeId, commessaId: input.commessaId, actorUserId: ctx.user?.id ?? null });
      } catch (errore: any) {
        const messaggio = String(errore?.message ?? "");
        if (messaggio.startsWith("NOT_FOUND: Contratto")) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Prima serve il contratto: inserisci o leggi le righe." });
        }
        if (messaggio.startsWith("NOT_FOUND: ")) {
          throw new TRPCError({ code: "NOT_FOUND", message: messaggio.slice("NOT_FOUND: ".length) });
        }
        if (messaggio.startsWith("TARIFFE_NON_DISPONIBILI")) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Tariffe non disponibili per la data del contratto." });
        }
        throw errore;
      }
    }),
});
