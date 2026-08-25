import { createHash } from "crypto";
import type { ContextFact } from "./types";

function canonicalValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map(key => [key, canonicalValue(record[key])])
    );
  }
  return value;
}

function canonicalFacts(facts: ContextFact[]) {
  return facts
    .map(fact => ({
      key: fact.key,
      value: canonicalValue(fact.value),
      confidence: fact.confidence,
      evidence: fact.evidence
        .map(item => canonicalValue(item) as Record<string, unknown>)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function fingerprintContext(input: {
  facts: ContextFact[];
  schemaVersion: string;
  policyVersion: string;
  collectorVersion: string;
}): string {
  const payload = canonicalValue({
    schemaVersion: input.schemaVersion,
    policyVersion: input.policyVersion,
    collectorVersion: input.collectorVersion,
    facts: canonicalFacts(input.facts),
  });
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
