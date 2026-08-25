import { describe, expect, it } from "vitest";
import { setFeatureFlags } from "../platform/featureFlags";
import { createMemoryBusinessEventRepository } from "./repository";
import { buildAssignmentEvent, publishDomainEvent } from "./publish";

const now = new Date("2026-08-25T12:00:00.000Z");

describe("publishDomainEvent", () => {
  it("non pubblica quando il registro e spento", async () => {
    const repository = createMemoryBusinessEventRepository();
    const event = buildAssignmentEvent({
      sedeId: 9301,
      entityType: "commessa",
      entityId: 42,
      previousAssigneeId: 3,
      assigneeId: 7,
      actorUserId: 3,
      updatedAt: now,
      link: "/commesse/42",
    });

    expect(event).not.toBeNull();
    expect(await publishDomainEvent(event!, { repository })).toEqual({
      status: "disabled",
      eventId: null,
    });
  });

  it("pubblica e deduplica in shadow mode", async () => {
    const repository = createMemoryBusinessEventRepository();
    setFeatureFlags(
      9302,
      { eventBusMode: "shadow" },
      { actorUserId: 1, reason: "Attivazione test eventi" }
    );
    const event = buildAssignmentEvent({
      sedeId: 9302,
      entityType: "cliente",
      entityId: 51,
      previousAssigneeId: null,
      assigneeId: 8,
      actorUserId: 1,
      updatedAt: now,
      link: "/clienti/51",
    });

    const first = await publishDomainEvent(event!, { repository });
    const duplicate = await publishDomainEvent(event!, { repository });

    expect(first.status).toBe("inserted");
    expect(duplicate).toEqual({ status: "duplicate", eventId: first.eventId });
  });

  it("non costruisce un evento se l'assegnatario non cambia", () => {
    expect(
      buildAssignmentEvent({
        sedeId: 1,
        entityType: "commessa",
        entityId: 42,
        previousAssigneeId: 7,
        assigneeId: 7,
        actorUserId: 3,
        updatedAt: now,
        link: "/commesse/42",
      })
    ).toBeNull();
  });
});
