import type { TrpcContext } from "../_core/context";
import { runTars } from "../tars/loop";
import { openaiConfigured } from "../tars/openai";
import { budgetMensileSuperato, getTarsConfig } from "../tars/stores";
import { getActionCaseRepository, type ActionCaseRepository } from "./repository";
import type { ActionCaseRecord } from "./types";

const DEFAULT_BATCH_SIZE = 3;
const QUEUE_DELAY_MS = 4_000;
const running = new Set<number>();
const timers = new Map<number, NodeJS.Timeout>();

export function buildCaseAnalysisRequest(record: ActionCaseRecord): string {
  const evidence = record.signals.slice(0, 12).map(signal =>
    `- ${signal.kind}: ${signal.summary} [${signal.sourceKey}]`
  );
  return `<caso_operativo id="${record.id}" fingerprint="${record.signalFingerprint}">
Titolo: ${record.title}
Priorita deterministica: ${record.priority} (${record.priorityScore})
Stato workflow: ${record.status}
Prossima azione deterministica: ${record.nextAction.label}
Scadenza: ${record.dueAt?.toISOString() ?? "non definita"}
Evidenze:
${evidence.length ? evidence.join("\n") : "- Nessuna evidenza descrittiva aggiuntiva"}
</caso_operativo>

Analizza questo solo caso incrociando il fascicolo della commessa e le fonti utili.
Verifica eventuali contraddizioni prima di concludere. Indica una sola azione consigliata
e al massimo due alternative. Se manca un dato decisivo, crea una domanda; se serve una
modifica, crea esclusivamente una proposta approvabile; non eseguire modifiche e non
ridurre la priorita deterministica. Chiudi con un riepilogo breve e concreto.`;
}

export async function runQueuedCaseAnalyses(input: {
  repository: ActionCaseRepository;
  sedeId: number;
  limit?: number;
  now?: Date;
  analyze: (record: ActionCaseRecord) => Promise<{
    summary: string | null;
    executionId: number;
    proposalIds: number[];
  }>;
}) {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_BATCH_SIZE, 1), 10);
  const now = input.now ?? new Date();
  const queued = await input.repository.listPendingAnalysis(input.sedeId, limit);
  const result = { processed: 0, completed: 0, failed: 0 };

  for (const record of queued) {
    result.processed += 1;
    await input.repository.markAnalysis({
      sedeId: input.sedeId,
      id: record.id,
      status: "in_corso",
      fingerprint: record.signalFingerprint,
      now,
    });
    try {
      const analysis = await input.analyze(record);
      await input.repository.markAnalysis({
        sedeId: input.sedeId,
        id: record.id,
        status: "completata",
        fingerprint: record.signalFingerprint,
        analysis: {
          summary: analysis.summary,
          executionId: analysis.executionId,
          proposalIds: analysis.proposalIds,
        },
        now: new Date(),
      });
      result.completed += 1;
    } catch (error) {
      await input.repository.markAnalysis({
        sedeId: input.sedeId,
        id: record.id,
        status: "errore",
        fingerprint: record.signalFingerprint,
        analysis: {
          message: error instanceof Error ? error.message.slice(0, 300) : "Errore analisi",
        },
        now: new Date(),
      });
      result.failed += 1;
    }
  }
  return result;
}

function systemContext(sedeId: number): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 0,
      openId: "tars-action-center",
      name: "Tars (Centro Azioni)",
      email: "tars-actions@sistema.local",
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

export async function runQueuedCaseAnalysis(sedeId: number): Promise<void> {
  if (running.has(sedeId)) return;
  const config = getTarsConfig(sedeId);
  if (!config.attivo || !openaiConfigured() || budgetMensileSuperato(sedeId)) return;
  running.add(sedeId);
  try {
    const result = await runQueuedCaseAnalyses({
      repository: getActionCaseRepository(),
      sedeId,
      analyze: async record => {
        const execution = await runTars({
          ctx: systemContext(sedeId),
          trigger: "centro_azioni",
          commessaId: record.commessaId,
          richiesta: buildCaseAnalysisRequest(record),
        });
        if (execution.esito === "errore") {
          throw new Error(execution.errore || "Analisi Tars non disponibile");
        }
        return {
          summary: execution.riepilogo,
          executionId: execution.id,
          proposalIds: execution.proposteIds,
        };
      },
    });
    if (result.processed > 0) {
      console.info("[action-center] Tars batch", { sedeId, ...result });
    }
    if ((await getActionCaseRepository().listPendingAnalysis(sedeId, 1)).length > 0) {
      scheduleCaseAnalysisQueue(sedeId);
    }
  } finally {
    running.delete(sedeId);
  }
}

export function scheduleCaseAnalysisQueue(sedeId: number): void {
  if (timers.has(sedeId)) return;
  const timer = setTimeout(() => {
    timers.delete(sedeId);
    void runQueuedCaseAnalysis(sedeId);
  }, QUEUE_DELAY_MS);
  timer.unref?.();
  timers.set(sedeId, timer);
}

export async function scheduleCaseAnalysis(
  sedeId: number,
  caseId: number,
  now = new Date()
): Promise<ActionCaseRecord> {
  const repository = getActionCaseRepository();
  const record = await repository.findById(sedeId, caseId);
  if (!record) throw new Error("ACTION_CASE_NOT_FOUND");
  const queued = await repository.markAnalysis({
    sedeId,
    id: caseId,
    status: "in_coda",
    fingerprint: record.signalFingerprint,
    now,
  });
  scheduleCaseAnalysisQueue(sedeId);
  return queued;
}
