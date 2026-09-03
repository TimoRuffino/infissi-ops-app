// Cosa ricorda un documento del fascicolo sul costo che ne è nato (o non ne
// è nato). Tipi puri: li importano sia il registro documenti sia il servizio
// che legge le conferme, senza dipendenze fra loro.

/**
 * Bump quando cambia il modo di leggere (estrattore, regole di aggancio):
 * il worker rilegge ogni conferma con una versione diversa.
 */
export const VERSIONE_LETTURA_COSTO = "1.0.0";

/** Oltre questi tentativi un errore di lettura resta com'è. */
export const TENTATIVI_MASSIMI_LETTURA = 3;

export type EsitoLetturaCosto =
  /** Costo nuovo scritto sulla commessa. */
  | "registrato"
  /** Un costo già presente (manuale o importato) è stato legato al documento. */
  | "collegato"
  /** Testo letto, ma nessun imponibile dichiarato: non si scorpora l'IVA. */
  | "senza_imponibile"
  /** Scansione senza OCR riuscito, formato non supportato, file troppo grande. */
  | "non_leggibile"
  /** Scansione: serve l'OCR, che gira solo nel worker. */
  | "da_ocr"
  /** Storage o parser hanno fallito: si ritenta. */
  | "errore";

export type LetturaCostoDocumento = {
  versione: string;
  checksum: string | null;
  quando: string; // ISO
  esito: EsitoLetturaCosto;
  fonteTesto: "testo_pdf" | "ocr" | "nessuna";
  imponibile: number | null;
  fornitore: string | null;
  numeroOrdine: string | null;
  dataDocumento: string | null;
  motivo: string | null;
  tentativi: number;
  /** Il costo sulla commessa (registrato o collegato). */
  costoId: number | null;
};

/** Esiti che chiudono la lettura: il worker non li rivisita. */
export const ESITI_TERMINALI: ReadonlySet<EsitoLetturaCosto> = new Set([
  "registrato",
  "collegato",
  "senza_imponibile",
  "non_leggibile",
]);
