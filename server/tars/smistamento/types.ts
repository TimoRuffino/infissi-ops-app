// Smistamento comunicazioni (02/09/2026) — piano:
// docs/superpowers/plans/2026-09-02-tars-smistamento.md
//
// Contratti chiusi: categorie, urgenze e azioni sono enumerazioni; gli id
// di cliente/commessa nell'esito vengono SOLO dai candidati generati e
// verificati dal server. Il modello capisce e propone; il codice decide.

import type { CategoriaComunicazione } from "../../comunicazioni/filtroComunicazioni";
import type { DocTipo } from "../../routers/preventiviContratti";

// 1.1.0 (02/09): clienti interni esclusi dai candidati, prompt v2. Le
// proposte APERTE di una versione precedente vengono ri-esaminate dal
// worker: un errore sistematico non resta in coda a chi decide.
export const VERSIONE_SMISTAMENTO = "1.3.0";

export const URGENZE = ["bassa", "normale", "alta", "critica"] as const;
export type UrgenzaSmistamento = (typeof URGENZE)[number];

export const AZIONI_SUGGERITE = [
  "collega",
  "archivia_allegati",
  "rispondi",
  "promemoria",
  "nessuna",
  "ignora",
] as const;
export type AzioneSuggerita = (typeof AZIONI_SUGGERITE)[number];

export type CandidatoCollegamento = {
  tipo: "commessa" | "cliente";
  id: number;
  etichetta: string;
  /** 0-100, deterministico: somma dei segnali che lo sostengono. */
  punteggio: number;
  motivi: string[];
};

export type SegnaliMittente = {
  /** Il mittente è una casella/persona dell'azienda. */
  interno: boolean;
  /** Il corpo contiene un messaggio inoltrato con un mittente originale. */
  inoltro: boolean;
  mittenteOriginale: string | null;
};

export type PianoAllegato = {
  indice: number;
  nome: string;
  tipo: DocTipo;
  confidenza: "alta" | "media" | "bassa";
  /** Decisione deterministica finale (D2), non il desiderio del modello. */
  archiviare: boolean;
  motivo: string;
};

export type CollegamentoSmistamento = {
  esito: "certo" | "proposto" | "nessuno";
  commessaId: number | null;
  clienteId: number | null;
  confidenza: "alta" | "media" | "bassa";
  motivo: string;
};

export type EsitoSmistamento = {
  versione: string;
  fonte: "modello" | "deterministico";
  modello: string | null;
  categoria: CategoriaComunicazione;
  urgenza: UrgenzaSmistamento;
  /** Una o due frasi, senza importi. */
  riepilogo: string;
  richiedeRisposta: boolean;
  azioneSuggerita: AzioneSuggerita;
  /** Istruzione operativa per chi legge (tars_istruzione). */
  istruzione: string;
  collegamento: CollegamentoSmistamento;
  allegati: PianoAllegato[];
  /** Documenti effettivamente creati nel fascicolo (idempotenti per sourceRef). */
  archiviati: Array<{ indice: number; documentoId: number; tipo: DocTipo }>;
  candidati: CandidatoCollegamento[];
  segnali: SegnaliMittente;
};

export type StatoSmistamento = "analizzata" | "errore" | "saltata";
export type StatoProposta =
  | "nessuna"
  | "aperta"
  | "approvata"
  | "rifiutata"
  | "superata";

export type RecordSmistamento = {
  comunicazioneId: number;
  sedeId: number;
  versione: string;
  stato: StatoSmistamento;
  esito: EsitoSmistamento | null;
  propostaStato: StatoProposta;
  tentativi: number;
  ultimoErrore: string | null;
  decisaDa: number | null;
  decisaAt: Date | null;
  createdAt: Date;
  aggiornataAt: Date;
};
