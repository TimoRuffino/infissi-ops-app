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

  it("mantiene le due presentazioni Kanban indipendenti dalle mutation", () => {
    const desktop = readPresentation(
      "../components/kanban/KanbanDesktopBoard.tsx"
    );
    const mobile = readPresentation(
      "../components/kanban/KanbanMobilePhaseList.tsx"
    );

    for (const source of [desktop, mobile]) {
      expect(source).not.toMatch(/\btrpc\b|useQuery|useMutation/);
      expect(source).toMatch(/onOpen/);
      expect(source).toMatch(/onMove/);
    }
    expect(desktop).toMatch(/export type KanbanDesktopBoardProps/);
    expect(mobile).toMatch(/export type KanbanMobilePhaseListProps/);
  });

  it("mantiene la cabina Tars indipendente dall'esecuzione", () => {
    const source = readPresentation(
      "../components/tars/TarsOperationalPanels.tsx"
    );
    const page = readPresentation("../pages/Tars.tsx");

    expect(source).not.toMatch(/\btrpc\b|useQuery|useMutation/);
    expect(source).toMatch(/export type TarsOperationalPanelsProps/);
    expect(source).toMatch(/availability: TarsAvailability/);
    expect(source).toMatch(/availability\.kind === "unavailable"/);
    expect(page).toMatch(/capabilities\?\.has\("tars\.use"\)/);
    expect(page).toMatch(/aria-relevant="additions text"/);
  });

  it("mantiene le superfici sul campo indipendenti da query e mutation", () => {
    const header = readPresentation(
      "../components/operativita/MobileFieldHeader.tsx"
    );
    const signature = readPresentation(
      "../components/operativita/SignaturePad.tsx"
    );

    for (const source of [header, signature]) {
      expect(source).not.toMatch(/\btrpc\b|useQuery|useMutation/);
    }
    expect(header).toMatch(/export type MobileFieldHeaderProps/);
    expect(signature).toMatch(/export type SignaturePadProps/);
    expect(signature).toMatch(/onPointerDown/);
    expect(signature).toMatch(/onPointerMove/);
    expect(signature).toMatch(/onPointerUp/);
    expect(signature).toMatch(/setPointerCapture/);
  });
});
