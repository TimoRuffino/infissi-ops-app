// Regole DETERMINISTICHE dell'osservatore (T6): da un caso del Centro
// Azioni a un'osservazione candidata. Zero token, zero modello: solo i
// segnali reali già riconciliati. La materialità filtra il rumore; le
// sintesi non contengono mai importi, qualunque cosa arrivi dai titoli.

import type { ActionCaseDraft } from "../../actionCenter/types";
import {
  VERSIONE_DETECTOR,
  type ConfidenzaOsservazione,
  type MaterialitaOsservazione,
  type NuovaOsservazione,
} from "./types";

// Qualsiasi cifra con separatori/valuta viene oscurata: il floor non
// economico dell'osservatore vale anche se una fonte scrive un importo nel
// titolo. I numeri corti (id, giorni, quantità) restano leggibili.
const PATTERN_IMPORTO =
  /(?:€|\beur(?:o|i)?\b)\s*\d[\d.,]*|\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})?\s*(?:€|\beur(?:o|i)?\b)?|\d+[.,]\d{2}\s*(?:€|\beur(?:o|i)?\b)|\d+\s*(?:€|\beur(?:o|i)?\b)/gi;

export function senzaImporti(testo: string): string {
  return testo.replace(PATTERN_IMPORTO, "[importo riservato]");
}

function materialita(draft: ActionCaseDraft): MaterialitaOsservazione | null {
  if (draft.priority === "critica") return "alta";
  if (draft.priority === "alta") return "media";
  // I casi a priorità normale entrano solo quando il punteggio indica una
  // situazione che sta maturando: sotto soglia sono rumore per l'osservatore
  // (restano comunque visibili nel Centro Azioni, che è la fonte).
  return draft.priorityScore >= 40 ? "bassa" : null;
}

function confidenza(draft: ActionCaseDraft): ConfidenzaOsservazione {
  // Fonti deterministiche: la confidenza cresce quando più segnali
  // indipendenti convergono sullo stesso caso.
  return draft.signals.length >= 2 ? "alta" : "media";
}

/**
 * Deriva l'osservazione candidata da un caso riconciliato, o null quando il
 * caso non è materiale per l'osservatore.
 */
export function derivaOsservazione(
  draft: ActionCaseDraft
): NuovaOsservazione | null {
  const livello = materialita(draft);
  if (!livello) return null;
  return {
    sedeId: draft.sedeId,
    casoKey: draft.canonicalKey,
    detector: draft.nextAction.sourceKind,
    detectorVersione: VERSIONE_DETECTOR,
    fingerprint: draft.signalFingerprint,
    commessaId: draft.commessaId,
    targetType: draft.targetType,
    targetId: draft.targetId,
    titolo: senzaImporti(draft.title).slice(0, 200),
    sintesi: senzaImporti(
      `${draft.title} — prossima azione: ${draft.nextAction.label}`
    ).slice(0, 400),
    priorita: draft.priority,
    materialita: livello,
    confidenza: confidenza(draft),
  };
}
