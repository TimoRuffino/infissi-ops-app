import { describe, expect, it } from "vitest";
import { comparePolicyDecision } from "./audit";
import { createMemoryPolicyRepository } from "./repository";

describe("policy decision audit", () => {
  it("salva solo differenze e metadati privacy-safe", async () => {
    const repository = createMemoryPolicyRepository();

    await comparePolicyDecision(
      {
        endpoint: "commesse.update",
        capability: "commessa.update_operational",
        legacyAllowed: true,
        proposed: {
          allowed: false,
          effect: "deny",
          code: "ownership_required",
          reason: "Testo non persistibile con dati della risorsa",
        },
        userId: 7,
        sedeId: 1,
        resourceType: "commessa",
        createdAt: new Date("2026-08-25T10:00:00Z"),
      },
      repository
    );
    await comparePolicyDecision(
      {
        endpoint: "clienti.create",
        capability: "cliente.create",
        legacyAllowed: true,
        proposed: {
          allowed: true,
          effect: "allow",
          code: "role_default",
          reason: "Questa decisione coincide e non va registrata",
        },
        userId: 7,
        sedeId: 1,
        resourceType: "cliente",
        createdAt: new Date("2026-08-25T10:01:00Z"),
      },
      repository
    );

    const records = await repository.listAuditDiffs({ sedeId: 1, days: 7 });
    expect(records).toEqual([
      expect.objectContaining({
        endpoint: "commesse.update",
        capability: "commessa.update_operational",
        legacyAllowed: true,
        proposedAllowed: false,
        proposedCode: "ownership_required",
        userId: 7,
        sedeId: 1,
        resourceType: "commessa",
      }),
    ]);
    expect(records[0]).not.toHaveProperty("reason");
    expect(records[0]).not.toHaveProperty("resource");
    expect(JSON.stringify(records[0])).not.toContain("Testo non persistibile");
  });
});
