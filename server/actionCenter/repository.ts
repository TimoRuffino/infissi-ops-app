import { kvSql } from "../_core/persistence";
import type {
  ActionCaseDraft,
  ActionCaseEvent,
  ActionCaseRecord,
  ActionStatus,
  TarsAnalysisStatus,
} from "./types";

export type ActionCaseListInput = {
  sedeId: number;
  statuses?: ActionStatus[];
  assigneeUserId?: number | null;
  limit?: number;
  cursor?: string | null;
};

export type ActionCaseTransitionInput = {
  sedeId: number;
  id: number;
  expectedFingerprint: string;
  status: ActionStatus;
  assigneeUserId?: number | null;
  reviewAt?: Date | null;
  snoozedUntil?: Date | null;
  actorUserId: number | null;
  eventType: string;
  metadata?: Record<string, unknown>;
  now: Date;
};

export type ActionCaseRepository = {
  ensureSchema(): Promise<void>;
  upsertDraft(
    draft: ActionCaseDraft,
    now: Date
  ): Promise<{ record: ActionCaseRecord; created: boolean; changed: boolean }>;
  findById(sedeId: number, id: number): Promise<ActionCaseRecord | null>;
  findByCanonicalKey(
    sedeId: number,
    canonicalKey: string
  ): Promise<ActionCaseRecord | null>;
  list(input: ActionCaseListInput): Promise<{
    items: ActionCaseRecord[];
    nextCursor: string | null;
  }>;
  transition(input: ActionCaseTransitionInput): Promise<ActionCaseRecord>;
  appendEvent(
    event: Omit<ActionCaseEvent, "id">
  ): Promise<ActionCaseEvent>;
  listEvents(sedeId: number, actionCaseId: number): Promise<ActionCaseEvent[]>;
  listPendingAnalysis(sedeId: number, limit: number): Promise<ActionCaseRecord[]>;
  markAnalysis(input: {
    sedeId: number;
    id: number;
    status: TarsAnalysisStatus;
    fingerprint: string | null;
    analysis?: Record<string, unknown> | null;
    now: Date;
  }): Promise<ActionCaseRecord>;
};

function cloneRecord(record: ActionCaseRecord): ActionCaseRecord {
  return structuredClone(record);
}

