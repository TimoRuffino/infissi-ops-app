// Tipi della proposta di estrazione (piano 3): la forma che il contratto
// assume PRIMA di essere applicato. Ogni campo proposto porta con sé
// l'evidenza (pagina/frammento) e un flag di verifica: il servizio
// server decide quando fidarsi e come tradurre il vocabolario del
// modello (server/contratti/estrazione/schema.ts, EsitoModello) in
// quello del CRM (CategoriaRiga e gli altri tipi di limiti/tipi) — qui
// vivono solo le forme, nessuna logica, come in shared/limiti/tipi.ts.
//
// EstrazioneContratto è la riga persistita (proposta/applicata/scartata);
// PropostaContratto è il contenuto strutturato che il servizio costruisce
// dall'esito del modello prima di mostrarlo all'utente per la conferma.

import type { CategoriaRiga, DetrazioneTipo, OscuranteIntegrato, PattuitoTipo, RataContratto } from "../limiti/tipi";

/** Dove il modello ha trovato un valore: pagina del PDF e frammento di testo citato. */
export type EvidenzaEstratta = { pagina: number; frammento: string };

/** Un campo proposto dal modello: valore, evidenza (se citata) e stato di verifica. */
export type CampoProposto<T> = {
  valore: T;
  evidenza: EvidenzaEstratta | null;
  daVerificare: boolean;
  nota: string | null;
};

export type RigaProposta = {
  ordine: number;
  categoria: CampoProposto<CategoriaRiga>;
  tipologia: CampoProposto<string | null>; // codice DEI scelto dal CRM
  descrizione: CampoProposto<string>;
  quantita: CampoProposto<number>;
  larghezzaMm: CampoProposto<number | null>;
  altezzaMm: CampoProposto<number | null>;
  prezzoTotCent: CampoProposto<number | null>;
  oscuranteIntegrato: CampoProposto<OscuranteIntegrato | null>;
  oscuranteTipologia: CampoProposto<string | null>;
  accessori: Array<{ codice: string; quantita: number; etichetta: string }>;
  beneSignificativo: boolean;
  note: string | null;
  avvertenze: string[];
};

export type ControlloProposta = { codice: string; esito: "ok" | "avviso" | "errore"; messaggio: string };

export type PropostaContratto = {
  righe: RigaProposta[];
  pattuitoCent: CampoProposto<number | null>;
  pattuitoTipo: CampoProposto<PattuitoTipo | null>;
  posaInclusa: CampoProposto<boolean>;
  posaCent: CampoProposto<number | null>;
  notePosa: string | null;
  rate: CampoProposto<RataContratto[]>;
  comuneCantiere: CampoProposto<string | null>;
  indirizzoCantiere: CampoProposto<string | null>;
  provinciaCantiere: string | null;
  piano: CampoProposto<number | null>;
  dataFirma: CampoProposto<string | null>; // YYYY-MM-DD
  riferimento: CampoProposto<string | null>; // numero preventivo/contratto
  clienteCitato: CampoProposto<string | null>;
  detrazioneTipo: CampoProposto<DetrazioneTipo | null>;
  note: string | null;
  controlli: ControlloProposta[];
  avvertenze: string[];
};

export const STATI_ESTRAZIONE = ["proposta", "applicata", "scartata"] as const;
export type StatoEstrazione = (typeof STATI_ESTRAZIONE)[number];

export type EstrazioneContratto = {
  id: number;
  sedeId: number;
  commessaId: number;
  documentoId: number;
  documentoChecksum: string;
  stato: StatoEstrazione;
  promptVersione: string;
  modello: string | null;
  runId: string | null;
  pagine: number | null;
  ocr: boolean;
  parser: string | null;
  proposta: PropostaContratto;
  createdBy: number | null;
  createdAt: Date;
  applicataAt: Date | null;
  applicataBy: number | null;
  scartataMotivo: string | null;
};
