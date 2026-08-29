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
  /** Interruttore aggiuntivo oltre al master tars (es. documentIntelligence). */
  interruttore?: Interruttore;
  descrizione: string;
  schemaInput: z.ZodType<I>;
  esegui(contesto: ContestoRun, input: I): Promise<O>;
};
