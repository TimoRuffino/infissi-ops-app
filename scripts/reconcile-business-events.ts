import { bootstrapAll, flushAll } from "../server/_core/persistence";
import { reconcileAssignmentEvents } from "../server/events/reconcileAssignments";

function numericArg(name: string, fallback?: number): number | undefined {
  const prefix = `--${name}=`;
  const raw = process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
  if (raw == null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Argomento --${name} non valido`);
  }
  return value;
}

const sedeId = numericArg("sede");
if (!sedeId) throw new Error("Specificare --sede=<id>");
const dryRun = !process.argv.includes("--apply");

await bootstrapAll();
const result = await reconcileAssignmentEvents({
  sedeId,
  limit: numericArg("limit", 10_000),
  dryRun,
});
if (!dryRun) await flushAll();

console.log(JSON.stringify({ dryRun, sedeId, ...result }, null, 2));
if (result.failed > 0) process.exitCode = 1;
