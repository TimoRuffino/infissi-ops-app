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
import {
  chiamataTool,
  creaProviderFinto,
  rispostaTesto,
} from "../tars/openai/fake";
import { strumentiPerContesto } from "../tars/profili";
import type { TarsProvider } from "../tars/provider";
import { DEFAULT_SEDE_ID } from "./sedi";

const procedura = procedureConInterruttore("tars");

function providerCorrente(): TarsProvider {
  if (process.env.TARS_PROVIDER?.trim().toLowerCase() === "openai") {
    return creaProviderReale();
  }
  // Fake di sviluppo: deterministico e onesto sul proprio stato. Il
  // copione dimostrativo riconosce «Ricordami <quando> di <cosa>» e usa lo
  // strumento VERO (T2): la pagina /tars resta provabile senza modello e
  // l'attrito dichiarato (zero conferme, una sola precisazione) si vede.
  return creaProviderFinto(richiesta => {
    const ultimoTool = [...richiesta.input]
      .reverse()
      .find(m => m.ruolo === "tool");
    if (ultimoTool) {
      if (ultimoTool.contenuto.startsWith("ERRORE")) {
        return rispostaTesto(
          `Non posso eseguirlo: ${ultimoTool.contenuto} (provider dimostrativo).`
        );
      }
      try {
        const esito = JSON.parse(ultimoTool.contenuto);
        if (esito?.tipo === "azione") {
          if (esito.stato === "non_eseguito") {
            return rispostaTesto(
              `Non ho creato il promemoria: ${esito.motivo} (provider dimostrativo).`
            );
          }
          return rispostaTesto(
            `Fatto: promemoria «${esito.dati?.testo}» per ${esito.dati?.remindAtLocale}. Puoi annullarlo qui sotto. (provider dimostrativo)`
          );
        }
      } catch {
        // non-JSON: risposta di servizio qui sotto
      }
      return rispostaTesto("Ho letto i dati richiesti (provider dimostrativo).");
    }

    const ultimoUtente =
      [...richiesta.input].reverse().find(m => m.ruolo === "user")?.contenuto ??
      "";
    const conQuando = /^ricordami\s+(.+?)\s+di\s+(.+)$/i.exec(
      ultimoUtente.trim()
    );
    if (conQuando) {
      return chiamataTool("crea_promemoria", {
        testo: conQuando[2].trim(),
        quando: conQuando[1].trim(),
      });
    }
    if (/^ricordami\b/i.test(ultimoUtente.trim())) {
      return rispostaTesto(
        "Dimmi anche quando: ad esempio «Ricordami domani alle 9 di chiamare il fornitore». (provider dimostrativo)"
      );
    }
    return rispostaTesto(
      "Il modello reale non è configurato su questa installazione (TARS_PROVIDER≠openai): questa è una risposta di servizio del provider dimostrativo. Gli strumenti e il resto del CRM funzionano normalmente."
    );
  });
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
