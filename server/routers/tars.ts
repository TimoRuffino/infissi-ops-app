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
  impostaConversazioneArchiviata,
  eliminaConversazione,
  impostaConversazioneFissata,
  rinominaConversazione,
} from "../tars/archivio";
import { costruisciContesto } from "../tars/contesto";
import {
  configurazioneRunDefault,
  eseguiRun,
  type RispostaRun,
} from "../tars/orchestratore";
import {
  creaProviderPerRun,
  statoProvider,
} from "../tars/costi/providerGovernato";
import { ledgerCorrente } from "../tars/costi/ledger";
import { nanoInUsd } from "../tars/costi/tariffe";
import { configurazioneBudget } from "../tars/costi/governor";
import {
  chiamataTool,
  rispostaTesto,
  type PassoCopione,
} from "../tars/openai/fake";
import { strumentiPerContesto } from "../tars/profili";
import { repositoryOsservazioniCorrente } from "../tars/proattivita/repository";
import { osservatoreEspone } from "../tars/proattivita/worker";
import { calcolaPatternAzienda } from "../tars/proattivita/patterns";
import {
  accettaMiglioramento,
  derivaMiglioramenti,
  registraFeedbackMiglioramento,
} from "../tars/proattivita/improvements";
import { AZIONI_DICHIARATE_INDISPONIBILI } from "../tars/azioni/registry";
import {
  applicaContestoConversazioneAlRun,
  caricaContestoConversazione,
} from "../tars/conversazione/context";
import type { TarsProvider } from "../tars/provider";
import { getLiveComunicazione } from "../comunicazioni/comunicazioni";
import { modelloSmistamento } from "../tars/smistamento/analisi";
import { applicaPropostaApprovata } from "../tars/smistamento/applica";
import { repositorySmistamentoCorrente } from "../tars/smistamento/repository";
import { linkComunicazione } from "../tars/smistamento/segnali";
import {
  dipendenzeSmistamentoReali,
  smistaComunicazione,
  smistamentoAttivo,
} from "../tars/smistamento/worker";
import { DEFAULT_SEDE_ID } from "./sedi";
import {
  ledgerEsecuzioniAutorevoleDisponibile,
  ledgerEsecuzioniCorrente,
} from "../tars/azioni/executions";
import { getProposteStore } from "../proposte/gateway";
import { repositoryAnalisiCorrente } from "../tars/analisi/repository";
import { generaAnalisiAzienda } from "../tars/analisi/worker";
import { giornoLocale as giornoLocaleAnalisi } from "../tars/analisi/fotografia";
import { proiezioneProposta } from "./proposte";
import { getUtentiStore } from "./utenti";

const procedura = procedureConInterruttore("tars");

// Rate limit per principal su `invia` (spec §14, Cost/DoS): finestra
// scorrevole in-process (replica singola: vincolo documentato §14). I
// limiti si leggono a ogni chiamata: configurabili senza riavvio nei test.
const inviiRecenti = new Map<string, number[]>();

// Anti doppio-click (revisione): due invii IDENTICI mentre il primo è
// ANCORA IN VOLO sono un doppio click, non due domande — senza questa
// guardia sarebbero due run e due addebiti reali (la cache C0 non li
// vede: il primo turno è già stato salvato e cambia la cronologia).
//
// La voce si cancella appena il run finisce, in qualunque modo: un
// utente che RIPETE volutamente la stessa domanda dopo la risposta deve
// ottenere un run nuovo e un turno nuovo, non il replay silenzioso di
// quello vecchio (seconda revisione).
const inviiInCorso = new Map<string, Promise<RispostaRun>>();

function chiaveInvio(input: {
  sedeId: number;
  utenteId: number;
  conversazioneId: number | null;
  messaggio: string;
}): string {
  return [
    input.sedeId,
    input.utenteId,
    input.conversazioneId ?? "nuova",
    input.messaggio.trim().toLowerCase().replace(/\s+/g, " "),
  ].join("|");
}

