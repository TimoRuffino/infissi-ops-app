/**
 * Identità dell'ambiente di deploy. NON è NODE_ENV: anche staging gira con
 * NODE_ENV=production, così i gate di sicurezza (JWT_SECRET obbligatoria,
 * BOOTSTRAP_ADMIN_PASSWORD obbligatoria) e i flag fail-closed restano attivi.
 * Fail-closed: qualunque valore diverso da "staging" — o l'assenza — vale
 * produzione. Nessun altro modulo legge process.env.AMBIENTE.
 */
export function ambienteStaging(): boolean {
  return (process.env.AMBIENTE ?? "").trim().toLowerCase() === "staging";
}