export function createMemoryActionCaseRepository(): ActionCaseRepository {
  const records: ActionCaseRecord[] = [];
  const events: ActionCaseEvent[] = [];
  let nextId = 1;
  let nextEventId = 1;

  const appendEvent: ActionCaseRepository["appendEvent"] = async event => {
    const stored = { ...structuredClone(event), id: nextEventId++ };
    events.push(stored);
    return structuredClone(stored);
  };

  return {
    async ensureSchema() {},

    async upsertDraft(draft, now) {
      const existing = records.find(
        record =>
          record.sedeId === draft.sedeId &&
          record.canonicalKey === draft.canonicalKey
      );
      if (!existing) {
        const record: ActionCaseRecord = {
          ...structuredClone(draft),
          id: nextId++,
          status: "da_valutare",
          reviewAt: null,
          snoozedUntil: null,
          tarsAnalysis: null,
          tarsAnalysisFingerprint: null,
          tarsAnalysisStatus: "non_richiesta",
          createdAt: new Date(now),
          updatedAt: new Date(now),
          resolvedAt: null,
        };
        records.push(record);
        await appendEvent({
          actionCaseId: record.id,
          sedeId: record.sedeId,
          actorUserId: null,
          eventType: "creata",
          fromStatus: null,
          toStatus: record.status,
          metadata: {},
          createdAt: now,
        });
        return { record: cloneRecord(record), created: true, changed: true };
      }
      if (existing.signalFingerprint === draft.signalFingerprint) {
        return { record: cloneRecord(existing), created: false, changed: false };
      }
      const preservedAssignee =
        existing.status === "da_valutare"
          ? draft.assigneeUserId
          : existing.assigneeUserId;
      Object.assign(existing, structuredClone(draft), {
        id: existing.id,
        status: existing.status,
        assigneeUserId: preservedAssignee,
        reviewAt: existing.reviewAt,
        snoozedUntil: existing.snoozedUntil,
        tarsAnalysis: existing.tarsAnalysis,
        tarsAnalysisFingerprint: existing.tarsAnalysisFingerprint,
        tarsAnalysisStatus: "non_richiesta" as const,
        createdAt: existing.createdAt,
        updatedAt: new Date(now),
        resolvedAt: existing.resolvedAt,
      });
      await appendEvent({
        actionCaseId: existing.id,
        sedeId: existing.sedeId,
        actorUserId: null,
        eventType: "segnali_aggiornati",
        fromStatus: existing.status,
        toStatus: existing.status,
        metadata: {},
        createdAt: now,
      });
      return { record: cloneRecord(existing), created: false, changed: true };
    },

    async findById(sedeId, id) {
      const record = records.find(item => item.sedeId === sedeId && item.id === id);
      return record ? cloneRecord(record) : null;
    },

    async findByCanonicalKey(sedeId, canonicalKey) {
      const record = records.find(
        item => item.sedeId === sedeId && item.canonicalKey === canonicalKey
      );
      return record ? cloneRecord(record) : null;
    },

    async list(input) {
      const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
      const cursorId = input.cursor ? Number(input.cursor) : null;
      const filtered = records
        .filter(record => record.sedeId === input.sedeId)
        .filter(record => !input.statuses || input.statuses.includes(record.status))
        .filter(record =>
          input.assigneeUserId === undefined
            ? true
            : record.assigneeUserId === input.assigneeUserId
        )
        .filter(record => cursorId == null || record.id > cursorId)
        .sort((a, b) => a.id - b.id);
      const items = filtered.slice(0, limit).map(cloneRecord);
      return {
        items,
        nextCursor:
          filtered.length > limit ? String(items[items.length - 1].id) : null,
      };
    },

    async transition(input) {
      const record = records.find(
        item => item.sedeId === input.sedeId && item.id === input.id
      );
      if (!record) throw new Error("ACTION_CASE_NOT_FOUND");
      if (record.signalFingerprint !== input.expectedFingerprint) {
        throw new Error("STALE_ACTION_CASE");
      }
      const fromStatus = record.status;
      record.status = input.status;
      if (input.assigneeUserId !== undefined) {
        record.assigneeUserId = input.assigneeUserId;
      }
      if (input.reviewAt !== undefined) record.reviewAt = input.reviewAt;
      if (input.snoozedUntil !== undefined) {
        record.snoozedUntil = input.snoozedUntil;
      }
      record.resolvedAt = input.status === "risolta" ? input.now : null;
      record.updatedAt = input.now;
      await appendEvent({
        actionCaseId: record.id,
        sedeId: record.sedeId,
        actorUserId: input.actorUserId,
        eventType: input.eventType,
        fromStatus,
        toStatus: record.status,
        metadata: input.metadata ?? {},
        createdAt: input.now,
      });
      return cloneRecord(record);
    },

    appendEvent,

    async listEvents(sedeId, actionCaseId) {
      return events
        .filter(event => event.sedeId === sedeId && event.actionCaseId === actionCaseId)
        .sort((a, b) => a.id - b.id)
        .map(event => structuredClone(event));
    },

    async listPendingAnalysis(sedeId, limit) {
      return records
        .filter(
          record =>
            record.sedeId === sedeId && record.tarsAnalysisStatus === "in_coda"
        )
        .sort((a, b) => a.id - b.id)
        .slice(0, limit)
        .map(cloneRecord);
    },

    async markAnalysis(input) {
      const record = records.find(
        item => item.sedeId === input.sedeId && item.id === input.id
      );
      if (!record) throw new Error("ACTION_CASE_NOT_FOUND");
      record.tarsAnalysisStatus = input.status;
      record.tarsAnalysisFingerprint = input.fingerprint;
      if (input.analysis !== undefined) record.tarsAnalysis = input.analysis;
      record.updatedAt = input.now;
      return cloneRecord(record);
    },
  };
}

