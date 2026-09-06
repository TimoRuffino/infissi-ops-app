// Il tenant (azienda) sopra le sedi — WS1 (06/09/2026). Spec:
// docs/superpowers/specs/2026-09-06-ws1-fondazione-tenant-design.md

/** Ruffino Group. MUST stay 1: è il backfill di ogni utente e sede legacy. */
export const TENANT_PREDEFINITO_ID = 1;
export const TENANT_PREDEFINITO_SLUG = "ruffino-group";
export const TENANT_PREDEFINITO_NOME = "Ruffino Group";

export const RUOLO_PROPRIETARIO = "proprietario" as const;
export const CAPABILITY_PROPRIETARI = "tenant.manage_proprietari" as const;

export const INTERVALLO_COMANDI_MS = 30_000;

/** Minuscole, cifre, trattini interni; da 1 a 40 caratteri. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export const MESSAGGI = {
  portaChiusa: "L'azienda non è ancora attiva su questa installazione.",
  solaLettura: "Azienda sospesa: il gestionale è in sola lettura.",
  senzaSede: "L'azienda non ha una sede attiva.",
  soloProprietari: "Solo un proprietario può nominare o revocare un proprietario.",
  proprietarioRichiedeFlag: "Il ruolo proprietario richiede FLAG_MULTI_AZIENDA.",
  nonTrovato: "Risorsa non trovata.",
} as const;
