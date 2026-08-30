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
import { assicuraTars, statoInterruttori } from "../platform/interruttori";
import { costruisciBriefing } from "../tars/briefing";
import { fascicoloCommessa } from "../tars/fascicoli";
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

// Rate limit per principal su `invia` (spec §14, Cost/DoS): finestra
// scorrevole in-process (replica singola: vincolo documentato §14). I
// limiti si leggono a ogni chiamata: configurabili senza riavvio nei test.
const inviiRecenti = new Map<string, number[]>();

/** Solo per i test. */
export function azzeraRateLimitTarsPerTest(): void {
  inviiRecenti.clear();
}

function assicuraRateLimitInvio(sedeId: number, utenteId: number): void {
  const limite = Number(process.env.TARS_RATE_LIMIT_INVII ?? 20);
  const finestraMs = Number(
    process.env.TARS_RATE_LIMIT_FINESTRA_MS ?? 300_000
  );
  const chiave = `${sedeId}:${utenteId}`;
  const adesso = Date.now();
  const recenti = (inviiRecenti.get(chiave) ?? []).filter(
    t => adesso - t < finestraMs
  );
  if (recenti.length >= limite) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message:
        "Troppi messaggi a Tars in poco tempo: aspetta qualche minuto e riprova.",
    });
  }
  recenti.push(adesso);
  inviiRecenti.set(chiave, recenti);
}

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
          if (
            esito.stato === "non_eseguito" ||
            esito.stato === "non_necessaria"
          ) {
            return rispostaTesto(
              `Non eseguito: ${esito.motivo} (provider dimostrativo).`
            );
          }
          if (esito.conferma) {
            return rispostaTesto(
              `Proposta pronta: ${esito.conferma.effetto ?? esito.conferma.etichetta}. Decidi tu con il bottone qui sotto. (provider dimostrativo)`
            );
          }
          if (esito.dati?.remindAtLocale) {
            return rispostaTesto(
              `Fatto: promemoria «${esito.dati?.testo}» per ${esito.dati?.remindAtLocale}. Puoi annullarlo qui sotto. (provider dimostrativo)`
            );
          }
          return rispostaTesto(
            `Fatto (${esito.stato}). (provider dimostrativo)`
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
    // Split greedy sull'ULTIMO « di »: «domani alle 9 di sera di chiamare
    // X» → quando «domani alle 9 di sera», testo «chiamare X».
    const conQuando = /^ricordami\s+(.+)\s+di\s+(.+)$/i.exec(
      ultimoUtente.trim()
    );
    if (conQuando) {
      return chiamataTool("crea_promemoria", {
        testo: conQuando[2].trim(),
        quando: conQuando[1].trim(),
      });
    }
    const proponi = /^proponi la consegna dell'ordine\s+(\d+)/i.exec(
      ultimoUtente.trim()
    );
    if (proponi) {
      return chiamataTool("proponi_data_consegna", {
        ordineId: Number(proponi[1]),
      });
    }
    const prendi = /^prendi in carico il caso\s+(\d+)/i.exec(
      ultimoUtente.trim()
    );
    if (prendi) {
      return chiamataTool("prendi_in_carico_caso", {
        casoId: Number(prendi[1]),
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

  /**
   * Briefing deterministico (T4): promemoria di oggi, casi mine,
   * segnalazioni shadow. Zero token; la sezione segnalazioni esiste
   * solo con FLAG_TARS_PROACTIVE.
   */
  briefing: procedura.query(async ({ ctx }) => {
    try {
      assicuraTars("tarsReadTools");
      const contesto = await costruisciContesto(ctx);
      return await costruisciBriefing(contesto);
    } catch (errore) {
      if (errore instanceof TRPCError) throw errore;
      comeErrore(errore);
    }
  }),

  /**
   * Fascicolo C3 per il pannello contestuale (T3): nessun run del
   * modello, nessun token — solo il derivato deterministico in cache.
   */
  fascicolo: procedura
    .input(z.object({ commessaId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      try {
        assicuraTars("tarsReadTools");
        const contesto = await costruisciContesto(ctx);
        if (!contesto.capability.has("commessa.read")) {
          throw new Error("NOT_FOUND: commessa non trovata.");
        }
        const fascicolo = await fascicoloCommessa({
          sedeId: contesto.sedeId,
          commessaId: input.commessaId,
        });
        if (!fascicolo) throw new Error("NOT_FOUND: commessa non trovata.");
        return fascicolo;
      } catch (errore) {
        if (errore instanceof TRPCError) throw errore;
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
        assicuraRateLimitInvio(contesto.sedeId, contesto.utenteId);
        return await eseguiRun({
          contesto,
          provider: providerCorrente(),
          messaggio: input.messaggio,
          conversazioneId: input.conversazioneId ?? null,
        });
      } catch (errore) {
        if (errore instanceof TRPCError) throw errore;
        comeErrore(errore);
      }
    }),
});
