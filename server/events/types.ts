export type BusinessEventSource = {
  type: string;
  id: string;
  version?: string;
};

export type BusinessEventDraft = {
  sedeId: number;
  eventType: string;
  source: BusinessEventSource;
  actorUserId: number | null;
  subjectRefs: Array<{ type: string; id: string }>;
  recipientHints: number[];
  payload: { version: 1; [key: string]: unknown };
  dedupeKey: string;
  occurredAt: Date;
};

export type BusinessEvent = BusinessEventDraft & {
  id: number;
  createdAt: Date;
};

export type EventProcessingStatus =
  | "pending"
  | "processing"
  | "completed"
  | "dead_letter";

export type BusinessEventProcessing = {
  eventId: number;
  consumerName: string;
  status: EventProcessingStatus;
  attempts: number;
  availableAt: Date;
  lockedBy: string | null;
  lockedAt: Date | null;
  lastErrorCode: string | null;
  processedAt: Date | null;
  updatedAt: Date;
};
