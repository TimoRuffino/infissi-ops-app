// Human-readable labels for commessa stato (board column) IDs.
// Kept in /shared so both client (KanbanBoard) and server (upload rename)
// can reference a single source of truth.

export const STATO_LABELS: Record<string, string> = {
  preventivo: "Preventivo",
  misure_esecutive: "Misure Esecutive",
  aggiornamento_contratto: "Aggiornamento Contratto",
  fatture_pagamento: "Fatture Pagamento",
  da_ordinare: "Da Ordinare",
  produzione: "Produzione",
  ordini_ultimazione: "Richiesta Secondo Acconto",
  attesa_posa: "Attesa Posa",
  finiture_saldo: "Finiture Saldo",
  interventi_regolazioni: "Interventi Regolazioni",
};

export function statoLabel(stato: string | null | undefined): string {
  if (!stato) return "";
  return STATO_LABELS[stato] ?? stato;
}

// Build auto-rename for a file uploaded inside a commessa board stato.
// Pattern: "{stato label} {cliente}.{ext}" — e.g.
//   "Misure Esecutive Andrea Chirenti.pdf"
// Falls back to the original filename if we lack the context (no stato or
// no cliente) so an upload never ends up with an empty name.
export function renameForStato(params: {
  originalName: string;
  stato: string | null | undefined;
  cliente: string | null | undefined;
}): string {
  const { originalName } = params;
  const label = statoLabel(params.stato);
  const cliente = (params.cliente ?? "").trim();

  // Extract extension (everything after the LAST dot, if any).
  const dotIdx = originalName.lastIndexOf(".");
  const ext =
    dotIdx > 0 && dotIdx < originalName.length - 1
      ? originalName.slice(dotIdx + 1)
      : "";

  if (!label || !cliente) return originalName;

  const base = `${label} ${cliente}`;
  // Strip characters that cause trouble in filenames across OSes and in
  // Content-Disposition headers. Collapse whitespace runs.
  const safe = base
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return ext ? `${safe}.${ext}` : safe;
}
