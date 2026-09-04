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
import { tariffeAttive } from "../computo/tariffe";
import { getCommessaById } from "./commesse";
import { DEFAULT_SEDE_ID } from "./sedi";

const procedura = procedureConInterruttore("limiti");

/**
 * Catalogo DEI per la tab Contratto: solo i campi che servono a scegliere e
 * a etichettare una voce. Il prezzo viaggia perché la UI lo mostra accanto
 * al nome, ma resta il motore a calcolare — il client non prezza mai nulla.
 */
function catalogoPerUi(alla: Date = new Date()) {
  const t = tariffeAttive(alla);
  return {
    prodotti: t.prodotti.map(p => ({
      codice: p.codice,
      gruppo: p.gruppo,
      famiglia: p.famiglia,
      nome: p.nome,
      prezzo: p.prezzo,
      unita: p.unita,
      zone: p.zone ?? null,
      portafinestra: p.portafinestra ?? false,
      nAnte: p.nAnte ?? null,
    })),
    accessori: t.accessori.map(a => ({
      codice: a.codice,
      gruppo: a.gruppo,
      famiglie: a.famiglie,
      nome: a.nome,
      regola: a.regola,
      valore: a.valore,
      soloPortafinestra: a.soloPortafinestra,
    })),
    controtelai: t.controtelai.map(c => ({
      codice: c.codice,
      famiglia: c.famiglia,
      variante: c.variante,
      unita: c.unita,
    })),
    opere: t.opere.map(o => ({
      codice: o.codice,
      gruppo: o.gruppo,
      descrizione: o.descrizione,
      inclusaDefault: o.inclusaDefault,
    })),
  };
}

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
  // Fatturazione dal contratto (piano 2, Task 13): prefissi di
  // server/fatture/servizio.ts, emissione.ts e repository.ts.
  if (messaggio.startsWith("PRECONDIZIONE: ")) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: messaggio.slice("PRECONDIZIONE: ".length) });
  }
  if (messaggio.startsWith("FATTURA_IMMUTABILE: ")) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: messaggio.slice("FATTURA_IMMUTABILE: ".length) });
  }
  if (messaggio.startsWith("CONFLITTO: ")) {
    throw new TRPCError({ code: "CONFLICT", message: messaggio.slice("CONFLITTO: ".length) });
  }
  if (messaggio.startsWith("EMISSIONE: ")) {
    throw new TRPCError({ code: "BAD_GATEWAY", message: messaggio.slice("EMISSIONE: ".length) });
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

  /**
   * Il catalogo DEI sta su una query sua: non dipende dalla commessa, cambia
   * solo col listino, e la card Pagamenti legge `get` a ogni commessa aperta
   * per sapere se il pattuito viene dal contratto. Farglisi trascinare dietro
   * centinaia di voci a ogni apertura era un peso senza motivo.
   */
  catalogo: procedura.query(async ({ ctx }) => {
    const sedeId = sedeCorrente(ctx);
    await authorizeCoreOperation({
      ctx,
      endpoint: "contratti.catalogo",
      capability: "contratto.read",
      resourceType: "contratto",
      resource: { sedeId },
      legacyAllowed: "capability",
    });
    return catalogoPerUi();
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
