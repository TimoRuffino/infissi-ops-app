import { kvSql } from "../_core/persistence";
import type {
  BusinessEvent,
  BusinessEventDraft,
  BusinessEventProcessing,
} from "./types";

type ClaimInput = {
  consumerName: string;
  workerId: string;
  eventTypes?: string[];
  limit: number;
  now: Date;
};

type CompletionInput = {
  eventId: number;
  consumerName: string;
  workerId: string;
  now: Date;
};

type FailureInput = CompletionInput & {
  errorCode: string;
  retryAt: Date;
};

export type BusinessEventRepository = {
  ensureSchema(): Promise<void>;
  publish(draft: BusinessEventDraft): Promise<{ id: number; inserted: boolean }>;
  claim(input: ClaimInput): Promise<BusinessEvent[]>;
  complete(input: CompletionInput): Promise<boolean>;
  fail(input: FailureInput): Promise<boolean>;
  recoverStale(input: { cutoff: Date; now: Date }): Promise<number>;
  getProcessing(
    eventId: number,
    consumerName: string
  ): Promise<BusinessEventProcessing | null>;
};

const MAX_ATTEMPTS = 5;

function sanitizeErrorCode(value: string): string {
  const first = value.trim().split(/\s+/)[0] ?? "EVENT_CONSUMER_FAILED";
  const sanitized = first.toUpperCase().replace(/[^A-Z0-9_.:-]/g, "_");
  return sanitized.slice(0, 120) || "EVENT_CONSUMER_FAILED";
}

function cloneEvent(event: BusinessEvent): BusinessEvent {
  return structuredClone(event);
}

function processingKey(eventId: number, consumerName: string): string {
  return `${eventId}:${consumerName}`;
}

export function createMemoryBusinessEventRepository(options?: {
  now?: () => Date;
}): BusinessEventRepository {
  const events: BusinessEvent[] = [];
  const processing = new Map<string, BusinessEventProcessing>();
  let nextId = 1;

  function ensureProcessing(event: BusinessEvent, consumerName: string, now: Date) {
    const key = processingKey(event.id, consumerName);
    let record = processing.get(key);
    if (!record) {
      record = {
        eventId: event.id,
        consumerName,
        status: "pending",
        attempts: 0,
        availableAt: new Date(event.createdAt),
        lockedBy: null,
        lockedAt: null,
        lastErrorCode: null,
        processedAt: null,
        updatedAt: new Date(now),
      };
      processing.set(key, record);
    }
    return record;
  }

  return {
    async ensureSchema() {},

    async publish(draft) {
      const existing = events.find(
        event => event.sedeId === draft.sedeId && event.dedupeKey === draft.dedupeKey
      );
      if (existing) return { id: existing.id, inserted: false };
      const event: BusinessEvent = {
        ...structuredClone(draft),
        id: nextId++,
        createdAt: new Date(options?.now?.() ?? new Date()),
      };
      events.push(event);
      return { id: event.id, inserted: true };
    },

    async claim(input) {
      const allowed = input.eventTypes?.length
        ? new Set(input.eventTypes)
        : null;
      const claimed: BusinessEvent[] = [];
      for (const event of events.sort((a, b) => a.id - b.id)) {
        if (claimed.length >= Math.min(Math.max(input.limit, 1), 100)) break;
        if (allowed && !allowed.has(event.eventType)) continue;
        const record = ensureProcessing(event, input.consumerName, input.now);
        if (record.status !== "pending" || record.availableAt > input.now) continue;
        record.status = "processing";
        record.attempts += 1;
        record.lockedBy = input.workerId;
        record.lockedAt = new Date(input.now);
        record.updatedAt = new Date(input.now);
        claimed.push(cloneEvent(event));
      }
      return claimed;
    },

    async complete(input) {
      const record = processing.get(
        processingKey(input.eventId, input.consumerName)
      );
      if (
        !record ||
        record.status !== "processing" ||
        record.lockedBy !== input.workerId
      ) {
        return false;
      }
      record.status = "completed";
      record.processedAt = new Date(input.now);
      record.lockedBy = null;
      record.lockedAt = null;
      record.lastErrorCode = null;
      record.updatedAt = new Date(input.now);
      return true;
    },

    async fail(input) {
      const record = processing.get(
        processingKey(input.eventId, input.consumerName)
      );
      if (
        !record ||
        record.status !== "processing" ||
        record.lockedBy !== input.workerId
      ) {
        return false;
      }
      record.status = record.attempts >= MAX_ATTEMPTS ? "dead_letter" : "pending";
      record.availableAt = new Date(input.retryAt);
      record.lockedBy = null;
      record.lockedAt = null;
      record.lastErrorCode = sanitizeErrorCode(input.errorCode);
      record.updatedAt = new Date(input.now);
      return true;
    },

    async recoverStale(input) {
      let recovered = 0;
      for (const record of Array.from(processing.values())) {
        if (
          record.status === "processing" &&
          record.lockedAt != null &&
          record.lockedAt < input.cutoff
        ) {
          record.status = "pending";
          record.availableAt = new Date(input.now);
          record.lockedBy = null;
          record.lockedAt = null;
          record.updatedAt = new Date(input.now);
          recovered += 1;
        }
      }
      return recovered;
    },

    async getProcessing(eventId, consumerName) {
      const record = processing.get(processingKey(eventId, consumerName));
      return record ? structuredClone(record) : null;
    },
  };
}

