import { kvSql } from "../../_core/persistence";
import type { SearchChunk, SearchEntityRef, VisibilityScope } from "./types";

export type SearchSourceInput = {
  sedeId: number;
  scope: VisibilityScope;
  sourceType: string;
  sourceId: string;
  sourceVersion: string;
  chunks: Array<{
    content: string;
    checksum: string;
    entityRefs: SearchEntityRef[];
    occurredAt: Date | null;
    embedding: number[] | null;
  }>;
};

export type SearchRepository = {
  ensureSchema(): Promise<{ vectorAvailable: boolean }>;
  upsertSource(input: SearchSourceInput): Promise<number>;
  deleteSource(input: {
    sedeId: number;
    sourceType: string;
    sourceId: string;
    now: Date;
  }): Promise<number>;
  searchCandidates(input: {
    query: string;
    sedeId: number;
    scopes: VisibilityScope[];
    limit: number;
  }): Promise<SearchChunk[]>;
};

export function createMemorySearchRepository(): SearchRepository {
  const chunks: SearchChunk[] = [];
  let nextId = 1;
  return {
    async ensureSchema() {
      return { vectorAvailable: false };
    },
    async upsertSource(input) {
      const now = new Date();
      for (const item of chunks) {
        if (
          item.sedeId === input.sedeId &&
          item.sourceType === input.sourceType &&
          item.sourceId === input.sourceId &&
          !item.deletedAt
        )
          item.deletedAt = now;
      }
      input.chunks.forEach((chunk, chunkIndex) =>
        chunks.push({
          id: nextId++,
          sedeId: input.sedeId,
          scope: input.scope,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          sourceVersion: input.sourceVersion,
          chunkIndex,
          content: chunk.content,
          checksum: chunk.checksum,
          entityRefs: structuredClone(chunk.entityRefs),
          occurredAt: chunk.occurredAt,
          deletedAt: null,
          embedding: chunk.embedding ? [...chunk.embedding] : null,
        })
      );
      return input.chunks.length;
    },
    async deleteSource(input) {
      let count = 0;
      for (const item of chunks) {
        if (
          item.sedeId === input.sedeId &&
          item.sourceType === input.sourceType &&
          item.sourceId === input.sourceId &&
          !item.deletedAt
        ) {
          item.deletedAt = new Date(input.now);
          count += 1;
        }
      }
      return count;
    },
    async searchCandidates(input) {
      return chunks
        .filter(
          item =>
            item.sedeId === input.sedeId &&
            input.scopes.includes(item.scope) &&
            !item.deletedAt
        )
        .slice(0, input.limit)
        .map(item => structuredClone(item));
    },
  };
}

type Sql = NonNullable<typeof kvSql>;

export function createPostgresSearchRepository(sql: Sql): SearchRepository {
  let schema: Promise<{ vectorAvailable: boolean }> | null = null;
  const ensureSchema = () => {
    schema ??= (async () => {
      const extensions = await sql`SELECT EXISTS(
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
      ) AS available`;
      const vectorAvailable = Boolean(extensions[0]?.available);
      await sql`CREATE TABLE IF NOT EXISTS tars_search_chunks (
        id BIGSERIAL PRIMARY KEY, sede_id INTEGER NOT NULL, scope TEXT NOT NULL,
        source_type TEXT NOT NULL, source_id TEXT NOT NULL, source_version TEXT NOT NULL,
        chunk_index INTEGER NOT NULL, content TEXT NOT NULL, checksum TEXT NOT NULL,
        entity_refs JSONB NOT NULL DEFAULT '[]'::jsonb, occurred_at TIMESTAMPTZ,
        deleted_at TIMESTAMPTZ, embedding_json JSONB,
        UNIQUE(sede_id, source_type, source_id, source_version, chunk_index)
      )`;
      await sql`CREATE INDEX IF NOT EXISTS tars_search_chunks_scope_idx
        ON tars_search_chunks(sede_id, scope, source_type, source_id)
        WHERE deleted_at IS NULL`;
      await sql`CREATE INDEX IF NOT EXISTS tars_search_chunks_text_idx
        ON tars_search_chunks USING GIN(to_tsvector('simple', content))`;
      return { vectorAvailable };
    })();
    return schema;
  };
  const row = (item: any): SearchChunk => ({
    id: Number(item.id),
    sedeId: Number(item.sede_id),
    scope: item.scope,
    sourceType: item.source_type,
    sourceId: item.source_id,
    sourceVersion: item.source_version,
    chunkIndex: Number(item.chunk_index),
    content: item.content,
    checksum: item.checksum,
    entityRefs: item.entity_refs ?? [],
    occurredAt: item.occurred_at ? new Date(item.occurred_at) : null,
    deletedAt: item.deleted_at ? new Date(item.deleted_at) : null,
    embedding: Array.isArray(item.embedding_json) ? item.embedding_json : null,
  });
  return {
    ensureSchema,
    async upsertSource(input) {
      await ensureSchema();
      return sql.begin(async tx => {
        await tx`UPDATE tars_search_chunks SET deleted_at = NOW()
          WHERE sede_id = ${input.sedeId} AND source_type = ${input.sourceType}
            AND source_id = ${input.sourceId} AND deleted_at IS NULL`;
        for (let index = 0; index < input.chunks.length; index += 1) {
          const chunk = input.chunks[index];
          await tx`INSERT INTO tars_search_chunks (
            sede_id, scope, source_type, source_id, source_version, chunk_index,
            content, checksum, entity_refs, occurred_at, embedding_json, deleted_at
          ) VALUES (
            ${input.sedeId}, ${input.scope}, ${input.sourceType}, ${input.sourceId},
            ${input.sourceVersion}, ${index}, ${chunk.content}, ${chunk.checksum},
            ${tx.json(chunk.entityRefs as any)}, ${chunk.occurredAt},
            ${chunk.embedding ? tx.json(chunk.embedding as any) : null}, NULL
          ) ON CONFLICT (sede_id, source_type, source_id, source_version, chunk_index)
          DO UPDATE SET scope = EXCLUDED.scope, content = EXCLUDED.content,
            checksum = EXCLUDED.checksum, entity_refs = EXCLUDED.entity_refs,
            occurred_at = EXCLUDED.occurred_at, embedding_json = EXCLUDED.embedding_json,
            deleted_at = NULL`;
        }
        return input.chunks.length;
      });
    },
    async deleteSource(input) {
      await ensureSchema();
      const rows =
        await sql`UPDATE tars_search_chunks SET deleted_at = ${input.now}
        WHERE sede_id = ${input.sedeId} AND source_type = ${input.sourceType}
          AND source_id = ${input.sourceId} AND deleted_at IS NULL RETURNING id`;
      return rows.length;
    },
    async searchCandidates(input) {
      await ensureSchema();
      const rows = await sql`SELECT * FROM tars_search_chunks
        WHERE sede_id = ${input.sedeId} AND scope IN ${sql(input.scopes)}
          AND deleted_at IS NULL
          AND (to_tsvector('simple', content) @@ plainto_tsquery('simple', ${input.query})
            OR content ILIKE ${`%${input.query.replace(/[%_\\]/g, "\\$&")}%`} ESCAPE '\\')
        ORDER BY occurred_at DESC NULLS LAST, id DESC LIMIT ${input.limit}`;
      return rows.map(row);
    },
  };
}

let repository: SearchRepository | null = null;
export function getSearchRepository(): SearchRepository {
  repository ??= kvSql
    ? createPostgresSearchRepository(kvSql)
    : createMemorySearchRepository();
  return repository;
}
