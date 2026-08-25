import webpush from "web-push";

export type PushSubscriptionRecord = {
  endpointHash: string;
  subscription: webpush.PushSubscription;
};

export type WebPushSender = {
  send(input: {
    subscription: PushSubscriptionRecord;
    payload: string;
  }): Promise<"sent" | "invalid" | "failed">;
};

export function webPushConfigured() {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT
  );
}

export function createWebPushSender(): WebPushSender {
  if (webPushConfigured()) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT!,
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    );
  }
  return {
    async send(input) {
      if (!webPushConfigured()) return "failed";
      try {
        await webpush.sendNotification(input.subscription.subscription, input.payload, {
          TTL: 60 * 60,
          urgency: "high",
        });
        return "sent";
      } catch (error) {
        const statusCode = Number((error as any)?.statusCode ?? 0);
        if (statusCode === 404 || statusCode === 410) return "invalid";
        return "failed";
      }
    },
  };
}
