// Proposte di azione documentali (D7, slice 3 — PRD §19.4).
//
// Il router VALIDA l'input, decide le autorizzazioni e invoca i comandi
// tipizzati del gateway (server/proposte/gateway.ts): la logica di stato,
// idempotenza, scadenza e applicazione vive lì. Doppio requisito per
// approvare e applicare: la capability dedicata alle proposte documentali
// (`documento.approve_proposals`) E la capability dell'operazione finale
// dichiarata dal tipo di azione (oggi `fornitore.manage_ordini`). Il
// motore decide in ogni policyMode: direzione dal ruolo, ruolo `ordini`
// dai default, gli altri con override individuali. Sedi isolate:
// NOT_FOUND, mai dettagli.

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  authorizeCoreOperation,
  effectiveCapabilitySet,
} from "../authz/enforcement";
import {
  annullaProposta,
  applicaProposta,
  approvaProposta,
  definizioneAzione,
  propostaById,
  propostePerOrdine,
  rifiutaProposta,
  verificaFreschezza,
  type PropostaAzione,
} from "../proposte/gateway";
import { generaProposteDaAnalisi } from "../proposte/generazione";
import { analisiPerOrdine } from "../documenti/analisi";
import { getOrdineFornitoreById } from "./fornitori";
import { getInterventiStore } from "./interventi";
import { DEFAULT_SEDE_ID } from "./sedi";
import { assicuraInterruttore } from "../platform/interruttori";
import "../proposte/azioni/ordineDataConsegna";

function ordineInSede(ordineId: number, sedeId: number) {
  const trovato = getOrdineFornitoreById(ordineId);
  if (!trovato) return null;
  if (((trovato.ordine as any).sedeId ?? DEFAULT_SEDE_ID) !== sedeId) {
    return null;
  }
  return trovato;
}

function sedeCorrente(ctx: { sedeId: number | null }): number {
  return ctx.sedeId ?? DEFAULT_SEDE_ID;
}

/** La proposta come la vede la UI: con effetto esatto e etichetta. */
function proiezione(proposta: PropostaAzione) {
  const def = definizioneAzione(proposta.tipo);
  let effetto: string | null = null;
  try {
    effetto = def.descriviEffetto(proposta);
  } catch {
    // Ordine non più leggibile: la proposta resta consultabile senza
    // descrizione dell'effetto (la freschezza la marcherà obsoleta).
  }
  return { ...proposta, etichetta: def.etichetta, effetto };
}

/**
 * Il doppio requisito di approvazione/applicazione: entrambe le
 * authorizeCoreOperation devono passare, ciascuna con il proprio audit.
 */
async function autorizzaDecisione(
  ctx: Parameters<typeof authorizeCoreOperation>[0]["ctx"],
  endpoint: string,
  proposta: PropostaAzione
) {
  await authorizeCoreOperation({
    ctx,
    endpoint,
    capability: "documento.approve_proposals",
    resourceType: "proposta_azione",
    resource: { sedeId: proposta.sedeId },
    legacyAllowed: "capability",
  });
  await authorizeCoreOperation({
    ctx,
    endpoint,
    capability: definizioneAzione(proposta.tipo).capabilityFinale,
    resourceType: "proposta_azione",
    resource: { sedeId: proposta.sedeId },
    legacyAllowed: "capability",
  });
}

function propostaInSede(id: number, sedeId: number): PropostaAzione {
  const trovata = propostaById(sedeId, id);
  if (!trovata) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Proposta non trovata." });
  }
  return trovata;
}

function comeBadRequest(errore: any): never {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: String(errore?.message ?? "Operazione non riuscita."),
  });
}

/**
 * Dopo l'applicazione: la nuova consegna cade dopo una posa pianificata
 * della commessa? Nessun automatismo — è solo l'avviso che il Centro
 * Azioni aprirà/aggiornerà il caso per rivedere la pianificazione.
 */
function avvisoPosa(proposta: PropostaAzione): string | null {
  if (proposta.commessaId == null) return null;
  const posa = getInterventiStore()
    .filter(
      (i: any) =>
        i.sedeId === proposta.sedeId &&
        i.commessaId === proposta.commessaId &&
        i.tipo === "posa" &&
        i.stato === "pianificato" &&
        typeof i.dataPianificata === "string" &&
        i.dataPianificata < proposta.valoreProposto
    )
    .sort((a: any, b: any) =>
      a.dataPianificata.localeCompare(b.dataPianificata)
    )[0];
  if (!posa) return null;
  return `La nuova consegna (${proposta.valoreProposto}) cade dopo la posa pianificata del ${posa.dataPianificata}: il Centro Azioni segnala il conflitto e propone di rivedere la pianificazione. Nessuna data di posa è stata modificata.`;
}

