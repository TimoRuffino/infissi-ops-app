export type EvidenceRef = {
  sourceType: string;
  sourceId: string;
  label: string;
  version: string;
  link?: string;
};

export type ContextFact = {
  key: string;
  value: unknown;
  confidence: "certain" | "inferred";
  evidence: EvidenceRef[];
};

export type EntityContextKey = {
  sedeId: number;
  entityType: "cliente" | "commessa";
  entityId: number;
  scope: "operativo" | "amministrazione" | "direzione";
};

export type ContextSummaryItem = {
  text: string;
  evidenceIds: string[];
};

export type ContextSummary = {
  summary: string;
  openQuestions: ContextSummaryItem[];
  risks: ContextSummaryItem[];
  nextActions: ContextSummaryItem[];
};

export type ContextVersionState = "facts_only" | "ready" | "failed";

export type ContextEvidence = EvidenceRef & {
  id: number;
  contextVersionId: number;
  factKey: string;
  ordinal: number;
  sourceVersion: string;
};

export type EntityContextSnapshot = {
  id: number;
  key: EntityContextKey;
  version: number;
  schemaVersion: string;
  collectorVersion: string;
  policyVersion: string;
  fingerprint: string;
  facts: ContextFact[];
  evidence: ContextEvidence[];
  summary: ContextSummary | null;
  state: ContextVersionState;
  errorCode: string | null;
  createdAt: Date;
  expiresAt: Date;
  stale: boolean;
  definitive: boolean;
};

export type SaveContextVersionInput = {
  key: EntityContextKey;
  schemaVersion: string;
  collectorVersion: string;
  policyVersion: string;
  fingerprint: string;
  facts: ContextFact[];
  summary: ContextSummary | null;
  state: ContextVersionState;
  errorCode?: string | null;
  createdAt: Date;
  expiresAt: Date;
};

export type ContextRebuildRequest = {
  key: EntityContextKey;
  reason: string;
  eventId?: number;
  requestedAt: Date;
};
