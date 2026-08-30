// Avvio dell'analisi di una conferma per un ordine (T6, decisione 32):
// la coerenza fascicolo/collegamento e la costruzione degli input escono
// dal router in quest'UNICA fonte, usata sia da
// `analisiDocumenti.analizzaConferma` (dopo la sua authz) sia dallo
// strumento L2 di Tars. Errori tipizzati con prefisso "NOT_FOUND: " e
// "PRECONDITION: "; gli errori di lettura byte pensati per l'operatore
// sono riconoscibili con `messaggioOperatoreAnalisi` (tutto il resto NON
// deve arrivare grezzo al client: può contenere dettagli
// d'infrastruttura).

import { getCommessaById } from "../routers/commesse";
import { getOrdineFornitoreInSede } from "../routers/fornitori";
import { getDocumentoRecordById } from "../routers/preventiviContratti";
import {
  eseguiAnalisiConferma,
  type AnalisiDocumento,
  type DocumentoDaAnalizzare,
} from "./analisi";
import { collegamentoAttivo } from "./collegamenti";

const MESSAGGI_OPERATORE = [
  "File non disponibile nello storage.",
  "Il documento non ha byte leggibili (né storage né inline).",
];

/** Il messaggio se è pensato per l'operatore, altrimenti null. */
export function messaggioOperatoreAnalisi(errore: unknown): string | null {
  const messaggio = String((errore as any)?.message ?? "");
  return MESSAGGI_OPERATORE.includes(messaggio) ? messaggio : null;
}

export function documentoInSede(documentoId: number, sedeId: number) {
  const documento = getDocumentoRecordById(documentoId);
  const commessa = documento ? getCommessaById(documento.commessaId) : null;
  if (!documento || !commessa || (commessa as any).sedeId !== sedeId) {
    return null;
  }
  return { documento, commessa };
}

function comeDocumentoDaAnalizzare(documento: any): DocumentoDaAnalizzare {
  return {
    id: documento.id,
    commessaId: documento.commessaId,
    nome: documento.nome,
    mimeType: documento.mimeType,
    storageKey: documento.storageKey ?? null,
    dataBase64: documento.dataBase64 ?? null,
  };
}

/**
 * Coerenza del fascicolo + avvio dell'analisi: si analizzano documenti
 * della stessa commessa dell'ordine, OPPURE documenti che un umano ha già
 * collegato a questo ordine (il collegamento confermato è una decisione
 * esplicita e prevale sulla posizione del file). L'idempotenza per firma
 * vive in `eseguiAnalisiConferma`.
 */
export async function analizzaConfermaPerOrdine(input: {
  sedeId: number;
  ordineId: number;
  documentoId: number;
  createdBy: number | null;
  forza?: boolean;
}): Promise<{ run: AnalisiDocumento; riusata: boolean }> {
  const trovato = getOrdineFornitoreInSede(input.ordineId, input.sedeId);
  if (!trovato) throw new Error("NOT_FOUND: Ordine non trovato.");
  const { ordine, fornitoreNome } = trovato;

  const trovatoDoc = documentoInSede(input.documentoId, input.sedeId);
  if (!trovatoDoc) throw new Error("NOT_FOUND: Documento non trovato.");
  const { documento } = trovatoDoc;

  const collegato = collegamentoAttivo(input.sedeId, documento.id);
  if (
    documento.commessaId !== ordine.commessaId &&
    collegato?.ordineId !== ordine.id
  ) {
    throw new Error(
      "PRECONDITION: Il documento appartiene a un'altra commessa: seleziona un file dal fascicolo della commessa dell'ordine, oppure collegalo prima a questo ordine."
    );
  }

  const commessaOrdine = getCommessaById(ordine.commessaId);
  return eseguiAnalisiConferma({
    sedeId: input.sedeId,
    documento: comeDocumentoDaAnalizzare(documento),
    ordine: {
      id: ordine.id,
      codiceOrdine: ordine.codiceOrdine,
      commessaCodice: (commessaOrdine as any)?.codice ?? null,
      dataConsegnaPrevista: ordine.dataConsegnaPrevista ?? null,
      importoTotale: ordine.importoTotale ?? null,
      righe: ordine.righe,
      fornitoreNome,
    },
    createdBy: input.createdBy,
    forza: input.forza,
  });
}
