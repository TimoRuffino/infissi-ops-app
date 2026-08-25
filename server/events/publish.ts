import { getFeatureFlags } from "../platform/featureFlags";
import {
  getBusinessEventRepository,
  type BusinessEventRepository,
} from "./repository";
import type { BusinessEventDraft } from "./types";

export type AssignmentEntityType =
  | "cliente"
  | "commessa"
  | "ticket"
  | "intervento"
  | "azione_operativa";

export function buildAssignmentEvent(input: {
  sedeId: number;
  entityType: AssignmentEntityType;
  entityId: number;
  previousAssigneeId: number | null;
  assigneeId: number | null;
  actorUserId: number | null;
  updatedAt: Date;
  link: string;
  reason?: string | null;
}): BusinessEventDraft | null {
  if (input.previousAssigneeId === input.assigneeId) return null;
  const version = input.updatedAt.toISOString();
  return {
    sedeId: input.sedeId,
    eventType: `${input.entityType}.assigned`,
    source: {
      type: input.entityType,
      id: String(input.entityId),
      version,
    },
    actorUserId: input.actorUserId,
    subjectRefs: [{ type: input.entityType, id: String(input.entityId) }],
    recipientHints: input.assigneeId == null ? [] : [input.assigneeId],
    payload: {
      version: 1,
      previousAssigneeId: input.previousAssigneeId,
      assigneeId: input.assigneeId,
      link: input.link,
      reason: input.reason?.trim() || null,
    },
    dedupeKey: `${input.entityType}:${input.entityId}:assigned:${input.assigneeId ?? "none"}:${version}`,
    occurredAt: new Date(input.updatedAt),
  };
}

export async function publishDomainEvent(
  draft: BusinessEventDraft,
  options: { repository?: BusinessEventRepository } = {}
): Promise<{
  status: "inserted" | "duplicate" | "disabled" | "failed";
  eventId: number | null;
}> {
  if (getFeatureFlags(draft.sedeId).eventBusMode === "off") {
    return { status: "disabled", eventId: null };
  }
  try {
    const result = await (options.repository ?? getBusinessEventRepository()).publish(
      draft
    );
    return {
      status: result.inserted ? "inserted" : "duplicate",
      eventId: result.id,
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && typeof (error as any).code === "string"
        ? (error as any).code
        : "BUSINESS_EVENT_PUBLISH_FAILED";
    console.error(`[events] publish ${draft.eventType} failed: ${code}`);
    return { status: "failed", eventId: null };
  }
}

export async function publishAssignmentEvent(
  input: Parameters<typeof buildAssignmentEvent>[0],
  options: { repository?: BusinessEventRepository } = {}
) {
  const event = buildAssignmentEvent(input);
  return event
    ? publishDomainEvent(event, options)
    : Promise.resolve({ status: "duplicate" as const, eventId: null });
}
