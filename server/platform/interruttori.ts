// Kill switch della Document Intelligence (release hardening, 29/08/2026).
//
// Tre interruttori indipendenti via variabili d'ambiente, letti a OGNI
// chiamata (nessuna cache: un restart con l'env cambiata basta, e i test
// li commutano direttamente):
//
//   FLAG_DOCUMENT_INTELLIGENCE  analisi conferme + collegamento assistito
//   FLAG_PROPOSTE               approval gateway (genera/approva/applica…)
//   FLAG_OCR                    fallback OCR locale nel registro parser
//
// Default FAIL-CLOSED: attivi SOLO con NODE_ENV development/test; in
// produzione, in staging o con NODE_ENV assente sono spenti. Valori accettati: on/true/1 e off/false/0;
// qualunque altro valore ricade sul default d'ambiente. Il confine è il
// SERVER: ogni endpoint verifica il proprio interruttore e la UI si limita
// a nascondere le superfici spente. Rollout e rollback:
// docs/runbooks/rollout-document-intelligence.md.

import { TRPCError } from "@trpc/server";

export type Interruttore = "documentIntelligence" | "proposte" | "ocr";

const VARIABILE: Record<Interruttore, string> = {
  documentIntelligence: "FLAG_DOCUMENT_INTELLIGENCE",
  proposte: "FLAG_PROPOSTE",
  ocr: "FLAG_OCR",
};

const ETICHETTA: Record<Interruttore, string> = {
  documentIntelligence: "La Document Intelligence (analisi conferme e collegamento documenti)",
  proposte: "L'approval gateway delle proposte documentali",
  ocr: "L'OCR locale",
};

const VALORI_ON = new Set(["on", "true", "1", "attivo", "si"]);
const VALORI_OFF = new Set(["off", "false", "0", "spento", "no"]);

export function interruttoreAttivo(nome: Interruttore): boolean {
  const grezzo = process.env[VARIABILE[nome]]?.trim().toLowerCase();
  if (grezzo && VALORI_ON.has(grezzo)) return true;
  if (grezzo && VALORI_OFF.has(grezzo)) return false;
  // FAIL CLOSED (revisione): il default è acceso SOLO negli ambienti di
  // lavoro dichiarati. Un NODE_ENV assente, «staging» o scritto male vale
  // produzione: tutto spento finché un flag non dice il contrario.
  return (
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
  );
}

/** Stato complessivo per la UI (che nasconde, ma non è mai il confine). */
export function statoInterruttori(): Record<Interruttore, boolean> {
  return {
    documentIntelligence: interruttoreAttivo("documentIntelligence"),
    proposte: interruttoreAttivo("proposte"),
    ocr: interruttoreAttivo("ocr"),
  };
}

/**
 * Guardia degli endpoint: con l'interruttore spento la chiamata muore qui,
 * qualunque sia il ruolo o la capability del chiamante — un kill switch
 * non si aggira dall'API.
 */
export function assicuraInterruttore(nome: Interruttore): void {
  if (interruttoreAttivo(nome)) return;
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `${ETICHETTA[nome]} è disattivata su questa installazione (${VARIABILE[nome]}).`,
  });
}
