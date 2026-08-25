import { describe, expect, it } from "vitest";
import { createMemoryNotificationRepository } from "./repository";

const now = new Date("2026-08-25T12:00:00.000Z");

function draft(overrides: Record<string, unknown> = {}) {
  return {
    sedeId: 1,
    recipientUserId: 7,
    canonicalKey: "commessa:42:assigned:7",
    type: "assignment",
    priority: "high" as const,
    title: "Nuova commessa assegnata",
    body: "Hai una nuova responsabilita",
    link: "/commesse/42",
    groupKey: "commessa:42",
    sourceEventId: 11,
    entityRefs: [{ type: "commessa", id: "42" }],
    createdAt: now,
    expiresAt: null,
    ...overrides,
  };
}

describe("notification repository", () => {
  it("deduplica per sede destinatario e chiave canonica", async () => {
    const repo = createMemoryNotificationRepository();
    const first = await repo.upsert(draft());
    const duplicate = await repo.upsert(draft({ title: "Titolo aggiornato" }));

    expect(first.created).toBe(true);
    expect(duplicate).toEqual({ id: first.id, created: false });
    expect((await repo.findById(first.id, 7, 1))?.title).toBe("Titolo aggiornato");
  });

  it("isola per sede e destinatario e separa lettura da risoluzione", async () => {
    const repo = createMemoryNotificationRepository();
    const { id } = await repo.upsert(draft());

    expect(await repo.findById(id, 8, 1)).toBeNull();
    expect(await repo.findById(id, 7, 2)).toBeNull();
    await repo.markSeen({ sedeId: 1, recipientUserId: 7, ids: [id], now });
    expect((await repo.findById(id, 7, 1))?.status).toBe("seen");
    await repo.markRead({ sedeId: 1, recipientUserId: 7, ids: [id], now });
    expect((await repo.findById(id, 7, 1))?.status).toBe("read");
    await repo.resolve({ sedeId: 1, recipientUserId: 7, ids: [id], now });
    expect((await repo.findById(id, 7, 1))?.status).toBe("resolved");
    expect(await repo.countUnread({ sedeId: 1, recipientUserId: 7, now })).toBe(0);
  });

  it("pagina il feed in ordine stabile e filtra le risolte", async () => {
    const repo = createMemoryNotificationRepository();
    const first = await repo.upsert(draft({ canonicalKey: "a", createdAt: new Date(now.getTime() - 1000) }));
    await repo.upsert(draft({ canonicalKey: "b", createdAt: now }));
    await repo.resolve({ sedeId: 1, recipientUserId: 7, ids: [first.id], now });

    const active = await repo.list({ sedeId: 1, recipientUserId: 7, limit: 10, now });
    const resolved = await repo.list({
      sedeId: 1,
      recipientUserId: 7,
      statuses: ["resolved"],
      limit: 10,
      now,
    });

    expect(active.items.map(item => item.canonicalKey)).toEqual(["b"]);
    expect(resolved.items.map(item => item.canonicalKey)).toEqual(["a"]);
  });

  it("registra una sola consegna per canale e tentativo canonico", async () => {
    const repo = createMemoryNotificationRepository();
    const { id } = await repo.upsert(draft());
    const first = await repo.recordDelivery({
      notificationId: id,
      channel: "push",
      canonicalKey: `push:${id}`,
      status: "queued",
      attemptedAt: now,
      errorCode: null,
    });
    const duplicate = await repo.recordDelivery({
      notificationId: id,
      channel: "push",
      canonicalKey: `push:${id}`,
      status: "queued",
      attemptedAt: now,
      errorCode: null,
    });

    expect(first.created).toBe(true);
    expect(duplicate).toEqual({ id: first.id, created: false });
  });

  it("risolve tutte le notifiche attive di un gruppo per il solo destinatario", async () => {
    const repo = createMemoryNotificationRepository();
    const own = await repo.upsert(draft({ canonicalKey: "own", groupKey: "commessa:42" }));
    await repo.upsert(draft({ canonicalKey: "other", recipientUserId: 8, groupKey: "commessa:42" }));

    expect(
      await repo.resolveGroup({
        sedeId: 1,
        recipientUserId: 7,
        groupKey: "commessa:42",
        now,
      })
    ).toBe(1);
    expect((await repo.findById(own.id, 7, 1))?.status).toBe("resolved");
    expect(await repo.countUnread({ sedeId: 1, recipientUserId: 8, now })).toBe(1);
  });
});
