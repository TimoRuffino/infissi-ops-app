import { getPolicyRepository } from "../server/authz/repository";

function numericArg(name: string, fallback: number): number {
  const raw = process.argv.find(arg => arg.startsWith(`--${name}=`))?.split("=")[1];
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const sedeId = numericArg("sede", 1);
const days = numericArg("days", 7);
const repository = getPolicyRepository();
await repository.ensureSchema();
const records = await repository.listAuditDiffs({ sedeId, days });
const summary = new Map<string, { total: number; legacyAllows: number; proposedAllows: number }>();

for (const record of records) {
  const key = `${record.endpoint}|${record.capability}|${record.proposedCode}`;
  const current = summary.get(key) ?? { total: 0, legacyAllows: 0, proposedAllows: 0 };
  current.total += 1;
  current.legacyAllows += record.legacyAllowed ? 1 : 0;
  current.proposedAllows += record.proposedAllowed ? 1 : 0;
  summary.set(key, current);
}

console.log(JSON.stringify({
  sedeId,
  days,
  differences: records.length,
  groups: Array.from(summary.entries()).map(([key, value]) => {
    const [endpoint, capability, proposedCode] = key.split("|");
    return { endpoint, capability, proposedCode, ...value };
  }),
}, null, 2));
