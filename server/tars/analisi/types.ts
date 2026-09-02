// Analisi azienda di Tars (02/09/2026): una fotografia deterministica
// dell'azienda al giorno, una sintesi del modello sopra, proposte che si
// eseguono SOLO chiedendolo a Tars in chat (nessuna mutazione da qui).

export const VERSIONE_ANALISI_AZIENDA = "1.0.0";

export type FattoAnalisi = {
  /** Chiave stabile del fatto (per i test e per il modello). */
  chiave: string;
  testo: string;
  /** Riferimenti delle entità coinvolte: `commessa:12`, `caso:4`, … */
  entita: string[];
  link: string | null;
};

export type SezioneFotografia = {
  chiave: string;
  titolo: string;
  fatti: FattoAnalisi[];
};

export type FotografiaAzienda = {
  sedeId: number;
  generataIl: string;
  contatori: Record<string, number>;
  sezioni: SezioneFotografia[];
};

export const TIPI_PUNTO = ["rischio", "anomalia", "andamento", "opportunita"] as const;
export type TipoPunto = (typeof TIPI_PUNTO)[number];
export const PRIORITA_PUNTO = ["alta", "media", "bassa"] as const;
export type PrioritaPunto = (typeof PRIORITA_PUNTO)[number];

export type PuntoAnalisi = {
  tipo: TipoPunto;
  priorita: PrioritaPunto;
  testo: string;
  entita: string[];
  link: string | null;
};

export type PropostaAnalisi = {
  testo: string;
  /** La frase da dire a Tars per farla eseguire (precompila la chat). */
  richiestaPerTars: string;
  entita: string[];
  link: string | null;
};

export type EsitoAnalisiAzienda = {
  versione: string;
  fonte: "modello" | "deterministica";
  modello: string | null;
  sintesi: string;
  punti: PuntoAnalisi[];
  proposte: PropostaAnalisi[];
  domande: string[];
  avvertenze: string[];
  contatori: Record<string, number>;
  fattiConsiderati: number;
};

export type StatoAnalisiAzienda = "pronta" | "errore";

export type RecordAnalisiAzienda = {
  id: number;
  sedeId: number;
  /** Giorno locale (Europe/Rome) `YYYY-MM-DD`: una analisi per sede al giorno. */
  giorno: string;
  versione: string;
  stato: StatoAnalisiAzienda;
  esito: EsitoAnalisiAzienda | null;
  errore: string | null;
  /** null = generata dal worker; altrimenti l'utente che ha chiesto la rigenerazione. */
  richiestaDa: number | null;
  generataAt: Date;
};
