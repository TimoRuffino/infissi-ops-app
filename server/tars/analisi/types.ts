// Analisi azienda di Tars (02/09/2026): una fotografia deterministica
// dell'azienda al giorno, una sintesi del modello sopra, proposte che si
// eseguono SOLO chiedendolo a Tars in chat (nessuna mutazione da qui).

export const VERSIONE_ANALISI_AZIENDA = "1.2.0";

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

/** L'azione eseguibile con un click (T3): verificata contro il catalogo. */
export type AzionePropostaAnalisi = {
  strumento: string;
  /** Input dello strumento come stringa JSON (formato strict del provider). */
  input: string;
};

/** Cosa è successo quando l'utente ha cliccato Esegui (dal ledger R1). */
export type EsecuzionePropostaAnalisi = {
  stato: string;
  motivo: string | null;
  azioneId: string | null;
  entitaToccate: string[];
  quando: string;
  daUtente: number;
};

export type PropostaAnalisi = {
  testo: string;
  /** La frase da dire a Tars per farla eseguire (precompila la chat). */
  richiestaPerTars: string;
  entita: string[];
  link: string | null;
  /** null = la proposta si porta in chat; valorizzata = bottone Esegui. */
  azione: AzionePropostaAnalisi | null;
  esecuzione?: EsecuzionePropostaAnalisi | null;
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
  /** Quante volte è stata generata oggi (worker e rigenerazioni). */
  tentativi: number;
  generataAt: Date;
};
