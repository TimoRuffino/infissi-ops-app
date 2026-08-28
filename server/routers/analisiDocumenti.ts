// Analisi delle conferme d'ordine fornitore (D7, slice 1 — PRD §54.6).
//
// Il punto d'ingresso vive nella scheda ordine (area Fornitori, direzione):
// l'operatore SCEGLIE l'ordine e il documento del fascicolo da analizzare —
// il collegamento assistito con candidati è la slice 2 del piano. Il router
// non scrive mai su dati autorevoli: restituisce campi con evidenza e
// differenze da rivedere.

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { requireDirezione } from "../_core/permissions";
import { getCommessaById } from "./commesse";
import { getOrdineFornitoreById } from "./fornitori";
import { getDocumentoRecordById } from "./preventiviContratti";
import {
  analisiPerOrdine,
  eseguiAnalisiConferma,
} from "../documenti/analisi";
import { DEFAULT_SEDE_ID } from "./sedi";

function ordineInSede(ordineId: number, sedeId: number | null) {
  const trovato = getOrdineFornitoreById(ordineId);
  if (!trovato) return null;
  const ordineSede = (trovato.ordine as any).sedeId ?? DEFAULT_SEDE_ID;
  if (sedeId != null && ordineSede !== sedeId) return null;
  return trovato;
}

export const analisiDocumentiRouter = router({
  /** I run già eseguiti su un ordine, dal più recente. */
  perOrdine: protectedProcedure
    .input(z.object({ ordineId: z.number() }))
    .query(({ input, ctx }) => {
      requireDirezione(ctx.user);
      const trovato = ordineInSede(input.ordineId, ctx.sedeId);
      if (!trovato) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ordine non trovato." });
      }
      return analisiPerOrdine(ctx.sedeId ?? DEFAULT_SEDE_ID, input.ordineId);
    }),

  /**
   * Analizza un documento del fascicolo come conferma di QUESTO ordine.
   * Idempotente: stesso file + stesse versioni → stesso run; `forza`
   * rielabora conservando i run precedenti.
   */
  analizzaConferma: protectedProcedure
    .input(
      z.object({
        ordineId: z.number(),
        documentoId: z.number(),
        forza: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      requireDirezione(ctx.user);
      const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;

      const trovato = ordineInSede(input.ordineId, ctx.sedeId);
      if (!trovato) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ordine non trovato." });
      }
      const { ordine, fornitoreNome } = trovato;

      const documento = getDocumentoRecordById(input.documentoId);
      const commessaDoc = documento
        ? getCommessaById(documento.commessaId)
        : null;
      if (
        !documento ||
        !commessaDoc ||
        (commessaDoc as any).sedeId !== sedeId
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Documento non trovato.",
        });
      }
      // Coerenza del fascicolo: in questa slice si analizzano documenti
      // della stessa commessa dell'ordine. Un documento di un'altra
      // commessa è quasi certamente un errore di selezione.
      if (documento.commessaId !== ordine.commessaId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Il documento appartiene a un'altra commessa: seleziona un file dal fascicolo della commessa dell'ordine.",
        });
      }

      const commessaOrdine = getCommessaById(ordine.commessaId);
      try {
        return await eseguiAnalisiConferma({
          sedeId,
          documento: {
            id: documento.id,
            commessaId: documento.commessaId,
            nome: documento.nome,
            mimeType: documento.mimeType,
            storageKey: documento.storageKey ?? null,
            dataBase64: documento.dataBase64 ?? null,
          },
          ordine: {
            id: ordine.id,
            codiceOrdine: ordine.codiceOrdine,
            commessaCodice: (commessaOrdine as any)?.codice ?? null,
            dataConsegnaPrevista: ordine.dataConsegnaPrevista ?? null,
            importoTotale: ordine.importoTotale ?? null,
            righe: ordine.righe,
            fornitoreNome,
          },
          createdBy: ctx.user?.id ?? null,
          forza: input.forza,
        });
      } catch (errore: any) {
        // Byte irrecuperabili (storage assente, record inconsistente): un
        // esito esplicito, non un 500 anonimo.
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: String(
            errore?.message ?? "Documento non analizzabile in questo momento."
          ),
        });
      }
    }),
});
