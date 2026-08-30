// Generazione deterministica delle proposte da un run di analisi (D7
// slice 3). Legge il run (slice 1), NON rilegge il documento: la proposta
// nasce dai campi estratti con evidenza e fotografa il valore corrente
// dell'ordine al momento della generazione. Autore: "sistema". Nessuna
// applicazione qui dentro — solo record di proposta nel gateway.

import { analisiPerOrdine, type AnalisiDocumento } from "../documenti/analisi";
import { collegamentoAttivo } from "../documenti/collegamenti";
import { getCommessaById } from "../routers/commesse";
import { getOrdineFornitoreInSede } from "../routers/fornitori";
import { getDocumentoRecordById } from "../routers/preventiviContratti";
import { creaProposta, type PropostaAzione } from "./gateway";
import "./azioni/ordineDataConsegna";

export type EsitoGenerazione = {
  proposte: Array<{ proposta: PropostaAzione; riusata: boolean }>;
  /** Perché non è stato proposto nulla, quando la lista è vuota. */
  motivo: string | null;
};

export function generaProposteDaAnalisi(input: {
  run: AnalisiDocumento;
  ordine: { id: number; dataConsegnaPrevista: string | null };
  now?: Date;
}): EsitoGenerazione {
  const { run } = input;
  if (run.stato !== "analizzata" || !run.estrazione) {
    return {
      proposte: [],
      motivo:
        "Il documento non ha un'analisi riuscita: senza contenuto estratto non si generano proposte.",
    };
  }

  const consegna = run.estrazione.dateConsegna[0] ?? null;
  if (!consegna) {
    return {
      proposte: [],
      motivo:
        "La conferma non dichiara una data di consegna riconoscibile: niente da proporre.",
    };
  }

  // Il confronto vale sul dato VIVO: se nel frattempo l'ordine è già stato
  // allineato, non c'è niente da proporre.
  const corrente = input.ordine.dataConsegnaPrevista ?? null;
  if (consegna.valore === corrente) {
    return {
      proposte: [],
      motivo:
        "La data di consegna dell'ordine coincide già con quella della conferma.",
    };
  }

  const risultato = creaProposta({
    sedeId: run.sedeId,
    tipo: "ordine_fornitore.aggiorna_data_consegna",
    documentoId: run.documentoId,
    documentoNome: run.documentoNome,
    byteChecksum: run.byteChecksum,
    analisiId: run.id,
    evidenza: consegna.evidenza,
    ordineId: input.ordine.id,
    commessaId: run.commessaId,
    valoreCorrente: corrente,
    valoreProposto: consegna.valore,
    motivazione:
      `La conferma «${run.documentoNome}» dichiara la consegna al ${consegna.valore}, l'ordine registra ${corrente ?? "nessuna data"}.` +
      (run.daVerificare
        ? " ATTENZIONE: testo ricavato con OCR a bassa confidenza — verificare la data sul documento originale prima di approvare."
        : ""),
    versioni: {
      parser: run.parserVersione,
      estrattore: run.estrattoreVersione,
      confronto: run.confrontoVersione,
    },
    now: input.now,
  });
  return { proposte: [risultato], motivo: null };
}

/**
 * Coerenza VIVA documento↔ordine + generazione (T5, decisione 27):
 * l'UNICA fonte della regola, usata sia dal router `proposte.genera`
 * (dopo la sua authz) sia dallo strumento L3 di Tars. Errori tipizzati
 * con prefisso: "NOT_FOUND: …" e "PRECONDITION: …".
 *
 * La regola (revisione D7): il run resta in archivio anche se il
 * collegamento è stato annullato o il documento apparteneva a un'altra
 * commessa — ma una proposta si genera solo se OGGI il documento è del
 * fascicolo dell'ordine o gli è esplicitamente collegato.
 */
export function generaDaOrdineEDocumento(input: {
  sedeId: number;
  ordineId: number;
  documentoId: number;
  now?: Date;
}): EsitoGenerazione {
  const trovato = getOrdineFornitoreInSede(input.ordineId, input.sedeId);
  if (!trovato) throw new Error("NOT_FOUND: Ordine non trovato.");

  const documento = getDocumentoRecordById(input.documentoId);
  const commessaDoc = documento
    ? getCommessaById(documento.commessaId)
    : null;
  if (
    !documento ||
    !commessaDoc ||
    (commessaDoc as any).sedeId !== input.sedeId
  ) {
    throw new Error("NOT_FOUND: Documento non trovato.");
  }
  const collegato = collegamentoAttivo(input.sedeId, documento.id);
  if (
    documento.commessaId !== trovato.ordine.commessaId &&
    collegato?.ordineId !== trovato.ordine.id
  ) {
    throw new Error(
      "PRECONDITION: Il documento non appartiene alla commessa dell'ordine e non gli è collegato: nessuna proposta da questo run."
    );
  }
  const run = analisiPerOrdine(input.sedeId, input.ordineId).find(
    item => item.documentoId === input.documentoId
  );
  if (!run) {
    throw new Error(
      "PRECONDITION: Nessuna analisi per questo documento su questo ordine: esegui prima l'analisi della conferma."
    );
  }
  return generaProposteDaAnalisi({
    run,
    ordine: {
      id: trovato.ordine.id,
      dataConsegnaPrevista: trovato.ordine.dataConsegnaPrevista ?? null,
    },
    now: input.now,
  });
}
