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
  legacyAllowed?: boolean;
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
  const legacyAllowed = input.legacyAllowed ?? true;

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

  if (flags.policyMode === "enforce") {
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
