import { describe, expect, it } from "vitest";
import {
  buildCapabilityOutcomeReport,
  createMemoryOutcomeStore,
  recordTarsOutcome,
} from "./outcomes";

describe("Tars outcome learning", () => {
  it("registra versioni e motivi normalizzati senza conservare testo libero", () => {
    const store = createMemoryOutcomeStore();
    const outcome = recordTarsOutcome(
      {
        sedeId: 4,
        capability: "commessa.create",
        eventType: "rejected",
        workflowId: "create-customer-job",
        workflowVersion: "2",
        modelVersion: "gpt-x",
        promptVersion: "p3",
        reason: "Il cliente esiste gia, testo libero sensibile",
        occurredAt: new Date("2026-08-01T10:00:00Z"),
      },
      store
    );
    expect(outcome.reasonCode).toBe("duplicate");
    expect(outcome).not.toHaveProperty("reason");
    expect(JSON.stringify(outcome)).not.toContain("sensibile");
    expect(outcome.workflowVersion).toBe("2");
  });

  it("calcola metriche per capability senza media generale", () => {
    const store = createMemoryOutcomeStore();
    for (const [capability, eventType] of [
      ["cliente.create", "verified"],
      ["cliente.create", "rejected"],
      ["commessa.create", "approved"],
    ] as const) {
      recordTarsOutcome(
        {
          sedeId: 9,
          capability,
          eventType,
          workflowId: "wf",
          workflowVersion: "1",
          modelVersion: "m1",
          promptVersion: "p1",
          reason: null,
          occurredAt: new Date(),
        },
        store
      );
    }
    const report = buildCapabilityOutcomeReport({ sedeId: 9, store });
    expect(report).toEqual([
      expect.objectContaining({
        capability: "cliente.create",
        sampleSize: 2,
        accuracy: 0.5,
      }),
      expect.objectContaining({
        capability: "commessa.create",
        sampleSize: 1,
        accuracy: 1,
      }),
    ]);
    expect(report).not.toHaveProperty("accuracy");
  });
});
