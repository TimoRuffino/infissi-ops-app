import { kvSql } from "../_core/persistence";
import type {
  CreateReminderInput,
  Reminder,
  ReminderEvent,
  ReminderEventType,
  ReminderListInput,
  ReminderMutationInput,
  ReminderScope,
} from "./types";

export type ReminderRepository = {
  ensureSchema(): Promise<void>;
  create(input: CreateReminderInput): Promise<{ record: Reminder; created: boolean }>;
  findById(
    sedeId: number,
    recipientUserId: number,
    id: number,
  ): Promise<Reminder | null>;
  listPopupDue(input: ReminderScope & { limit: number }): Promise<Reminder[]>;
  listPersonal(input: ReminderListInput): Promise<Reminder[]>;
  claimDue(input: { now: Date; limit: number }): Promise<Reminder[]>;
  listPendingNotification(limit: number): Promise<Reminder[]>;
  markNotificationProjected(input: {
    id: number;
    revision: number;
    now: Date;
  }): Promise<boolean>;
  dismissPopup(input: ReminderMutationInput): Promise<Reminder | null>;
  complete(input: ReminderMutationInput): Promise<Reminder | null>;
  snooze(
    input: ReminderMutationInput & { remindAt: Date },
  ): Promise<Reminder | null>;
  cancel(input: ReminderMutationInput): Promise<Reminder | null>;
  listEvents(sedeId: number, reminderId: number): Promise<ReminderEvent[]>;
};

function cloneReminder(record: Reminder): Reminder {
  return structuredClone(record);
}

