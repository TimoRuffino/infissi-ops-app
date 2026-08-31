import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function routeSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("route migrate alla grammatica Modular Control", () => {
  it("compone il Centro azioni con header e superfici del sistema", () => {
    const source = routeSource("../pages/Notifiche.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/<DataSurface/);
  });

  it("compone la gestione sedi con header e superfici del sistema", () => {
    const source = routeSource("../pages/SediList.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/<DataSurface/);
    expect(source).toMatch(/min-h-11 min-w-11/);
    expect(source).toMatch(
      /<Button className="min-h-11" onClick=\{openCreate\}/
    );
  });

  it("compone l'archivio con header e superfici del sistema", () => {
    const source = routeSource("../pages/Archivio.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/<DataSurface/);
  });

  it("compone il calendario come workbench capability-aware", () => {
    const source = routeSource("../pages/Planning.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/variant="workbench"/);
    expect(source).toMatch(/<DataSurface/);
    // Le CTA passano dalla matrice pura, non da ruoli letti nella pagina.
    expect(source).toMatch(/planningPermissions\(/);
    expect(source).toMatch(/<PlanningToolbar/);
    expect(source).toMatch(/<PlanningAgenda/);
    // L'evento Google apre solo lo sheet in sola lettura.
    expect(source).toMatch(/mode="read-external"/);
  });

  it("compone il roster squadre con header e superfici del sistema", () => {
    const source = routeSource("../pages/SquadreList.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/<DataSurface/);
    // Il roster vive in una card senza logica autorizzativa.
    expect(source).toMatch(/<SquadraRosterCard/);
    // La gestione resta direzione-only, specchio UX di `adminProcedure`.
    expect(source).toMatch(/isDirezione\(user\)/);
    // Chi non è direzione legge il roster: niente permission-state sulla lista.
    expect(source).toMatch(/Gestione squadre riservata alla direzione\./);
  });

  it("compone la conoscenza aziendale con header e superfici del sistema", () => {
    const source = routeSource("../pages/Conoscenza.tsx");

    expect(source).toMatch(/import PageHeader/);
    expect(source).toMatch(/import DataSurface/);
    expect(source).toMatch(/<PageHeader/);
    expect(source).toMatch(/<DataSurface/);
  });
});
