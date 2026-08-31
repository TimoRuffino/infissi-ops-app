import type { z } from "zod";
import type { Capability } from "../../authz/capabilities";
import type { Interruttore } from "../../platform/interruttori";
import type {
  IntentoTars,
  LivelloRischio,
  StrumentoTars,
  SuperficieTars,
  TipoEntitaTars,
} from "../strumenti/tipi";

/** Classificazione operativa distinta dal contratto storico L0-L4. */
export type RischioAzioneTars = "R0" | "R1" | "R2" | "R3" | "R4";
export type ScopeAzioneTars = "personale" | "sede" | "entita";

export type DescrittoreAzioneTars = {
  nome: string;
  versioneRegistro: string;
  versioneStrumento: string;
  /** Campo storico: resta compatibile e non viene derivato dal rischio R. */
  livello: LivelloRischio;
  rischio: RischioAzioneTars;
  capability: readonly Capability[];
  scope: ScopeAzioneTars;
  schemaRisultato: z.ZodType;
  prerequisiti: {
    direzione: boolean;
    superfici: readonly SuperficieTars[];
    intenti: readonly IntentoTars[];
    entita: readonly TipoEntitaTars[];
  };
  idempotenza: {
    strategia: "non_applicabile" | "dominio" | "chiave_obbligatoria";
    fonte: string;
  };
  audit: { richiesto: boolean; fonte: string };
  compensazione: {
    disponibile: boolean;
    via: "nessuna" | "dominio" | "gateway";
  };
  interruttori: readonly Interruttore[];
  timeoutMs: number;
  costo: {
    unita: "operazione";
    massimo: number;
    classe: "trascurabile" | "basso" | "medio";
  };
  /** Ammesso solo quando i selettori non individuano alcun profilo. */
  fallbackSicuro: boolean;
  strumento: StrumentoTars;
};
