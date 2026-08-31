import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readPresentation(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("boundary presentational delle golden screen", () => {
  it("mantiene CapabilityDashboard indipendente da query e mutation", () => {
    const source = readPresentation(
      "../components/dashboard/CapabilityDashboard.tsx"
    );

    expect(source).not.toMatch(/\btrpc\b|useQuery|useMutation/);
    expect(source).toMatch(/export type CapabilityDashboardProps/);
  });

  it("mantiene header e workspace Commessa 360 indipendenti dai dati", () => {
    const header = readPresentation(
      "../components/commesse/Commessa360Header.tsx"
    );
    const workspace = readPresentation(
      "../components/commesse/Commessa360Workspace.tsx"
    );
    const page = readPresentation("../pages/CommessaDetail.tsx");

    expect(header).not.toMatch(/\btrpc\b|useQuery|useMutation/);
    expect(header).toMatch(/export type Commessa360HeaderProps/);
    expect(header).toMatch(/<header/);
    expect(header).toMatch(/aria-label="Percorso commessa"/);
    expect(header).toMatch(/<h1/);
    expect(workspace).not.toMatch(/\btrpc\b|useQuery|useMutation/);
    expect(workspace).toMatch(/export type Commessa360WorkspaceProps/);
    expect(workspace).not.toMatch(/<main/);
    for (const slot of [
      "overview",
      "timeline",
      "documents",
      "operations",
      "economy",
      "communications",
      "tars",
      "details",
    ]) {
      expect(workspace).toMatch(new RegExp(`\\b${slot}\\??:`));
    }
    expect(page).toMatch(/<Commessa360Header/);
    expect(page).toMatch(/<Commessa360Workspace/);
    expect(page).toMatch(/aria-label="Sezioni della commessa"/);
  });
});
