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
});
