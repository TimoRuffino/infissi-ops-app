import { kvSql } from "../_core/persistence";
import type {
  Notification,
  NotificationDelivery,
  NotificationDeliveryDraft,
  NotificationDraft,
  NotificationPreferences,
  NotificationStatus,
} from "./types";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "./types";

type Scope = { sedeId: number; recipientUserId: number };
type MutationInput = Scope & { ids: number[]; now: Date };
type NotificationCursor = { createdAt: Date; id: number };
export type StoredPushSubscription = Scope & {
  id: number;
  endpointHash: string;
  encryptedSubscription: string;
};

export type NotificationRepository = {
  ensureSchema(): Promise<void>;
  upsert(draft: NotificationDraft): Promise<{ id: number; created: boolean }>;
  findById(id: number, recipientUserId: number, sedeId: number): Promise<Notification | null>;
  list(input: Scope & {
    statuses?: NotificationStatus[];
    priorities?: Notification["priority"][];
    types?: string[];
    cursor?: NotificationCursor;
    limit: number;
    now: Date;
  }): Promise<{ items: Notification[]; nextCursor: NotificationCursor | null }>;
  listAfterId(input: Scope & { afterId: number; limit: number; now: Date }): Promise<Notification[]>;
  markSeen(input: MutationInput): Promise<number>;
  markRead(input: MutationInput): Promise<number>;
  markAllRead(input: Scope & { types?: string[]; now: Date }): Promise<number>;
  resolve(input: MutationInput): Promise<number>;
  resolveGroup(input: Scope & { groupKey: string; now: Date }): Promise<number>;
  countUnread(input: Scope & { types?: string[]; now: Date }): Promise<number>;
  recordDelivery(draft: NotificationDeliveryDraft): Promise<{ id: number; created: boolean }>;
  getPreferences(input: Scope): Promise<NotificationPreferences>;
  setPreferences(input: Scope & { preferences: NotificationPreferences; now: Date }): Promise<NotificationPreferences>;
  upsertPushSubscription(input: Scope & { endpointHash: string; encryptedSubscription: string; now: Date }): Promise<{ id: number; created: boolean }>;
  listPushSubscriptions(input: Scope): Promise<StoredPushSubscription[]>;
  deactivatePushSubscription(input: Scope & { endpointHash: string; now: Date }): Promise<boolean>;
};

function cloneNotification(item: Notification): Notification {
  return structuredClone(item);
}

function isExpired(item: Notification, now: Date) {
  return item.expiresAt != null && item.expiresAt <= now;
}

