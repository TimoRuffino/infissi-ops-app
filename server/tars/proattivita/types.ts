// Osservatore proattivo di Tars (T6) — tipi e contratti.
//
// L'osservatore CONSUMA i casi già riconciliati dal Centro Azioni: non
// esiste un secondo event mesh. Ogni osservazione è deduplicata per
// (sede, caso, detector, versione detector), con storico append-only,
// cooldown sull'auto-risoluzione e riapertura solo a evidenze nuove.
// I contenuti sono SEMPRE non economici: mai importi nelle sintesi.

import type {
  ActionPriority,
  ActionTargetType,
} from "../../actionCenter/types";

export const VERSIONE_DETECTOR = "1.0.0";

/** Cooldown dopo l'auto-risoluzione: la stessa evidenza non riapre subito. */
export const COOLDOWN_AUTO_RISOLUZIONE_MS = 6 * 60 * 60 * 1000;

export type MaterialitaOsservazione = "bassa" | "media" | "alta";
export type ConfidenzaOsservazione = "media" | "alta";
export type StatoOsservazione = "aperta" | "auto_risolta";

export type EventoOsservazione = {
  tipo: "aperta" | "aggiornata" | "auto_risolta" | "riaperta";
  fingerprint: string;
  at: Date;
};

export type NuovaOsservazione = {
  sedeId: number;
  /** canonicalKey del caso del Centro Azioni che l'ha generata. */
  casoKey: string;
  detector: string;
  detectorVersione: string;
  fingerprint: string;
  commessaId: number | null;
  targetType: ActionTargetType;
  targetId: number;
  titolo: string;
  sintesi: string;
  priorita: ActionPriority;
  materialita: MaterialitaOsservazione;
  confidenza: ConfidenzaOsservazione;
};

export type OsservazioneTars = NuovaOsservazione & {
  id: number;
  stato: StatoOsservazione;
  cooldownFinoA: Date | null;
  storico: EventoOsservazione[];
  apertaAt: Date;
  aggiornataAt: Date;
  risoltaAt: Date | null;
};

export type EsitoOsservazione = {
  aperte: number;
  aggiornate: number;
  invariate: number;
  riaperte: number;
  autoRisolte: number;
  scartatePerMaterialita: number;
};

export type ModalitaOsservatore = "shadow" | "active";

export function parseModalitaOsservatore(
  value: string | undefined
): ModalitaOsservatore {
  return value === "active" ? "active" : "shadow";
}
