// Cosa ricorda un documento del fascicolo sul costo che ne è nato (o non ne
// è nato). Tipi puri: li importano sia il registro documenti sia il servizio
// che legge le conferme, senza dipendenze fra loro.

import type { EvidenzeLetturaCosto } from "@shared/documenti/evidenze";

/**
 * Bump quando cambia il modo di leggere (estrattore, regole di aggancio):
 * il worker rilegge ogni conferma con una versione diversa.
 */
// 1.1.0: anche la merce a magazzino. 1.2.0: riscontro della commessa nel
// testo per le archiviazioni automatiche, duplicati per riferimento
// d'ordine, settimana di approntamento (04/09/2026 notte).
// 1.3.0: fornitore dall'intestazione e numero documento del fornitore.
// 1.5.0 (04/09/2026): una rilettura corregge i costi nati dalla regola e mai
// toccati; la conferma aggiornata dello stesso ordine sostituisce la vecchia;
// il CAP non è più un riferimento d'ordine.
// 1.6.0: il costo «nato dalla regola» si riconosce dalla sua impronta
// (descrizione, nota, nessuna modifica a mano), non dal confronto con la
// lettura precedente.
// 1.7.0: lettura visiva con il modello per scansioni e foto che l'OCR non
// legge (fonteTesto «visione»); le foto (jpeg, png) passano dall'OCR.
// 1.8.0: un file con più conferme (Bertolotto) si legge a sezioni e il costo
// è la somma degli imponibili, solo se ogni sezione ha il suo.
// 1.9.0 (06/09/2026): evidenze localizzate per campo (dove, nella pagina, è
// stato letto ogni valore) e merce con la sua evidenza. Valori invariati:
// la rilettura riempie le evidenze e non tocca un costo.
export const VERSIONE_LETTURA_COSTO = "1.9.0";

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
  | "errore"
  /**
   * Archiviata da un automatismo ma il testo non cita la commessa (né
   * codice, né cliente, né indirizzo, né ordine noto): niente costo né
   * merce finché una persona non conferma che è di questa commessa.
   */
  | "senza_riscontro"
  /** Stesso riferimento d'ordine di una conferma già a registro: nessun effetto in più. */
  | "duplicato";

export type LetturaCostoDocumento = {
  versione: string;
  checksum: string | null;
  quando: string; // ISO
  esito: EsitoLetturaCosto;
  fonteTesto: "testo_pdf" | "ocr" | "visione" | "nessuna";
  imponibile: number | null;
  fornitore: string | null;
  numeroOrdine: string | null;
  dataDocumento: string | null;
  motivo: string | null;
  tentativi: number;
  /** Il costo sulla commessa (registrato o collegato). */
  costoId: number | null;
  /**
   * La merce in arrivo scritta a magazzino da questa conferma. `undefined`
   * = lettura di una versione che non la tentava; null = non tentata (testo
   * non letto).
   */
  merce?: MerceDaConferma | null;
  /** I riferimenti d'ordine del documento (nome file e testo): servono a riconoscere i duplicati. */
  riferimenti?: string[];
  /** Quante conferme contiene il file (1 di norma; Bertolotto ne manda tre in un PDF). */
  sezioni?: number;
  /** Il documento di cui questa conferma è un duplicato. */
  duplicatoDi?: number | null;
  /** Il riscontro della commessa nel testo (solo per le archiviazioni automatiche). */
  riscontro?: { ok: boolean; prove: string[] } | null;
  /**
   * Dove, nella pagina, è stato letto ogni valore (1.9.0, anteprime delle
   * evidenze): pagina, frammento e area normalizzata. `undefined` = lettura
   * di una versione che non le scriveva; null = testo non letto.
   */
  evidenze?: EvidenzeLetturaCosto | null;
};

export type MerceDaConferma = {
  /** Righe scritte a magazzino (0 = commessa non ancora eleggibile, o già presenti). */
  righe: number;
  dataConsegna: string | null;
  motivo: string | null;
  /** L'estrattore che ha letto le righe: se cambia, le righe non toccate a mano si rigenerano. */
  versioneEstrattore?: string | null;
  /** Settimana di approntamento dichiarata (merce pronta dal fornitore, non consegna). */
  approntamento?: { settimana: number; anno: number | null; dal: string | null } | null;
};

/** Esiti che chiudono la lettura: il worker non li rivisita. */
export const ESITI_TERMINALI: ReadonlySet<EsitoLetturaCosto> = new Set([
  "registrato",
  "collegato",
  "senza_imponibile",
  "non_leggibile",
  "senza_riscontro",
  "duplicato",
]);