function rowToEvent(row: any): BusinessEvent {
  return {
    id: Number(row.id),
    sedeId: Number(row.sede_id),
    eventType: row.event_type,
    source: {
      type: row.source_type,
      id: row.source_id,
      ...(row.source_version ? { version: row.source_version } : {}),
    },
    actorUserId: row.actor_user_id == null ? null : Number(row.actor_user_id),
    subjectRefs: Array.isArray(row.subject_refs) ? row.subject_refs : [],
    recipientHints: Array.isArray(row.recipient_hints)
      ? row.recipient_hints.map(Number)
      : [],
    payload: row.payload ?? { version: 1 },
    dedupeKey: row.dedupe_key,
    occurredAt: new Date(row.occurred_at),
    createdAt: new Date(row.created_at),
  };
}

function rowToProcessing(row: any): BusinessEventProcessing {
  return {
    eventId: Number(row.event_id),
    consumerName: row.consumer_name,
    status: row.status,
    attempts: Number(row.attempts),
    availableAt: new Date(row.available_at),
    lockedBy: row.locked_by ?? null,
    lockedAt: row.locked_at ? new Date(row.locked_at) : null,
    lastErrorCode: row.last_error_code ?? null,
    processedAt: row.processed_at ? new Date(row.processed_at) : null,
    updatedAt: new Date(row.updated_at),
  };
}

