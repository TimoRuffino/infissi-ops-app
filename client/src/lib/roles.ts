// Role helpers — single source of truth for client-side role gating. Mirrors
// the server-side RUOLI constant in server/routers/utenti.ts. Users carry
// `ruoli: string[]` (1–3 entries) plus a legacy `ruolo: string` primary,
// normalized server-side in localAuth.ts. Gating is role-based only — any
// user with "direzione" in their `ruoli` list passes, regardless of whether
// they are the original admin user or one added later from Utenti.

export type Ruolo =
  | "direzione"
  | "amministrazione"
  | "commerciale"
  | "tecnico_rilievi"
  | "squadra_posa"
  | "post_vendita"
  | "ordini";

// Accept an unknown user shape — the `/auth/me` endpoint returns the full
// LocalUser from server/localAuth.ts which includes `ruoli: string[]`, but
// the tRPC-inferred client type may omit it depending on how the query is
// typed upstream. `unknown` keeps the helpers usable at any call site.

/** Return the normalized role list for a user (empty array if none). */
export function getRuoli(user: unknown): string[] {
  if (!user || typeof user !== "object") return [];
  const arr = (user as any).ruoli;
  if (Array.isArray(arr) && arr.length > 0) return arr as string[];
  const single = (user as any).ruolo;
  if (typeof single === "string" && single) return [single];
  return [];
}

/** True when the user holds the given role. */
export function hasRuolo(user: unknown, r: Ruolo): boolean {
  return getRuoli(user).includes(r);
}

/**
 * True when the user can access direzione-only surfaces (hidden settings,
 * preventivatori, etc.). Matches on the `direzione` role — no special
 * treatment for the admin user, so any utente with direzione among their
 * `ruoli` unlocks the same pages.
 */
export function isDirezione(user: unknown): boolean {
  return hasRuolo(user, "direzione");
}
