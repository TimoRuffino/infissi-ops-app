import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../_core/context";
import { getFeatureFlags } from "../platform/featureFlags";
import { comparePolicyDecision } from "./audit";
import type { Capability } from "./capabilities";
import { can, requireCapability, type PolicyResource } from "./policy";
import { getPolicyRepository } from "./repository";

export async function authorizeCoreOperation(input: {
  ctx: Pick<TrpcContext, "user" | "sedeId" | "sediIds">;
  endpoint: string;
  capability: Capability;
  resourceType: string;
  resource?: PolicyResource | null;
  // `"capability"`: anche in policyMode legacy/audit la decisione è quella
  // del motore (ruoli + override individuali). È il regime degli endpoint
  // economici (slice 2): la matrice vale identica in ogni modalità, e un
  // override per utente funziona senza aspettare `enforce`.
  legacyAllowed?: boolean | "capability";
}): Promise<void> {
  const sedeId = input.ctx.sedeId;
  const userId = input.ctx.user?.id;
  if (sedeId == null || userId == null) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Autenticazione richiesta." });
  }
  const flags = getFeatureFlags(sedeId);
  const overrides = await getPolicyRepository().listEffectiveOverrides({
    sedeId,
    userId,
    now: new Date(),
  });
  const policyInput = {
    user: {
      ...input.ctx.user,
      attivo: true,
      sediIds: input.ctx.sediIds,
    },
    capability: input.capability,
    resource: input.resource,
    activeSedeId: sedeId,
    overrides,
  };
  const proposed = can(policyInput);
  const seguiCapability = input.legacyAllowed === "capability";
  const legacyAllowed: boolean =
    input.legacyAllowed === "capability"
      ? proposed.allowed
      : (input.legacyAllowed ?? true);

  if (flags.policyMode === "audit") {
    await comparePolicyDecision({
      endpoint: input.endpoint,
      capability: input.capability,
      legacyAllowed,
      proposed,
      userId,
      sedeId,
      resourceType: input.resourceType,
    });
  }

  if (flags.policyMode === "enforce" || seguiCapability) {
    requireCapability(policyInput);
    return;
  }
  if (!legacyAllowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Operazione non consentita dal profilo corrente.",
    });
  }
}

/**
 * Le capability effettive dell'utente corrente (ruoli + override/deleghe
 * attivi), calcolate una volta per richiesta. Serve alle letture che devono
 * SAGOMARE il payload invece di rifiutarlo: i campi non autorizzati non
 * partono proprio (slice 2, decisioni 4-5). Nessun throw: fuori sessione la
 * risposta è l'insieme vuoto.
 */
export async function effectiveCapabilitySet(
  ctx: Pick<TrpcContext, "user" | "sedeId" | "sediIds">,
  capabilities: readonly Capability[]
): Promise<Set<Capability>> {
  const result = new Set<Capability>();
  const sedeId = ctx.sedeId;
  const userId = ctx.user?.id;
  if (sedeId == null || userId == null) return result;
  const overrides = await getPolicyRepository().listEffectiveOverrides({
    sedeId,
    userId,
    now: new Date(),
  });
  const user = { ...ctx.user, attivo: true, sediIds: ctx.sediIds };
  for (const capability of capabilities) {
    const decision = can({
      user,
      capability,
      activeSedeId: sedeId,
      overrides,
    });
    if (decision.allowed) result.add(capability);
  }
  return result;
}
