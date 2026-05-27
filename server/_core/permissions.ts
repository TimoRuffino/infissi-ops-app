// Server-side authorization helpers — used on top of `protectedProcedure`
// to enforce per-record ownership or the `direzione` admin role.
//
// Threat model: every endpoint is already authenticated (protectedProcedure),
// so anyone hitting these helpers is a logged-in employee. The remaining
// risk is INSIDER misuse — a commerciale deleting another commerciale's
// commessa, or scripting a download of every uploaded contract. These
// helpers narrow destructive operations to either the resource owner or a
// direzione user.

import { TRPCError } from "@trpc/server";

type AnyUser =
  | {
      id?: number | null;
      role?: string | null;
      ruoli?: string[] | null;
    }
  | null
  | undefined;

type OwnedRecord =
  | {
      createdBy?: number | null;
      assegnatoA?: number | null;
    }
  | null
  | undefined;

/** True when the user holds the `direzione` role (or legacy admin flag). */
export function isDirezione(user: AnyUser): boolean {
  if (!user) return false;
  if ((user.role ?? "") === "admin") return true;
  const ruoli = Array.isArray(user.ruoli) ? user.ruoli : [];
  return ruoli.includes("direzione");
}

/** Throws FORBIDDEN unless the user is direzione. */
export function requireDirezione(user: AnyUser): void {
  if (!isDirezione(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Solo la direzione può eseguire questa operazione.",
    });
  }
}

/**
 * Allow the operation when the user is direzione OR the resource's
 * `createdBy` / `assegnatoA` matches the user. Throws NOT_FOUND when the
 * record is null/undefined (so callers can pass the result of a `find`
 * directly) and FORBIDDEN otherwise.
 */
export function requireOwnershipOrDirezione(
  record: OwnedRecord,
  user: AnyUser
): void {
  if (!record) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Risorsa non trovata.",
    });
  }
  if (isDirezione(user)) return;
  const uid = user?.id ?? null;
  if (
    uid != null &&
    (record.createdBy === uid || record.assegnatoA === uid)
  ) {
    return;
  }
  throw new TRPCError({
    code: "FORBIDDEN",
    message:
      "Operazione non consentita: non sei il proprietario di questa risorsa.",
  });
}
