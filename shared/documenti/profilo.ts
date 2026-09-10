// Il profilo di lettura di un MODULO di conferma d'ordine (spec
// `2026-09-10-fornitori-per-azienda-e-profili-design.md` §5).
//
// Non è un modello allenato: è un elenco di appigli. «Il numero d'ordine
// segue l'etichetta CV», «l'imponibile è la cifra dopo Totale imponibile».
// Nasce dalla CORREZIONE di un esempio — la persona dice qual è il valore
// giusto, il codice guarda dove sta e registra che cosa lo precede — e per
// questo dentro un'ancora c'è sempre un'ETICHETTA, mai un VALORE.
//
// Quella regola non è cosmesi: è ciò che permetterà di promuovere la FORMA di
// un profilo a patrimonio del prodotto senza portarsi dietro il cliente, il
// prezzo o il cantiere di nessuno.

/**
 * I campi su cui un'ancora può puntare. I nomi sono **gli stessi** di
 * `EstrazioneConferma`: è ciò che permette all'applicazione di scrivere senza
 * una mappa di traduzione, e che rende impossibile ancorare un campo che
 * l'estrattore non conosce.
 */
export const CAMPI_ANCORABILI = [
  "numeroConferma",
  "riferimentoOrdine",
  "riferimentoCliente",
  "imponibileDocumento",
  "totaleDocumento",
  "dataDocumento",
] as const;
export type CampoAncorabile = (typeof CAMPI_ANCORABILI)[number];

/** Che aspetto ha il valore: impedisce di prendere il numero sbagliato. */
export type FormaValore = "numero" | "importo" | "data" | "testo";

/** Dove sta il valore rispetto all'etichetta che lo annuncia. */
export type PosizioneAncora = "dopo_etichetta" | "riga_successiva" | "cella_a_destra";

export type AncoraCampo = {
  campo: CampoAncorabile;
  /** L'etichetta STAMPATA che precede il valore. Mai il valore. */
  etichetta: string;
  posizione: PosizioneAncora;
  forma: FormaValore;
  /** Pagina fissa quando il modulo la fissa; null = qualunque. */
  pagina: number | null;
};

export type RuoloColonna =
  | "codice" | "descrizione" | "quantita" | "unita" | "prezzo" | "ignora";

/**
 * Il blocco delle righe di merce: dove comincia, dove finisce, e che cosa
 * sono le colonne. Il tipo nasce qui e si persiste, ma nessuno lo compila e
 * nessuno lo applica ancora: è il pezzo più rischioso — tocca la lettura che
 * alimenta il magazzino — e ha un piano suo.
 */
export type BloccoRighe = {
  /** La riga d'intestazione che apre la tabella. */
  apertura: string;
  /** Che cosa la chiude: un'etichetta di totale, un piede, la pagina nuova. */
  chiusura: string;
  /** Le colonne per posizione di partenza sulla riga resa. */
  colonne: Array<{ ruolo: RuoloColonna; inizio: number; fine: number | null }>;
};

export type ProfiloLettura = {
  id: number;
  sedeId: number;
  fornitoreId: number;
  versione: number;
  /** L'impronta del layout su cui questo profilo si applica. */
  impronta: string;
  ancore: AncoraCampo[];
  blocco: BloccoRighe | null;
  origine: "correzione" | "catalogo";
  esempioId: number | null;
  /** Quante conferme ha letto senza che nessuno correggesse niente. */
  lettureSenzaCorrezione: number;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};
