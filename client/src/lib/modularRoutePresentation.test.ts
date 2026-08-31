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
  });
});
