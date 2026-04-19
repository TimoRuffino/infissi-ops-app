// Role helpers — single source of truth for client-side role gating. Mirrors
// the server-side RUOLI constant in server/routers/utenti.ts. Users carry
// `ruoli: string[]` (1–3 entries) plus a legacy `ruolo: string` primary,
// normalized server-side in localAuth.ts. The legacy boolean `role: "admin"`
// is honored as an implicit `direzione` for backward compat.

export type Ruolo =
  | "direzione"
  | "amministrazione"
  | "commerciale"
  | "tecnico_rilievi"
  | "squadra_posa"
  | "post_vendita"
  | "ordini";

type AuthUserShape = {
  ruoli?: unknown;
  ruolo?: unknown;
  role?: unknown;
} | null | undefined;

/** Return the normalized role list for a user (empty array if none). */
export function getRuoli(user: AuthUserShape): string[] {
  if (!user) return [];
  const arr = (user as any).ruoli;
  if (Array.isArray(arr) && arr.length > 0) return arr as string[];
  const single = (user as any).ruolo;
  if (typeof single === "string" && single) return [single];
  return [];
}

/** True when the user holds the given role. */
export function hasRuolo(user: AuthUserShape, r: Ruolo): boolean {
  return getRuoli(user).includes(r);
}

/**
 * True when the user can access direzione-only surfaces (hidden settings,
 * preventivatori, etc.). Accepts the legacy `role: "admin"` flag too so the
 * bootstrap admin never gets locked out before seed roles take effect.
 */
export function isDirezione(user: AuthUserShape): boolean {
  return hasRuolo(user, "direzione") || (user as any)?.role === "admin";
}
