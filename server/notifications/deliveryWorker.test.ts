import { describe, expect, it } from "vitest";
import { createMemoryNotificationRepository } from "./repository";
import { buildPrivacySafePushPayload, processNotificationDelivery } from "./deliveryWorker";
import type { Notification } from "./types";

const notification: Notification = {
  id: 12,
  sedeId: 1,
  recipientUserId: 7,
  canonicalKey: "event:12",
  type: "assignment",
  priority: "critical",
  title: "Cliente Segreto 3390000000",
  body: "Preventivo da 18.900 euro per Mario Rossi",
  link: "/commesse/42",
  groupKey: "commessa:42",
  sourceEventId: 1,
  entityRefs: [{ type: "commessa", id: "42" }],
  status: "unread",
  seenAt: null,
  readAt: null,
  actedAt: null,
  resolvedAt: null,
  createdAt: new Date("2026-08-25T12:00:00Z"),
  updatedAt: new Date("2026-08-25T12:00:00Z"),
  expiresAt: null,
};

describe("notification delivery", () => {
  it("costruisce un payload push privo di dati cliente", () => {
    const payload = buildPrivacySafePushPayload(notification);
    const serialized = JSON.stringify(payload);
    expect(payload).toEqual({
      notificationId: 12,
      title: "Ruffino Flow",
      genericBody: "Hai una nuova attivita critica da gestire.",
      link: "/commesse/42",
    });
    expect(serialized).not.toMatch(/Segreto|3390000000|18\.900|Mario Rossi/);
  });

  it("accoda il fallback critico una sola volta", async () => {
    const repository = createMemoryNotificationRepository();
    const stored = await repository.upsert(notification);
    const item = (await repository.findById(stored.id, 7, 1))!;
    let fallbackCalls = 0;
    const input = {
      notification: item,
      preferences: {
        pushEnabled: false,
        criticalFallbackEnabled: true,
        mutedTypes: [],
        quietHours: null,
      },
      subscriptions: [],
      repository,
      webPushEnabled: false,
      webPushSender: { send: async () => "sent" as const },
      fallbackSender: {
        send: async () => {
          fallbackCalls += 1;
          return "skipped" as const;
        },
      },
    };

    await processNotificationDelivery(input);
    await processNotificationDelivery(input);
    expect(fallbackCalls).toBe(1);
  });
});