function createPostgresBusinessEventRepository(): BusinessEventRepository {
  if (!kvSql) throw new Error("DATABASE_URL_MISSING");
  const sql = kvSql;
  return {
    async ensureSchema() {
      await sql`CREATE TABLE IF NOT EXISTS business_events (
        id BIGSERIAL PRIMARY KEY,
        sede_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_version TEXT,
        actor_user_id INTEGER,
        subject_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
        recipient_hints JSONB NOT NULL DEFAULT '[]'::jsonb,
        payload JSONB NOT NULL,
        dedupe_key TEXT NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (sede_id, dedupe_key)
      )`;
      await sql`CREATE INDEX IF NOT EXISTS business_events_type_idx
        ON business_events (event_type, id)`;
      await sql`CREATE INDEX IF NOT EXISTS business_events_sede_idx
        ON business_events (sede_id, id)`;
      await sql`CREATE TABLE IF NOT EXISTS business_event_processing (
        event_id BIGINT NOT NULL REFERENCES business_events(id) ON DELETE CASCADE,
        consumer_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        locked_by TEXT,
        locked_at TIMESTAMPTZ,
        last_error_code TEXT,
        processed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (event_id, consumer_name)
      )`;
      await sql`CREATE INDEX IF NOT EXISTS business_event_processing_queue_idx
        ON business_event_processing (consumer_name, status, available_at, event_id)`;
    },

    async publish(draft) {
      const rows = await sql`INSERT INTO business_events (
          sede_id, event_type, source_type, source_id, source_version,
          actor_user_id, subject_refs, recipient_hints, payload, dedupe_key,
          occurred_at
        ) VALUES (
          ${draft.sedeId}, ${draft.eventType}, ${draft.source.type},
          ${draft.source.id}, ${draft.source.version ?? null}, ${draft.actorUserId},
          ${sql.json(draft.subjectRefs as any)},
          ${sql.json(draft.recipientHints as any)},
          ${sql.json(draft.payload as any)}, ${draft.dedupeKey}, ${draft.occurredAt}
        ) ON CONFLICT (sede_id, dedupe_key) DO NOTHING RETURNING id`;
      if (rows[0]) return { id: Number(rows[0].id), inserted: true };
      const existing = await sql`SELECT id FROM business_events
        WHERE sede_id = ${draft.sedeId} AND dedupe_key = ${draft.dedupeKey}
        LIMIT 1`;
      if (!existing[0]) throw new Error("BUSINESS_EVENT_DEDUPE_LOOKUP_FAILED");
      return { id: Number(existing[0].id), inserted: false };
    },

    async claim(input) {
      const limit = Math.min(Math.max(input.limit, 1), 100);
      return sql.begin(async tx => {
        if (input.eventTypes?.length) {
          await tx`INSERT INTO business_event_processing (
              event_id, consumer_name, status, available_at, updated_at
            ) SELECT id, ${input.consumerName}, 'pending', created_at, ${input.now}
              FROM business_events
              WHERE event_type IN ${tx(input.eventTypes)}
            ON CONFLICT (event_id, consumer_name) DO NOTHING`;
        } else {
          await tx`INSERT INTO business_event_processing (
              event_id, consumer_name, status, available_at, updated_at
            ) SELECT id, ${input.consumerName}, 'pending', created_at, ${input.now}
              FROM business_events
            ON CONFLICT (event_id, consumer_name) DO NOTHING`;
        }
        const claimed = await tx`WITH candidates AS (
            SELECT event_id FROM business_event_processing
            WHERE consumer_name = ${input.consumerName}
              AND status = 'pending' AND available_at <= ${input.now}
            ORDER BY event_id ASC
            FOR UPDATE SKIP LOCKED LIMIT ${limit}
          ) UPDATE business_event_processing p SET
            status = 'processing', attempts = p.attempts + 1,
            locked_by = ${input.workerId}, locked_at = ${input.now},
            updated_at = ${input.now}
          FROM candidates c
          WHERE p.event_id = c.event_id AND p.consumer_name = ${input.consumerName}
          RETURNING p.event_id`;
        const ids = claimed.map(row => Number(row.event_id));
        if (ids.length === 0) return [];
        const rows = await tx`SELECT * FROM business_events
          WHERE id IN ${tx(ids)} ORDER BY id ASC`;
        return rows.map(rowToEvent);
      });
    },

    async complete(input) {
      const rows = await sql`UPDATE business_event_processing SET
          status = 'completed', processed_at = ${input.now}, locked_by = NULL,
          locked_at = NULL, last_error_code = NULL, updated_at = ${input.now}
        WHERE event_id = ${input.eventId} AND consumer_name = ${input.consumerName}
          AND status = 'processing' AND locked_by = ${input.workerId}
        RETURNING event_id`;
      return rows.length > 0;
    },

    async fail(input) {
      const code = sanitizeErrorCode(input.errorCode);
      const rows = await sql`UPDATE business_event_processing SET
          status = CASE WHEN attempts >= ${MAX_ATTEMPTS}
            THEN 'dead_letter' ELSE 'pending' END,
          available_at = ${input.retryAt}, locked_by = NULL, locked_at = NULL,
          last_error_code = ${code}, updated_at = ${input.now}
        WHERE event_id = ${input.eventId} AND consumer_name = ${input.consumerName}
          AND status = 'processing' AND locked_by = ${input.workerId}
        RETURNING event_id`;
      return rows.length > 0;
    },

    async recoverStale(input) {
      const rows = await sql`UPDATE business_event_processing SET
          status = 'pending', available_at = ${input.now}, locked_by = NULL,
          locked_at = NULL, updated_at = ${input.now}
        WHERE status = 'processing' AND locked_at < ${input.cutoff}
        RETURNING event_id`;
      return rows.length;
    },

    async getProcessing(eventId, consumerName) {
      const rows = await sql`SELECT * FROM business_event_processing
        WHERE event_id = ${eventId} AND consumer_name = ${consumerName} LIMIT 1`;
      return rows[0] ? rowToProcessing(rows[0]) : null;
    },
  };
}

let singleton: BusinessEventRepository | null = null;

export function getBusinessEventRepository(): BusinessEventRepository {
  if (!singleton) {
    singleton = kvSql
      ? createPostgresBusinessEventRepository()
      : createMemoryBusinessEventRepository();
  }
  return singleton;
}