function rowToRecord(row: any): ActionCaseRecord {
  return {
    id: Number(row.id),
    sedeId: Number(row.sede_id),
    canonicalKey: row.canonical_key,
    targetType: row.target_type,
    targetId: Number(row.target_id),
    clienteId: row.cliente_id == null ? null : Number(row.cliente_id),
    commessaId: row.commessa_id == null ? null : Number(row.commessa_id),
    title: row.title,
    status: row.status,
    priority: row.priority,
    priorityScore: Number(row.priority_score),
    assigneeUserId:
      row.assignee_user_id == null ? null : Number(row.assignee_user_id),
    dueAt: row.due_at ? new Date(row.due_at) : null,
    reviewAt: row.review_at ? new Date(row.review_at) : null,
    snoozedUntil: row.snoozed_until ? new Date(row.snoozed_until) : null,
    signalFingerprint: row.signal_fingerprint,
    signals: Array.isArray(row.signals) ? row.signals : [],
    nextAction: row.next_action,
    link: row.link,
    tarsAnalysis: row.tars_analysis ?? null,
    tarsAnalysisFingerprint: row.tars_analysis_fingerprint ?? null,
    tarsAnalysisStatus: row.tars_analysis_status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : null,
  } as ActionCaseRecord;
}

function rowToEvent(row: any): ActionCaseEvent {
  return {
    id: Number(row.id),
    actionCaseId: Number(row.azione_operativa_id),
    sedeId: Number(row.sede_id),
    actorUserId: row.actor_user_id == null ? null : Number(row.actor_user_id),
    eventType: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    metadata: row.metadata ?? {},
    createdAt: new Date(row.created_at),
  };
}

