import { kvSql } from "../../_core/persistence";
import type {
  ContextEvidence,
  ContextSummary,
  EntityContextKey,
  EntityContextSnapshot,
  SaveContextVersionInput,
} from "./types";

type CompleteVersionInput = {
  key: EntityContextKey;
  version: number;
  summary: ContextSummary;
  expiresAt?: Date;
};

export type ContextRepository = {
  ensureSchema(): Promise<void>;
  saveVersion(input: SaveContextVersionInput): Promise<{
    snapshot: EntityContextSnapshot;
    created: boolean;
  }>;
  completeVersion(
    input: CompleteVersionInput
  ): Promise<EntityContextSnapshot | null>;
  markVersionFailed(input: {
    key: EntityContextKey;
    version: number;
    errorCode: string;
  }): Promise<EntityContextSnapshot | null>;
  getLatest(input: {
    key: EntityContextKey;
    now: Date;
  }): Promise<EntityContextSnapshot | null>;
  listVersions(key: EntityContextKey): Promise<EntityContextSnapshot[]>;
};

type StoredVersion = Omit<EntityContextSnapshot, "stale" | "definitive">;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function contextKey(key: EntityContextKey): string {
  return `${key.sedeId}:${key.entityType}:${key.entityId}:${key.scope}`;
}

function withFreshness(
  version: StoredVersion,
  now: Date
): EntityContextSnapshot {
  const stale = version.expiresAt.getTime() <= now.getTime();
  return {
    ...clone(version),
    stale,
    definitive: version.state === "ready" && !stale,
  };
}

function flattenEvidence(
  versionId: number,
  facts: SaveContextVersionInput["facts"],
  nextId: () => number
): ContextEvidence[] {
  return facts.flatMap(fact =>
    fact.evidence.map((evidence, ordinal) => ({
      ...clone(evidence),
      id: nextId(),
      contextVersionId: versionId,
      factKey: fact.key,
      ordinal,
      sourceVersion: evidence.version,
    }))
  );
}

export function createMemoryContextRepository(): ContextRepository {
  const contexts = new Map<
    string,
    { currentVersion: number; nextVersion: number }
  >();
  const versions = new Map<string, StoredVersion[]>();
  let nextVersionId = 1;
  let nextEvidenceId = 1;

  const findStored = (key: EntityContextKey, version: number) =>
    versions.get(contextKey(key))?.find(item => item.version === version) ??
    null;

  return {
    async ensureSchema() {},

    async saveVersion(input) {
      const mapKey = contextKey(input.key);
      const context = contexts.get(mapKey) ?? {
        currentVersion: 0,
        nextVersion: 1,
      };
      const existing = versions
        .get(mapKey)
        ?.find(
          item =>
            item.fingerprint === input.fingerprint &&
            item.schemaVersion === input.schemaVersion
        );
      if (existing) {
        contexts.set(mapKey, { ...context, currentVersion: existing.version });
        return {
          snapshot: withFreshness(existing, input.createdAt),
          created: false,
        };
      }

      const id = nextVersionId++;
      const evidence = flattenEvidence(id, input.facts, () => nextEvidenceId++);
      const stored: StoredVersion = {
        id,
        key: clone(input.key),
        version: context.nextVersion,
        schemaVersion: input.schemaVersion,
        collectorVersion: input.collectorVersion,
        policyVersion: input.policyVersion,
        fingerprint: input.fingerprint,
        facts: clone(input.facts),
        evidence,
        summary: clone(input.summary),
        state: input.state,
        errorCode: input.errorCode ?? null,
        createdAt: new Date(input.createdAt),
        expiresAt: new Date(input.expiresAt),
      };
      const records = versions.get(mapKey) ?? [];
      records.push(stored);
      versions.set(mapKey, records);
      contexts.set(mapKey, {
        currentVersion: stored.version,
        nextVersion: stored.version + 1,
      });
      return {
        snapshot: withFreshness(stored, input.createdAt),
        created: true,
      };
    },

    async completeVersion(input) {
      const stored = findStored(input.key, input.version);
      if (!stored) return null;
      stored.summary = clone(input.summary);
      stored.state = "ready";
      stored.errorCode = null;
      if (input.expiresAt) stored.expiresAt = new Date(input.expiresAt);
      return withFreshness(stored, new Date());
    },

    async markVersionFailed(input) {
      const stored = findStored(input.key, input.version);
      if (!stored) return null;
      stored.state = "failed";
      stored.errorCode = input.errorCode;
      return withFreshness(stored, new Date());
    },

    async getLatest(input) {
      const mapKey = contextKey(input.key);
      const current = contexts.get(mapKey)?.currentVersion;
      if (current == null) return null;
      const stored = findStored(input.key, current);
      return stored ? withFreshness(stored, input.now) : null;
    },

    async listVersions(key) {
      return (versions.get(contextKey(key)) ?? [])
        .slice()
        .sort((a, b) => b.version - a.version)
        .map(item => withFreshness(item, new Date()));
    },
  };
}