export function createMemoryReminderRepository(): ReminderRepository {
  const records: Reminder[] = [];
  const events: ReminderEvent[] = [];
  let nextId = 1;
  let nextEventId = 1;

  function scopedFind(input: ReminderScope & { id: number }) {
    return records.find(
      (item) =>
        item.id === input.id &&
        item.sedeId === input.sedeId &&
        item.recipientUserId === input.recipientUserId,
    );
  }

  function append(
    reminder: Reminder,
    actorUserId: number | null,
    eventType: ReminderEventType,
    metadata: Record<string, unknown> = {},
    createdAt = reminder.updatedAt,
  ) {
    events.push({
      id: nextEventId++,
      reminderId: reminder.id,
      sedeId: reminder.sedeId,
      actorUserId,
      eventType,
      metadata: structuredClone(metadata),
      createdAt: new Date(createdAt),
    });
  }

  return {
    async ensureSchema() {},

    async create(input) {
      const existing = records.find(
        (item) =>
          item.sedeId === input.sedeId &&
          (item.canonicalKey === input.canonicalKey ||
            (input.sourceProposalId != null &&
              item.sourceProposalId === input.sourceProposalId)),
      );
      if (existing) {
        return { record: cloneReminder(existing), created: false };
      }

      const record: Reminder = {
        id: nextId++,
        sedeId: input.sedeId,
        recipientUserId: input.recipientUserId,
        createdByUserId: input.createdByUserId,
        sourceProposalId: input.sourceProposalId,
        canonicalKey: input.canonicalKey,
        text: input.text,
        remindAt: new Date(input.remindAt),
        timezone: input.timezone,
        status: "scheduled",
        revision: 1,
        clienteId: input.clienteId,
        commessaId: input.commessaId,
        popupDismissedAt: null,
        firedAt: null,
        notificationRevision: 0,
        completedAt: null,
        cancelledAt: null,
        createdAt: new Date(input.now),
        updatedAt: new Date(input.now),
      };
      records.push(record);
      append(record, input.createdByUserId, "created", {
        revision: record.revision,
        remindAt: record.remindAt.toISOString(),
      });
      return { record: cloneReminder(record), created: true };
    },

    async findById(sedeId, recipientUserId, id) {
      const record = scopedFind({ sedeId, recipientUserId, id });
      return record ? cloneReminder(record) : null;
    },

    async listPopupDue(input) {
      const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 50);
      return records
        .filter(
          (item) =>
            item.sedeId === input.sedeId &&
            item.recipientUserId === input.recipientUserId &&
            item.status === "due" &&
            item.popupDismissedAt == null,
        )
        .sort(
          (a, b) => a.remindAt.getTime() - b.remindAt.getTime() || a.id - b.id,
        )
        .slice(0, limit)
        .map(cloneReminder);
    },

    async listPersonal(input) {
      const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 100);
      const filtrati = records.filter(
        (item) =>
          item.sedeId === input.sedeId &&
          item.recipientUserId === input.recipientUserId &&
          input.stati.includes(item.status) &&
          (!input.daRemindAt || item.remindAt >= input.daRemindAt) &&
          (!input.aRemindAt || item.remindAt <= input.aRemindAt),
      );
      filtrati.sort((a, b) =>
        input.ordina === "creazioneDesc"
          ? b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id
          : a.remindAt.getTime() - b.remindAt.getTime() || a.id - b.id,
      );
      return filtrati.slice(0, limit).map(cloneReminder);
    },

    async claimDue(input) {
      const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 100);
      const claimed = records
        .filter(
          (item) =>
            item.status === "scheduled" && item.remindAt.getTime() <= input.now.getTime(),
        )
        .sort(
          (a, b) => a.remindAt.getTime() - b.remindAt.getTime() || a.id - b.id,
        )
        .slice(0, limit);

      for (const item of claimed) {
        item.status = "due";
        item.firedAt = new Date(input.now);
        item.updatedAt = new Date(input.now);
        append(item, null, "fired", { revision: item.revision }, input.now);
      }
      return claimed.map(cloneReminder);
    },

    async listPendingNotification(limit) {
      const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
      return records
        .filter(
          (item) =>
            item.status === "due" && item.notificationRevision < item.revision,
        )
        .sort(
          (a, b) => a.remindAt.getTime() - b.remindAt.getTime() || a.id - b.id,
        )
        .slice(0, boundedLimit)
        .map(cloneReminder);
    },

    async markNotificationProjected(input) {
      const item = records.find((candidate) => candidate.id === input.id);
      if (
        !item ||
        item.status !== "due" ||
        item.revision !== input.revision ||
        item.notificationRevision >= input.revision
      ) {
        return false;
      }
      item.notificationRevision = input.revision;
      item.updatedAt = new Date(input.now);
      return true;
    },

    async dismissPopup(input) {
      const item = scopedFind(input);
      if (!item || item.status !== "due") return null;
      if (item.popupDismissedAt != null) return cloneReminder(item);
      item.popupDismissedAt = new Date(input.now);
      item.updatedAt = new Date(input.now);
      append(item, input.actorUserId, "popup_dismissed", {
        revision: item.revision,
      });
      return cloneReminder(item);
    },

    async complete(input) {
      const item = scopedFind(input);
      if (!item || item.status === "cancelled") return null;
      if (item.status === "completed") return cloneReminder(item);
      item.status = "completed";
      item.completedAt = new Date(input.now);
      item.updatedAt = new Date(input.now);
      append(item, input.actorUserId, "completed", { revision: item.revision });
      return cloneReminder(item);
    },

    async snooze(input) {
      const item = scopedFind(input);
      if (!item || item.status === "completed" || item.status === "cancelled") {
        return null;
      }
      item.status = "scheduled";
      item.remindAt = new Date(input.remindAt);
      item.revision += 1;
      item.popupDismissedAt = null;
      item.firedAt = null;
      item.notificationRevision = 0;
      item.updatedAt = new Date(input.now);
      append(item, input.actorUserId, "snoozed", {
        revision: item.revision,
        remindAt: item.remindAt.toISOString(),
      });
      return cloneReminder(item);
    },

    async cancel(input) {
      const item = scopedFind(input);
      if (!item || item.status === "completed") return null;
      if (item.status === "cancelled") return cloneReminder(item);
      item.status = "cancelled";
      item.cancelledAt = new Date(input.now);
      item.updatedAt = new Date(input.now);
      append(item, input.actorUserId, "cancelled", { revision: item.revision });
      return cloneReminder(item);
    },

    async listEvents(sedeId, reminderId) {
      return events
        .filter(
          (event) => event.sedeId === sedeId && event.reminderId === reminderId,
        )
        .sort((a, b) => a.id - b.id)
        .map((event) => structuredClone(event));
    },
  };
}

