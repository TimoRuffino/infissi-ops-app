// Strumento L2 di Tars (T6): avviare l'analisi di una conferma d'ordine
// — spec §24, decisione 32. Riusa l'UNICA fonte
// `documenti/analisiOrdine.analizzaConfermaPerOrdine` (stessa coerenza
// del router, idempotenza per firma nel dominio). I run sono
// append-only: nessun undo, dichiarato. L'analisi è una DERIVAZIONE:
// nessun dato di dominio viene toccato.

import { z } from "zod";
import {
  analizzaConfermaPerOrdine,
  messaggioOperatoreAnalisi,
} from "../../documenti/analisiOrdine";
import {
  interruttoreAttivo,
  tarsAttivo,
} from "../../platform/interruttori";
import type { EsitoAzione, StrumentoTars } from "./tipi";

const analizzaConferma: StrumentoTars = {
  nome: "analizza_conferma_ordine",
  versione: "1.0.0",
  categoria: "documenti",
  livello: "L2",
  effetto: "interno",
  reversibile: false, // i run sono append-only (idempotenti per firma)
  capability: [],
  soloDirezione: true, // stessa regola dell'endpoint analisiDocumenti
  interruttore: ["tarsL2Actions", "documentIntelligence"],
  descrizione:
    "Avvia l'analisi Document Intelligence di un documento del fascicolo come conferma di un ordine. Idempotente: stesso file e stesse versioni riusano il run. Non modifica ordini o commesse: produce solo il run con differenze ed evidenze.",
  schemaInput: z
    .object({
      ordineId: z.number().int().positive(),
      documentoId: z.number().int().positive(),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    if (
      !tarsAttivo("tarsL2Actions") ||
      !interruttoreAttivo("documentIntelligence")
    ) {
      throw new Error(
        "FORBIDDEN: l'analisi documentale via Tars è disattivata (kill switch)."
      );
    }
    const nome = "analizza_conferma_ordine";
    const base = {
      tipo: "azione" as const,
      strumento: nome,
      azioneId: null as string | null,
      auditId: null as string | null,
      entitaToccate: [] as string[],
      prima: null,
      dopo: null,
      undoDisponibile: false,
      undoEntro: null,
      undoVia: null,
      conferma: null,
      avvertenze: [] as string[],
      assunzioni: [] as string[],
      evidenze: [] as Array<{
        tipo: "entita" | "documento" | "run_analisi";
        riferimento: string;
        descrizione: string;
      }>,
      freschezza: new Date().toISOString(),
    };

    let esito;
    try {
      esito = await analizzaConfermaPerOrdine({
        sedeId: contesto.sedeId,
        ordineId: input.ordineId,
        documentoId: input.documentoId,
        createdBy: contesto.utenteId,
      });
    } catch (errore: any) {
      const messaggio = String(errore?.message ?? "");
      if (
        messaggio.startsWith("NOT_FOUND: ") ||
        messaggio.startsWith("PRECONDITION: ")
      ) {
        return {
          ...base,
          stato: "non_eseguito",
          motivo: messaggio.replace(/^(NOT_FOUND|PRECONDITION): /, ""),
          dati: null,
        };
      }
      const operatore = messaggioOperatoreAnalisi(errore);
      if (operatore) {
        return { ...base, stato: "non_eseguito", motivo: operatore, dati: null };
      }
      // Dettagli d'infrastruttura: mai grezzi verso il modello.
      console.error("[tars] analisi non riuscita:", errore);
      return {
        ...base,
        stato: "non_eseguito",
        motivo: "Documento non analizzabile in questo momento.",
        dati: null,
      };
    }

    const { run, riusata } = esito;
    return {
      ...base,
      stato: riusata ? "run_riusato" : "analizzato",
      motivo: null,
      azioneId: `${nome}:analisi:${run.id}`,
      auditId: `documenti_analisi:analisi:${run.id}`,
      entitaToccate: [`analisi:${run.id}`],
      dopo: {
        runId: run.id,
        statoRun: run.stato,
        motivoStato: run.motivoStato,
        differenze: run.differenze.length,
        daVerificare: run.daVerificare,
        parser: run.parser,
      },
      avvertenze: run.daVerificare
        ? ["Testo da OCR a bassa confidenza: verificare sul documento originale."]
        : [],
      dati: {
        runId: run.id,
        statoRun: run.stato,
        differenze: run.differenze.map(d => ({
          tipo: d.tipo,
          gravita: d.gravita,
          dettaglio: d.dettaglio,
        })),
      },
      evidenze: [
        {
          tipo: "run_analisi",
          riferimento: `analisi:${run.id}`,
          descrizione: `${run.documentoNome} — ${run.stato}${run.daVerificare ? " (DA VERIFICARE)" : ""}`,
        },
        {
          tipo: "entita",
          riferimento: `ordine:${run.ordineId}`,
          descrizione: `ordine ${run.ordineId} — confronto con la conferma`,
        },
      ],
    };
  },
};

export const STRUMENTI_DOCUMENTI: readonly StrumentoTars[] = [
  analizzaConferma,
];
