import type { BusinessEventConsumer } from "../../events/registry";
import type { BusinessEvent } from "../../events/types";
import { getFeatureFlags } from "../../platform/featureFlags";
import { rebuildEntityContext } from "./builder";
import { invalidateCachedQueries } from "./cache";
import type { EntityContextKey } from "./types";

type ContextMode = "off" | "shadow" | "active";

function entityRefs(event: BusinessEvent) {
  const refs = [event.source, ...event.subjectRefs]
    .filter(ref => ref.type === "cliente" || ref.type === "commessa")
    .map(ref => ({
      entityType: ref.type as EntityContextKey["entityType"],
      entityId: Number(ref.id),
    }))
    .filter(ref => Number.isInteger(ref.entityId) && ref.entityId > 0);
  return Array.from(
    new Map(
      refs.map(ref => [`${ref.entityType}:${ref.entityId}`, ref])
    ).values()
  );
}

export function createContextEventConsumer(
  options: {
    rebuild?: typeof rebuildEntityContext;
    modeForSede?: (sedeId: number) => ContextMode;
  } = {}
): BusinessEventConsumer {
  const rebuild = options.rebuild ?? rebuildEntityContext;
  const modeForSede =
    options.modeForSede ??
    (sedeId => getFeatureFlags(sedeId).contextEngineMode);
  return {
    name: "tars-context-v1",
    eventTypes: "*",
    async handle(event) {
      if (modeForSede(event.sedeId) === "off") return;
      for (const ref of entityRefs(event)) {
        invalidateCachedQueries({
          sedeId: event.sedeId,
          keyPrefix: `${ref.entityType}:${ref.entityId}`,
        });
        for (const scope of [
          "operativo",
          "amministrazione",
          "direzione",
        ] as const) {
          await rebuild({
            key: { sedeId: event.sedeId, ...ref, scope },
          });
        }
      }
    },
  };
}
