// Single source of truth for commessa-state presentation (redesign §2.1).
// Sentence case labels, palette classes (tokens from index.css), and the
// "needs code to delete" rule (§3.6: steps beyond produzione).

export const STATI_ORDER = [
  "preventivo",
  "misure_esecutive",
  "aggiornamento_contratto",
  "fatture_pagamento",
  "da_ordinare",
  "produzione",
  "ordini_ultimazione",
  "attesa_posa",
  "finiture_saldo",
  "interventi_regolazioni",
  "archiviata",
] as const;

export type StatoCommessa = (typeof STATI_ORDER)[number];

// Sentence case — never UPPERCASE, never all-lowercase (§2).
export const STATO_LABEL: Record<string, string> = {
  preventivo: "Preventivo",
  misure_esecutive: "Misure esecutive",
  aggiornamento_contratto: "Aggiornamento contratto",
  fatture_pagamento: "Fatture / Pagamento",
  da_ordinare: "Da ordinare",
  produzione: "Produzione",
  ordini_ultimazione: "Richiesta secondo acconto",
  attesa_posa: "Attesa posa",
  finiture_saldo: "Finiture / Saldo",
  interventi_regolazioni: "Interventi / Regolazioni",
  archiviata: "Archiviata",
};

export function statoLabel(stato: string): string {
  return STATO_LABEL[stato] ?? stato.replace(/_/g, " ");
}

// Chip classes (text + soft bg) from the §2.1 palette. The 11 states map onto
// the 7 named buckets without introducing new colors.
export const STATO_CHIP: Record<string, string> = {
  preventivo: "text-st-preventivo bg-st-preventivo-soft",
  misure_esecutive: "text-st-misure bg-st-misure-soft",
  aggiornamento_contratto: "text-st-contratto bg-st-contratto-soft",
  fatture_pagamento: "text-st-pagamento bg-st-pagamento-soft",
  da_ordinare: "text-st-ordine bg-st-ordine-soft",
  produzione: "text-st-produzione bg-st-produzione-soft",
  ordini_ultimazione: "text-st-produzione bg-st-produzione-soft",
  attesa_posa: "text-st-produzione bg-st-produzione-soft",
  finiture_saldo: "text-st-pagamento bg-st-pagamento-soft",
  interventi_regolazioni: "text-st-chiusura bg-st-chiusura-soft",
  archiviata: "text-st-chiusura bg-st-chiusura-soft",
};

export function statoChipClass(stato: string): string {
  return STATO_CHIP[stato] ?? "text-st-chiusura bg-st-chiusura-soft";
}

// Variabile CSS del colore pieno della famiglia (per rail, segmenti e
// grafici). Stessa mappa famiglie di STATO_CHIP: mai colori nuovi.
export const STATO_COLOR_VAR: Record<string, string> = {
  preventivo: "var(--color-st-preventivo)",
  misure_esecutive: "var(--color-st-misure)",
  aggiornamento_contratto: "var(--color-st-contratto)",
  fatture_pagamento: "var(--color-st-pagamento)",
  da_ordinare: "var(--color-st-ordine)",
  produzione: "var(--color-st-produzione)",
  ordini_ultimazione: "var(--color-st-produzione)",
  attesa_posa: "var(--color-st-produzione)",
  finiture_saldo: "var(--color-st-pagamento)",
  interventi_regolazioni: "var(--color-st-chiusura)",
  archiviata: "var(--color-st-chiusura)",
};

export function statoColorVar(stato: string): string {
  return STATO_COLOR_VAR[stato] ?? "var(--color-st-chiusura)";
}

// Priorità → Badge variant (§2.2).
export const PRIORITA_VARIANT: Record<string, "danger" | "warning" | "info" | "secondary"> = {
  urgente: "danger",
  alta: "warning",
  media: "info",
  bassa: "secondary",
};

export const PRIORITA_LABEL: Record<string, string> = {
  urgente: "Urgente",
  alta: "Alta",
  media: "Media",
  bassa: "Bassa",
};

// §3.6: commesse beyond step 5 (in produzione / pagamenti onward) require
// typing the code to confirm a hard delete.
export function requiresCodeToDelete(stato: string): boolean {
  const idx = STATI_ORDER.indexOf(stato as StatoCommessa);
  return idx >= STATI_ORDER.indexOf("produzione");
}
