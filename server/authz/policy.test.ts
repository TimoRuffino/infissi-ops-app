import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { requireDirezione } from "../_core/permissions";
import { setFeatureFlags } from "../platform/featureFlags";
import type { Capability } from "./capabilities";
import {
  can,
  requireCapability,
  type CapabilityOverride,
  type PolicyResource,
} from "./policy";

type TestUser = {
  id: number;
  role: "user" | "admin";
  ruoli: string[];
  sediIds: number[];
  attivo: boolean;
};

const activeSedeId = 1;

function user(ruoli: string[], patch: Partial<TestUser> = {}): TestUser {
  return {
    id: 7,
    role: ruoli.includes("direzione") ? "admin" : "user",
    ruoli,
    sediIds: [activeSedeId],
    attivo: true,
    ...patch,
  };
}

function resource(patch: Partial<PolicyResource> = {}): PolicyResource {
  return {
    sedeId: activeSedeId,
    createdBy: 7,
    assegnatoA: null,
    ...patch,
  };
}

describe("capability policy", () => {
  it.each<[string, TestUser, Capability]>([
    ["commerciale crea clienti", user(["commerciale"]), "cliente.create"],
    ["tecnico crea commesse", user(["tecnico_rilievi"]), "commessa.create"],
    ["posatore crea ticket", user(["squadra_posa"]), "ticket.create"],
    ["post vendita crea ticket", user(["post_vendita"]), "ticket.create"],
  ])("consente a un utente attivo della sede di %s", (_label, actor, capability) => {
    expect(can({ user: actor, capability, activeSedeId })).toMatchObject({
      allowed: true,
      effect: "allow",
      code: "role_default",
    });
  });

  it("consente modifiche operative al creatore o assegnatario", () => {
    expect(
      can({
        user: user(["commerciale"]),
        capability: "commessa.update_operational",
        resource: resource({ createdBy: 99, assegnatoA: 7 }),
        activeSedeId,
      })
    ).toMatchObject({ allowed: true, code: "resource_owner" });
  });

  it("nega modifiche operative sui record di altri utenti", () => {
    expect(
      can({
        user: user(["commerciale"]),
        capability: "commessa.update_operational",
        resource: resource({ createdBy: 98, assegnatoA: 99 }),
        activeSedeId,
      })
    ).toMatchObject({ allowed: false, effect: "deny", code: "ownership_required" });
  });

  it("non eredita accesso economico da una capability operativa", () => {
    expect(
      can({
        user: user(["commerciale"]),
        capability: "commessa.update_operational",
        resource: resource({ sensitivity: "economic" }),
        activeSedeId,
      })
    ).toMatchObject({ allowed: false, code: "economic_scope_required" });
  });

  it.each<[string, TestUser, Capability, boolean]>([
    ["commerciale non legge economia", user(["commerciale"]), "economia.read", false],
    ["amministrazione legge economia", user(["amministrazione"]), "economia.read", true],
    ["amministrazione registra pagamenti", user(["amministrazione"]), "pagamento.record", true],
    ["commerciale non elimina clienti", user(["commerciale"]), "cliente.delete", false],
    ["direzione elimina clienti", user(["direzione"]), "cliente.delete", true],
    ["direzione cambia stato", user(["direzione"]), "commessa.change_state", true],
  ])("applica il profilo ruolo: %s", (_label, actor, capability, allowed) => {
    expect(can({ user: actor, capability, activeSedeId }).allowed).toBe(allowed);
  });

  it("non rivela risorse di un'altra sede", () => {
    expect(
      can({
        user: user(["direzione"]),
        capability: "commessa.read",
        resource: resource({ sedeId: 2 }),
        activeSedeId,
      })
    ).toMatchObject({ allowed: false, effect: "not_found", code: "sede_mismatch" });
  });

  it("nega ogni capability a un utente inattivo", () => {
    expect(
      can({
        user: user(["direzione"], { attivo: false }),
        capability: "cliente.create",
        activeSedeId,
      })
    ).toMatchObject({ allowed: false, code: "user_inactive" });
  });

  it("ignora una delega scaduta", () => {
    const overrides: CapabilityOverride[] = [
      {
        capability: "economia.read",
        effect: "allow",
        sedeId: activeSedeId,
        source: "delegation",
        expiresAt: new Date("2026-08-24T10:00:00Z"),
      },
    ];

    expect(
      can({
        user: user(["commerciale"]),
        capability: "economia.read",
        activeSedeId,
        overrides,
        now: new Date("2026-08-25T10:00:00Z"),
      })
    ).toMatchObject({ allowed: false, code: "capability_missing" });
  });

  it("applica allow e deny validi senza superare il confine sede", () => {
    const validUntil = new Date("2026-08-26T10:00:00Z");
    const actor = user(["commerciale"]);

    expect(
      can({
        user: actor,
        capability: "intervento.plan",
        activeSedeId,
        overrides: [
          {
            capability: "intervento.plan",
            effect: "allow",
            sedeId: activeSedeId,
            source: "override",
            expiresAt: validUntil,
          },
        ],
        now: new Date("2026-08-25T10:00:00Z"),
      })
    ).toMatchObject({ allowed: true, code: "override_allow" });

    expect(
      can({
        user: actor,
        capability: "cliente.create",
        activeSedeId,
        overrides: [
          {
            capability: "cliente.create",
            effect: "deny",
            sedeId: activeSedeId,
            source: "override",
          },
        ],
      })
    ).toMatchObject({ allowed: false, code: "override_deny" });

    expect(
      can({
        user: actor,
        capability: "intervento.plan",
        activeSedeId,
        overrides: [
          {
            capability: "intervento.plan",
            effect: "allow",
            sedeId: 2,
            source: "override",
          },
        ],
      })
    ).toMatchObject({ allowed: false, code: "capability_missing" });
  });

  it("requireCapability traduce le decisioni in errori tRPC stabili", () => {
    expect(() =>
      requireCapability({
        user: user(["direzione"]),
        capability: "commessa.read",
        resource: resource({ sedeId: 2 }),
        activeSedeId,
      })
    ).toThrowError(TRPCError);

    try {
      requireCapability({
        user: user(["commerciale"]),
        capability: "economia.read",
        activeSedeId,
      });
    } catch (error) {
      expect(error).toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("mantiene il wrapper legacy finche la policy non e in enforce", () => {
    const sedeId = 88131;
    const actor = user(["commerciale"], { sediIds: [sedeId] });
    const policy = {
      capability: "tars.manage_policy" as const,
      activeSedeId: sedeId,
      overrides: [
        {
          capability: "tars.manage_policy" as const,
          effect: "allow" as const,
          sedeId,
          source: "override" as const,
        },
      ],
    };

    expect(() => requireDirezione(actor, policy)).toThrowError(TRPCError);

    setFeatureFlags(
      sedeId,
      { policyMode: "enforce" },
      { actorUserId: 1, reason: "Test rollout policy" }
    );

    expect(() => requireDirezione(actor, policy)).not.toThrow();
  });
});