type SqlRow = Record<string, unknown>;

function dateValue(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function numberValue(value: unknown): number {
  return Number(value);
}

function keyFromRow(row: SqlRow): EntityContextKey {
  return {
    sedeId: numberValue(row.sede_id),
    entityType: row.entity_type as EntityContextKey["entityType"],
    entityId: numberValue(row.entity_id),
    scope: row.scope as EntityContextKey["scope"],
  };
}

function evidenceFromRow(row: SqlRow): ContextEvidence {
  return {
    id: numberValue(row.id),
    contextVersionId: numberValue(row.context_version_id),
    factKey: String(row.fact_key),
    ordinal: numberValue(row.ordinal),
    sourceType: String(row.source_type),
    sourceId: String(row.source_id),
    label: String(row.label),
    version: String(row.source_version),
    sourceVersion: String(row.source_version),
    ...(row.link == null ? {} : { link: String(row.link) }),
  };
}

function snapshotFromRows(
  row: SqlRow,
  evidenceRows: SqlRow[],
  now: Date
): EntityContextSnapshot {
  const stored: StoredVersion = {
    id: numberValue(row.id),
    key: keyFromRow(row),
    version: numberValue(row.version_number),
    schemaVersion: String(row.schema_version),
    collectorVersion: String(row.collector_version),
    policyVersion: String(row.policy_version),
    fingerprint: String(row.fingerprint),
    facts: clone(row.facts_json as SaveContextVersionInput["facts"]),
    evidence: evidenceRows.map(evidenceFromRow),
    summary:
      row.summary_json == null
        ? null
        : clone(row.summary_json as ContextSummary),
    state: row.state as StoredVersion["state"],
    errorCode: row.error_code == null ? null : String(row.error_code),
    createdAt: dateValue(row.created_at),
    expiresAt: dateValue(row.expires_at),
  };
  return withFreshness(stored, now);
}

export function createPostgresContextRepository(
  sql: NonNullable<typeof kvSql>
): ContextRepository {
  let schemaPromise: Promise<void> | null = null;
  const ensureSchema = () => {
    schemaPromise ??= sql
      .begin(async tx => {
        await tx`CREATE TABLE IF NOT EXISTS tars_entity_contexts (
          id BIGSERIAL PRIMARY KEY,
          sede_id INTEGER NOT NULL,
          entity_type TEXT NOT NULL CHECK (entity_type IN ('cliente','commessa')),
          entity_id INTEGER NOT NULL,
          scope TEXT NOT NULL CHECK (scope IN ('operativo','amministrazione','direzione')),
          current_version_id BIGINT,
          next_version INTEGER NOT NULL DEFAULT 1,
          updated_at TIMESTAMPTZ NOT NULL,
          UNIQUE (sede_id, entity_type, entity_id, scope)
        )`;
        await tx`CREATE TABLE IF NOT EXISTS tars_context_versions (
          id BIGSERIAL PRIMARY KEY,
          context_id BIGINT NOT NULL REFERENCES tars_entity_contexts(id) ON DELETE CASCADE,
          version_number INTEGER NOT NULL,
          schema_version TEXT NOT NULL,
          collector_version TEXT NOT NULL,
          policy_version TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          facts_json JSONB NOT NULL,
          summary_json JSONB,
          state TEXT NOT NULL CHECK (state IN ('facts_only','ready','failed')),
          error_code TEXT,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          UNIQUE (context_id, version_number),
          UNIQUE (context_id, fingerprint, schema_version)
        )`;
        await tx`CREATE INDEX IF NOT EXISTS tars_context_versions_fingerprint_idx
          ON tars_context_versions (context_id, fingerprint, schema_version)`;
        await tx`CREATE TABLE IF NOT EXISTS tars_context_evidence (
          id BIGSERIAL PRIMARY KEY,
          context_version_id BIGINT NOT NULL REFERENCES tars_context_versions(id) ON DELETE CASCADE,
          fact_key TEXT NOT NULL,
          ordinal INTEGER NOT NULL,
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL,
          label TEXT NOT NULL,
          source_version TEXT NOT NULL,
          link TEXT,
          UNIQUE (context_version_id, fact_key, ordinal)
        )`;
        await tx`CREATE INDEX IF NOT EXISTS tars_context_evidence_source_idx
          ON tars_context_evidence (source_type, source_id, source_version)`;
      })
      .then(() => undefined);
    return schemaPromise;
  };

  const evidenceFor = async (versionId: number): Promise<SqlRow[]> =>
    (await sql`SELECT * FROM tars_context_evidence
      WHERE context_version_id = ${versionId}
      ORDER BY fact_key, ordinal`) as SqlRow[];

  const loadVersion = async (input: {
    key: EntityContextKey;
    version?: number;
    now: Date;
  }): Promise<EntityContextSnapshot | null> => {
    await ensureSchema();
    const rows =
      input.version == null
        ? await sql`SELECT v.*, c.sede_id, c.entity_type, c.entity_id, c.scope
          FROM tars_entity_contexts c
          JOIN tars_context_versions v ON v.id = c.current_version_id
          WHERE c.sede_id = ${input.key.sedeId} AND c.entity_type = ${input.key.entityType}
            AND c.entity_id = ${input.key.entityId} AND c.scope = ${input.key.scope}`
        : await sql`SELECT v.*, c.sede_id, c.entity_type, c.entity_id, c.scope
          FROM tars_entity_contexts c
          JOIN tars_context_versions v ON v.context_id = c.id
          WHERE c.sede_id = ${input.key.sedeId} AND c.entity_type = ${input.key.entityType}
            AND c.entity_id = ${input.key.entityId} AND c.scope = ${input.key.scope}
            AND v.version_number = ${input.version}`;
    if (rows.length === 0) return null;
    const row = rows[0] as SqlRow;
    return snapshotFromRows(
      row,
      await evidenceFor(numberValue(row.id)),
      input.now
    );
  };

  return {
    ensureSchema,

    async saveVersion(input) {
      await ensureSchema();
      const result = await sql.begin(async tx => {
        const contexts = await tx`INSERT INTO tars_entity_contexts (
          sede_id, entity_type, entity_id, scope, updated_at
        ) VALUES (
          ${input.key.sedeId}, ${input.key.entityType}, ${input.key.entityId}, ${input.key.scope}, ${input.createdAt}
        ) ON CONFLICT (sede_id, entity_type, entity_id, scope)
          DO UPDATE SET updated_at = EXCLUDED.updated_at
        RETURNING *`;
        const context = contexts[0] as SqlRow;
        const known = await tx`SELECT id, version_number
          FROM tars_context_versions
          WHERE context_id = ${numberValue(context.id)}
            AND fingerprint = ${input.fingerprint}
            AND schema_version = ${input.schemaVersion}
          LIMIT 1`;
        if (known[0]) {
          await tx`UPDATE tars_entity_contexts SET
            current_version_id = ${numberValue(known[0].id)}, updated_at = ${input.createdAt}
            WHERE id = ${numberValue(context.id)}`;
          return {
            created: false,
            version: numberValue(known[0].version_number),
          };
        }

        const versionNumber = numberValue(context.next_version);
        const inserted = await tx`INSERT INTO tars_context_versions (
          context_id, version_number, schema_version, collector_version, policy_version,
          fingerprint, facts_json, summary_json, state, error_code, expires_at, created_at
        ) VALUES (
          ${numberValue(context.id)}, ${versionNumber}, ${input.schemaVersion},
          ${input.collectorVersion}, ${input.policyVersion}, ${input.fingerprint},
          ${tx.json(input.facts as any)},
          ${input.summary == null ? null : tx.json(input.summary as any)},
          ${input.state}, ${input.errorCode ?? null}, ${input.expiresAt}, ${input.createdAt}
        ) RETURNING id`;
        const versionId = numberValue(inserted[0].id);
        for (const fact of input.facts) {
          for (let ordinal = 0; ordinal < fact.evidence.length; ordinal += 1) {
            const evidence = fact.evidence[ordinal];
            await tx`INSERT INTO tars_context_evidence (
              context_version_id, fact_key, ordinal, source_type, source_id, label, source_version, link
            ) VALUES (
              ${versionId}, ${fact.key}, ${ordinal}, ${evidence.sourceType}, ${evidence.sourceId},
              ${evidence.label}, ${evidence.version}, ${evidence.link ?? null}
            )`;
          }
        }
        await tx`UPDATE tars_entity_contexts SET
          current_version_id = ${versionId}, next_version = ${versionNumber + 1}, updated_at = ${input.createdAt}
          WHERE id = ${numberValue(context.id)}`;
        return { created: true, version: versionNumber };
      });
      const snapshot = await loadVersion({
        key: input.key,
        version: result.version,
        now: input.createdAt,
      });
      if (!snapshot) throw new Error("Contesto appena salvato non leggibile.");
      return { snapshot, created: result.created };
    },

    async completeVersion(input) {
      await ensureSchema();
      const rows = await sql`UPDATE tars_context_versions v SET
        summary_json = ${sql.json(input.summary as any)}, state = 'ready', error_code = NULL,
        expires_at = COALESCE(${input.expiresAt ?? null}, expires_at)
        FROM tars_entity_contexts c
        WHERE v.context_id = c.id AND c.sede_id = ${input.key.sedeId}
          AND c.entity_type = ${input.key.entityType} AND c.entity_id = ${input.key.entityId}
          AND c.scope = ${input.key.scope} AND v.version_number = ${input.version}
        RETURNING v.id`;
      if (rows.length === 0) return null;
      return loadVersion({
        key: input.key,
        version: input.version,
        now: new Date(),
      });
    },

    async markVersionFailed(input) {
      await ensureSchema();
      const rows =
        await sql`UPDATE tars_context_versions v SET state = 'failed', error_code = ${input.errorCode}
        FROM tars_entity_contexts c
        WHERE v.context_id = c.id AND c.sede_id = ${input.key.sedeId}
          AND c.entity_type = ${input.key.entityType} AND c.entity_id = ${input.key.entityId}
          AND c.scope = ${input.key.scope} AND v.version_number = ${input.version}
        RETURNING v.id`;
      if (rows.length === 0) return null;
      return loadVersion({
        key: input.key,
        version: input.version,
        now: new Date(),
      });
    },

    async getLatest(input) {
      return loadVersion(input);
    },

    async listVersions(key) {
      await ensureSchema();
      const rows =
        await sql`SELECT v.*, c.sede_id, c.entity_type, c.entity_id, c.scope
        FROM tars_entity_contexts c
        JOIN tars_context_versions v ON v.context_id = c.id
        WHERE c.sede_id = ${key.sedeId} AND c.entity_type = ${key.entityType}
          AND c.entity_id = ${key.entityId} AND c.scope = ${key.scope}
        ORDER BY v.version_number DESC`;
      const now = new Date();
      return Promise.all(
        (rows as SqlRow[]).map(async row =>
          snapshotFromRows(row, await evidenceFor(numberValue(row.id)), now)
        )
      );
    },
  };
}

let repository: ContextRepository | null = null;

export function getContextRepository(): ContextRepository {
  repository ??= kvSql
    ? createPostgresContextRepository(kvSql)
    : createMemoryContextRepository();
  return repository;
}
