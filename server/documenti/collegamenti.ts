// Collegamenti documento ↔ ordine fornitore (D7, slice 2).
//
// Il collegamento è un dato NUOVO e separato: non altera il documento
// originale né l'ordine. Ogni record porta il suo audit append-only
// (conferma, rifiuto, annullamento, con utente, momento e motivo): la
// correzione è un annullamento seguito da una nuova conferma, mai una
// riscrittura muta. Un documento ha al massimo UN collegamento confermato;
// i rifiuti restano registrati e tolgono il candidato dal calcolo dello
// stato finché un umano non lo riconferma esplicitamente.

import { persistedStore } from "../_core/persistence";

export type AzioneCollegamento = "confermato" | "rifiutato" | "annullato";

export type EventoCollegamento = {
  azione: AzioneCollegamento;
  utenteId: number | null;
  at: Date;
  motivo: string | null;
};

export type CollegamentoDocumentoOrdine = {
  id: number;
  sedeId: number;
  documentoId: number;
  ordineId: number;
  stato: AzioneCollegamento;
  /** Fotografia del perché al momento della conferma: punteggio e segnali. */
  punteggio: number | null;
  motivazioni: string[];
  /** SHA-256 del documento alla conferma, per rilevare duplicati. */
  byteChecksum: string | null;
  eventi: EventoCollegamento[];
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

let nextCollegamentoId = 1;
const _store = persistedStore<CollegamentoDocumentoOrdine>(
  "documenti_collegamenti_ordini",
  items => {
    nextCollegamentoId = items.length
      ? Math.max(...items.map(item => item.id)) + 1
      : 1;
  }
);
const collegamenti = _store.items;

export function collegamentoAttivo(
  sedeId: number,
  documentoId: number
): CollegamentoDocumentoOrdine | null {
  return (
    collegamenti.find(
      c =>
        c.sedeId === sedeId &&
        c.documentoId === documentoId &&
        c.stato === "confermato"
    ) ?? null
  );
}

export function collegamentiPerOrdine(
  sedeId: number,
  ordineId: number
): CollegamentoDocumentoOrdine[] {
  return collegamenti
    .filter(
      c =>
        c.sedeId === sedeId && c.ordineId === ordineId && c.stato === "confermato"
    )
    .sort((a, b) => b.id - a.id);
}

export function ordiniRifiutatiPerDocumento(
  sedeId: number,
  documentoId: number
): Set<number> {
  return new Set(
    collegamenti
      .filter(
        c =>
          c.sedeId === sedeId &&
          c.documentoId === documentoId &&
          c.stato === "rifiutato"
      )
      .map(c => c.ordineId)
  );
}

/** Un documento identico (stesso checksum) già collegato a un ordine? */
export function collegamentoDuplicatoPerChecksum(
  sedeId: number,
  byteChecksum: string | null,
  documentoId: number
): CollegamentoDocumentoOrdine | null {
  if (!byteChecksum) return null;
  return (
    collegamenti.find(
      c =>
        c.sedeId === sedeId &&
        c.stato === "confermato" &&
        c.byteChecksum === byteChecksum &&
        c.documentoId !== documentoId
    ) ?? null
  );
}

function trovaCoppia(
  sedeId: number,
  documentoId: number,
  ordineId: number
): CollegamentoDocumentoOrdine | null {
  return (
    collegamenti.find(
      c =>
        c.sedeId === sedeId &&
        c.documentoId === documentoId &&
        c.ordineId === ordineId &&
        c.stato !== "annullato"
    ) ?? null
  );
}

export function confermaCollegamento(input: {
  sedeId: number;
  documentoId: number;
  ordineId: number;
  punteggio: number | null;
  motivazioni: string[];
  byteChecksum: string | null;
  utenteId: number | null;
  motivo: string | null;
}): { collegamento: CollegamentoDocumentoOrdine; riusato: boolean } {
  const attivo = collegamentoAttivo(input.sedeId, input.documentoId);
  if (attivo && attivo.ordineId === input.ordineId) {
    // Idempotente: confermare due volte la stessa coppia non crea un
    // secondo collegamento né un doppio audit.
    return { collegamento: attivo, riusato: true };
  }
  if (attivo) {
    throw new Error(
      `Il documento è già collegato all'ordine ${attivo.ordineId}: annulla quel collegamento prima di correggerlo.`
    );
  }

  const now = new Date();
  const evento: EventoCollegamento = {
    azione: "confermato",
    utenteId: input.utenteId,
    at: now,
    motivo: input.motivo,
  };

  // Un rifiuto precedente sulla stessa coppia viene superato dalla conferma
  // esplicita: stesso record, audit completo.
  const esistente = trovaCoppia(input.sedeId, input.documentoId, input.ordineId);
  if (esistente) {
    esistente.stato = "confermato";
    esistente.punteggio = input.punteggio;
    esistente.motivazioni = input.motivazioni;
    esistente.byteChecksum = input.byteChecksum;
    esistente.eventi.push(evento);
    esistente.updatedAt = now;
    _store.save();
    return { collegamento: esistente, riusato: false };
  }

  const collegamento: CollegamentoDocumentoOrdine = {
    id: nextCollegamentoId++,
    sedeId: input.sedeId,
    documentoId: input.documentoId,
    ordineId: input.ordineId,
    stato: "confermato",
    punteggio: input.punteggio,
    motivazioni: input.motivazioni,
    byteChecksum: input.byteChecksum,
    eventi: [evento],
    createdBy: input.utenteId,
    createdAt: now,
    updatedAt: now,
  };
  collegamenti.push(collegamento);
  _store.save();
  return { collegamento, riusato: false };
}

export function rifiutaCandidato(input: {
  sedeId: number;
  documentoId: number;
  ordineId: number;
  utenteId: number | null;
  motivo: string | null;
}): CollegamentoDocumentoOrdine {
  const attivo = collegamentoAttivo(input.sedeId, input.documentoId);
  if (attivo && attivo.ordineId === input.ordineId) {
    throw new Error(
      "Questo ordine è il collegamento confermato del documento: annullalo, non rifiutarlo."
    );
  }
  const now = new Date();
  const evento: EventoCollegamento = {
    azione: "rifiutato",
    utenteId: input.utenteId,
    at: now,
    motivo: input.motivo,
  };
  const esistente = trovaCoppia(input.sedeId, input.documentoId, input.ordineId);
  if (esistente) {
    if (esistente.stato === "rifiutato") return esistente; // idempotente
    esistente.stato = "rifiutato";
    esistente.eventi.push(evento);
    esistente.updatedAt = now;
    _store.save();
    return esistente;
  }
  const record: CollegamentoDocumentoOrdine = {
    id: nextCollegamentoId++,
    sedeId: input.sedeId,
    documentoId: input.documentoId,
    ordineId: input.ordineId,
    stato: "rifiutato",
    punteggio: null,
    motivazioni: [],
    byteChecksum: null,
    eventi: [evento],
    createdBy: input.utenteId,
    createdAt: now,
    updatedAt: now,
  };
  collegamenti.push(record);
  _store.save();
  return record;
}

export function annullaCollegamento(input: {
  sedeId: number;
  documentoId: number;
  utenteId: number | null;
  motivo: string | null;
}): CollegamentoDocumentoOrdine {
  const attivo = collegamentoAttivo(input.sedeId, input.documentoId);
  if (!attivo) {
    throw new Error("Il documento non ha un collegamento confermato.");
  }
  attivo.stato = "annullato";
  attivo.eventi.push({
    azione: "annullato",
    utenteId: input.utenteId,
    at: new Date(),
    motivo: input.motivo,
  });
  attivo.updatedAt = new Date();
  _store.save();
  return attivo;
}