export function createMemoryNotificationRepository(): NotificationRepository {
  const notifications: Notification[] = [];
  const deliveries: NotificationDelivery[] = [];
  const preferences = new Map<string, NotificationPreferences>();
  const pushSubscriptions: Array<StoredPushSubscription & { active: boolean }> = [];
  let nextNotificationId = 1;
  let nextDeliveryId = 1;
  let nextPushSubscriptionId = 1;

  function scoped(input: Scope, item: Notification) {
    return item.sedeId === input.sedeId && item.recipientUserId === input.recipientUserId;
  }

  function transition(input: MutationInput, mutate: (item: Notification) => boolean) {
    const ids = new Set(input.ids);
    let changed = 0;
    for (const item of notifications) {
      if (!ids.has(item.id) || !scoped(input, item)) continue;
      if (mutate(item)) {
        item.updatedAt = new Date(input.now);
        changed += 1;
      }
    }
    return changed;
  }

  return {
    async ensureSchema() {},

    async upsert(draft) {
      const existing = notifications.find(
        item =>
          item.sedeId === draft.sedeId &&
          item.recipientUserId === draft.recipientUserId &&
          item.canonicalKey === draft.canonicalKey
      );
      if (existing) {
        Object.assign(existing, structuredClone(draft), { updatedAt: new Date() });
        return { id: existing.id, created: false };
      }
      const item: Notification = {
        ...structuredClone(draft),
        id: nextNotificationId++,
        status: "unread",
        seenAt: null,
        readAt: null,
        actedAt: null,
        resolvedAt: null,
        updatedAt: new Date(draft.createdAt),
      };
      notifications.push(item);
      return { id: item.id, created: true };
    },

    async findById(id, recipientUserId, sedeId) {
      const item = notifications.find(
        candidate =>
          candidate.id === id &&
          candidate.recipientUserId === recipientUserId &&
          candidate.sedeId === sedeId
      );
      return item ? cloneNotification(item) : null;
    },

    async list(input) {
      const explicitStatuses = input.statuses?.length ? new Set(input.statuses) : null;
      const priorities = input.priorities?.length ? new Set(input.priorities) : null;
      const types = input.types?.length ? new Set(input.types) : null;
      const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 50);
      const items = notifications
        .filter(item => scoped(input, item))
        .filter(item =>
          explicitStatuses
            ? explicitStatuses.has(isExpired(item, input.now) ? "expired" : item.status)
            : item.status !== "resolved" && item.status !== "expired" && !isExpired(item, input.now)
        )
        .filter(item => !priorities || priorities.has(item.priority))
        .filter(item => !types || types.has(item.type))
        .filter(item =>
          !input.cursor ||
          item.createdAt < input.cursor.createdAt ||
          (item.createdAt.getTime() === input.cursor.createdAt.getTime() && item.id < input.cursor.id)
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id)
        .slice(0, limit + 1);
      const hasMore = items.length > limit;
      const page = items.slice(0, limit).map(cloneNotification);
      const last = hasMore ? page.at(-1) : null;
      return {
        items: page,
        nextCursor: last ? { createdAt: new Date(last.createdAt), id: last.id } : null,
      };
    },

    async listAfterId(input) {
      const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 100);
      return notifications
        .filter(item => scoped(input, item))
        .filter(item => item.id > input.afterId && !isExpired(item, input.now))
        .sort((a, b) => a.id - b.id)
        .slice(0, limit)
        .map(cloneNotification);
    },

    async markSeen(input) {
      return transition(input, item => {
        if (item.status !== "unread") return false;
        item.status = "seen";
        item.seenAt = new Date(input.now);
        return true;
      });
    },

    async markRead(input) {
      return transition(input, item => {
        if (item.status !== "unread" && item.status !== "seen") return false;
        item.status = "read";
        item.seenAt ??= new Date(input.now);
        item.readAt = new Date(input.now);
        return true;
      });
    },

    async markAllRead(input) {
      const types = input.types?.length ? new Set(input.types) : null;
      let changed = 0;
      for (const item of notifications) {
        if (
          !scoped(input, item) ||
          (types && !types.has(item.type)) ||
          (item.status !== "unread" && item.status !== "seen")
        ) {
          continue;
        }
        item.status = "read";
        item.seenAt ??= new Date(input.now);
        item.readAt = new Date(input.now);
        item.updatedAt = new Date(input.now);
        changed += 1;
      }
      return changed;
    },

    async resolve(input) {
      return transition(input, item => {
        if (item.status === "resolved" || item.status === "expired") return false;
        item.status = "resolved";
        item.resolvedAt = new Date(input.now);
        return true;
      });
    },

    async resolveGroup(input) {
      let changed = 0;
      for (const item of notifications) {
        if (
          !scoped(input, item) ||
          item.groupKey !== input.groupKey ||
          item.status === "resolved" ||
          item.status === "expired"
        ) {
          continue;
        }
        item.status = "resolved";
        item.resolvedAt = new Date(input.now);
        item.updatedAt = new Date(input.now);
        changed += 1;
      }
      return changed;
    },

    async countUnread(input) {
      const types = input.types?.length ? new Set(input.types) : null;
      return notifications.filter(
        item =>
          scoped(input, item) &&
          (!types || types.has(item.type)) &&
          item.status === "unread" &&
          !isExpired(item, input.now)
      ).length;
    },

    async recordDelivery(draft) {
      const existing = deliveries.find(
        item =>
          item.notificationId === draft.notificationId &&
          item.channel === draft.channel &&
          item.canonicalKey === draft.canonicalKey
      );
      if (existing) return { id: existing.id, created: false };
      const item = { ...structuredClone(draft), id: nextDeliveryId++ };
      deliveries.push(item);
      return { id: item.id, created: true };
    },

    async getPreferences(input) {
      return structuredClone(
        preferences.get(`${input.sedeId}:${input.recipientUserId}`) ??
          DEFAULT_NOTIFICATION_PREFERENCES
      );
    },

    async setPreferences(input) {
      const value = structuredClone(input.preferences);
      preferences.set(`${input.sedeId}:${input.recipientUserId}`, value);
      return structuredClone(value);
    },

    async upsertPushSubscription(input) {
      const existing = pushSubscriptions.find(
        item =>
          item.sedeId === input.sedeId &&
          item.recipientUserId === input.recipientUserId &&
          item.endpointHash === input.endpointHash
      );
      if (existing) {
        existing.encryptedSubscription = input.encryptedSubscription;
        existing.active = true;
        return { id: existing.id, created: false };
      }
      const item = {
        id: nextPushSubscriptionId++,
        sedeId: input.sedeId,
        recipientUserId: input.recipientUserId,
        endpointHash: input.endpointHash,
        encryptedSubscription: input.encryptedSubscription,
        active: true,
      };
      pushSubscriptions.push(item);
      return { id: item.id, created: true };
    },

    async listPushSubscriptions(input) {
      return pushSubscriptions
        .filter(item => item.active && item.sedeId === input.sedeId && item.recipientUserId === input.recipientUserId)
        .map(({ active: _active, ...item }) => structuredClone(item));
    },

    async deactivatePushSubscription(input) {
      const item = pushSubscriptions.find(
        candidate =>
          candidate.active &&
          candidate.sedeId === input.sedeId &&
          candidate.recipientUserId === input.recipientUserId &&
          candidate.endpointHash === input.endpointHash
      );
      if (!item) return false;
      item.active = false;
      return true;
    },
  };
}

