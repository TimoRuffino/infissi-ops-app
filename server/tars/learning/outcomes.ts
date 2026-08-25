import { newTarsOutcomeId, saveTarsOutcomes, tarsOutcomes } from "../stores";

export type TarsOutcomeEvent =
  | "approved"
  | "modified"
  | "rejected"
  | "undo"
  | "verified"
  | "incident";

export type TarsOutcomeReason =
  | "duplicate"
  | "wrong_data"
  | "wrong_target"
  | "not_needed"
  | "manual_preference"
  | "execution_error"
  | "verified"
  | "unspecified";

export type TarsOutcome = {
  id: number;
  sedeId: number;
  capability: string;
  eventType: TarsOutcomeEvent;
  successful: boolean;
  workflowId: string;
  workflowVersion: string;
  modelVersion: string;
  promptVersion: string;
  reasonCode: TarsOutcomeReason;
  occurredAt: Date;
};

export type TarsOutcomeStore = {
  nextId(): number;
  add(outcome: TarsOutcome): void;
  list(sedeId: number): TarsOutcome[];
};

export function createMemoryOutcomeStore(): TarsOutcomeStore {
  const rows: TarsOutcome[] = [];
  let nextId = 1;
  return {
    nextId: () => nextId++,
    add: outcome => rows.push(structuredClone(outcome)),
    list: sedeId =>
      rows
        .filter(row => row.sedeId === sedeId)
        .map(row => structuredClone(row)),
  };
}

const persistedOutcomeStore: TarsOutcomeStore = {
  nextId: newTarsOutcomeId,
  add(outcome) {
    tarsOutcomes.push(outcome);
    saveTarsOutcomes();
  },
  list(sedeId) {
    return tarsOutcomes
      .filter(row => row.sedeId === sedeId)
      .map(row => structuredClone(row));
  },
};

function normalizeReason(
  reason: string | null | undefined,
  eventType: TarsOutcomeEvent
): TarsOutcomeReason {
  const value = reason?.toLowerCase() ?? "";
  if (/duplic|esiste gi|gia present/.test(value)) return "duplicate";
  if (/dato|informazion.*sbagliat/.test(value)) return "wrong_data";
  if (
    /commessa|cliente.*sbagliat|destinazion|assegnat|responsabil|utente/.test(
      value
    )
  )
    return "wrong_target";
  if (/non necess|inutile/.test(value)) return "not_needed";
  if (/faccio io|manual/.test(value)) return "manual_preference";
  if (/error|fallit|incident/.test(value) || eventType === "incident") {
    return "execution_error";
  }
  if (eventType === "verified") return "verified";
  return "unspecified";
}

export function recordTarsOutcome(
  input: Omit<TarsOutcome, "id" | "successful" | "reasonCode"> & {
    reason?: string | null;
  },
  store: TarsOutcomeStore = persistedOutcomeStore
): TarsOutcome {
  const outcome: TarsOutcome = {
    id: store.nextId(),
    sedeId: input.sedeId,
    capability: input.capability.trim(),
    eventType: input.eventType,
    successful: input.eventType === "verified",
    workflowId: input.workflowId,
    workflowVersion: input.workflowVersion,
    modelVersion: input.modelVersion,
    promptVersion: input.promptVersion,
    reasonCode: normalizeReason(input.reason, input.eventType),
    occurredAt: new Date(input.occurredAt),
  };
  store.add(outcome);
  return structuredClone(outcome);
}

export type CapabilityOutcomeReport = {
  capability: string;
  sampleSize: number;
  successful: number;
  accuracy: number;
  decisionCount: number;
  approvalRate: number | null;
  incidents: number;
  observedFrom: Date;
  observedTo: Date;
  modelVersions: string[];
  promptVersions: string[];
  workflowVersions: string[];
};

export function buildCapabilityOutcomeReport(input: {
  sedeId: number;
  store?: TarsOutcomeStore;
}): CapabilityOutcomeReport[] {
  const groups = new Map<string, TarsOutcome[]>();
  for (const outcome of (input.store ?? persistedOutcomeStore).list(
    input.sedeId
  )) {
    const group = groups.get(outcome.capability) ?? [];
    group.push(outcome);
    groups.set(outcome.capability, group);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([capability, rows]) => {
      const ordered = rows.sort(
        (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()
      );
      const qualityRows = rows.filter(row =>
        ["verified", "modified", "undo", "incident"].includes(row.eventType)
      );
      const decisionRows = rows.filter(row =>
        ["approved", "rejected"].includes(row.eventType)
      );
      const successful = qualityRows.filter(row => row.successful).length;
      return {
        capability,
        sampleSize: qualityRows.length,
        successful,
        accuracy: qualityRows.length ? successful / qualityRows.length : 0,
        decisionCount: decisionRows.length,
        approvalRate: decisionRows.length
          ? decisionRows.filter(row => row.eventType === "approved").length /
            decisionRows.length
          : null,
        incidents: rows.filter(row => row.eventType === "incident").length,
        observedFrom: ordered[0].occurredAt,
        observedTo: ordered[ordered.length - 1].occurredAt,
        modelVersions: Array.from(new Set(rows.map(row => row.modelVersion))),
        promptVersions: Array.from(new Set(rows.map(row => row.promptVersion))),
        workflowVersions: Array.from(
          new Set(rows.map(row => row.workflowVersion))
        ),
      };
    });
}
