import type { EvidenceRef, EntityContextKey } from "../context/types";

export type VisibilityScope = EntityContextKey["scope"];
export type SearchEntityRef = { type: string; id: string };

export type SearchChunk = {
  id: number;
  sedeId: number;
  scope: VisibilityScope;
  sourceType: string;
  sourceId: string;
  sourceVersion: string;
  chunkIndex: number;
  content: string;
  checksum: string;
  entityRefs: SearchEntityRef[];
  occurredAt: Date | null;
  deletedAt: Date | null;
  embedding: number[] | null;
};

export type SearchHit = {
  sourceType: string;
  sourceId: string;
  snippet: string;
  score: number;
  entityRefs: SearchEntityRef[];
  evidenceRef: EvidenceRef;
};
