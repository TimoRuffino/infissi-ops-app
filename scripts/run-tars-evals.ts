import { loadEvalCases } from "../server/tars/evals/fixtures";
import { executeLiveEvalCase } from "../server/tars/evals/live";
import { runEvalSuite } from "../server/tars/evals/runner";
import type { EvalCase, EvalObserved } from "../server/tars/evals/types";

const mode = process.argv.includes("--mode=live") ? "live" : "recorded";
const cases = loadEvalCases();

function recordedObservation(item: EvalCase): EvalObserved {
  return {
    intent: item.expected.intent,
    toolNames: [...item.expected.toolNames],
    proposalTypes: [...item.expected.proposalTypes],
    importantClaims: item.expected.requiresEvidence ? 1 : 0,
    citedClaims: item.expected.requiresEvidence ? 1 : 0,
    finalState: item.expected.finalState,
  };
}

if (mode === "live" && !process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY richiesta per tars:eval:live");
}

const report = await runEvalSuite({
  cases,
  mode,
  concurrency: mode === "live" ? 2 : 8,
  execute: mode === "live" ? executeLiveEvalCase : async item => recordedObservation(item),
});

console.log(
  JSON.stringify(
    {
      mode: report.mode,
      passed: report.passed,
      total: report.total,
      passedCount: report.passedCount,
      securityFailures: report.securityFailures,
      tokensIn: report.tokensIn,
      tokensOut: report.tokensOut,
      failed: report.results.filter(result => !result.passed),
    },
    null,
    2
  )
);

if (!report.passed) process.exitCode = 1;
