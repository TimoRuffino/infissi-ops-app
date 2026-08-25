import {
  gradeEvidence,
  gradeFinalState,
  gradeStringSet,
  gradeToolSet,
} from "./graders";
import type { EvalCase, EvalObserved } from "./types";

export type EvalCaseResult = {
  id: string;
  family: string;
  passed: boolean;
  reasons: string[];
  evidenceScore: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
};

export type EvalReport = {
  mode: "recorded" | "live";
  passed: boolean;
  total: number;
  passedCount: number;
  securityFailures: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  results: EvalCaseResult[];
};

function gradeCase(item: EvalCase, observed: EvalObserved): EvalCaseResult {
  const reasons: string[] = [];
  const tools = gradeToolSet(
    item.expected.toolNames,
    observed.toolNames,
    item.expected.forbiddenToolNames
  );
  if (tools.missing.length) reasons.push(`missing_tools:${tools.missing.join(",")}`);
  if (tools.forbidden.length) reasons.push(`forbidden_tools:${tools.forbidden.join(",")}`);
  if (tools.unexpected.length) {
    reasons.push(`unexpected_tools:${tools.unexpected.join(",")}`);
  }

  const proposals = gradeStringSet(
    item.expected.proposalTypes,
    observed.proposalTypes
  );
  if (proposals.missing.length) {
    reasons.push(`missing_proposals:${proposals.missing.join(",")}`);
  }
  if (proposals.unexpected.length) {
    reasons.push(`unexpected_proposals:${proposals.unexpected.join(",")}`);
  }

  const evidence = item.expected.requiresEvidence
    ? gradeEvidence(observed)
    : { passed: true, score: 1 };
  if (!evidence.passed) reasons.push(`evidence:${evidence.score.toFixed(2)}`);

  const finalState = gradeFinalState(
    item.expected.finalState,
    observed.finalState
  );
  if (!finalState.passed) {
    reasons.push(
      `final_state:${observed.finalState ?? "missing"}!=${item.expected.finalState}`
    );
  }
  if (item.expected.intent && observed.intent !== item.expected.intent) {
    reasons.push(`intent:${observed.intent ?? "missing"}!=${item.expected.intent}`);
  }
  if (observed.securityViolation) {
    reasons.push(`security:${observed.securityViolation}`);
  }

  return {
    id: item.id,
    family: item.family,
    passed: reasons.length === 0,
    reasons,
    evidenceScore: evidence.score,
    tokensIn: observed.tokensIn ?? 0,
    tokensOut: observed.tokensOut ?? 0,
    durationMs: observed.durationMs ?? 0,
  };
}

export async function runEvalSuite(options: {
  cases: EvalCase[];
  mode: "recorded" | "live";
  execute: (item: EvalCase) => Promise<EvalObserved>;
  concurrency?: number;
}): Promise<EvalReport> {
  const concurrency = Math.min(Math.max(options.concurrency ?? 2, 1), 8);
  const results = new Array<EvalCaseResult>(options.cases.length);
  let cursor = 0;

  async function worker() {
    while (cursor < options.cases.length) {
      const index = cursor++;
      const item = options.cases[index];
      const observed = await options.execute(item);
      results[index] = gradeCase(item, observed);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, options.cases.length) }, worker)
  );
  const securityFailures = results.filter(result =>
    result.reasons.some(reason => reason.startsWith("security:"))
  ).length;
  const passedCount = results.filter(result => result.passed).length;
  return {
    mode: options.mode,
    passed: securityFailures === 0 && passedCount === results.length,
    total: results.length,
    passedCount,
    securityFailures,
    tokensIn: results.reduce((sum, result) => sum + result.tokensIn, 0),
    tokensOut: results.reduce((sum, result) => sum + result.tokensOut, 0),
    durationMs: results.reduce((sum, result) => sum + result.durationMs, 0),
    results,
  };
}
