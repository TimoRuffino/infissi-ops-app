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

export type Interruttore =
  | "documentIntelligence"
  | "proposte"
  | "ocr"
  // Tars v2 (T1+): master + funzioni. Il master spento vince su tutto:
  // nessuna istanza del provider, router muto, UI nascosta.
  | "tars"
  | "tarsReadTools"
  | "tarsReminders"
  | "tarsL2Actions"
  | "tarsProposals"
  | "tarsProactive"
  | "tarsPatterns"
  | "tarsImprovements"
  | "tarsCommunications"
  | "tarsMemory"
  | "tarsSemanticSearch"
  // Smistamento comunicazioni in background (02/09/2026): triage,
  // collegamenti certi, archiviazione allegati, proposte a un click.
  | "tarsSmistamento"
  // Analisi azienda giornaliera (02/09/2026): fotografia deterministica +
  // sintesi del modello, proposte eseguibili solo chiedendolo a Tars.
  | "tarsAnalisiAzienda"
  // Modular Control / Borgogna Operativa (31/08/2026): governa solo la
  // generazione visuale del client. Nessun percorso server dipende dal flag.
  | "uiV2"
  // Contratto strutturato e computo limiti DM MITE (03/09/2026): tab
  // Contratto/Limiti, gate sulla transizione verso «Fatture pagamento».
  | "limiti"
  // Fatturazione dal contratto (piano 2, 04/09/2026): bozza, emissione FiC, sonda SdI
  | "fatturazione";

const VARIABILE: Record<Interruttore, string> = {
  documentIntelligence: "FLAG_DOCUMENT_INTELLIGENCE",
  proposte: "FLAG_PROPOSTE",
  ocr: "FLAG_OCR",
  tars: "FLAG_TARS",
  tarsReadTools: "FLAG_TARS_READ_TOOLS",
  tarsReminders: "FLAG_TARS_REMINDERS",
  tarsL2Actions: "FLAG_TARS_L2_ACTIONS",
  tarsProposals: "FLAG_TARS_PROPOSALS",
  tarsProactive: "FLAG_TARS_PROACTIVE",
  tarsPatterns: "FLAG_TARS_PATTERNS",
  tarsImprovements: "FLAG_TARS_IMPROVEMENTS",
  tarsCommunications: "FLAG_TARS_COMMUNICATIONS",
  tarsMemory: "FLAG_TARS_MEMORY",
  tarsSemanticSearch: "FLAG_TARS_SEMANTIC_SEARCH",
  tarsSmistamento: "FLAG_TARS_SMISTAMENTO",
  tarsAnalisiAzienda: "FLAG_TARS_ANALISI_AZIENDA",
  uiV2: "FLAG_UI_V2",
  limiti: "FLAG_LIMITI",
  fatturazione: "FLAG_FATTURAZIONE",
};

const ETICHETTA: Record<Interruttore, string> = {
  documentIntelligence:
    "La Document Intelligence (analisi conferme e collegamento documenti)",
  proposte: "L'approval gateway delle proposte documentali",
  ocr: "L'OCR locale",
  tars: "Tars",
  tarsReadTools: "Gli strumenti di lettura di Tars",
  tarsReminders: "I promemoria via Tars",
  tarsL2Actions: "Le azioni operative leggere (L2) di Tars",
  tarsProposals: "Le proposte via Tars",
  tarsProactive: "La proattività di Tars",
  tarsPatterns: "I pattern aziendali (Panorama) di Tars",
  tarsImprovements: "Le proposte di miglioramento di Tars",
  tarsCommunications: "Le bozze di comunicazione di Tars",
  tarsMemory: "La memoria di Tars",
  tarsSemanticSearch: "La ricerca semantica di Tars",
  tarsSmistamento: "Lo smistamento automatico delle comunicazioni di Tars",
  tarsAnalisiAzienda: "L'analisi giornaliera dell'azienda di Tars",
  uiV2: "L'interfaccia Modular Control / Borgogna Operativa",
  limiti: "Il contratto strutturato e il computo dei limiti di spesa",
  fatturazione:
    "La fatturazione dal contratto (bozza, emissione su Fatture in Cloud, stati SdI)",
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
  const stato = {} as Record<Interruttore, boolean>;
  for (const nome of Object.keys(VARIABILE) as Interruttore[]) {
    stato[nome] = interruttoreAttivo(nome);
  }
  return stato;
}

/**
 * Le funzioni di Tars richiedono il master E il proprio interruttore:
 * `FLAG_TARS=off` spegne tutto qualunque sia il resto (fail-closed).
 */
export function tarsAttivo(
  funzione?: Exclude<
    Interruttore,
    | "documentIntelligence"
    | "proposte"
    | "ocr"
    | "uiV2"
    | "limiti"
    | "fatturazione"
  >
): boolean {
  if (!interruttoreAttivo("tars")) return false;
  if (!funzione || funzione === "tars") return true;
  return interruttoreAttivo(funzione);
}

export function assicuraTars(
  funzione?: Exclude<
    Interruttore,
    | "documentIntelligence"
    | "proposte"
    | "ocr"
    | "uiV2"
    | "limiti"
    | "fatturazione"
  >
): void {
  assicuraInterruttore("tars");
  if (funzione && funzione !== "tars") assicuraInterruttore(funzione);
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
