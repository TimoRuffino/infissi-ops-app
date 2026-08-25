import type { NotificationRepository } from "./repository";
import type {
  Notification,
  NotificationPreferences,
} from "./types";
import type { PushSubscriptionRecord, WebPushSender } from "./push";
import { createWebPushSender } from "./push";
import { getNotificationRepository } from "./repository";
import { decryptSecret } from "../_core/secretBox";
import { getFeatureFlags } from "../platform/featureFlags";

export type CriticalFallbackSender = {
  send(input: {
    userId: number;
    notificationId: number;
  }): Promise<"sent" | "skipped">;
};

export const disabledCriticalFallbackSender: CriticalFallbackSender = {
  async send() {
    return "skipped";
  },
};

export function buildPrivacySafePushPayload(notification: Notification) {
  return {
    notificationId: notification.id,
    title: "Ruffino Flow",
    genericBody:
      notification.priority === "critical"
        ? "Hai una nuova attivita critica da gestire."
        : "Hai un nuovo aggiornamento da gestire.",
    link: notification.link,
  };
}

export async function processNotificationDelivery(input: {
  notification: Notification;
  preferences: NotificationPreferences;
  subscriptions: PushSubscriptionRecord[];
  repository: NotificationRepository;
  webPushEnabled: boolean;
  webPushSender: WebPushSender;
  fallbackSender: CriticalFallbackSender;
  onInvalidSubscription?: (subscription: PushSubscriptionRecord) => Promise<void>;
}) {
  if (input.preferences.mutedTypes.includes(input.notification.type)) {
    return { pushSent: 0, fallback: "skipped" as const };
  }
  let pushSent = 0;
  if (input.webPushEnabled && input.preferences.pushEnabled) {
    const payload = JSON.stringify(buildPrivacySafePushPayload(input.notification));
    for (const subscription of input.subscriptions) {
      const reserved = await input.repository.recordDelivery({
        notificationId: input.notification.id,
        channel: "push",
        canonicalKey: `push:${input.notification.id}:${subscription.endpointHash}`,
        status: "queued",
        attemptedAt: new Date(),
        errorCode: null,
      });
      if (!reserved.created) continue;
      const outcome = await input.webPushSender.send({ subscription, payload });
      if (outcome === "sent") pushSent += 1;
      if (outcome === "invalid") await input.onInvalidSubscription?.(subscription);
    }
  }

  let fallback: "sent" | "skipped" = "skipped";
  if (
    input.notification.priority === "critical" &&
    input.preferences.criticalFallbackEnabled &&
    pushSent === 0
  ) {
    const reserved = await input.repository.recordDelivery({
      notificationId: input.notification.id,
      channel: "email",
      canonicalKey: `critical-fallback:${input.notification.id}`,
      status: "queued",
      attemptedAt: new Date(),
      errorCode: null,
    });
    if (reserved.created) {
      fallback = await input.fallbackSender.send({
        userId: input.notification.recipientUserId,
        notificationId: input.notification.id,
      });
    }
  }
  return { pushSent, fallback };
}

export async function deliverStoredNotification(input: {
  notificationId: number;
  sedeId: number;
  recipientUserId: number;
}) {
  const repository = getNotificationRepository();
  const notification = await repository.findById(
    input.notificationId,
    input.recipientUserId,
    input.sedeId
  );
  if (!notification) return { pushSent: 0, fallback: "skipped" as const };
  const preferences = await repository.getPreferences(input);
  const stored = await repository.listPushSubscriptions(input);
  const subscriptions = stored.flatMap(item => {
    try {
      return [{
        endpointHash: item.endpointHash,
        subscription: JSON.parse(decryptSecret(item.encryptedSubscription)),
      }];
    } catch {
      return [];
    }
  });
  return processNotificationDelivery({
    notification,
    preferences,
    subscriptions,
    repository,
    webPushEnabled: getFeatureFlags(input.sedeId).webPushEnabled,
    webPushSender: createWebPushSender(),
    fallbackSender: disabledCriticalFallbackSender,
    onInvalidSubscription: async subscription => {
      await repository.deactivatePushSubscription({
        ...input,
        endpointHash: subscription.endpointHash,
        now: new Date(),
      });
    },
  });
}
