import { describe, expect, it } from "vitest";
import {
  currentExecutionVersions,
  normalizeExecutionMetadata,
} from "../stores";

describe("Tars execution version metadata", () => {
  it("backfilla versioni neutrali sui record legacy", () => {
    const legacy: Record<string, unknown> = {};

    normalizeExecutionMetadata(legacy);

    expect(legacy).toMatchObject({
      promptVersion: "legacy",
      toolRegistryVersion: "legacy",
      workflowVersion: null,
      policyVersion: "legacy",
    });
  });

  it("non sovrascrive le versioni gia registrate", () => {
    const current = {
      promptVersion: "prompt-v3",
      toolRegistryVersion: "tools-v4",
      workflowVersion: "lead-v2",
      policyVersion: "policy-v2",
    };

    normalizeExecutionMetadata(current);

    expect(current).toEqual({
      promptVersion: "prompt-v3",
      toolRegistryVersion: "tools-v4",
      workflowVersion: "lead-v2",
      policyVersion: "policy-v2",
      contextFingerprint: null,
      contextScope: null,
      contextCacheHit: false,
      evidenceRefs: [],
      factsRead: 0,
      factsRevalidated: 0,
    });
  });

  it("registra le versioni del prompt e del catalogo promemoria", () => {
    expect(currentExecutionVersions()).toMatchObject({
      promptVersion: "prompt-v3",
      toolRegistryVersion: "tools-v3",
    });
  });
});
