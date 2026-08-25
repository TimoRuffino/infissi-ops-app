import rawCases from "./cases/core.json";
import { EVAL_FAMILIES, type EvalCase } from "./types";

function isEvalCase(value: unknown): value is EvalCase {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const expected = item.expected as Record<string, unknown> | undefined;
  return (
    typeof item.id === "string" &&
    item.version === 1 &&
    EVAL_FAMILIES.includes(item.family as any) &&
    typeof item.trigger === "string" &&
    !!item.input &&
    typeof item.input === "object" &&
    Array.isArray(item.tags) &&
    !!expected &&
    Array.isArray(expected.toolNames) &&
    Array.isArray(expected.forbiddenToolNames) &&
    Array.isArray(expected.proposalTypes) &&
    typeof expected.requiresEvidence === "boolean"
  );
}

export function loadEvalCases(): EvalCase[] {
  if (!Array.isArray(rawCases) || !rawCases.every(isEvalCase)) {
    throw new Error("TARS_EVAL_CORPUS_INVALID");
  }
  const ids = new Set<string>();
  for (const item of rawCases) {
    if (ids.has(item.id)) throw new Error(`TARS_EVAL_DUPLICATE_ID:${item.id}`);
    ids.add(item.id);
  }
  return structuredClone(rawCases) as EvalCase[];
}
