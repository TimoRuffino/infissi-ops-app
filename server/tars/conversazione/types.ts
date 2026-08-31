import type { SuperficieTars } from "../strumenti/tipi";

export type CandidatoChiarificazioneCommessa = {
  commessaId: number;
  codice: string;
  cliente: string;
};

export type ChiarificazionePendente = {
  tipo: "commessa";
  riferimento: string;
  domanda: string;
  candidati: CandidatoChiarificazioneCommessa[];
};

/**
 * Hint conversazionale persistente. Non contiene capability e non concede
 * autorità: ogni consumer deve rileggere la fonte CRM prima di usarlo.
 */
export type ContestoConversazione = {
  commessaId: number | null;
  clienteId: number | null;
  comunicazioneId: number | null;
  allegatoIndex: number | null;
  superficie: SuperficieTars | null;
  versioniEntita: Record<string, string>;
  chiarificazionePendente: ChiarificazionePendente | null;
  versione: number;
};

export type PatchContestoConversazione = Partial<
  Omit<ContestoConversazione, "versione">
>;

export type CandidatoResolverCommessa =
  CandidatoChiarificazioneCommessa & {
    punteggio: number;
    evidenze: string[];
  };

export type EsitoResolverCommessa =
  | { stato: "unico"; candidato: CandidatoResolverCommessa }
  | {
      stato: "ambiguo";
      candidati: CandidatoResolverCommessa[];
      domanda: string;
    }
  | { stato: "non_trovato"; candidati: [] };

export function contestoConversazioneVuoto(): ContestoConversazione {
  return {
    commessaId: null,
    clienteId: null,
    comunicazioneId: null,
    allegatoIndex: null,
    superficie: null,
    versioniEntita: {},
    chiarificazionePendente: null,
    versione: 0,
  };
}
