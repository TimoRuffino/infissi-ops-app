export type NotificationStatus =
  | "unread"
  | "seen"
  | "read"
  | "acted"
  | "resolved"
  | "expired";

export type NotificationPriority = "critical" | "high" | "normal" | "low";

export type NotificationEntityRef = { type: string; id: string };

export type NotificationDraft = {
  sedeId: number;
  recipientUserId: number;
  canonicalKey: string;
  type: string;
  priority: NotificationPriority;
  title: string;
  body: string;
  link: string;
  groupKey: string | null;
  sourceEventId: number | null;
  entityRefs: NotificationEntityRef[];
  createdAt: Date;
  expiresAt: Date | null;
};

export type Notification = NotificationDraft & {
  id: number;
  status: NotificationStatus;
  seenAt: Date | null;
  readAt: Date | null;
  actedAt: Date | null;
  resolvedAt: Date | null;
  updatedAt: Date;
};

export type NotificationDeliveryChannel = "in_app" | "push" | "email";
export type NotificationDeliveryStatus =
  | "queued"
  | "sent"
  | "skipped"
  | "failed";

export type NotificationDeliveryDraft = {
  notificationId: number;
  channel: NotificationDeliveryChannel;
  canonicalKey: string;
  status: NotificationDeliveryStatus;
  attemptedAt: Date;
  errorCode: string | null;
};

export type NotificationDelivery = NotificationDeliveryDraft & {
  id: number;
};

export type NotificationPreferences = {
  pushEnabled: boolean;
  criticalFallbackEnabled: boolean;
  mutedTypes: string[];
  quietHours: { from: string; to: string } | null;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  pushEnabled: false,
  criticalFallbackEnabled: false,
  mutedTypes: [],
  quietHours: null,
};
