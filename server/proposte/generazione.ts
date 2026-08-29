// Generazione deterministica delle proposte da un run di analisi (D7
// slice 3). Legge il run (slice 1), NON rilegge il documento: la proposta
// nasce dai campi estratti con evidenza e fotografa il valore corrente
// dell'ordine al momento della generazione. Autore: "sistema". Nessuna
// applicazione qui dentro — solo record di proposta nel gateway.

import type { AnalisiDocumento } from "../documenti/analisi";
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
    motivazione: `La conferma «${run.documentoNome}» dichiara la consegna al ${consegna.valore}, l'ordine registra ${corrente ?? "nessuna data"}.`,
    versioni: {
      parser: run.parserVersione,
      estrattore: run.estrattoreVersione,
      confronto: run.confrontoVersione,
    },
    now: input.now,
  });
  return { proposte: [risultato], motivo: null };
}
