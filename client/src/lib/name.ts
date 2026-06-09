// Display-name convention (global): "Cognome Nome".
// Use everywhere a person (cliente / utente / referente) is shown by name.
export function personName(
  p: { nome?: string | null; cognome?: string | null } | null | undefined,
  fallback = ""
): string {
  if (!p) return fallback;
  return `${p.cognome ?? ""} ${p.nome ?? ""}`.trim() || fallback;
}
