export type ToolSetGrade = {
  passed: boolean;
  missing: string[];
  forbidden: string[];
  unexpected: string[];
};

export function gradeToolSet(
  expected: string[],
  observed: string[],
  forbiddenNames: string[]
): ToolSetGrade {
  const expectedSet = new Set(expected);
  const observedSet = new Set(observed);
  const forbiddenSet = new Set(forbiddenNames);
  const missing = expected.filter(name => !observedSet.has(name)).sort();
  const forbidden = observed.filter(name => forbiddenSet.has(name)).sort();
  const unexpected = observed
    .filter(name => !expectedSet.has(name) && !forbiddenSet.has(name))
    .sort();
  return {
    passed: missing.length === 0 && forbidden.length === 0 && unexpected.length === 0,
    missing,
    forbidden,
    unexpected,
  };
}

export function gradeStringSet(expected: string[], observed: string[]) {
  return gradeToolSet(expected, observed, []);
}

export function gradeEvidence(input: {
  importantClaims: number;
  citedClaims: number;
}): { passed: boolean; score: number } {
  if (input.importantClaims <= 0) return { passed: true, score: 1 };
  const score = Math.min(
    1,
    Math.max(0, input.citedClaims) / input.importantClaims
  );
  return { passed: score === 1, score };
}

export function gradeFinalState(expected?: string, observed?: string) {
  if (expected === undefined) return { passed: true };
  return { passed: expected === observed };
}
