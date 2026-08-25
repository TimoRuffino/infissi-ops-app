import { describe, expect, it, vi } from "vitest";
import type { BusinessEvent } from "../../events/types";
import { createSearchEventConsumer } from "./consumer";
import { createMemorySearchRepository } from "./repository";

function event(overrides: Partial<BusinessEvent> = {}): BusinessEvent {
  return {
    id: 1,
    sedeId: 7,
    eventType: "comunicazione.updated",
    source: { type: "comunicazione", id: "42", version: "v2" },
    actorUserId: 3,
    subjectRefs: [{ type: "cliente", id: "8" }],
    recipientHints: [],
    payload: { version: 1 },
    dedupeKey: "search:1",
    occurredAt: new Date("2026-08-25T09:00:00Z"),
    createdAt: new Date("2026-08-25T09:00:01Z"),
    ...overrides,
  };
}

describe("search event consumer", () => {
  it("indicizza una fonte risolta quando la ricerca e in shadow", async () => {
    const repository = createMemorySearchRepository();
    const consumer = createSearchEventConsumer({
      repository,
      modeForSede: () => "shadow",
      resolveSources: vi.fn().mockResolvedValue([
        {
          scope: "operativo",
          sourceType: "whatsapp",
          sourceId: "42",
          sourceVersion: "v2",
          text: "Richiesta preventivo serramenti",
          entityRefs: [{ type: "cliente", id: "8" }],
          occurredAt: new Date("2026-08-25T09:00:00Z"),
        },
      ]),
    });

    await consumer.handle(event());

    await expect(
      repository.searchCandidates({
        query: "preventivo",
        sedeId: 7,
        scopes: ["operativo"],
        limit: 10,
      })
    ).resolves.toHaveLength(1);
  });

  it("rimuove la fonte su evento di cancellazione", async () => {
    const repository = createMemorySearchRepository();
    await repository.upsertSource({
      sedeId: 7,
      scope: "operativo",
      sourceType: "comunicazione",
      sourceId: "42",
      sourceVersion: "v1",
      chunks: [
        {
          content: "testo da eliminare",
          checksum: "x",
          entityRefs: [],
          occurredAt: null,
          embedding: null,
        },
      ],
    });
    const resolveSources = vi.fn();
    const consumer = createSearchEventConsumer({
      repository,
      modeForSede: () => "active",
      resolveSources,
    });

    await consumer.handle(event({ eventType: "comunicazione.deleted" }));

    expect(resolveSources).not.toHaveBeenCalled();
    await expect(
      repository.searchCandidates({
        query: "eliminare",
        sedeId: 7,
        scopes: ["operativo"],
        limit: 10,
      })
    ).resolves.toHaveLength(0);
  });

  it("non indicizza quando la feature e spenta", async () => {
    const resolveSources = vi.fn();
    const consumer = createSearchEventConsumer({
      modeForSede: () => "off",
      resolveSources,
    });
    await consumer.handle(event());
    expect(resolveSources).not.toHaveBeenCalled();
  });
});
