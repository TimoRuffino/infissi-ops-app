import type { BusinessEventConsumer } from "../events/registry";
import type { BusinessEvent } from "../events/types";
import { getUtentiStore } from "../routers/utenti";
import {
  getNotificationRepository,
  type NotificationRepository,
} from "./repository";
import type { NotificationDraft } from "./types";
import {
  notificationHub,
  publishNotificationSignal,
  type NotificationHub,
} from "./sse";
import { deliverStoredNotification } from "./deliveryWorker";
import { getFeatureFlags } from "../platform/featureFlags";

const ASSIGNMENT_EVENT_TYPES = [
  "cliente.assigned",
  "commessa.assigned",
  "ticket.assigned",
  "intervento.assigned",
  "azione_operativa.assigned",
  "tars.plan_waiting",
] as const;

const ENTITY_LABELS: Record<string, string> = {
  cliente: "Cliente",
  commessa: "Commessa",
  ticket: "Ticket post-vendita",
  intervento: "Intervento",
  azione_operativa: "Azione operativa",
};

function numericPayload(event: BusinessEvent, key: string): number | null {
  const value = event.payload[key];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function assignmentGroupKey(event: BusinessEvent) {
  return `${event.source.type}:${event.source.id}`;
}

export function projectNotification(event: BusinessEvent): NotificationDraft[] {
  if (!ASSIGNMENT_EVENT_TYPES.includes(event.eventType as any)) return [];
  if (event.eventType === "tars.plan_waiting") {
    const recipientUserId = event.recipientHints[0];
    if (recipientUserId == null) return [];
    const status = String(event.payload.status ?? "waiting_user");
    return [
      {
        sedeId: event.sedeId,
        recipientUserId,
        canonicalKey: `event:${event.id}:tars-plan:${event.source.id}`,
        type: "tars.plan_waiting",
        priority: status === "waiting_technical" ? "high" : "normal",
        title:
          status === "waiting_approval"
            ? "Tars attende la tua approvazione"
            : status === "waiting_technical"
              ? "Un obiettivo Tars va ripreso"
              : "Tars ha una domanda per te",
        body: "Apri l'obiettivo per continuare dal punto raggiunto.",
        link: String(
          event.payload.link ?? `/tars?tab=oggi&plan=${event.source.id}`
        ),
        groupKey: `tars-plan:${event.source.id}`,
        sourceEventId: event.id,
        entityRefs: event.subjectRefs,
        createdAt: new Date(event.occurredAt),
        expiresAt: null,
      },
    ];
  }
  const assigneeId = numericPayload(event, "assigneeId");
  if (assigneeId == null) return [];
  const notifyActor = event.payload.notifyActor === true;
  if (!notifyActor && event.actorUserId === assigneeId) return [];
  const label = ENTITY_LABELS[event.source.type] ?? "Attivita";
  const link =
    typeof event.payload.link === "string" ? event.payload.link : "/";
  return [
    {
      sedeId: event.sedeId,
      recipientUserId: assigneeId,
      canonicalKey: `event:${event.id}:assignment:${assigneeId}`,
      type: "assignment",
      priority: event.source.type === "cliente" ? "normal" : "high",
      title: `${label} assegnata a te`,
      body: "Hai una nuova responsabilita da prendere in carico.",
      link,
      groupKey: assignmentGroupKey(event),
      sourceEventId: event.id,
      entityRefs: event.subjectRefs,
      createdAt: new Date(event.occurredAt),
      expiresAt: null,
    },
  ];
}

export function createNotificationProjectorConsumer(
  options: {
    repository?: NotificationRepository;
    getUsers?: () => Array<{ id: number; attivo: boolean; sediIds?: number[] }>;
    onDiagnostic?: (code: string, event: BusinessEvent, userId: number) => void;
    hub?: NotificationHub;
    modeForSede?: (sedeId: number) => "legacy" | "shadow" | "active";
  } = {}
): BusinessEventConsumer {
  const repository = options.repository ?? getNotificationRepository();
  const getUsers = options.getUsers ?? getUtentiStore;
  const hub = options.hub ?? notificationHub;
  const diagnostic =
    options.onDiagnostic ??
    ((code, event, userId) => {
      console.warn(
        `[notifications] ${code} event=${event.id} recipient=${userId}`
      );
    });

  return {
    name: "notification-projector-v1",
    eventTypes: ASSIGNMENT_EVENT_TYPES,
    async handle(event) {
      const mode = options.modeForSede?.(event.sedeId) ??
        getFeatureFlags(event.sedeId).notificationMode;
      if (mode !== "active") return;
      const previousAssigneeId = numericPayload(event, "previousAssigneeId");
      if (previousAssigneeId != null) {
        await repository.resolveGroup({
          sedeId: event.sedeId,
          recipientUserId: previousAssigneeId,
          groupKey: assignmentGroupKey(event),
          now: new Date(event.occurredAt),
        });
      }
      const users = getUsers();
      for (const draft of projectNotification(event)) {
        const recipient = users.find(user => user.id === draft.recipientUserId);
        if (
          !recipient?.attivo ||
          !Array.isArray(recipient.sediIds) ||
          !recipient.sediIds.includes(event.sedeId)
        ) {
          diagnostic("recipient_invalid", event, draft.recipientUserId);
          continue;
        }
        const result = await repository.upsert(draft);
        if (result.created) {
          const signal = {
            notificationId: result.id,
            recipientUserId: draft.recipientUserId,
            sedeId: draft.sedeId,
          };
          if (options.hub) hub.publish(signal);
          else await publishNotificationSignal(signal);
          if (!options.repository) {
            await deliverStoredNotification({
              notificationId: result.id,
              recipientUserId: draft.recipientUserId,
              sedeId: draft.sedeId,
            });
          }
        }
      }
    },
  };
}