/** Solo per i test. */
export function azzeraRateLimitTarsPerTest(): void {
  inviiRecenti.clear();
  inviiInCorso.clear();
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

/**
 * Il provider del run passa SEMPRE dalla fabbrica unica
 * (`costi/providerGovernato`): il reale nasce solo governato dal budget,
 * altrimenti si usa il fake dimostrativo qui sotto.
 */
function providerCorrente(contesto: {
  sedeId: number;
  utenteId: number;
}): TarsProvider {
  return creaProviderPerRun({
    modello: configurazioneRunDefault().modello,
    sedeId: contesto.sedeId,
    utenteId: contesto.utenteId,
    copioneFinto: copioneDimostrativo,
  });
}

// Fake di sviluppo: deterministico e onesto sul proprio stato. Il
// copione dimostrativo riconosce «Ricordami <quando> di <cosa>» e usa lo
// strumento VERO (T2): la pagina /tars resta provabile senza modello e
// l'attrito dichiarato (zero conferme, una sola precisazione) si vede.
const copioneDimostrativo: PassoCopione = (() => {
  const copione: PassoCopione = richiesta => {
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
  };
  return copione;
})();

function comeErrore(errore: any): never {
  const messaggio = String(errore?.message ?? "");
  if (messaggio.startsWith("NOT_FOUND")) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Non trovato." });
  }
  if (messaggio.startsWith("UNAUTHORIZED")) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sessione non valida." });
  }
  if (messaggio.startsWith("CONVERSAZIONE_ARCHIVIATA")) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Ripristina la conversazione prima di modificarla o inviare un messaggio.",
    });
  }
  console.error("[tars] errore router:", errore);
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Tars non è riuscito a completare la richiesta.",
  });
}