function normalizePreferences(value: unknown): NotificationPreferences {
  const source = value && typeof value === "object" ? value as any : {};
  const quiet = source.quietHours;
  return {
    pushEnabled: source.pushEnabled === true,
    criticalFallbackEnabled: source.criticalFallbackEnabled === true,
    mutedTypes: Array.isArray(source.mutedTypes)
      ? source.mutedTypes.filter((item: unknown): item is string => typeof item === "string").slice(0, 50)
      : [],
    quietHours:
      quiet && typeof quiet.from === "string" && typeof quiet.to === "string"
        ? { from: quiet.from, to: quiet.to }
        : null,
  };
}

function rowToNotification(row: any): Notification {
  return {
    id: Number(row.id),
    sedeId: Number(row.sede_id),
    recipientUserId: Number(row.recipient_user_id),
    canonicalKey: row.canonical_key,
    type: row.type,
    priority: row.priority,
    title: row.title,
    body: row.body,
    link: row.link,
    groupKey: row.group_key ?? null,
    sourceEventId: row.source_event_id == null ? null : Number(row.source_event_id),
    entityRefs: Array.isArray(row.entity_refs) ? row.entity_refs : [],
    status: row.status,
    seenAt: row.seen_at ? new Date(row.seen_at) : null,
    readAt: row.read_at ? new Date(row.read_at) : null,
    actedAt: row.acted_at ? new Date(row.acted_at) : null,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
  };
}

