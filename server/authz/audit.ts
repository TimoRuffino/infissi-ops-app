import type { Capability } from "./capabilities";
import type { PolicyDecision } from "./policy";
import {
  getPolicyRepository,
  type PolicyRepository,
} from "./repository";

export async function comparePolicyDecision(
  input: {
    endpoint: string;
    capability: Capability;
    legacyAllowed: boolean;
    proposed: PolicyDecision;
    userId: number;
    sedeId: number;
    resourceType: string;
    createdAt?: Date;
  },
  repository: PolicyRepository = getPolicyRepository()
): Promise<void> {
  if (input.legacyAllowed === input.proposed.allowed) return;
  await repository.recordAuditDiff({
    sedeId: input.sedeId,
    endpoint: input.endpoint,
    capability: input.capability,
    legacyAllowed: input.legacyAllowed,
    proposedAllowed: input.proposed.allowed,
    proposedEffect: input.proposed.effect,
    proposedCode: input.proposed.code,
    userId: input.userId,
    resourceType: input.resourceType,
    createdAt: input.createdAt ?? new Date(),
  });
}
