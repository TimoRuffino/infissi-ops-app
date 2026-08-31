// Contratto degli strumenti di Tars (T1) — docs/tars/architettura-tars-v2.md §7.
//
// Nessuno strumento generico: ogni strumento dichiara capability, scope,
// livello e schemi strict. L'output di uno strumento è un DATO per il
// modello, mai un'istruzione. Le letture portano sempre evidenze,
// freschezza, fonte autorevole e OMISSIONI dichiarate (ciò che il
// principal non può vedere non parte, e lo si dice).

import type { z } from "zod";
import type { Capability } from "../../authz/capabilities";
import type { Interruttore } from "../../platform/interruttori";

export type SuperficieTars =
  | "generale"
  | "commessa"
  | "documenti-ordini"
  | "promemoria"
  | "comunicazioni"
  | "economia"
  | "direzione"
  | "post-vendita";

export type TipoEntitaTars =
  | "commessa"
  | "cliente"
  | "ordine_fornitore"
  | "documento"
  | "caso"
  | "promemoria"
  | "memoria";

export type IntentoTars =
  | "lettura"
  | "azione_esplicita"
  | "analisi"
  | "proposta";

export type ContestoRun = {
  utenteId: number;
  sedeId: number;
  ruoli: string[];
  direzione: boolean;
  capability: ReadonlySet<Capability>;
  /** Hash stabile del perimetro authz: entra nelle chiavi di cache. */
  capabilityFingerprint: string;
  lingua: "it";
  fuso: "Europe/Rome";
  /**
   * Selettori di profilo opzionali. Il router/orchestratore corrente può
   * ometterli (compatibilità); il resolver d'intento li popolerà dalla T2.
   */
  superficie?: SuperficieTars;
  entitaAttiva?: { tipo: TipoEntitaTars; id: number };
  intento?: IntentoTars;
};

export type EvidenzaTars = {
  tipo: "entita" | "documento" | "run_analisi" | "caso";
  riferimento: string; // es. "commessa:124", "documento:88", "analisi:12"
  descrizione: string;
};

export type EsitoLettura<T> = {
  dati: T;
  evidenze: EvidenzaTars[];
  freschezza: string; // ISO della lettura
  fonteAutorevole: string;
  /** Cosa è stato omesso per permessi/flag, dichiarato sempre. */
  omissioni: string[];
  versioniEntita: Record<string, string>;
};

export type LivelloRischio = "L0" | "L1" | "L2" | "L3" | "L4";

/**
 * Esito di uno strumento che AGISCE (L1+) — spec §7: le azioni
 * restituiscono stato, riferimenti di audit, prima/dopo e undo. Un esito
 * `non_eseguito` è un DATO per il modello (motivo leggibile), mai
 * un'eccezione: il run prosegue e spiega.
 */
export type EsitoAzione<T = unknown> = {
  tipo: "azione";
  strumento: string;
  stato: string; // es. "creato" | "gia_esistente" | "annullato" | "non_eseguito"
  motivo: string | null; // valorizzato quando stato = non_eseguito
  azioneId: string | null;
  auditId: string | null;
  entitaToccate: string[];
  prima: Record<string, unknown> | null;
  dopo: Record<string, unknown> | null;
  undoDisponibile: boolean;
  /** Finestra o condizione dell'undo (testo dichiarato), null se nessuno. */
  undoEntro: string | null;
  /** Per la UI: come annullare con UN click senza passare dal modello. */
  undoVia: { procedura: "promemoria.cancel"; id: number } | null;
  /**
   * L3: l'azione NON è eseguita — serve l'UNICA conferma umana. La UI
   * mostra l'anteprima e il bottone che chiama la procedura indicata;
   * il modello non ha alcuno strumento per darla (L5).
   */
  conferma?: {
    via: "proposte.approvaEApplica";
    propostaId: number;
    etichetta: string;
    effetto: string | null;
  } | null;
  avvertenze: string[];
  assunzioni: string[];
  dati: T;
  evidenze: EvidenzaTars[];
  freschezza: string;
};

export type StrumentoTars<I = any, O = any> = {
  nome: string;
  versione: string;
  categoria: string;
  livello: LivelloRischio;
  effetto: "nessuno" | "interno" | "esterno";
  reversibile: boolean;
  /** Capability minime per PROVARE a usarlo (lo shaping resta per-campo). */
  capability: readonly Capability[];
  /** Il livello direzione-only eredita le regole degli endpoint attuali. */
  soloDirezione?: boolean;
  /**
   * Interruttori aggiuntivi oltre al master tars (es. documentIntelligence):
   * uno o una lista — TUTTI devono essere accesi.
   */
  interruttore?: Interruttore | readonly Interruttore[];
  descrizione: string;
  schemaInput: z.ZodType<I>;
  esegui(contesto: ContestoRun, input: I): Promise<O>;
};
