// Router di Tars (T1) — sottile per contratto: valida, costruisce il
// contesto autorizzato, sceglie il provider e invoca l'orchestratore.
// Ogni procedura nasce dietro FLAG_TARS (base procedure fail-closed).
//
// Provider: il DEFAULT è il fake deterministico — il provider OpenAI
// reale si attiva SOLO impostando TARS_PROVIDER=openai (oltre a
// FLAG_TARS e alla chiave): la chiave residua di produzione non può
// essere consumata per sbaglio. È il gate «uso reale» della direzione.

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { procedureConInterruttore, router } from "../_core/trpc";
import { statoInterruttori } from "../platform/interruttori";
import {
  listaConversazioni,
  statisticheRun,
  turniDiConversazione,
  conversazioneDiUtente,
} from "../tars/archivio";
import { costruisciContesto } from "../tars/contesto";
import { configurazioneRunDefault, eseguiRun } from "../tars/orchestratore";
import { creaProviderReale } from "../tars/openai/adapter";
import { creaProviderFinto, rispostaTesto } from "../tars/openai/fake";
import { strumentiPerContesto } from "../tars/profili";
import type { TarsProvider } from "../tars/provider";
import { DEFAULT_SEDE_ID } from "./sedi";

const procedura = procedureConInterruttore("tars");

function providerCorrente(): TarsProvider {
  if (process.env.TARS_PROVIDER?.trim().toLowerCase() === "openai") {
    return creaProviderReale();
  }
  // Fake di sviluppo: onesto sul proprio stato, deterministico.
  return creaProviderFinto(() =>
    rispostaTesto(
      "Il modello reale non è configurato su questa installazione (TARS_PROVIDER≠openai): questa è una risposta di servizio del provider dimostrativo. Gli strumenti e il resto del CRM funzionano normalmente."
    )
  );
}

function comeErrore(errore: any): never {
  const messaggio = String(errore?.message ?? "");
  if (messaggio.startsWith("NOT_FOUND")) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Non trovato." });
  }
  if (messaggio.startsWith("UNAUTHORIZED")) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sessione non valida." });
  }
  console.error("[tars] errore router:", errore);
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Tars non è riuscito a completare la richiesta.",
  });
}

export const tarsRouter = router({
  /** Stato per la pagina /tars: flag, provider, profilo, run aggregati. */
  stato: procedura.query(async ({ ctx }) => {
    try {
      const contesto = await costruisciContesto(ctx);
      const strumenti = strumentiPerContesto(contesto);
      return {
        interruttori: statoInterruttori(),
        provider:
          process.env.TARS_PROVIDER?.trim().toLowerCase() === "openai"
            ? "openai"
            : "finto",
        modello: configurazioneRunDefault().modello,
        strumentiDisponibili: strumenti.map(s => ({
          nome: s.nome,
          categoria: s.categoria,
          descrizione: s.descrizione,
        })),
        run: await statisticheRun(ctx.sedeId ?? DEFAULT_SEDE_ID),
      };
    } catch (errore) {
      comeErrore(errore);
    }
  }),

  conversazioni: procedura.query(async ({ ctx }) => {
    try {
      const contesto = await costruisciContesto(ctx);
      return listaConversazioni(contesto.sedeId, contesto.utenteId);
    } catch (errore) {
      comeErrore(errore);
    }
  }),

  turni: procedura
    .input(z.object({ conversazioneId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      try {
        const contesto = await costruisciContesto(ctx);
        const conversazione = await conversazioneDiUtente(
          input.conversazioneId,
          contesto.sedeId,
          contesto.utenteId
        );
        if (!conversazione) {
          throw new Error("NOT_FOUND: conversazione non trovata.");
        }
        return turniDiConversazione(input.conversazioneId, contesto.sedeId);
      } catch (errore) {
        comeErrore(errore);
      }
    }),

  invia: procedura
    .input(
      z.object({
        messaggio: z.string().min(1).max(4000),
        conversazioneId: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const contesto = await costruisciContesto(ctx);
        return await eseguiRun({
          contesto,
          provider: providerCorrente(),
          messaggio: input.messaggio,
          conversazioneId: input.conversazioneId ?? null,
        });
      } catch (errore) {
        comeErrore(errore);
      }
    }),
});
