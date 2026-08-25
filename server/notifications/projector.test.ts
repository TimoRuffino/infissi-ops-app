import { describe, expect, it } from "vitest";
import type { BusinessEvent } from "../events/types";
import { createMemoryNotificationRepository } from "./repository";
import { createNotificationProjectorConsumer, projectNotification } from "./projector";

function assignmentEvent(overrides: Partial<BusinessEvent> = {}): BusinessEvent {
  return {
    id: 101,
    sedeId: 1,
    eventType: "commessa.assigned",
    source: { type: "commessa", id: "42", version: "v1" },
    actorUserId: 3,
    subjectRefs: [{ type: "commessa", id: "42" }],
    recipientHints: [7],
    payload: {
      version: 1,
      previousAssigneeId: null,
      assigneeId: 7,
      link: "/commesse/42",
      reason: null,
    },
    dedupeKey: "commessa:42:assigned:7:v1",
    occurredAt: new Date("2026-08-25T12:00:00Z"),
    createdAt: new Date("2026-08-25T12:00:01Z"),
    ...overrides,
  };
}

describe("notification projector", () => {
  it("crea una notifica personale raggruppata per l'assegnatario", () => {
    expect(projectNotification(assignmentEvent())).toEqual([
      expect.objectContaining({
        recipientUserId: 7,
        canonicalKey: "event:101:assignment:7",
        groupKey: "commessa:42",
        priority: "high",
        link: "/commesse/42",
      }),
    ]);
  });

  it("non notifica chi ha assegnato a se stesso", () => {
    expect(projectNotification(assignmentEvent({ actorUserId: 7 }))).toEqual([]);
  });

  it("risolve il precedente destinatario e deduplica i retry", async () => {
    const repository = createMemoryNotificationRepository();
    const users = [
      { id: 7, attivo: true, sediIds: [1] },
      { id: 8, attivo: true, sediIds: [1] },
    ];
    const consumer = createNotificationProjectorConsumer({
      repository,
      getUsers: () => users,
    });
    await consumer.handle(assignmentEvent());
    const reassigned = assignmentEvent({
      id: 102,
      source: { type: "commessa", id: "42", version: "v2" },
      recipientHints: [8],
      payload: {
        version: 1,
        previousAssigneeId: 7,
        assigneeId: 8,
        link: "/commesse/42",
        reason: null,
      },
    });
    await consumer.handle(reassigned);
    await consumer.handle(reassigned);

    expect(
      (await repository.list({
        sedeId: 1,
        recipientUserId: 7,
        statuses: ["resolved"],
        limit: 10,
        now: new Date(),
      })).items
    ).toHaveLength(1);
    expect(
      (await repository.list({
        sedeId: 1,
        recipientUserId: 8,
        limit: 10,
        now: new Date(),
      })).items
    ).toHaveLength(1);
  });
});