function rowToReminder(row: any): Reminder {
  return {
    id: Number(row.id),
    sedeId: Number(row.sede_id),
    recipientUserId: Number(row.recipient_user_id),
    createdByUserId: Number(row.created_by_user_id),
    sourceProposalId:
      row.source_proposal_id == null ? null : Number(row.source_proposal_id),
    canonicalKey: row.canonical_key,
    text: row.text,
    remindAt: new Date(row.remind_at),
    timezone: "Europe/Rome",
    status: row.status,
    revision: Number(row.revision),
    clienteId: row.cliente_id == null ? null : Number(row.cliente_id),
    commessaId: row.commessa_id == null ? null : Number(row.commessa_id),
    popupDismissedAt: row.popup_dismissed_at
      ? new Date(row.popup_dismissed_at)
      : null,
    firedAt: row.fired_at ? new Date(row.fired_at) : null,
    notificationRevision: Number(row.notification_revision),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function rowToReminderEvent(row: any): ReminderEvent {
  return {
    id: Number(row.id),
    reminderId: Number(row.promemoria_id),
    sedeId: Number(row.sede_id),
    actorUserId: row.actor_user_id == null ? null : Number(row.actor_user_id),
    eventType: row.event_type,
    metadata: row.metadata ?? {},
    createdAt: new Date(row.created_at),
  };
}

export function createPostgresReminderRepository(
  sql: NonNullable<typeof kvSql>,
): ReminderRepository {
  let schemaPromise: Promise<void> | null = null;

  const ensureSchema = () => {
    schemaPromise ??= sql
      .begin(async (tx) => {
        await tx`CREATE TABLE IF NOT EXISTS promemoria (
          id BIGSERIAL PRIMARY KEY,
          sede_id BIGINT NOT NULL,
          recipient_user_id BIGINT NOT NULL,
          created_by_user_id BIGINT NOT NULL,
          source_proposal_id BIGINT,
          canonical_key TEXT NOT NULL,
          text TEXT NOT NULL CHECK (LENGTH(BTRIM(text)) > 0),
          remind_at TIMESTAMPTZ NOT NULL,
          timezone TEXT NOT NULL DEFAULT 'Europe/Rome' CHECK (timezone = 'Europe/Rome'),
          status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','due','completed','cancelled')),
          revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
          cliente_id BIGINT,
          commessa_id BIGINT,
          popup_dismissed_at TIMESTAMPTZ,
          fired_at TIMESTAMPTZ,
          notification_revision INTEGER NOT NULL DEFAULT 0,
          completed_at TIMESTAMPTZ,
          cancelled_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (sede_id, canonical_key),
          CHECK (notification_revision >= 0 AND notification_revision <= revision)
        )`;
        await tx`CREATE UNIQUE INDEX IF NOT EXISTS promemoria_source_proposal_idx
          ON promemoria (sede_id, source_proposal_id)
          WHERE source_proposal_id IS NOT NULL`;
        await tx`CREATE INDEX IF NOT EXISTS promemoria_worker_idx
          ON promemoria (status, remind_at, id)`;
        await tx`CREATE INDEX IF NOT EXISTS promemoria_popup_idx
          ON promemoria (sede_id, recipient_user_id, status, remind_at)`;
        await tx`CREATE TABLE IF NOT EXISTS promemoria_eventi (
          id BIGSERIAL PRIMARY KEY,
          promemoria_id BIGINT NOT NULL REFERENCES promemoria(id) ON DELETE CASCADE,
          sede_id BIGINT NOT NULL,
          actor_user_id BIGINT,
          event_type TEXT NOT NULL CHECK (event_type IN ('created','fired','popup_dismissed','completed','snoozed','cancelled')),
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
        await tx`CREATE INDEX IF NOT EXISTS promemoria_eventi_reminder_idx
          ON promemoria_eventi (sede_id, promemoria_id, id)`;
      })
      .then(() => undefined)
      .catch((error) => {
        schemaPromise = null;
        throw error;
      });
    return schemaPromise;
  };

  return {
    ensureSchema,

    async create(input) {
      await ensureSchema();
      return sql.begin(async (tx) => {
        const rows = await tx`INSERT INTO promemoria (
          sede_id, recipient_user_id, created_by_user_id, source_proposal_id,
          canonical_key, text, remind_at, timezone, status, revision,
          cliente_id, commessa_id, created_at, updated_at
        ) VALUES (
          ${input.sedeId}, ${input.recipientUserId}, ${input.createdByUserId},
          ${input.sourceProposalId}, ${input.canonicalKey}, ${input.text},
          ${input.remindAt}, ${input.timezone}, 'scheduled', 1,
          ${input.clienteId}, ${input.commessaId}, ${input.now}, ${input.now}
        ) ON CONFLICT DO NOTHING RETURNING *`;
        if (rows[0]) {
          const record = rowToReminder(rows[0]);
          await tx`INSERT INTO promemoria_eventi (
            promemoria_id, sede_id, actor_user_id, event_type, metadata, created_at
          ) VALUES (
            ${record.id}, ${record.sedeId}, ${input.createdByUserId}, 'created',
            ${tx.json({
              revision: record.revision,
              remindAt: record.remindAt.toISOString(),
            })}, ${input.now}
          )`;
          return { record, created: true };
        }

        const existing = await tx`SELECT * FROM promemoria
          WHERE sede_id = ${input.sedeId}
            AND (
              canonical_key = ${input.canonicalKey}
              OR (${input.sourceProposalId} IS NOT NULL AND source_proposal_id = ${input.sourceProposalId})
            )
          ORDER BY id ASC LIMIT 1`;
        if (!existing[0]) throw new Error("REMINDER_CREATE_CONFLICT");
        return { record: rowToReminder(existing[0]), created: false };
      });
    },

    async findById(sedeId, recipientUserId, id) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM promemoria
        WHERE sede_id = ${sedeId} AND recipient_user_id = ${recipientUserId}
          AND id = ${id} LIMIT 1`;
      return rows[0] ? rowToReminder(rows[0]) : null;
    },

    async listPopupDue(input) {
      await ensureSchema();
      const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 50);
      const rows = await sql`SELECT * FROM promemoria
        WHERE sede_id = ${input.sedeId}
          AND recipient_user_id = ${input.recipientUserId}
          AND status = 'due' AND popup_dismissed_at IS NULL
        ORDER BY remind_at ASC, id ASC LIMIT ${limit}`;
      return rows.map(rowToReminder);
    },

    async listPersonal(input) {
      await ensureSchema();
      const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 100);
      // Estremi sempre valorizzati: query statica, nessun frammento dinamico.
      const da = input.daRemindAt ?? new Date(0);
      const a = input.aRemindAt ?? new Date("9999-01-01T00:00:00Z");
      const rows =
        input.ordina === "creazioneDesc"
          ? await sql`SELECT * FROM promemoria
              WHERE sede_id = ${input.sedeId}
                AND recipient_user_id = ${input.recipientUserId}
                AND status = ANY(${input.stati})
                AND remind_at >= ${da} AND remind_at <= ${a}
              ORDER BY created_at DESC, id DESC LIMIT ${limit}`
          : await sql`SELECT * FROM promemoria
              WHERE sede_id = ${input.sedeId}
                AND recipient_user_id = ${input.recipientUserId}
                AND status = ANY(${input.stati})
                AND remind_at >= ${da} AND remind_at <= ${a}
              ORDER BY remind_at ASC, id ASC LIMIT ${limit}`;
      return rows.map(rowToReminder);
    },

    async claimDue(input) {
      await ensureSchema();
      const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 100);
      return sql.begin(async (tx) => {
        const rows = await tx`WITH claimed AS (
          SELECT id FROM promemoria
          WHERE status = 'scheduled' AND remind_at <= ${input.now}
          ORDER BY remind_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE promemoria p
        SET status = 'due', fired_at = ${input.now}, updated_at = ${input.now}
        FROM claimed
        WHERE p.id = claimed.id AND p.status = 'scheduled'
        RETURNING p.*`;
        for (const row of rows) {
          await tx`INSERT INTO promemoria_eventi (
            promemoria_id, sede_id, actor_user_id, event_type, metadata, created_at
          ) VALUES (
            ${row.id}, ${row.sede_id}, NULL, 'fired',
            ${tx.json({ revision: Number(row.revision) })}, ${input.now}
          )`;
        }
        return rows.map(rowToReminder);
      });
    },

    async listPendingNotification(limit) {
      await ensureSchema();
      const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
      const rows = await sql`SELECT * FROM promemoria
        WHERE status = 'due' AND notification_revision < revision
        ORDER BY remind_at ASC, id ASC LIMIT ${boundedLimit}`;
      return rows.map(rowToReminder);
    },

    async markNotificationProjected(input) {
      await ensureSchema();
      const rows = await sql`UPDATE promemoria
        SET notification_revision = ${input.revision}, updated_at = ${input.now}
        WHERE id = ${input.id} AND status = 'due'
          AND revision = ${input.revision}
          AND notification_revision < ${input.revision}
        RETURNING id`;
      return rows.length > 0;
    },

    async dismissPopup(input) {
      await ensureSchema();
      return sql.begin(async (tx) => {
        const currentRows = await tx`SELECT * FROM promemoria
          WHERE sede_id = ${input.sedeId}
            AND recipient_user_id = ${input.recipientUserId}
            AND id = ${input.id}
          FOR UPDATE`;
        const current = currentRows[0] ? rowToReminder(currentRows[0]) : null;
        if (!current || current.status !== "due") return null;
        if (current.popupDismissedAt != null) return current;
        const rows = await tx`UPDATE promemoria
          SET popup_dismissed_at = ${input.now}, updated_at = ${input.now}
          WHERE sede_id = ${input.sedeId}
            AND recipient_user_id = ${input.recipientUserId}
            AND id = ${input.id} AND status = 'due'
          RETURNING *`;
        if (!rows[0]) return null;
        const record = rowToReminder(rows[0]);
        await tx`INSERT INTO promemoria_eventi (
          promemoria_id, sede_id, actor_user_id, event_type, metadata, created_at
        ) VALUES (
          ${record.id}, ${record.sedeId}, ${input.actorUserId}, 'popup_dismissed',
          ${tx.json({ revision: record.revision })}, ${input.now}
        )`;
        return record;
      });
    },

    async complete(input) {
      await ensureSchema();
      return sql.begin(async (tx) => {
        const currentRows = await tx`SELECT * FROM promemoria
          WHERE sede_id = ${input.sedeId}
            AND recipient_user_id = ${input.recipientUserId}
            AND id = ${input.id}
          FOR UPDATE`;
        const current = currentRows[0] ? rowToReminder(currentRows[0]) : null;
        if (!current || current.status === "cancelled") return null;
        if (current.status === "completed") return current;
        const rows = await tx`UPDATE promemoria
          SET status = 'completed', completed_at = ${input.now}, updated_at = ${input.now}
          WHERE sede_id = ${input.sedeId}
            AND recipient_user_id = ${input.recipientUserId}
            AND id = ${input.id} AND status IN ('scheduled','due')
          RETURNING *`;
        if (!rows[0]) return null;
        const record = rowToReminder(rows[0]);
        await tx`INSERT INTO promemoria_eventi (
          promemoria_id, sede_id, actor_user_id, event_type, metadata, created_at
        ) VALUES (
          ${record.id}, ${record.sedeId}, ${input.actorUserId}, 'completed',
          ${tx.json({ revision: record.revision })}, ${input.now}
        )`;
        return record;
      });
    },

    async snooze(input) {
      await ensureSchema();
      return sql.begin(async (tx) => {
        const rows = await tx`UPDATE promemoria
          SET status = 'scheduled', remind_at = ${input.remindAt},
            revision = revision + 1, popup_dismissed_at = NULL,
            fired_at = NULL, notification_revision = 0,
            completed_at = NULL, cancelled_at = NULL, updated_at = ${input.now}
          WHERE sede_id = ${input.sedeId}
            AND recipient_user_id = ${input.recipientUserId}
            AND id = ${input.id} AND status IN ('scheduled','due')
          RETURNING *`;
        if (!rows[0]) return null;
        const record = rowToReminder(rows[0]);
        await tx`INSERT INTO promemoria_eventi (
          promemoria_id, sede_id, actor_user_id, event_type, metadata, created_at
        ) VALUES (
          ${record.id}, ${record.sedeId}, ${input.actorUserId}, 'snoozed',
          ${tx.json({
            revision: record.revision,
            remindAt: record.remindAt.toISOString(),
          })}, ${input.now}
        )`;
        return record;
      });
    },

    async cancel(input) {
      await ensureSchema();
      return sql.begin(async (tx) => {
        const currentRows = await tx`SELECT * FROM promemoria
          WHERE sede_id = ${input.sedeId}
            AND recipient_user_id = ${input.recipientUserId}
            AND id = ${input.id}
          FOR UPDATE`;
        const current = currentRows[0] ? rowToReminder(currentRows[0]) : null;
        if (!current || current.status === "completed") return null;
        if (current.status === "cancelled") return current;
        const rows = await tx`UPDATE promemoria
          SET status = 'cancelled', cancelled_at = ${input.now}, updated_at = ${input.now}
          WHERE sede_id = ${input.sedeId}
            AND recipient_user_id = ${input.recipientUserId}
            AND id = ${input.id} AND status IN ('scheduled','due')
          RETURNING *`;
        if (!rows[0]) return null;
        const record = rowToReminder(rows[0]);
        await tx`INSERT INTO promemoria_eventi (
          promemoria_id, sede_id, actor_user_id, event_type, metadata, created_at
        ) VALUES (
          ${record.id}, ${record.sedeId}, ${input.actorUserId}, 'cancelled',
          ${tx.json({ revision: record.revision })}, ${input.now}
        )`;
        return record;
      });
    },

    async listEvents(sedeId, reminderId) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM promemoria_eventi
        WHERE sede_id = ${sedeId} AND promemoria_id = ${reminderId}
        ORDER BY id ASC`;
      return rows.map(rowToReminderEvent);
    },
  };
}

let singleton: ReminderRepository | null = null;

export function getReminderRepository(): ReminderRepository {
  singleton ??= kvSql
    ? createPostgresReminderRepository(kvSql)
    : createMemoryReminderRepository();
  return singleton;
}