export function createPostgresNotificationRepository(sql: NonNullable<typeof kvSql>): NotificationRepository {
  let schemaPromise: Promise<void> | null = null;
  const ensureSchema = () => {
    schemaPromise ??= sql.begin(async tx => {
      await tx`CREATE TABLE IF NOT EXISTS notifications (
        id BIGSERIAL PRIMARY KEY,
        sede_id INTEGER NOT NULL,
        recipient_user_id INTEGER NOT NULL,
        canonical_key TEXT NOT NULL,
        type TEXT NOT NULL,
        priority TEXT NOT NULL CHECK (priority IN ('critical','high','normal','low')),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        link TEXT NOT NULL,
        group_key TEXT,
        source_event_id BIGINT,
        entity_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
        status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread','seen','read','acted','resolved','expired')),
        seen_at TIMESTAMPTZ,
        read_at TIMESTAMPTZ,
        acted_at TIMESTAMPTZ,
        resolved_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (sede_id, recipient_user_id, canonical_key)
      )`;
      await tx`CREATE INDEX IF NOT EXISTS notifications_feed_idx ON notifications (sede_id, recipient_user_id, status, created_at DESC, id DESC)`;
      await tx`CREATE INDEX IF NOT EXISTS notifications_group_idx ON notifications (sede_id, recipient_user_id, group_key, created_at DESC)`;
      await tx`CREATE TABLE IF NOT EXISTS notification_deliveries (
        id BIGSERIAL PRIMARY KEY,
        notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
        channel TEXT NOT NULL CHECK (channel IN ('in_app','push','email')),
        canonical_key TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued','sent','skipped','failed')),
        attempted_at TIMESTAMPTZ NOT NULL,
        error_code TEXT,
        UNIQUE (notification_id, channel, canonical_key)
      )`;
      await tx`CREATE TABLE IF NOT EXISTS push_subscriptions (
        id BIGSERIAL PRIMARY KEY,
        sede_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        endpoint_hash TEXT NOT NULL,
        subscription JSONB NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (sede_id, user_id, endpoint_hash)
      )`;
      await tx`CREATE TABLE IF NOT EXISTS notification_preferences (
        sede_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (sede_id, user_id)
      )`;
    }).then(() => undefined);
    return schemaPromise;
  };

  async function updateStatus(input: MutationInput, status: NotificationStatus) {
    if (!input.ids.length) return 0;
    await ensureSchema();
    const allowedCurrentStatuses =
      status === "seen"
        ? ["unread"]
        : status === "read"
          ? ["unread", "seen"]
          : ["unread", "seen", "read", "acted"];
    const rows = await sql`
      UPDATE notifications
      SET status = ${status},
          seen_at = CASE WHEN ${status} IN ('seen','read') THEN COALESCE(seen_at, ${input.now}) ELSE seen_at END,
          read_at = CASE WHEN ${status} = 'read' THEN ${input.now} ELSE read_at END,
          resolved_at = CASE WHEN ${status} = 'resolved' THEN ${input.now} ELSE resolved_at END,
          updated_at = ${input.now}
      WHERE sede_id = ${input.sedeId}
        AND recipient_user_id = ${input.recipientUserId}
        AND id IN ${sql(input.ids)}
        AND status IN ${sql(allowedCurrentStatuses)}
      RETURNING id
    `;
    return rows.length;
  }

  return {
    ensureSchema,
    async upsert(draft) {
      await ensureSchema();
      const refs = sql.json(draft.entityRefs as any);
      const inserted = await sql`
        INSERT INTO notifications (
          sede_id, recipient_user_id, canonical_key, type, priority, title, body,
          link, group_key, source_event_id, entity_refs, created_at, expires_at
        ) VALUES (
          ${draft.sedeId}, ${draft.recipientUserId}, ${draft.canonicalKey}, ${draft.type},
          ${draft.priority}, ${draft.title}, ${draft.body}, ${draft.link}, ${draft.groupKey},
          ${draft.sourceEventId}, ${refs}, ${draft.createdAt}, ${draft.expiresAt}
        ) ON CONFLICT (sede_id, recipient_user_id, canonical_key) DO NOTHING
        RETURNING id
      `;
      if (inserted.length) return { id: Number(inserted[0].id), created: true };
      const updated = await sql`
        UPDATE notifications SET
          type = ${draft.type}, priority = ${draft.priority}, title = ${draft.title},
          body = ${draft.body}, link = ${draft.link}, group_key = ${draft.groupKey},
          source_event_id = ${draft.sourceEventId}, entity_refs = ${refs},
          expires_at = ${draft.expiresAt}, updated_at = NOW()
        WHERE sede_id = ${draft.sedeId} AND recipient_user_id = ${draft.recipientUserId}
          AND canonical_key = ${draft.canonicalKey}
        RETURNING id
      `;
      return { id: Number(updated[0].id), created: false };
    },
    async findById(id, recipientUserId, sedeId) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM notifications WHERE id = ${id} AND recipient_user_id = ${recipientUserId} AND sede_id = ${sedeId} LIMIT 1`;
      return rows.length ? rowToNotification(rows[0]) : null;
    },
    async list(input) {
      await ensureSchema();
      const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 50);
      const statuses = input.statuses?.length ? input.statuses : ["unread", "seen", "read", "acted"];
      const priorities = input.priorities?.length ? input.priorities : ["critical", "high", "normal", "low"];
      const types = input.types?.length ? input.types : [];
      const typeValues = types.length ? types : ["__all__"];
      const includeExpired = statuses.includes("expired");
      const activeStatuses = statuses.filter(status => status !== "expired");
      if (!activeStatuses.length) activeStatuses.push("expired");
      const cursorAt = input.cursor?.createdAt ?? new Date("9999-12-31T23:59:59.999Z");
      const cursorId = input.cursor?.id ?? Number.MAX_SAFE_INTEGER;
      const rows = await sql`
        SELECT * FROM notifications
        WHERE sede_id = ${input.sedeId} AND recipient_user_id = ${input.recipientUserId}
          AND priority IN ${sql(priorities)}
          AND (${types.length === 0} OR type IN ${sql(typeValues)})
          AND (
            (${includeExpired} AND expires_at IS NOT NULL AND expires_at <= ${input.now})
            OR ((expires_at IS NULL OR expires_at > ${input.now}) AND status IN ${sql(activeStatuses)})
          )
          AND (created_at < ${cursorAt} OR (created_at = ${cursorAt} AND id < ${cursorId}))
        ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}
      `;
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map(rowToNotification);
      const last = hasMore ? items.at(-1) : null;
      return { items, nextCursor: last ? { createdAt: last.createdAt, id: last.id } : null };
    },
    async listAfterId(input) {
      await ensureSchema();
      const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 100);
      const rows = await sql`
        SELECT * FROM notifications
        WHERE sede_id = ${input.sedeId} AND recipient_user_id = ${input.recipientUserId}
          AND id > ${input.afterId} AND (expires_at IS NULL OR expires_at > ${input.now})
        ORDER BY id ASC LIMIT ${limit}
      `;
      return rows.map(rowToNotification);
    },
    markSeen(input) {
      return updateStatus(input, "seen");
    },
    markRead(input) {
      return updateStatus(input, "read");
    },
    async markAllRead(input) {
      await ensureSchema();
      const types = input.types?.length ? input.types : [];
      const typeValues = types.length ? types : ["__all__"];
      const rows = await sql`
        UPDATE notifications
        SET status = 'read', seen_at = COALESCE(seen_at, ${input.now}),
          read_at = ${input.now}, updated_at = ${input.now}
        WHERE sede_id = ${input.sedeId}
          AND recipient_user_id = ${input.recipientUserId}
          AND (${types.length === 0} OR type IN ${sql(typeValues)})
          AND status IN ('unread','seen')
        RETURNING id
      `;
      return rows.length;
    },
    resolve(input) {
      return updateStatus(input, "resolved");
    },
    async resolveGroup(input) {
      await ensureSchema();
      const rows = await sql`
        UPDATE notifications SET status = 'resolved', resolved_at = ${input.now}, updated_at = ${input.now}
        WHERE sede_id = ${input.sedeId} AND recipient_user_id = ${input.recipientUserId}
          AND group_key = ${input.groupKey} AND status IN ('unread','seen','read','acted')
        RETURNING id
      `;
      return rows.length;
    },
    async countUnread(input) {
      await ensureSchema();
      const types = input.types?.length ? input.types : [];
      const typeValues = types.length ? types : ["__all__"];
      const rows = await sql`SELECT COUNT(*)::int AS count FROM notifications
        WHERE sede_id = ${input.sedeId}
          AND recipient_user_id = ${input.recipientUserId}
          AND (${types.length === 0} OR type IN ${sql(typeValues)})
          AND status = 'unread'
          AND (expires_at IS NULL OR expires_at > ${input.now})`;
      return Number(rows[0]?.count ?? 0);
    },
    async recordDelivery(draft) {
      await ensureSchema();
      const inserted = await sql`
        INSERT INTO notification_deliveries (notification_id, channel, canonical_key, status, attempted_at, error_code)
        VALUES (${draft.notificationId}, ${draft.channel}, ${draft.canonicalKey}, ${draft.status}, ${draft.attemptedAt}, ${draft.errorCode})
        ON CONFLICT (notification_id, channel, canonical_key) DO NOTHING RETURNING id
      `;
      if (inserted.length) return { id: Number(inserted[0].id), created: true };
      const rows = await sql`SELECT id FROM notification_deliveries WHERE notification_id = ${draft.notificationId} AND channel = ${draft.channel} AND canonical_key = ${draft.canonicalKey} LIMIT 1`;
      return { id: Number(rows[0].id), created: false };
    },
    async getPreferences(input) {
      await ensureSchema();
      const rows = await sql`SELECT preferences FROM notification_preferences WHERE sede_id = ${input.sedeId} AND user_id = ${input.recipientUserId} LIMIT 1`;
      return rows.length
        ? normalizePreferences(rows[0].preferences)
        : structuredClone(DEFAULT_NOTIFICATION_PREFERENCES);
    },
    async setPreferences(input) {
      await ensureSchema();
      const value = normalizePreferences(input.preferences);
      const json = sql.json(value as any);
      await sql`
        INSERT INTO notification_preferences (sede_id, user_id, preferences, updated_at)
        VALUES (${input.sedeId}, ${input.recipientUserId}, ${json}, ${input.now})
        ON CONFLICT (sede_id, user_id) DO UPDATE
          SET preferences = EXCLUDED.preferences, updated_at = EXCLUDED.updated_at
      `;
      return value;
    },
    async upsertPushSubscription(input) {
      await ensureSchema();
      const subscription = sql.json({ encrypted: input.encryptedSubscription } as any);
      const rows = await sql`
        INSERT INTO push_subscriptions (
          sede_id, user_id, endpoint_hash, subscription, active, created_at, updated_at
        ) VALUES (
          ${input.sedeId}, ${input.recipientUserId}, ${input.endpointHash}, ${subscription}, TRUE, ${input.now}, ${input.now}
        )
        ON CONFLICT (sede_id, user_id, endpoint_hash) DO UPDATE SET
          subscription = EXCLUDED.subscription, active = TRUE, updated_at = EXCLUDED.updated_at
        RETURNING id, (xmax = 0) AS created
      `;
      return { id: Number(rows[0].id), created: Boolean(rows[0].created) };
    },
    async listPushSubscriptions(input) {
      await ensureSchema();
      const rows = await sql`
        SELECT id, sede_id, user_id, endpoint_hash, subscription
        FROM push_subscriptions
        WHERE sede_id = ${input.sedeId} AND user_id = ${input.recipientUserId} AND active = TRUE
      `;
      return rows.flatMap(row => {
        const encrypted = row.subscription?.encrypted;
        return typeof encrypted === "string"
          ? [{
              id: Number(row.id),
              sedeId: Number(row.sede_id),
              recipientUserId: Number(row.user_id),
              endpointHash: row.endpoint_hash,
              encryptedSubscription: encrypted,
            }]
          : [];
      });
    },
    async deactivatePushSubscription(input) {
      await ensureSchema();
      const rows = await sql`
        UPDATE push_subscriptions SET active = FALSE, updated_at = ${input.now}
        WHERE sede_id = ${input.sedeId} AND user_id = ${input.recipientUserId}
          AND endpoint_hash = ${input.endpointHash} AND active = TRUE
        RETURNING id
      `;
      return rows.length > 0;
    },
  };
}

let repository: NotificationRepository | null = null;
let repositoryOverride: NotificationRepository | null = null;

export function getNotificationRepository(): NotificationRepository {
  if (repositoryOverride) return repositoryOverride;
  repository ??= kvSql
    ? createPostgresNotificationRepository(kvSql)
    : createMemoryNotificationRepository();
  return repository;
}

export function setNotificationRepositoryForTesting(
  value: NotificationRepository | null,
) {
  repositoryOverride = value;
}
