import { persistedStore } from "../_core/persistence";
import type {
  ProcessExperimentOutcome,
  ProcessMetricKey,
  ProcessMetricReading,
} from "./processMetrics";

export type ProcessSnapshot = {
  id: number;
  sedeId: number;
  capturedAt: Date;
  metrics: ProcessMetricReading[];
};

export type ProcessExperiment = {
  id: number;
  sedeId: number;
  proposalId: number;
  actionCaseId: number | null;
  canonicalKey: string;
  metricKey: ProcessMetricKey;
  action: string;
  responsibleUserId: number;
  baselineValue: number;
  baselineDenominator: number;
  targetValue: number;
  dueAt: Date;
  status: "aperto" | "valutato";
  outcome: ProcessExperimentOutcome | null;
  measuredValue: number | null;
  measuredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type CreateExperimentInput = Omit<
  ProcessExperiment,
  | "id"
  | "actionCaseId"
  | "status"
  | "outcome"
  | "measuredValue"
  | "measuredAt"
  | "createdAt"
  | "updatedAt"
> & { now: Date };

export type ProcessExperimentRepository = {
  saveSnapshot(
    sedeId: number,
    metrics: ProcessMetricReading[],
    capturedAt?: Date
  ): ProcessSnapshot;
  listSnapshots(sedeId: number, limit?: number): ProcessSnapshot[];
  latestSnapshot(sedeId: number): ProcessSnapshot | null;
  createExperiment(input: CreateExperimentInput): ProcessExperiment;
  findOpenExperiment(
    sedeId: number,
    canonicalKey: string
  ): ProcessExperiment | null;
  listDueExperiments(now: Date): ProcessExperiment[];
  attachActionCase(
    id: number,
    sedeId: number,
    actionCaseId: number
  ): ProcessExperiment;
  completeExperiment(input: {
    id: number;
    sedeId: number;
    measuredValue: number;
    outcome: ProcessExperimentOutcome;
    measuredAt: Date;
  }): ProcessExperiment;
};

function restoreDates<T extends ProcessSnapshot | ProcessExperiment>(item: T): T {
  const dateKeys = [
    "capturedAt",
    "dueAt",
    "measuredAt",
    "createdAt",
    "updatedAt",
  ] as const;
  for (const key of dateKeys) {
    if (key in item && (item as any)[key] != null && !((item as any)[key] instanceof Date)) {
      (item as any)[key] = new Date((item as any)[key]);
    }
  }
  return item;
}

export function createArrayProcessExperimentRepository(
  snapshots: ProcessSnapshot[],
  experiments: ProcessExperiment[],
  saveSnapshots: () => void,
  saveExperiments: () => void
): ProcessExperimentRepository {
  return {
    saveSnapshot(sedeId, metrics, capturedAt = new Date()) {
      const day = capturedAt.toISOString().slice(0, 10);
      const existing = snapshots.find(
        item =>
          item.sedeId === sedeId &&
          item.capturedAt.toISOString().slice(0, 10) === day
      );
      const snapshot: ProcessSnapshot = {
        id:
          existing?.id ??
          (snapshots.length
            ? Math.max(...snapshots.map(item => item.id)) + 1
            : 1),
        sedeId,
        capturedAt: new Date(capturedAt),
        metrics: structuredClone(metrics),
      };
      if (existing) Object.assign(existing, snapshot);
      else snapshots.push(snapshot);

      const cutoff = capturedAt.getTime() - 90 * 86_400_000;
      for (let i = snapshots.length - 1; i >= 0; i -= 1) {
        if (snapshots[i].capturedAt.getTime() < cutoff) snapshots.splice(i, 1);
      }
      saveSnapshots();
      return structuredClone(snapshot);
    },

    listSnapshots(sedeId, limit = 30) {
      return snapshots
        .filter(item => item.sedeId === sedeId)
        .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
        .slice(0, Math.max(1, Math.min(limit, 90)))
        .map(item => structuredClone(item));
    },

    latestSnapshot(sedeId) {
      return this.listSnapshots(sedeId, 1)[0] ?? null;
    },

    createExperiment(input) {
      const retry = experiments.find(
        item => item.sedeId === input.sedeId && item.proposalId === input.proposalId
      );
      if (retry) return structuredClone(retry);
      const open = experiments.find(
        item =>
          item.sedeId === input.sedeId &&
          item.canonicalKey === input.canonicalKey &&
          item.status === "aperto"
      );
      if (open) throw new Error("Esiste già un esperimento aperto per questa metrica.");
      const now = new Date(input.now);
      const experiment: ProcessExperiment = {
        id: experiments.length
          ? Math.max(...experiments.map(item => item.id)) + 1
          : 1,
        sedeId: input.sedeId,
        proposalId: input.proposalId,
        actionCaseId: null,
        canonicalKey: input.canonicalKey,
        metricKey: input.metricKey,
        action: input.action,
        responsibleUserId: input.responsibleUserId,
        baselineValue: input.baselineValue,
        baselineDenominator: input.baselineDenominator,
        targetValue: input.targetValue,
        dueAt: new Date(input.dueAt),
        status: "aperto",
        outcome: null,
        measuredValue: null,
        measuredAt: null,
        createdAt: now,
        updatedAt: now,
      };
      experiments.push(experiment);
      saveExperiments();
      return structuredClone(experiment);
    },

    findOpenExperiment(sedeId, canonicalKey) {
      const found = experiments.find(
        item =>
          item.sedeId === sedeId &&
          item.canonicalKey === canonicalKey &&
          item.status === "aperto"
      );
      return found ? structuredClone(found) : null;
    },

    listDueExperiments(now) {
      return experiments
        .filter(item => item.status === "aperto" && item.dueAt <= now)
        .map(item => structuredClone(item));
    },

    attachActionCase(id, sedeId, actionCaseId) {
      const item = experiments.find(row => row.id === id && row.sedeId === sedeId);
      if (!item) throw new Error("Esperimento non trovato.");
      item.actionCaseId = actionCaseId;
      item.updatedAt = new Date();
      saveExperiments();
      return structuredClone(item);
    },

    completeExperiment(input) {
      const item = experiments.find(
        row => row.id === input.id && row.sedeId === input.sedeId
      );
      if (!item) throw new Error("Esperimento non trovato.");
      item.status = "valutato";
      item.measuredValue = input.measuredValue;
      item.outcome = input.outcome;
      item.measuredAt = new Date(input.measuredAt);
      item.updatedAt = new Date(input.measuredAt);
      saveExperiments();
      return structuredClone(item);
    },
  };
}

export function createMemoryProcessExperimentRepository(): ProcessExperimentRepository {
  return createArrayProcessExperimentRepository([], [], () => {}, () => {});
}

const snapshotStore = persistedStore<ProcessSnapshot>(
  "tars_process_snapshots",
  items => items.forEach(restoreDates)
);
const experimentStore = persistedStore<ProcessExperiment>(
  "tars_process_experiments",
  items => items.forEach(restoreDates)
);

export const processExperimentRepository = createArrayProcessExperimentRepository(
  snapshotStore.items,
  experimentStore.items,
  () => snapshotStore.save(),
  () => experimentStore.save()
);