function createPostgresActionCaseRepository(): ActionCaseRepository {
  if (!kvSql) throw new Error("DATABASE_URL_MISSING");
  const sql = kvSql;

  const repository: ActionCaseRepository = {
    async ensureSchema() {
      await sql`CREATE TABLE IF NOT EXISTS azioni_operative (
        id BIGSERIAL PRIMARY KEY,
        sede_id INTEGER NOT NULL,
        canonical_key TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id INTEGER NOT NULL,
        cliente_id INTEGER,
        commessa_id INTEGER,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'da_valutare',
        priority TEXT NOT NULL,
        priority_score INTEGER NOT NULL,
        assignee_user_id INTEGER,
        due_at TIMESTAMPTZ,
        review_at TIMESTAMPTZ,
        snoozed_until TIMESTAMPTZ,
        signal_fingerprint TEXT NOT NULL,
        signals JSONB NOT NULL DEFAULT '[]'::jsonb,
        next_action JSONB NOT NULL,
        link TEXT NOT NULL,
        tars_analysis JSONB,
        tars_analysis_fingerprint TEXT,
        tars_analysis_status TEXT NOT NULL DEFAULT 'non_richiesta',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ,
        UNIQUE (sede_id, canonical_key)
      )`;
      await sql`CREATE INDEX IF NOT EXISTS azioni_operative_coda_idx
        ON azioni_operative (sede_id, status, assignee_user_id, due_at)`;
      await sql`CREATE INDEX IF NOT EXISTS azioni_operative_tars_idx
        ON azioni_operative (sede_id, tars_analysis_status, updated_at)`;
      await sql`CREATE TABLE IF NOT EXISTS azioni_operative_eventi (
        id BIGSERIAL PRIMARY KEY,
        azione_operativa_id BIGINT NOT NULL REFERENCES azioni_operative(id) ON DELETE CASCADE,
        sede_id INTEGER NOT NULL,
        actor_user_id INTEGER,
        event_type TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
      await sql`CREATE INDEX IF NOT EXISTS azioni_operative_eventi_case_idx
        ON azioni_operative_eventi (sede_id, azione_operativa_id, id)`;
    },

    async upsertDraft(draft, now) {
      const current = await repository.findByCanonicalKey(
        draft.sedeId,
        draft.canonicalKey
      );
      if (current?.signalFingerprint === draft.signalFingerprint) {
        return { record: current, created: false, changed: false };
      }
      const rows = await sql`
        INSERT INTO azioni_operative (
          sede_id, canonical_key, target_type, target_id, cliente_id, commessa_id,
          title, priority, priority_score, assignee_user_id, due_at,
          signal_fingerprint, signals, next_action, link, created_at, updated_at
        ) VALUES (
          ${draft.sedeId}, ${draft.canonicalKey}, ${draft.targetType}, ${draft.targetId},
          ${draft.clienteId}, ${draft.commessaId}, ${draft.title}, ${draft.priority},
          ${draft.priorityScore}, ${draft.assigneeUserId}, ${draft.dueAt},
          ${draft.signalFingerprint}, ${sql.json(draft.signals as any)},
          ${sql.json(draft.nextAction as any)}, ${draft.link}, ${now}, ${now}
        )
        ON CONFLICT (sede_id, canonical_key) DO UPDATE SET
          target_type = EXCLUDED.target_type,
          target_id = EXCLUDED.target_id,
          cliente_id = EXCLUDED.cliente_id,
          commessa_id = EXCLUDED.commessa_id,
          title = EXCLUDED.title,
          priority = EXCLUDED.priority,
          priority_score = EXCLUDED.priority_score,
          assignee_user_id = CASE
            WHEN azioni_operative.status = 'da_valutare' THEN EXCLUDED.assignee_user_id
            ELSE azioni_operative.assignee_user_id
          END,
          due_at = EXCLUDED.due_at,
          signal_fingerprint = EXCLUDED.signal_fingerprint,
          signals = EXCLUDED.signals,
          next_action = EXCLUDED.next_action,
          link = EXCLUDED.link,
          tars_analysis_status = 'non_richiesta',
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `;
      const record = rowToRecord(rows[0]);
      const created = current == null;
      await repository.appendEvent({
        actionCaseId: record.id,
        sedeId: record.sedeId,
        actorUserId: null,
        eventType: created ? "creata" : "segnali_aggiornati",
        fromStatus: current?.status ?? null,
        toStatus: record.status,
        metadata: {},
        createdAt: now,
      });
      return { record, created, changed: true };
    },

    async findById(sedeId, id) {
      const rows = await sql`SELECT * FROM azioni_operative
        WHERE sede_id = ${sedeId} AND id = ${id} LIMIT 1`;
      return rows[0] ? rowToRecord(rows[0]) : null;
    },

    async findByCanonicalKey(sedeId, canonicalKey) {
      const rows = await sql`SELECT * FROM azioni_operative
        WHERE sede_id = ${sedeId} AND canonical_key = ${canonicalKey} LIMIT 1`;
      return rows[0] ? rowToRecord(rows[0]) : null;
    },

    async list(input) {
      const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
      const cursor = input.cursor ? Number(input.cursor) : 0;
      const statuses = input.statuses ?? [];
      const rows = await sql`SELECT * FROM azioni_operative
        WHERE sede_id = ${input.sedeId}
          AND id > ${cursor}
          AND (${statuses.length === 0} OR status IN ${sql(statuses)})
          AND (${input.assigneeUserId === undefined} OR assignee_user_id IS NOT DISTINCT FROM ${input.assigneeUserId ?? null})
        ORDER BY id ASC LIMIT ${limit + 1}`;
      const mapped = rows.map(rowToRecord);
      const items = mapped.slice(0, limit);
      return {
        items,
        nextCursor: mapped.length > limit ? String(items[items.length - 1].id) : null,
      };
    },

    async transition(input) {
      const current = await repository.findById(input.sedeId, input.id);
      if (!current) throw new Error("ACTION_CASE_NOT_FOUND");
      if (current.signalFingerprint !== input.expectedFingerprint) {
        throw new Error("STALE_ACTION_CASE");
      }
      const assignee = input.assigneeUserId === undefined
        ? current.assigneeUserId
        : input.assigneeUserId;
      const reviewAt = input.reviewAt === undefined ? current.reviewAt : input.reviewAt;
      const snoozedUntil = input.snoozedUntil === undefined
        ? current.snoozedUntil
        : input.snoozedUntil;
      const rows = await sql`UPDATE azioni_operative SET
          status = ${input.status}, assignee_user_id = ${assignee},
          review_at = ${reviewAt}, snoozed_until = ${snoozedUntil},
          resolved_at = ${input.status === "risolta" ? input.now : null},
          updated_at = ${input.now}
        WHERE sede_id = ${input.sedeId} AND id = ${input.id}
          AND signal_fingerprint = ${input.expectedFingerprint}
        RETURNING *`;
      if (!rows[0]) throw new Error("STALE_ACTION_CASE");
      const record = rowToRecord(rows[0]);
      await repository.appendEvent({
        actionCaseId: record.id,
        sedeId: record.sedeId,
        actorUserId: input.actorUserId,
        eventType: input.eventType,
        fromStatus: current.status,
        toStatus: record.status,
        metadata: input.metadata ?? {},
        createdAt: input.now,
      });
      return record;
    },

    async appendEvent(event) {
      const rows = await sql`INSERT INTO azioni_operative_eventi (
          azione_operativa_id, sede_id, actor_user_id, event_type,
          from_status, to_status, metadata, created_at
        ) VALUES (
          ${event.actionCaseId}, ${event.sedeId}, ${event.actorUserId},
          ${event.eventType}, ${event.fromStatus}, ${event.toStatus},
          ${sql.json(event.metadata as any)}, ${event.createdAt}
        ) RETURNING *`;
      return rowToEvent(rows[0]);
    },

    async listEvents(sedeId, actionCaseId) {
      const rows = await sql`SELECT * FROM azioni_operative_eventi
        WHERE sede_id = ${sedeId} AND azione_operativa_id = ${actionCaseId}
        ORDER BY id ASC`;
      return rows.map(rowToEvent);
    },

    async listPendingAnalysis(sedeId, limit) {
      const rows = await sql`SELECT * FROM azioni_operative
        WHERE sede_id = ${sedeId} AND tars_analysis_status = 'in_coda'
        ORDER BY updated_at ASC LIMIT ${Math.min(Math.max(limit, 1), 50)}`;
      return rows.map(rowToRecord);
    },

    async markAnalysis(input) {
      const rows = input.analysis === undefined
        ? await sql`UPDATE azioni_operative SET
            tars_analysis_status = ${input.status},
            tars_analysis_fingerprint = ${input.fingerprint},
            updated_at = ${input.now}
          WHERE sede_id = ${input.sedeId} AND id = ${input.id}
          RETURNING *`
        : await sql`UPDATE azioni_operative SET
            tars_analysis_status = ${input.status},
            tars_analysis_fingerprint = ${input.fingerprint},
            tars_analysis = ${sql.json(input.analysis as any)},
            updated_at = ${input.now}
          WHERE sede_id = ${input.sedeId} AND id = ${input.id}
          RETURNING *`;
      if (!rows[0]) throw new Error("ACTION_CASE_NOT_FOUND");
      return rowToRecord(rows[0]);
    },
  };
  return repository;
}

let singleton: ActionCaseRepository | null = null;

export function getActionCaseRepository(): ActionCaseRepository {
  if (!singleton) {
    singleton = kvSql
      ? createPostgresActionCaseRepository()
      : createMemoryActionCaseRepository();
  }
  return singleton;
}
