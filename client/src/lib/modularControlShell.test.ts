import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const COMPONENTS = new URL("../components/", import.meta.url);

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, COMPONENTS), "utf8");
}

describe("Modular Control shell boundary", () => {
  it("selects exactly one shell renderer from the centralized UI generation", () => {
    const dashboard = source("DashboardLayout.tsx");

    expect(dashboard).toContain("useModularControl");
    expect(dashboard).toContain("LegacyDashboardLayout");
    expect(dashboard).toContain("ModularControlLayout");
    expect(dashboard).toMatch(
      /modularControl\s*\?\s*\(?\s*<ModularControlLayout[\s\S]*:\s*\(?\s*<LegacyDashboardLayout/
    );
  });

  it("keeps the two renderers physically separate", () => {
    expect(
      existsSync(new URL("layout/LegacyDashboardLayout.tsx", COMPONENTS))
    ).toBe(true);
    expect(
      existsSync(new URL("layout/ModularControlLayout.tsx", COMPONENTS))
    ).toBe(true);

    const legacy = source("layout/LegacyDashboardLayout.tsx");
    const modular = source("layout/ModularControlLayout.tsx");
    const workspace = source("layout/ShellWorkspace.tsx");
    expect(legacy).not.toContain("data-modular-control-shell");
    expect(legacy).not.toContain("useModularControl");
    expect(modular).toContain("ShellWorkspace");
    expect(workspace).toContain("data-modular-control-shell");
  });

  it("consumes the operational context without re-querying access state", () => {
    const modular = source("layout/ModularControlLayout.tsx");

    expect(modular).toContain("useOperationalContext");
    expect(modular).not.toMatch(/permessi\.mie|platform\.interruttori/);
  });

  it("uses one responsive shell model for drawer, mobile bar and dock", () => {
    const modular = source("layout/ModularControlLayout.tsx");
    const compact = source("layout/CompactNavigation.tsx");
    const dock = source("BottomNav.tsx");

    expect(modular).toContain("CompactNavigation");
    expect(modular).toContain("MobileTopBar");
    expect(modular).toContain("BottomNav");
    expect(compact).toContain("NavigationSidebar");
    expect(dock).toContain("mobileDestinations");
    expect(dock).not.toMatch(/useSidebar|hasRuolo/);
  });
});
