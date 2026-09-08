// Analisi azienda di Tars (02/09/2026): una fotografia deterministica
// dell'azienda al giorno, una sintesi del modello sopra, proposte che si
// eseguono SOLO chiedendolo a Tars in chat (nessuna mutazione da qui).

export const VERSIONE_ANALISI_AZIENDA = "1.2.0";

/**
 * Quanto è solido il fatto sotto una proposta (punto 23 del piano
 * 08/09/2026): `certa` = dato del CRM; `letta` = un documento letto da una
 * macchina, con riscontro; `da_verificare` = letto senza riscontro, o non
 * letto affatto. Una lettura OCR al 60 % non deve avere lo stesso aspetto
 * di una certezza.
 */
export const FIDUCIA_FATTO = ["certa", "letta", "da_verificare"] as const;
export type FiduciaFatto = (typeof FIDUCIA_FATTO)[number];

export type FattoAnalisi = {
  /** Chiave stabile del fatto (per i test e per il modello). */
  chiave: string;
  testo: string;
  /** Assente = `certa`. */
  fiducia?: FiduciaFatto;
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
  /**
   * Quanto denaro è esposto dietro ogni riferimento (`commessa:12` → il
   * residuo da incassare). Serve a ordinare le proposte per quanto costa
   * ignorarle e **non entra nel testo che legge il modello**: gli importi
   * restano fuori dal prompt (punto 22 del piano 08/09/2026).
   */
  postaInGioco?: Record<string, { residuo: number; marginePerc: number | null }>;
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
  /**
   * La sezione della fotografia da cui nasce (`gate`, `conferme_ordine`,
   * `magazzino`…). Dichiarata dal modello e verificata contro le sezioni
   * vere: senza, non si può sapere quali fonti producono proposte che
   * accetti e quali no (punto 12 del piano 08/09/2026).
   */
  fonte?: string | null;
  /** La frase da dire a Tars per farla eseguire (precompila la chat). */
  richiestaPerTars: string;
  entita: string[];
  link: string | null;
  /** null = la proposta si porta in chat; valorizzata = bottone Esegui. */
  azione: AzionePropostaAnalisi | null;
  /**
   * A chi tocca: derivato dalla sezione e dall'assegnatario, non scelto dal
   * modello (punto 3 del piano 08/09/2026). `utenteId` per nome, `ruolo`
   * per squadra; la direzione vede comunque tutto.
   */
  /** La più debole fra le fiducie dei fatti che la proposta cita. */
  fiducia?: FiduciaFatto;
  /**
   * Le cifre: le vede **solo la direzione** (decisione 08/09/2026), e
   * `esitoVisibileA` le toglie a tutti gli altri. Il segnale «sotto
   * margine» invece sta nella fotografia e lo legge chiunque.
   */
  economia?: { residuo: number; marginePerc: number | null } | null;
  destinatario?: {
    utenteId: number | null;
    ruolo: "amministrazione" | "direzione" | null;
    motivo: string;
  } | null;
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
