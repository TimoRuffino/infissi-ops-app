import { describe, expect, it } from "vitest";
import { evaluateAutonomyGate, type AutonomyEvidence } from "./policy";

const now = new Date("2026-08-25T12:00:00Z");
function qualified(
  overrides: Partial<AutonomyEvidence> = {}
): AutonomyEvidence {
  return {
    capability: "notification.resolve",
    whitelistedCapabilities: ["notification.resolve"],
    enabledByDirection: true,
    featureEnabled: true,
    evalReportId: "eval-44",
    sampleSize: 140,
    accuracy: 0.99,
    observedFrom: new Date("2026-06-01T00:00:00Z"),
    observedTo: now,
    modelVersion: "m1",
    promptVersion: "p1",
    workflowVersion: "w1",
    currentModelVersion: "m1",
    currentPromptVersion: "p1",
    currentWorkflowVersion: "w1",
    riskClass: "low",
    irreversible: false,
    undoAvailable: true,
    systemPrincipalMinimal: true,
    incidents: 0,
    killSwitchActive: false,
    now,
    ...overrides,
  };
}

describe("evaluateAutonomyGate", () => {
  it.each([
    [{ sampleSize: 99 }, "100"],
    [{ accuracy: 0.979 }, "98%"],
    [{ observedFrom: new Date("2026-08-01T00:00:00Z") }, "6 settimane"],
    [{ modelVersion: "m0" }, "versione modello"],
    [{ promptVersion: "p0" }, "versione prompt"],
    [{ workflowVersion: "w0" }, "versione workflow"],
    [{ riskClass: "high" }, "rischio alto"],
    [{ irreversible: true }, "irreversibile"],
    [{ incidents: 1 }, "incidenti"],
  ])("nega quando manca un requisito qualificante", (override, reason) => {
    const result = evaluateAutonomyGate(qualified(override as any));
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toContain(reason);
  });

  it("richiede whitelist, direzione, feature, eval, undo e principal minimo", () => {
    const result = evaluateAutonomyGate(
      qualified({
        whitelistedCapabilities: [],
        enabledByDirection: false,
        featureEnabled: false,
        evalReportId: null,
        undoAvailable: false,
        systemPrincipalMinimal: false,
      })
    );
    expect(result.allowed).toBe(false);
    expect(result.reasons).toHaveLength(6);
  });

  it("qualifica solo la singola capability e scade dopo 30 giorni", () => {
    const result = evaluateAutonomyGate(qualified());
    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.expiresAt?.toISOString()).toBe("2026-09-24T12:00:00.000Z");
  });
});
