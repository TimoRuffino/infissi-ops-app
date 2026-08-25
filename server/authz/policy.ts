import { TRPCError } from "@trpc/server";
import { capabilitiesForRoles, type Capability } from "./capabilities";

export type PolicyUser =
  | {
      id?: number | null;
      role?: string | null;
      ruolo?: string | null;
      ruoli?: string[] | null;
      sediIds?: number[] | null;
      attivo?: boolean | null;
    }
  | null
  | undefined;

export type PolicyResource = {
  sedeId?: number | null;
  createdBy?: number | null;
  assegnatoA?: number | null;
  ownerUserId?: number | null;
  sensitivity?: "operational" | "economic";
};

export type CapabilityOverride = {
  capability: Capability;
  effect: "allow" | "deny";
  sedeId: number;
  source: "override" | "delegation";
  startsAt?: Date | null;
  expiresAt?: Date | null;
};

export type PolicyDecision = {
  allowed: boolean;
  effect: "allow" | "deny" | "not_found";
  code:
    | "role_default"
    | "resource_owner"
    | "override_allow"
    | "override_deny"
    | "unauthenticated"
    | "user_inactive"
    | "active_sede_forbidden"
    | "sede_mismatch"
    | "economic_scope_required"
    | "ownership_required"
    | "capability_missing";
  reason: string;
};

export type PolicyInput = {
  user: PolicyUser;
  capability: Capability;
  resource?: PolicyResource | null;
  activeSedeId: number;
  overrides?: CapabilityOverride[];
  now?: Date;
};

const OWNERSHIP_REQUIRED = new Set<Capability>([
  "cliente.update_operational",
  "cliente.assign",
  "cliente.archive",
  "commessa.update_operational",
  "commessa.assign",
  "commessa.change_state",
  "commessa.manage_documents",
  "ticket.assign",
  "ticket.manage",
  "intervento.plan",
  "intervento.assign",
]);

function allow(code: PolicyDecision["code"], reason: string): PolicyDecision {
  return { allowed: true, effect: "allow", code, reason };
}

function deny(code: PolicyDecision["code"], reason: string): PolicyDecision {
  return { allowed: false, effect: "deny", code, reason };
}

function notFound(code: PolicyDecision["code"]): PolicyDecision {
  return {
    allowed: false,
    effect: "not_found",
    code,
    reason: "Risorsa non trovata.",
  };
}

function rolesFor(user: NonNullable<PolicyUser>): string[] {
  const roles = Array.isArray(user.ruoli) ? user.ruoli.filter(Boolean) : [];
  if (roles.length > 0) return roles;
  if (user.ruolo) return [user.ruolo];
  if (user.role === "admin") return ["direzione"];
  return [];
}

function isCurrentOverride(
  item: CapabilityOverride,
  capability: Capability,
  activeSedeId: number,
  now: Date
): boolean {
  if (item.capability !== capability || item.sedeId !== activeSedeId) return false;
  if (item.startsAt && item.startsAt.getTime() > now.getTime()) return false;
  if (item.expiresAt && item.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

function ownsResource(userId: number | null, resource: PolicyResource): boolean {
  if (userId == null) return false;
  return [resource.createdBy, resource.assegnatoA, resource.ownerUserId].includes(userId);
}

export function can(input: PolicyInput): PolicyDecision {
  const { user, capability, resource, activeSedeId } = input;
  if (!user) return deny("unauthenticated", "Autenticazione richiesta.");
  if (user.attivo === false) return deny("user_inactive", "Utente non attivo.");

  const sediIds = Array.isArray(user.sediIds) ? user.sediIds : [];
  if (sediIds.length > 0 && !sediIds.includes(activeSedeId)) {
    return notFound("active_sede_forbidden");
  }
  if (resource?.sedeId != null && resource.sedeId !== activeSedeId) {
    return notFound("sede_mismatch");
  }
  if (resource?.sensitivity === "economic" && !capability.startsWith("economia.") && !capability.startsWith("pagamento.")) {
    return deny(
      "economic_scope_required",
      "I campi economici richiedono una capacita dedicata."
    );
  }

  const now = input.now ?? new Date();
  const currentOverrides = (input.overrides ?? []).filter(item =>
    isCurrentOverride(item, capability, activeSedeId, now)
  );
  if (currentOverrides.some(item => item.effect === "deny")) {
    return deny("override_deny", "Una regola individuale nega questa operazione.");
  }
  const explicitlyAllowed = currentOverrides.some(item => item.effect === "allow");
  const roles = rolesFor(user);
  const direction = roles.includes("direzione");
  const roleAllowed = capabilitiesForRoles(roles).has(capability);
  if (!explicitlyAllowed && !roleAllowed) {
    return deny("capability_missing", "Capacita non assegnata all'utente.");
  }

  if (resource && OWNERSHIP_REQUIRED.has(capability) && !direction) {
    if (!ownsResource(user.id ?? null, resource)) {
      return deny(
        "ownership_required",
        "L'operazione richiede la proprieta o l'assegnazione della risorsa."
      );
    }
    return allow("resource_owner", "Utente proprietario o assegnatario della risorsa.");
  }

  if (explicitlyAllowed) {
    return allow("override_allow", "Una regola individuale consente questa operazione.");
  }
  return allow("role_default", "Capacita inclusa nel profilo del ruolo.");
}

export function requireCapability(input: PolicyInput): PolicyDecision {
  const decision = can(input);
  if (decision.allowed) return decision;
  if (decision.effect === "not_found") {
    throw new TRPCError({ code: "NOT_FOUND", message: decision.reason });
  }
  throw new TRPCError({ code: "FORBIDDEN", message: decision.reason });
}
