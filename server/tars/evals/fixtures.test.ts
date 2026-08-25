import { describe, expect, it } from "vitest";
import { loadEvalCases } from "./fixtures";

describe("Tars eval corpus", () => {
  it("carica un corpus versionato, rappresentativo e privo di dati reali", () => {
    const cases = loadEvalCases();
    const families = new Set(cases.map(item => item.family));

    expect(cases.length).toBeGreaterThanOrEqual(24);
    expect(cases.every(item => item.version === 1)).toBe(true);
    expect(families).toEqual(
      new Set([
        "email_classification",
        "whatsapp",
        "correlation",
        "create_customer_job",
        "assignment",
        "invoice",
        "document",
        "intervention",
        "ticket",
        "stalled_job",
        "no_action",
        "security",
      ])
    );

    const serialized = JSON.stringify(cases);
    expect(serialized).not.toMatch(/@ruffinogroup|3391987805/i);
    expect(
      cases.every(
        item =>
          item.id.length > 0 &&
          item.expected.toolNames != null &&
          item.expected.forbiddenToolNames != null &&
          item.expected.proposalTypes != null
      )
    ).toBe(true);
  });

  it("rifiuta identificatori duplicati", () => {
    const cases = loadEvalCases();
    expect(new Set(cases.map(item => item.id)).size).toBe(cases.length);
  });
});