export const proposteRouter = router({
  /** Le proposte di un ordine, con freschezza rivalutata a ogni lettura. */
  perOrdine: protectedProcedure
    .input(z.object({ ordineId: z.number() }))
    .query(async ({ input, ctx }) => {
      assicuraInterruttore("proposte");
      const sedeId = sedeCorrente(ctx);
      if (!ordineInSede(input.ordineId, sedeId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ordine non trovato." });
      }
      const caps = await effectiveCapabilitySet(ctx, [
        "documento.approve_proposals",
        "fornitore.manage_ordini",
      ]);
      if (caps.size === 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Le proposte documentali richiedono una capacita dedicata.",
        });
      }
      const proposte = propostePerOrdine(sedeId, input.ordineId).map(item =>
        proiezione(verificaFreschezza(item))
      );
      const puoDecidere =
        caps.has("documento.approve_proposals") &&
        caps.has("fornitore.manage_ordini");
      return {
        proposte,
        // Parità UI/server: i pulsanti seguono la stessa policy del motore,
        // che resta comunque l'unico confine.
        puoGenerare: caps.has("fornitore.manage_ordini"),
        puoApprovare: puoDecidere,
        puoApplicare: puoDecidere,
      };
    }),

  /**
   * Genera le proposte dall'ultimo run di analisi del documento su questo
   * ordine. Deterministico e idempotente: nessuna applicazione, solo
   * record di proposta con evidenza e snapshot del valore corrente.
   */
  genera: protectedProcedure
    .input(z.object({ ordineId: z.number(), documentoId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      assicuraInterruttore("proposte");
      const sedeId = sedeCorrente(ctx);
      const trovato = ordineInSede(input.ordineId, sedeId);
      if (!trovato) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ordine non trovato." });
      }
      await authorizeCoreOperation({
        ctx,
        endpoint: "proposte.genera",
        capability: "fornitore.manage_ordini",
        resourceType: "proposta_azione",
        resource: { sedeId },
        legacyAllowed: "capability",
      });
      const run = analisiPerOrdine(sedeId, input.ordineId).find(
        item => item.documentoId === input.documentoId
      );
      if (!run) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Nessuna analisi per questo documento su questo ordine: esegui prima l'analisi della conferma.",
        });
      }
      const esito = generaProposteDaAnalisi({
        run,
        ordine: {
          id: trovato.ordine.id,
          dataConsegnaPrevista: trovato.ordine.dataConsegnaPrevista ?? null,
        },
      });
      return {
        motivo: esito.motivo,
        proposte: esito.proposte.map(item => ({
          riusata: item.riusata,
          proposta: proiezione(item.proposta),
        })),
      };
    }),

  /** Approvazione umana: doppia capability, freschezza ricontrollata. */
  approva: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      assicuraInterruttore("proposte");
      const sedeId = sedeCorrente(ctx);
      const proposta = propostaInSede(input.id, sedeId);
      await autorizzaDecisione(ctx, "proposte.approva", proposta);
      try {
        return proiezione(
          approvaProposta({
            sedeId,
            id: input.id,
            utenteId: ctx.user?.id ?? null,
          })
        );
      } catch (errore: any) {
        comeBadRequest(errore);
      }
    }),

  rifiuta: protectedProcedure
    .input(z.object({ id: z.number(), motivo: z.string().max(300).optional() }))
    .mutation(async ({ input, ctx }) => {
      assicuraInterruttore("proposte");
      const sedeId = sedeCorrente(ctx);
      const proposta = propostaInSede(input.id, sedeId);
      await authorizeCoreOperation({
        ctx,
        endpoint: "proposte.rifiuta",
        capability: "documento.approve_proposals",
        resourceType: "proposta_azione",
        resource: { sedeId: proposta.sedeId },
        legacyAllowed: "capability",
      });
      try {
        return proiezione(
          rifiutaProposta({
            sedeId,
            id: input.id,
            utenteId: ctx.user?.id ?? null,
            motivo: input.motivo?.trim() || null,
          })
        );
      } catch (errore: any) {
        comeBadRequest(errore);
      }
    }),

  annulla: protectedProcedure
    .input(z.object({ id: z.number(), motivo: z.string().max(300).optional() }))
    .mutation(async ({ input, ctx }) => {
      assicuraInterruttore("proposte");
      const sedeId = sedeCorrente(ctx);
      const proposta = propostaInSede(input.id, sedeId);
      await authorizeCoreOperation({
        ctx,
        endpoint: "proposte.annulla",
        capability: "documento.approve_proposals",
        resourceType: "proposta_azione",
        resource: { sedeId: proposta.sedeId },
        legacyAllowed: "capability",
      });
      try {
        return proiezione(
          annullaProposta({
            sedeId,
            id: input.id,
            utenteId: ctx.user?.id ?? null,
            motivo: input.motivo?.trim() || null,
          })
        );
      } catch (errore: any) {
        comeBadRequest(errore);
      }
    }),

  /**
   * Applicazione: autorizzazione e sede ricontrollate ADESSO, valore
   * corrente riconfrontato con lo snapshot, esecuzione solo attraverso il
   * comando tipizzato. Posa, appuntamenti e stati della commessa non si
   * muovono: l'eventuale conflitto diventa un caso del Centro Azioni.
   */
  applica: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      assicuraInterruttore("proposte");
      const sedeId = sedeCorrente(ctx);
      const proposta = propostaInSede(input.id, sedeId);
      await autorizzaDecisione(ctx, "proposte.applica", proposta);
      try {
        const { proposta: applicata, riusata } = await applicaProposta({
          sedeId,
          id: input.id,
          utenteId: ctx.user?.id ?? null,
        });
        return {
          proposta: proiezione(applicata),
          riusata,
          avvisoPosa: avvisoPosa(applicata),
        };
      } catch (errore: any) {
        comeBadRequest(errore);
      }
    }),
});
