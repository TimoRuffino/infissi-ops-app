import { getFeatureFlags } from "../server/platform/featureFlags";
import {
  CONTEXT_COLLECTOR_VERSION,
  CONTEXT_SCHEMA_VERSION,
  rebuildEntityContext,
} from "../server/tars/context/builder";
import { collectEntityFacts } from "../server/tars/context/collectors";
import { fingerprintContext } from "../server/tars/context/fingerprint";
import type { EntityContextKey } from "../server/tars/context/types";

function arg(name: string): string | undefined {
  return process.argv
    .find(value => value.startsWith(`--${name}=`))
    ?.split("=")[1];
}

const sedeId = Number(arg("sede"));
const entityType = arg("entity") as EntityContextKey["entityType"];
const entityId = Number(arg("id"));
const scope = arg("scope") as EntityContextKey["scope"];
const apply = process.argv.includes("--apply");

if (
  !Number.isInteger(sedeId) ||
  sedeId <= 0 ||
  !["cliente", "commessa"].includes(entityType) ||
  !Number.isInteger(entityId) ||
  entityId <= 0 ||
  !["operativo", "amministrazione", "direzione"].includes(scope)
) {
  throw new Error(
    "Uso: tsx scripts/rebuild-tars-context.ts --sede=1 --entity=commessa --id=42 --scope=operativo [--dry-run|--apply]"
  );
}

const key: EntityContextKey = { sedeId, entityType, entityId, scope };
if (!apply) {
  const collected = await collectEntityFacts(key);
  if (!collected) throw new Error("Entita non trovata nella sede indicata.");
  const policyVersion = `policy-${getFeatureFlags(sedeId).policyMode}-v1`;
  console.log(
    JSON.stringify(
      {
        dryRun: true,
        key,
        facts: collected.facts.length,
        evidence: collected.facts.reduce(
          (sum, fact) => sum + fact.evidence.length,
          0
        ),
        sourceVersions: collected.sourceVersions,
        fingerprint: fingerprintContext({
          facts: collected.facts,
          schemaVersion: CONTEXT_SCHEMA_VERSION,
          policyVersion,
          collectorVersion: CONTEXT_COLLECTOR_VERSION,
        }),
      },
      null,
      2
    )
  );
} else {
  const result = await rebuildEntityContext({ key });
  console.log(
    JSON.stringify(
      {
        dryRun: false,
        key,
        version: result.snapshot?.version ?? null,
        fingerprint: result.snapshot?.fingerprint ?? null,
        modelCalled: result.modelCalled,
        cacheHit: result.cacheHit,
        failed: result.failed,
      },
      null,
      2
    )
  );
}
