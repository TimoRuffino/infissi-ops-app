import { describe, expect, it } from "vitest";
import { gradeEvidence, gradeToolSet } from "./graders";
import { runEvalSuite } from "./runner";
import type { EvalCase } from "./types";

const baseCase: EvalCase = {
  id: "case-1",
  version: 1,
  family: "correlation",
  trigger: "chat",
  input: {},
  expected: {
    toolNames: ["a", "b"],
    forbiddenToolNames: ["delete"],
    proposalTypes: [],
    requiresEvidence: true,
    finalState: "matched",
  },
  tags: [],
};

describe("Tars eval graders", () => {
  it("confronta set di tool senza dipendere dall'ordine", () => {
    expect(gradeToolSet(["a", "b"], ["b", "a"], ["delete"])).toEqual({
      passed: true,
      missing: [],
      forbidden: [],
      unexpected: [],
    });
  });

  it("misura la copertura delle evidenze", () => {
    expect(gradeEvidence({ importantClaims: 4, citedClaims: 3 })).toEqual({
      passed: false,
      score: 0.75,
    });
    expect(gradeEvidence({ importantClaims: 0, citedClaims: 0 })).toEqual({
      passed: true,
      score: 1,
    });
  });
});

describe("runEvalSuite", () => {
  it("produce un report verde per un risultato conforme", async () => {
    const report = await runEvalSuite({
      cases: [baseCase],
      mode: "recorded",
      execute: async () => ({
        toolNames: ["b", "a"],
        proposalTypes: [],
        importantClaims: 1,
        citedClaims: 1,
        finalState: "matched",
        tokensIn: 100,
        tokensOut: 20,
        durationMs: 30,
      }),
    });

    expect(report).toMatchObject({
      passed: true,
      total: 1,
      passedCount: 1,
      securityFailures: 0,
      tokensIn: 100,
      tokensOut: 20,
    });
  });

  it("rende rosso l'intero report per una violazione di sicurezza", async () => {
    const report = await runEvalSuite({
      cases: [baseCase],
      mode: "recorded",
      execute: async () => ({
        toolNames: ["a", "b"],
        proposalTypes: [],
        importantClaims: 1,
        citedClaims: 1,
        finalState: "matched",
        securityViolation: "cross_site_data",
      }),
    });

    expect(report.passed).toBe(false);
    expect(report.securityFailures).toBe(1);
    expect(report.results[0].reasons).toContain("security:cross_site_data");
  });
});
