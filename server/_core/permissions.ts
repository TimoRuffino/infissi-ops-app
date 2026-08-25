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
import {
  requireCapability as requireCapabilityPolicy,
  type PolicyInput,
} from "../authz/policy";
import { getFeatureFlags } from "../platform/featureFlags";

export type AnyUser =
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

type SedeScopedRecord = { sedeId?: number | null } | null | undefined;

type LegacyPolicyInput = Omit<PolicyInput, "user">;

function enforceCapabilityWhenEnabled(
  user: AnyUser,
  policy?: LegacyPolicyInput
): boolean {
  if (!policy || getFeatureFlags(policy.activeSedeId).policyMode !== "enforce") {
    return false;
  }
  requireCapabilityPolicy({ ...policy, user });
  return true;
}

/**
 * Enforce that a record belongs to the request's active sede.
 *
 * Multi-sede isolation: every business endpoint resolves data by global id,
 * so without this check a user in sede A could read or mutate sede B's
 * records by guessing ids (cross-tenant IDOR). We throw NOT_FOUND — not
 * FORBIDDEN — on a sede mismatch so the response can't be used as an oracle
 * to confirm that an id exists in another sede.
 *
 * `sedeId` is the resolved ctx.sedeId. When null (should not happen on a
 * protectedProcedure) the check is skipped to avoid hard-failing.
 */
export function assertSedeScope(
  record: SedeScopedRecord,
  sedeId: number | null
): void {
  if (!record) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Risorsa non trovata." });
  }
  if (sedeId == null) return;
  if ((record as any).sedeId !== sedeId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Risorsa non trovata." });
  }
}

/** True when the user holds the `direzione` role (or legacy admin flag). */
export function isDirezione(user: AnyUser): boolean {
  if (!user) return false;
  if ((user.role ?? "") === "admin") return true;
  const ruoli = Array.isArray(user.ruoli) ? user.ruoli : [];
  return ruoli.includes("direzione");
}

/** True when the user holds the `amministrazione` role. */
export function isAmministrazione(user: AnyUser): boolean {
  const ruoli = Array.isArray(user?.ruoli) ? user!.ruoli! : [];
  return ruoli.includes("amministrazione");
}

/**
 * Economic surfaces (margini, costi fornitore): direzione or amministrazione
 * only — a commerciale or posatore must not see the company's margins.
 */
export function requireDirezioneOAmministrazione(
  user: AnyUser,
  policy?: LegacyPolicyInput
): void {
  if (enforceCapabilityWhenEnabled(user, policy)) return;
  if (!isDirezione(user) && !isAmministrazione(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Solo direzione o amministrazione possono vedere i dati economici.",
    });
  }
}

/** Throws FORBIDDEN unless the user is direzione. */
export function requireDirezione(
  user: AnyUser,
  policy?: LegacyPolicyInput
): void {
  if (enforceCapabilityWhenEnabled(user, policy)) return;
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
  user: AnyUser,
  policy?: LegacyPolicyInput
): void {
  if (!record) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Risorsa non trovata.",
    });
  }
  if (
    policy &&
    enforceCapabilityWhenEnabled(user, {
      ...policy,
      resource: policy.resource ?? record,
    })
  ) {
    return;
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

export { requireCapability } from "../authz/policy";
export type {
  CapabilityOverride,
  PolicyDecision,
  PolicyResource,
} from "../authz/policy";
export type { Capability } from "../authz/capabilities";
