import { Circle } from "lucide-react";
import { describe, expect, it } from "vitest";

import {
  DOCUMENT_INTELLIGENCE_DECISION_CAPABILITIES,
  type MenuItem,
  type NavigationAccess,
  isNavigationItemVisible,
  menuItems,
  navigationDestinations,
  navigationGroups,
  navigationItemState,
  produzioneRedirect,
} from "./navigation";

function access(overrides: Partial<NavigationAccess> = {}): NavigationAccess {
  return {
    user: { ruoli: ["commerciale"] },
    capabilities: new Set(),
    flags: { tars: true },
    capabilityStatus: "resolved",
    ...overrides,
  };
}

function itemAt(path: string): MenuItem {
  const item = menuItems
    .flatMap(entry => entry.children ?? [entry])
    .find(entry => entry.path === path);
  if (!item) throw new Error(`Voce di navigazione mancante: ${path}`);
  return item;
}

function destinationPaths(currentAccess: NavigationAccess): string[] {
  return navigationDestinations(currentAccess).map(item => item.path);
}

describe("navigationItemState", () => {
  it("opens a group for its active child without activating the parent", () => {
    expect(
      navigationItemState("/messaggi/email", "/messaggi/email", [
        "/messaggi/email",
        "/messaggi/whatsapp",
      ])
    ).toEqual({ active: false, containsActiveChild: true });
  });

  it("activates a matching leaf item", () => {
    expect(navigationItemState("/chat", "/chat", [])).toEqual({
      active: true,
      containsActiveChild: false,
    });
  });
});

describe("produzioneRedirect", () => {
  it("manda la vecchia route al Board, qualunque sia il resto dell'URL", () => {
    expect(produzioneRedirect("/produzione")).toBe("/kanban");
    expect(produzioneRedirect("/produzione?tab=bom")).toBe("/kanban");
    expect(produzioneRedirect("/produzione/qualcosa")).toBe("/kanban");
  });
});

describe("effective-capability navigation matrix", () => {
  it("composes a multi-role principal from the resolved effective set", () => {
    const paths = destinationPaths(
      access({
        user: { ruoli: ["commerciale", "amministrazione"] },
        capabilities: new Set([
          "cliente.read",
          "commessa.read",
          "pagamento.read",
        ]),
      })
    );

    expect(paths).toEqual(
      expect.arrayContaining(["/clienti", "/commesse", "/kanban", "/pagamenti"])
    );
    expect(paths).not.toContain("/economia");
  });

  it("shows Pagamenti to an override-only principal with pagamento.read", () => {
    const commerciale = { ruoli: ["commerciale"] };

    expect(
      isNavigationItemVisible(
        itemAt("/pagamenti"),
        access({ user: commerciale, capabilities: new Set() })
      )
    ).toBe(false);
    expect(
      isNavigationItemVisible(
        itemAt("/pagamenti"),
        access({
          user: commerciale,
          capabilities: new Set(["pagamento.read"]),
        })
      )
    ).toBe(true);
  });

  it("requires both effective capabilities for a Document Intelligence decision", () => {
    const decision: MenuItem = {
      icon: Circle,
      label: "Decisioni Document Intelligence",
      path: "/fornitori?tab=proposte",
      requiredCapabilities: DOCUMENT_INTELLIGENCE_DECISION_CAPABILITIES,
    };
    const overrideOnly = { ruoli: ["commerciale"] };

    expect(
      isNavigationItemVisible(
        decision,
        access({
          user: overrideOnly,
          capabilities: new Set([
            "documento.approve_proposals",
            "fornitore.manage_ordini",
          ]),
        })
      )
    ).toBe(true);
    expect(
      isNavigationItemVisible(
        decision,
        access({
          user: overrideOnly,
          capabilities: new Set(["documento.approve_proposals"]),
        })
      )
    ).toBe(false);
  });

  it("honours an effective deny even for a normally allowed role", () => {
    const amministrazioneWithoutEconomicCapabilities = access({
      user: { ruoli: ["amministrazione"] },
      capabilities: new Set(["cliente.read", "commessa.read"]),
    });

    expect(
      isNavigationItemVisible(
        itemAt("/pagamenti"),
        amministrazioneWithoutEconomicCapabilities
      )
    ).toBe(false);
    expect(
      isNavigationItemVisible(
        itemAt("/economia"),
        amministrazioneWithoutEconomicCapabilities
      )
    ).toBe(false);
  });

  it("uses only the effective set, so expired delegations grant nothing", () => {
    const noLongerDelegated = access({
      user: { ruoli: ["ordini"] },
      capabilities: new Set(["documento.approve_proposals"]),
    });
    const decision: MenuItem = {
      icon: Circle,
      label: "Applica proposta ordine",
      path: "/fornitori?tab=proposte",
      requiredCapabilities: DOCUMENT_INTELLIGENCE_DECISION_CAPABILITIES,
    };

    expect(isNavigationItemVisible(decision, noLongerDelegated)).toBe(false);
  });

  it("requires both tars.use and the server flag for Tars", () => {
    const tars = itemAt("/tars");
    const withCapability = access({
      capabilities: new Set(["tars.use"]),
    });

    expect(
      isNavigationItemVisible(tars, {
        ...withCapability,
        flags: { tars: false },
      })
    ).toBe(false);
    expect(
      isNavigationItemVisible(
        tars,
        access({ capabilities: new Set(), flags: { tars: true } })
      )
    ).toBe(false);
    expect(isNavigationItemVisible(tars, withCapability)).toBe(true);
  });

  it("keeps genuinely role-only routes limited to direzione", () => {
    const utenti = itemAt("/utenti");

    expect(
      isNavigationItemVisible(
        utenti,
        access({
          user: { ruoli: ["commerciale", "direzione"] },
          capabilities: new Set(),
        })
      )
    ).toBe(true);
    expect(
      isNavigationItemVisible(
        utenti,
        access({ user: { ruoli: ["amministrazione"] } })
      )
    ).toBe(false);
  });

  it("does not expose economic destinations after a resolved empty response", () => {
    const paths = destinationPaths(
      access({
        user: { ruoli: ["direzione", "amministrazione"] },
        capabilities: new Set(),
        capabilityStatus: "resolved",
      })
    );

    expect(paths).not.toContain("/economia");
    expect(paths).not.toContain("/pagamenti");
  });

  it("uses explicit loading fallbacks without exposing Economy or Tars", () => {
    const loading = access({
      user: { ruoli: ["amministrazione"] },
      capabilities: null,
      capabilityStatus: "loading",
      flags: { tars: true },
    });
    const paths = destinationPaths(loading);

    expect(paths).toEqual(expect.arrayContaining(["/clienti", "/commesse"]));
    expect(paths).not.toContain("/economia");
    expect(paths).not.toContain("/tars");
  });

  it("removes empty groups and returns only their visible children", () => {
    const groups = navigationGroups(
      access({ capabilities: new Set(["cliente.read"]) })
    );
    const economia = groups.find(group => group.label === "Economia");
    const commesse = groups.find(group => group.label === "Commesse");

    expect(economia).toBeUndefined();
    expect(commesse?.children?.map(item => item.path)).toEqual([
      "/preventivatori",
    ]);
  });
});