export const tarsRouter = router({
  /** Stato per la pagina /tars: flag, provider, profilo, run aggregati. */
  stato: procedura
    .input(
      z.object({ conversazioneId: z.number().int().positive().optional() })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      try {
        let contesto = await costruisciContesto(ctx);
        if (input?.conversazioneId != null) {
          const persistito = await caricaContestoConversazione({
            conversazioneId: input.conversazioneId,
            sedeId: contesto.sedeId,
            utenteId: contesto.utenteId,
          });
          if (!persistito) {
            throw new Error("NOT_FOUND: conversazione non trovata.");
          }
          contesto = applicaContestoConversazioneAlRun(contesto, persistito);
        }
        const strumenti = strumentiPerContesto(contesto);
        const provider = statoProvider(configurazioneRunDefault().modello);
        return {
          // Diagnosi onesta MA riservata: budget e motivi infrastrutturali
          // sono dati di costo (spec §27.48), quindi solo per la direzione;
          // agli altri resta il tipo di provider, che è già nella UI.
          providerDettaglio: contesto.direzione
            ? provider
            : {
                tipo: provider.tipo,
                modello: provider.modello,
                budget: null,
                motivoIndisponibilita: null,
              },
          interruttori: statoInterruttori(),
          // Il provider EFFETTIVO del prossimo run (non quello richiesto).
          provider: provider.tipo,
          modello: configurazioneRunDefault().modello,
          strumentiDisponibili: strumenti.map(s => ({
            nome: s.nome,
            categoria: s.categoria,
            descrizione: s.descrizione,
          })),
          // Onestà del catalogo: ciò che manca è dichiarato col blocco reale,
          // mai simulato (T5 — frontiera unica R2/R3).
          azioniIndisponibili: AZIONI_DICHIARATE_INDISPONIBILI,
          contestoAttivo: contesto.entitaAttiva
            ? {
                superficie: contesto.superficie ?? null,
                entita: contesto.entitaAttiva,
                fingerprint:
                  contesto.contestoConversazioneFingerprint ?? null,
              }
            : null,
          run: await (async () => {
            const statistiche = await statisticheRun(
              ctx.sedeId ?? DEFAULT_SEDE_ID
            );
            // Il motivo dell'ultimo run degradato è diagnostica riservata
            // alla direzione (stessa policy di motivoIndisponibilita).
            return contesto.direzione
              ? statistiche
              : { ...statistiche, ultimoDegradato: null };
          })(),
        };
      } catch (errore) {
        comeErrore(errore);
      }
    }),

  conversazioni: procedura
    .input(
      z.object({
        archiviate: z.boolean().optional(),
        ricerca: z.string().max(100).optional(),
        limite: z.number().int().min(1).max(100).optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
    try {
      const contesto = await costruisciContesto(ctx);
      return listaConversazioni(contesto.sedeId, contesto.utenteId, input);
    } catch (errore) {
      comeErrore(errore);
    }
  }),

  rinominaConversazione: procedura
    .input(z.object({
      conversazioneId: z.number().int().positive(),
      titolo: z.string().trim().min(1).max(80),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const contesto = await costruisciContesto(ctx);
        const esito = await rinominaConversazione({
          ...input,
          sedeId: contesto.sedeId,
          utenteId: contesto.utenteId,
        });
        if (esito.stato === "non_trovato") {
          throw new Error("NOT_FOUND: conversazione non trovata.");
        }
        if (esito.stato === "archiviata") {
          throw new Error("CONVERSAZIONE_ARCHIVIATA");
        }
        return esito.conversazione;
      } catch (errore) {
        comeErrore(errore);
      }
    }),

  fissaConversazione: procedura
    .input(z.object({
      conversazioneId: z.number().int().positive(),
      fissata: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const contesto = await costruisciContesto(ctx);
        const esito = await impostaConversazioneFissata({
          ...input,
          sedeId: contesto.sedeId,
          utenteId: contesto.utenteId,
        });
        if (esito.stato === "non_trovato") {
          throw new Error("NOT_FOUND: conversazione non trovata.");
        }
        if (esito.stato === "archiviata") {
          throw new Error("CONVERSAZIONE_ARCHIVIATA");
        }
        return esito.conversazione;
      } catch (errore) {
        comeErrore(errore);
      }
    }),

  archiviaConversazione: procedura
    .input(z.object({
      conversazioneId: z.number().int().positive(),
      archiviata: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const contesto = await costruisciContesto(ctx);
        const esito = await impostaConversazioneArchiviata({
          ...input,
          sedeId: contesto.sedeId,
          utenteId: contesto.utenteId,
        });
        if (esito.stato === "non_trovato") {
          throw new Error("NOT_FOUND: conversazione non trovata.");
        }
        if (esito.stato === "archiviata") {
          throw new Error("CONVERSAZIONE_ARCHIVIATA");
        }
        return esito.conversazione;
      } catch (errore) {
        comeErrore(errore);
      }
    }),

  eliminaConversazione: procedura
    .input(z.object({ conversazioneId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const contesto = await costruisciContesto(ctx);
        // Eliminazione definitiva del contenuto della chat; l'audit
        // operativo (ledger R1, tars_run, costi) resta per costruzione.
        const esito = await eliminaConversazione({
          conversazioneId: input.conversazioneId,
          sedeId: contesto.sedeId,
          utenteId: contesto.utenteId,
        });
        if (esito.stato === "non_trovato") {
          throw new Error("NOT_FOUND: conversazione non trovata.");
        }
        return { eliminata: true, conversazioneId: input.conversazioneId };
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
   * Lettura amministrativa dei costi (spec §27.48): direzione-only,
   * solo numeri — nessun contenuto, nessun prompt, nessun documento.
   */
  costi: procedura.query(async ({ ctx }) => {
    try {
      const contesto = await costruisciContesto(ctx);
      if (!contesto.direzione) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Riservato alla direzione.",
        });
      }
      const config = configurazioneBudget();
      const riepilogo = await ledgerCorrente()
        .riepilogo(new Date())
        .catch(() => null);
      const provider = statoProvider(configurazioneRunDefault().modello);
      return {
        provider,
        budgetConfigurato: config.ok
          ? {
              perRunUsd: config.configurazione.perRunUsd,
              giornalieroUsd: config.configurazione.giornalieroUsd,
              mensileUsd: config.configurazione.mensileUsd,
            }
          : null,
        motivoBudgetNonValido: config.ok ? null : config.motivo,
        riepilogo: riepilogo
          ? {
              // I totali sono GLOBALI (tutte le sedi) perché il tetto di
              // spesa è globale per definizione: dichiararlo evita di
              // leggerli come «spesa della mia sede» (spec §27.48).
              ambito: "globale" as const,
              giorno: riepilogo.giorno,
              mese: riepilogo.mese,
              spesaGiornoUsd: nanoInUsd(riepilogo.spesaGiornoNano),
              spesaMeseUsd: nanoInUsd(riepilogo.spesaMeseNano),
              // `null` = nessun tetto per la finestra: il residuo non
              // esiste, la spesa reale resta il dato da guardare.
              residuoGiornoUsd:
                config.ok && config.configurazione.limiti.giornoNano != null
                  ? nanoInUsd(
                      Math.max(
                        0,
                        config.configurazione.limiti.giornoNano -
                          riepilogo.spesaGiornoNano
                      )
                    )
                  : null,
              residuoMeseUsd:
                config.ok && config.configurazione.limiti.meseNano != null
                  ? nanoInUsd(
                      Math.max(
                        0,
                        config.configurazione.limiti.meseNano -
                          riepilogo.spesaMeseNano
                      )
                    )
                  : null,
              chiamateGiorno: riepilogo.chiamateGiorno,
              runGiorno: riepilogo.runGiorno,
              costoMedioRunUsd: nanoInUsd(riepilogo.costoMedioRunNano),
              costoMassimoRunUsd: nanoInUsd(riepilogo.costoMassimoRunNano),
              tokenGiorno: riepilogo.tokenGiorno,
              perStato: riepilogo.perStato,
            }
          : null,
        run: await statisticheRun(contesto.sedeId),
      };
    } catch (errore) {
      if (errore instanceof TRPCError) throw errore;
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
   * Panorama Azienda (T7): pattern aggregati deterministici, direzione-only.
   * Nessun modello, nessun token; le correlazioni sono dichiarate tali.
   */
  panorama: procedura
    .input(
      z
        .object({
          finestraGiorni: z.number().int().min(7).max(90).optional(),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      try {
        assicuraTars("tarsProactive");
        assicuraTars("tarsPatterns");
        const contesto = await costruisciContesto(ctx);
        if (!contesto.direzione || !contesto.capability.has("commessa.read")) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Il Panorama Azienda è riservato alla direzione.",
          });
        }
        return await calcolaPatternAzienda({
          sedeId: contesto.sedeId,
          now: new Date(),
          finestraGiorni: input?.finestraGiorni,
        });
      } catch (errore) {
        if (errore instanceof TRPCError) throw errore;
        comeErrore(errore);
      }
    }),

  /**
   * Proposte di miglioramento (T8): derivate dai pattern, inerti,
   * direzione-only. Feedback e accettazione muovono solo cooldown,
   * ranking e la decisione registrata — mai policy o codice.
   */
  miglioramenti: procedura
    .input(
      z
        .object({
          finestraGiorni: z.number().int().min(7).max(90).optional(),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      try {
        assicuraTars("tarsProactive");
        assicuraTars("tarsImprovements");
        const contesto = await costruisciContesto(ctx);
        if (!contesto.direzione || !contesto.capability.has("commessa.read")) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Le proposte di miglioramento sono riservate alla direzione.",
          });
        }
        return await derivaMiglioramenti({
          sedeId: contesto.sedeId,
          now: new Date(),
          finestraGiorni: input?.finestraGiorni,
        });
      } catch (errore) {
        if (errore instanceof TRPCError) throw errore;
        comeErrore(errore);
      }
    }),

  miglioramentoFeedback: procedura
    .input(
      z.object({
        id: z.number().int().positive(),
        feedback: z.enum(["utile", "non_utile", "gia_risolto", "troppo_rumore"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        assicuraTars("tarsProactive");
        assicuraTars("tarsImprovements");
        const contesto = await costruisciContesto(ctx);
        if (!contesto.direzione) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Operazione riservata alla direzione." });
        }
        return await registraFeedbackMiglioramento({
          sedeId: contesto.sedeId,
          id: input.id,
          feedback: input.feedback,
          utenteId: contesto.utenteId,
          now: new Date(),
        });
      } catch (errore) {
        if (errore instanceof TRPCError) throw errore;
        comeErrore(errore);
      }
    }),

  miglioramentoAccetta: procedura
    .input(
      z.object({
        id: z.number().int().positive(),
        nota: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        assicuraTars("tarsProactive");
        assicuraTars("tarsImprovements");
        const contesto = await costruisciContesto(ctx);
        if (!contesto.direzione) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Operazione riservata alla direzione." });
        }
        return await accettaMiglioramento({
          sedeId: contesto.sedeId,
          id: input.id,
          utenteId: contesto.utenteId,
          nota: input.nota ?? null,
          now: new Date(),
        });
      } catch (errore) {
        if (errore instanceof TRPCError) throw errore;
        comeErrore(errore);
      }
    }),

  // ── Smistamento comunicazioni (02/09/2026) ────────────────────────────

  /** Stato del motore: direzione-only, niente contenuti. */
  smistamentoStato: procedura.query(async ({ ctx }) => {
    try {
      assicuraTars("tarsSmistamento");
      const contesto = await costruisciContesto(ctx);
      if (!contesto.direzione) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Riservato alla direzione." });
      }
      const statistiche = await repositorySmistamentoCorrente().statistiche(contesto.sedeId);
      return {
        attivo: smistamentoAttivo(),
        modello: modelloSmistamento(),
        ...statistiche,
      };
    } catch (errore) {
      if (errore instanceof TRPCError) throw errore;
      comeErrore(errore);
    }
  }),

  /** L'esito dello smistamento di UNA comunicazione (per il lettore messaggi). */
  smistamentoPerComunicazione: procedura
    .input(z.object({ comunicazioneId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      try {
        assicuraTars("tarsSmistamento");
        const contesto = await costruisciContesto(ctx);
        if (!contesto.capability.has("commessa.read")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Capability mancante." });
        }
        const comunicazione = await getLiveComunicazione(input.comunicazioneId, contesto.sedeId);
        if (!comunicazione) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Comunicazione non trovata." });
        }
        const record = await repositorySmistamentoCorrente().perComunicazione(
          contesto.sedeId,
          input.comunicazioneId
        );
        return record
          ? {
              stato: record.stato,
              propostaStato: record.propostaStato,
              aggiornataAt: record.aggiornataAt,
              ultimoErrore: record.ultimoErrore,
              esito: record.esito,
            }
          : null;
      } catch (errore) {
        if (errore instanceof TRPCError) throw errore;
        comeErrore(errore);
      }
    }),

  /** Proposte aperte della sede, con il minimo della comunicazione per decidere. */
  smistamentoProposte: procedura.query(async ({ ctx }) => {
    try {
      assicuraTars("tarsSmistamento");
      const contesto = await costruisciContesto(ctx);
      if (!contesto.capability.has("commessa.read")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Capability mancante." });
      }
      const records = await repositorySmistamentoCorrente().proposteAperte(contesto.sedeId, 50);
      const voci = [];
      for (const record of records) {
        const esito = record.esito;
        if (!esito || esito.collegamento.esito !== "proposto") continue;
        const c = await getLiveComunicazione(record.comunicazioneId, contesto.sedeId);
        if (!c) continue;
        voci.push({
          comunicazioneId: c.id,
          canale: c.canale,
          mittente: c.mittenteNome?.trim() || c.mittente,
          oggetto: c.oggetto,
          ricevutaIl: c.receivedAt,
          riepilogo: esito.riepilogo,
          urgenza: esito.urgenza,
          categoria: esito.categoria,
          collegamento: esito.collegamento,
          candidati: esito.candidati,
          allegatiDaArchiviare: esito.allegati.filter(a => a.archiviare).map(a => a.nome),
          link: linkComunicazione(c),
        });
      }
      return voci;
    } catch (errore) {
      if (errore instanceof TRPCError) throw errore;
      comeErrore(errore);
    }
  }),

  /** Decisione umana sulla proposta: approva (collega + archivia) o rifiuta. */
  smistamentoDecidi: procedura
    .input(
      z.object({
        comunicazioneId: z.number().int().positive(),
        decisione: z.enum(["approva", "rifiuta"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        assicuraTars("tarsSmistamento");
        const contesto = await costruisciContesto(ctx);
        if (!contesto.capability.has("commessa.update_operational")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Capability mancante per collegare le comunicazioni." });
        }
        const repository = repositorySmistamentoCorrente();
        const comunicazione = await getLiveComunicazione(input.comunicazioneId, contesto.sedeId);
        if (!comunicazione) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Comunicazione non trovata." });
        }
        const record = await repository.perComunicazione(contesto.sedeId, input.comunicazioneId);
        if (!record?.esito || record.propostaStato !== "aperta") {
          throw new TRPCError({ code: "CONFLICT", message: "Nessuna proposta aperta su questa comunicazione." });
        }
        const now = new Date();
        if (input.decisione === "rifiuta") {
          const deciso = await repository.decidiProposta({
            sedeId: contesto.sedeId,
            comunicazioneId: input.comunicazioneId,
            stato: "rifiutata",
            utenteId: contesto.utenteId,
            now,
          });
          if (!deciso) throw new TRPCError({ code: "CONFLICT", message: "Proposta già decisa." });
          return { decisione: "rifiutata" as const, avvertenze: [] as string[] };
        }
        // Prima si chiude la proposta (chi arriva secondo trova CONFLICT),
        // poi si applica: l'effetto è idempotente per costruzione.
        const deciso = await repository.decidiProposta({
          sedeId: contesto.sedeId,
          comunicazioneId: input.comunicazioneId,
          stato: "approvata",
          utenteId: contesto.utenteId,
          now,
        });
        if (!deciso) throw new TRPCError({ code: "CONFLICT", message: "Proposta già decisa." });
        const puoArchiviare = contesto.capability.has("commessa.manage_documents");
        const esitoDaApplicare = puoArchiviare
          ? record.esito
          : { ...record.esito, allegati: record.esito.allegati.map(a => ({ ...a, archiviare: false })) };
        const applicata = await applicaPropostaApprovata({
          comunicazione,
          esito: esitoDaApplicare,
          utente: { id: contesto.utenteId, nome: ctx.user?.name ?? "un operatore" },
        });
        await repository.registra({
          comunicazioneId: input.comunicazioneId,
          sedeId: contesto.sedeId,
          versione: record.versione,
          stato: "analizzata",
          esito: applicata.esito,
          propostaStato: "approvata",
          ultimoErrore: null,
          now,
        });
        return {
          decisione: "approvata" as const,
          commessaId: applicata.esito.collegamento.commessaId,
          clienteId: applicata.esito.collegamento.clienteId,
          archiviati: applicata.esito.archiviati.length,
          avvertenze: [
            ...applicata.avvertenze,
            ...(puoArchiviare ? [] : ["Allegati non archiviati: manca la capability sui documenti."]),
          ],
        };
      } catch (errore) {
        if (errore instanceof TRPCError) throw errore;
        comeErrore(errore);
      }
    }),

  /** Rismista una comunicazione (direzione): utile dopo una correzione dei dati. */
  smistamentoRiesamina: procedura
    .input(z.object({ comunicazioneId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      try {
        assicuraTars("tarsSmistamento");
        const contesto = await costruisciContesto(ctx);
        if (!contesto.direzione) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Riservato alla direzione." });
        }
        const comunicazione = await getLiveComunicazione(input.comunicazioneId, contesto.sedeId);
        if (!comunicazione) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Comunicazione non trovata." });
        }
        const deps = dipendenzeSmistamentoReali();
        const precedente = await deps.repository.perComunicazione(contesto.sedeId, comunicazione.id);
        const fatto = await smistaComunicazione({
          comunicazione,
          deps,
          tentativo: (precedente?.tentativi ?? 0) + 1,
        });
        return {
          conModello: fatto.conModello,
          propostaStato: fatto.propostaStato,
          collegamentoCerto: fatto.candidati.certo != null,
          archiviati: fatto.archiviati,
        };
      } catch (errore) {
        if (errore instanceof TRPCError) throw errore;
        comeErrore(errore);
      }
    }),

  /**
   * Osservazioni dell'osservatore proattivo (T6): visibili solo in
   * modalità active, con flag acceso, capability di lettura e sede del
   * principal. Nessuna cache di vista: il filtro avviene a ogni richiesta.
   */
  osservazioni: procedura
    .input(
      z
        .object({
          stato: z.enum(["aperta", "auto_risolta"]).optional(),
          limite: z.number().int().min(1).max(200).default(50),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      try {
        assicuraTars("tarsProactive");
        if (!osservatoreEspone()) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "L'osservatore di Tars è in modalità shadow: calcola ma non espone (TARS_OBSERVER_MODE).",
          });
        }
        const contesto = await costruisciContesto(ctx);
        if (!contesto.capability.has("commessa.read")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Operazione non autorizzata." });
        }
        const record = await repositoryOsservazioniCorrente().lista({
          sedeId: contesto.sedeId,
          stato: input?.stato,
          limite: input?.limite ?? 50,
        });
        return record.map(osservazione => ({
          id: osservazione.id,
          detector: osservazione.detector,
          commessaId: osservazione.commessaId,
          targetType: osservazione.targetType,
          targetId: osservazione.targetId,
          titolo: osservazione.titolo,
          sintesi: osservazione.sintesi,
          priorita: osservazione.priorita,
          materialita: osservazione.materialita,
          confidenza: osservazione.confidenza,
          stato: osservazione.stato,
          apertaAt: osservazione.apertaAt,
          aggiornataAt: osservazione.aggiornataAt,
          risoltaAt: osservazione.risoltaAt,
        }));
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
        if (input.conversazioneId != null) {
          const conversazione = await conversazioneDiUtente(
            input.conversazioneId,
            contesto.sedeId,
            contesto.utenteId
          );
          if (!conversazione) {
            throw new Error("NOT_FOUND: conversazione non trovata.");
          }
          if (conversazione.archiviataAt != null) {
            throw new Error(
              "CONVERSAZIONE_ARCHIVIATA: ripristinala prima di inviare."
            );
          }
        }
        assicuraRateLimitInvio(contesto.sedeId, contesto.utenteId);

        const chiave = chiaveInvio({
          sedeId: contesto.sedeId,
          utenteId: contesto.utenteId,
          conversazioneId: input.conversazioneId ?? null,
          messaggio: input.messaggio,
        });
        const inCorso = inviiInCorso.get(chiave);
        if (inCorso) return await inCorso;

        const promessa = eseguiRun({
          contesto,
          provider: providerCorrente({
            sedeId: contesto.sedeId,
            utenteId: contesto.utenteId,
          }),
          messaggio: input.messaggio,
          conversazioneId: input.conversazioneId ?? null,
        });
        inviiInCorso.set(chiave, promessa);
        // Si libera SEMPRE, e solo se la voce è ancora la nostra: una
        // conclusione tardiva non deve sfrattare un invio più recente.
        void promessa
          .catch(() => undefined)
          .finally(() => {
            if (inviiInCorso.get(chiave) === promessa) {
              inviiInCorso.delete(chiave);
            }
          });
        return await promessa;
      } catch (errore) {
        if (errore instanceof TRPCError) throw errore;
        comeErrore(errore);
      }
    }),

  /**
   * Sezione «Proposte» della pagina Tars (Tars libero, 02/09/2026): le
   * proposte del gateway documentale aperte in sede. Le proposte di
   * smistamento restano su `smistamentoProposte`; la UI le unisce.
   */
  proposte: procedura.query(async ({ ctx }) => {
    try {
      assicuraTars();
      const contesto = await costruisciContesto(ctx);
      if (!contesto.capability.has("commessa.read")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Capability mancante." });
      }
      return getProposteStore()
        .filter(
          p =>
            p.sedeId === contesto.sedeId &&
            (p.stato === "proposta" || p.stato === "approvata")
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 50)
        .map(p => {
          const v = proiezioneProposta(p);
          return {
            id: v.id,
            tipo: v.tipo,
            etichetta: v.etichetta,
            effetto: v.effetto,
            motivazione: v.motivazione,
            valoreCorrente: v.valoreCorrente,
            valoreProposto: v.valoreProposto,
            documentoNome: v.documentoNome,
            ordineId: v.ordineId,
            commessaId: v.commessaId,
            stato: v.stato,
            hashAnteprima: v.hashAnteprima,
            creataIl: v.createdAt,
            scadeIl: v.scadeIl,
            link: v.commessaId ? `/commesse/${v.commessaId}` : "/fornitori",
          };
        });
    } catch (errore) {
      if (errore instanceof TRPCError) throw errore;
      comeErrore(errore);
    }
  }),

  /**
   * Registro delle azioni di Tars in sede: ogni effetto passato dal ledger
   * R1, con chi lo ha chiesto. «Se l'ha fatto Tars, si vede».
   */
  registroAzioni: procedura
    .input(
      z
        .object({ limite: z.number().int().min(1).max(200).default(80) })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      try {
        assicuraTars();
        const contesto = await costruisciContesto(ctx);
        if (!contesto.capability.has("commessa.read")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Capability mancante." });
        }
        const limite = input?.limite ?? 80;
        const utenti = new Map<number, string>(
          (getUtentiStore() as any[]).map(u => [
            u.id as number,
            `${u.nome ?? ""} ${u.cognome ?? ""}`.trim() || `utente ${u.id}`,
          ])
        );
        // Senza PostgreSQL (sviluppo) le azioni R1 sono fail-closed: il
        // registro è vuoto, non un errore.
        if (!ledgerEsecuzioniAutorevoleDisponibile() && process.env.NODE_ENV !== "test") {
          return [];
        }
        const righe = await ledgerEsecuzioniCorrente().lista({ sedeId: contesto.sedeId });
        return righe
          .filter(r => r.stato !== "reserved" && r.stato !== "expired")
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, limite)
          .map(r => ({
            id: r.id,
            runId: r.runId,
            strumento: r.strumento,
            stato: r.stato,
            esito: r.esito ?? r.risultato?.stato ?? null,
            motivo: r.risultato?.motivo ?? null,
            entitaToccate: r.risultato?.entitaToccate ?? [],
            utenteId: r.utenteId,
            utente: utenti.get(r.utenteId) ?? `utente ${r.utenteId}`,
            azioneId: r.audit.azioneId,
            undoDisponibile: r.compensazione.disponibile,
            undoVia: r.compensazione.via,
            quando: r.createdAt,
          }));
      } catch (errore) {
        if (errore instanceof TRPCError) throw errore;
        comeErrore(errore);
      }
    }),

  /**
   * Analisi azienda giornaliera (02/09/2026): l'ultima analisi della sede.
   * Riservata alla direzione come il Panorama; nessun importo dentro.
   */
  analisiAzienda: procedura.query(async ({ ctx }) => {
    try {
      assicuraTars("tarsProactive");
      assicuraTars("tarsAnalisiAzienda");
      const contesto = await costruisciContesto(ctx);
      if (!contesto.direzione || !contesto.capability.has("commessa.read")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "L'analisi dell'azienda è riservata alla direzione.",
        });
      }
      const record = await repositoryAnalisiCorrente().ultima(contesto.sedeId);
      return { record, oggi: giornoLocaleAnalisi(new Date()) };
    } catch (errore) {
      if (errore instanceof TRPCError) throw errore;
      comeErrore(errore);
    }
  }),

  /** Rigenera l'analisi di oggi (direzione): passa dal governor come ogni chiamata. */
  analisiAziendaRigenera: procedura.mutation(async ({ ctx }) => {
    try {
      assicuraTars("tarsProactive");
      assicuraTars("tarsAnalisiAzienda");
      const contesto = await costruisciContesto(ctx);
      if (!contesto.direzione || !contesto.capability.has("commessa.read")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "L'analisi dell'azienda è riservata alla direzione.",
        });
      }
      const record = await generaAnalisiAzienda({
        sedeId: contesto.sedeId,
        richiestaDa: contesto.utenteId,
      });
      return { record, oggi: giornoLocaleAnalisi(new Date()) };
    } catch (errore) {
      if (errore instanceof TRPCError) throw errore;
      comeErrore(errore);
    }
  }),
});
