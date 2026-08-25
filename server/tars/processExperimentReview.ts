import type { TrpcContext } from "../_core/context";
import {
  getActionCaseRepository,
  type ActionCaseRepository,
} from "../actionCenter/repository";
import {
  processExperimentRepository,
  type ProcessExperimentRepository,
} from "./processExperiments";
import {
  metricImprovement,
  type ProcessMetricKey,
  type ProcessMetricReading,
} from "./processMetrics";

const FIRST_RUN_MS = 2 * 60 * 1000;
const INTERVAL_MS = 60 * 60 * 1000;

export async function reviewDueProcessExperiments(input: {
  experiments: ProcessExperimentRepository;
  actions: ActionCaseRepository;
  now: Date;
  readMetric: (
    sedeId: number,
    metricKey: ProcessMetricKey
  ) => Promise<ProcessMetricReading | null>;
}): Promise<{ evaluated: number; failed: number }> {
  let evaluated = 0;
  let failed = 0;
  for (const experiment of input.experiments
    .listDueExperiments(input.now)
    .slice(0, 20)) {
    try {
      const metric = await input.readMetric(
        experiment.sedeId,
        experiment.metricKey
      );
      if (!metric) {
        failed += 1;
        continue;
      }
      const outcome = metricImprovement(
        metric,
        experiment.baselineValue,
        metric.value
      );
      input.experiments.completeExperiment({
        id: experiment.id,
        sedeId: experiment.sedeId,
        measuredValue: metric.value,
        outcome,
        measuredAt: input.now,
      });
      if (experiment.actionCaseId != null) {
        const action = await input.actions.findById(
          experiment.sedeId,
          experiment.actionCaseId
        );
        if (action && action.status !== "risolta") {
          await input.actions.transition({
            sedeId: experiment.sedeId,
            id: action.id,
            expectedFingerprint: action.signalFingerprint,
            status: "risolta",
            actorUserId: null,
            eventType: "esperimento_valutato",
            metadata: {
              outcome,
              baselineValue: experiment.baselineValue,
              targetValue: experiment.targetValue,
              measuredValue: metric.value,
            },
            now: input.now,
          });
        }
      }
      evaluated += 1;
    } catch {
      failed += 1;
    }
  }
  return { evaluated, failed };
}

function systemContext(sedeId: number): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 0,
      openId: "tars-process-review",
      name: "Tars (verifica processi)",
      email: "tars-process-review@sistema.local",
      loginMethod: "local",
      role: "admin",
      ruolo: "direzione",
      ruoli: ["direzione"],
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    } as any,
    req: { protocol: "https", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
  };
}

async function readFreshMetric(
  sedeId: number,
  metricKey: ProcessMetricKey
): Promise<ProcessMetricReading | null> {
  const { eseguiStrumento } = await import("./tools");
  const result = await eseguiStrumento(
    {
      ctx: systemContext(sedeId),
      esecuzioneId: 0,
      trigger: "verifica_processi",
      maxProposte: 0,
      proposteIds: [],
      terminato: null,
      risultatiCache: new Map(),
    },
    "leggi_quadro_azienda",
    { giorniFermo: 10 }
  );
  if (result.isError) return null;
  return (
    processExperimentRepository
      .latestSnapshot(sedeId)
      ?.metrics.find(metric => metric.key === metricKey) ?? null
  );
}

async function runReview(): Promise<void> {
  const result = await reviewDueProcessExperiments({
    experiments: processExperimentRepository,
    actions: getActionCaseRepository(),
    now: new Date(),
    readMetric: readFreshMetric,
  });
  if (result.evaluated > 0 || result.failed > 0) {
    console.info(
      `[tars] verifica esperimenti: ${result.evaluated} valutati, ${result.failed} rinviati`
    );
  }
}

export function startProcessExperimentReviewScheduler(): void {
  const first = setTimeout(() => void runReview(), FIRST_RUN_MS);
  first.unref?.();
  const interval = setInterval(() => void runReview(), INTERVAL_MS);
  interval.unref?.();
}
