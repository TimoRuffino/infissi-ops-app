// Strumento L3 di Tars (T5): proporre attraverso il gateway D7 — spec
// §23, decisioni 27-28. Lo strumento GENERA una proposta INERTE (stessa
// coerenza e generazione del router: generaDaOrdineEDocumento) e
// restituisce l'anteprima con `conferma`: l'UNICA approvazione umana
// passa dal bottone della UI (`proposte.approvaEApplica`). Il modello
// NON ha alcuno strumento per approvare: la sequenza vietata
// conferma→approva→applica non può esistere (L5).

import { z } from "zod";
import { analisiPerOrdine } from "../../documenti/analisi";
import { tarsAttivo } from "../../platform/interruttori";
import { definizioneAzione, hashAnteprimaProposta } from "../../proposte/gateway";
import { generaDaOrdineEDocumento } from "../../proposte/generazione";
import { getOrdineFornitoreInSede } from "../../routers/fornitori";
import type { EsitoAzione, EvidenzaTars, StrumentoTars } from "./tipi";

const proponiDataConsegna: StrumentoTars = {
  nome: "proponi_data_consegna",
  versione: "1.0.0",
  categoria: "proposte",
  livello: "L3",
  effetto: "interno",
  reversibile: true, // la proposta è inerte: si rifiuta o scade
  capability: ["fornitore.manage_ordini"],
  soloDirezione: true, // stessa regola delle analisi documentali
  interruttore: ["documentIntelligence", "proposte", "tarsProposals"],
  descrizione:
    "Propone di aggiornare la data di consegna di un ordine fornitore in base all'ultima conferma analizzata (Document Intelligence). NON applica nulla: crea una proposta nel gateway che l'utente approva con UN click. Se documentoId manca, usa l'analisi più recente dell'ordine.",
  schemaInput: z
    .object({
      ordineId: z.number().int().positive(),
      documentoId: z.number().int().positive().optional(),
    })
    .strict(),
  async esegui(contesto, input): Promise<EsitoAzione> {
    if (!tarsAttivo("tarsProposals")) {
      throw new Error(
        "FORBIDDEN: le proposte via Tars sono disattivate (kill switch)."
      );
    }
    const nome = "proponi_data_consegna";
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
      conferma: null as EsitoAzione["conferma"],
      avvertenze: [] as string[],
      assunzioni: [] as string[],
      evidenze: [] as EvidenzaTars[],
      freschezza: new Date().toISOString(),
    };

    const trovato = getOrdineFornitoreInSede(input.ordineId, contesto.sedeId);
    if (!trovato) {
      return { ...base, stato: "non_eseguito", motivo: "Ordine non trovato.", dati: null };
    }

    let documentoId = input.documentoId ?? null;
    const assunzioni: string[] = [];
    if (documentoId == null) {
      const runRecente = analisiPerOrdine(contesto.sedeId, input.ordineId)[0];
      if (!runRecente) {
        return {
          ...base,
          stato: "non_eseguito",
          motivo:
            "Nessuna analisi documentale per questo ordine: analizza prima la conferma d'ordine.",
          dati: null,
        };
      }
      documentoId = runRecente.documentoId;
      assunzioni.push(
        `documento non indicato: usata l'analisi più recente («${runRecente.documentoNome}»)`
      );
    }

    let esito;
    try {
      esito = generaDaOrdineEDocumento({
        sedeId: contesto.sedeId,
        ordineId: input.ordineId,
        documentoId,
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
          assunzioni,
        };
      }
      throw errore;
    }

    if (!esito.proposte.length) {
      return {
        ...base,
        stato: "non_necessaria",
        motivo: esito.motivo,
        dati: null,
        assunzioni,
      };
    }

    const { proposta, riusata } = esito.proposte[0];
    const def = definizioneAzione(proposta.tipo);
    let effetto: string | null = null;
    try {
      effetto = def.descriviEffetto(proposta);
    } catch {
      effetto = null;
    }

    return {
      ...base,
      stato: riusata ? "proposta_esistente" : "proposta_creata",
      motivo: null,
      azioneId: `${nome}:proposta:${proposta.id}`,
      auditId: `proposte_eventi:proposta:${proposta.id}`,
      entitaToccate: [`proposta:${proposta.id}`],
      dopo: {
        propostaId: proposta.id,
        valoreCorrente: proposta.valoreCorrente,
        valoreProposto: proposta.valoreProposto,
        motivazione: proposta.motivazione,
        scadeIl: proposta.scadeIl.toISOString(),
      },
      // L'unica conferma umana: la UI mostra il bottone, il modello no.
      // L'hash lega il click all'anteprima effettivamente mostrata (T5).
      conferma: {
        via: "proposte.approvaEApplica",
        propostaId: proposta.id,
        etichetta: def.etichetta,
        effetto,
        hashAnteprima: hashAnteprimaProposta(proposta),
      },
      avvertenze: proposta.motivazione.includes("OCR a bassa confidenza")
        ? ["Dato da OCR a bassa confidenza: verifica il documento prima di approvare."]
        : [],
      assunzioni,
      dati: {
        propostaId: proposta.id,
        stato: proposta.stato,
        valoreProposto: proposta.valoreProposto,
      },
      evidenze: [
        {
          tipo: "entita",
          riferimento: `ordine:${proposta.ordineId}`,
          descrizione: `${trovato.ordine.codiceOrdine} — consegna attuale ${proposta.valoreCorrente ?? "assente"}`,
        },
        {
          tipo: "documento",
          riferimento: `documento:${proposta.documentoId}`,
          descrizione: `${proposta.documentoNome}${proposta.evidenza ? ` (pag. ${proposta.evidenza.pagina})` : ""}`,
        },
      ],
    };
  },
};

export const STRUMENTI_PROPOSTE: readonly StrumentoTars[] = [
  proponiDataConsegna,
];
