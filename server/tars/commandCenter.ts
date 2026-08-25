import type { ActionCaseRecord } from "../actionCenter/types";
import type { StructuredValue, TarsPlan } from "./planner/types";

export type TarsEvidence = {
  type:
    | "email"
    | "whatsapp"
    | "fattura_fic"
    | "documento"
    | "cliente"
    | "commessa"
    | "registro";
  id: string;
  label: string;
  occurredAt: Date | null;
};

type StructuredEvidenceRef = {
  sourceType: string;
  sourceId: string;
  label: string;
  version: string;
  link?: string;
};

export type TarsPriority = {
  id: string;
  canonicalKey: string;
  title: string;
  conclusion: string;
  reason: string;
  confidence: "alta" | "media" | "bassa";
  urgency: number;
  impact: number;
  dueAt: Date | null;
  clienteId: number | null;
  commessaId: number | null;
  proposalId: number | null;
  evidence: TarsEvidence[];
  createdAt: Date;
};

export type TarsCommandCenterSnapshot = {
  generatedAt: Date;
  status: "ready" | "degraded" | "disabled";
  brief: { title: string; summary: string; highlights: string[] };
  priorities: TarsPriority[];
  activePlans: TarsPlanView[];
  waitingQuestions: TarsPlanView[];
  waitingApprovals: TarsPlanView[];
  blockedCases: Array<{
    id: number;
    title: string;
    priority: string;
    link: string;
    updatedAt: Date;
  }>;
  recentOutcomes: TarsPlanView[];
  metrics: {
    pending: number;
    failedRuns: number;
    duplicateAvoided: number;
    toolCacheHits: number;
    cacheReadPercent: number;
    contextCacheHits: number;
    factsRead: number;
    factsRevalidated: number;
    evidenceCoveragePercent: number;
    lastRunAt: Date | null;
  };
};

export type TarsPlanView = {
  id: number;
  version: number;
  workflowId: string;
  intent: string;
  status: TarsPlan["status"];
  currentStep: string | null;
  currentStepData: StructuredValue | null;
  completedSteps: number;
  totalSteps: number;
  errorCode: string | null;
  evidence: StructuredEvidenceRef[];
  updatedAt: Date;
};

const ECONOMIC_EVIDENCE = new Set(["fattura_fic", "pagamento", "economia"]);

function planEvidence(plan: TarsPlan, canReadEconomic: boolean) {
  const seen = new Set<string>();
  return plan.steps
    .flatMap(step => step.evidenceRefs)
    .filter(ref => canReadEconomic || !ECONOMIC_EVIDENCE.has(ref.sourceType))
    .filter(ref => {
      const key = `${ref.sourceType}:${ref.sourceId}:${ref.version}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function assignedUserId(plan: TarsPlan): number | null {
  const value = plan.input;
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const direct = Number(value.assigneeId ?? value.assegnatoA);
  if (Number.isSafeInteger(direct) && direct > 0) return direct;
  const job = value.job;
  if (!job || Array.isArray(job) || typeof job !== "object") return null;
  const nested = Number(job.assigneeId ?? job.assegnatoA);
  return Number.isSafeInteger(nested) && nested > 0 ? nested : null;
}

export function canViewPlan(input: {
  plan: TarsPlan;
  userId: number;
  direction: boolean;
}): boolean {
  return (
    input.direction ||
    input.plan.createdBy === input.userId ||
    assignedUserId(input.plan) === input.userId
  );
}

function planView(plan: TarsPlan, canReadEconomic: boolean): TarsPlanView {
  const current = plan.steps.find(
    step => !["completed", "skipped"].includes(step.status)
  );
  return {
    id: plan.id,
    version: plan.version,
    workflowId: plan.workflowId,
    intent: plan.intent,
    status: plan.status,
    currentStep: current?.key ?? null,
    currentStepData: current?.output ?? current?.input ?? null,
    completedSteps: plan.steps.filter(step =>
      ["completed", "skipped"].includes(step.status)
    ).length,
    totalSteps: plan.steps.length,
    errorCode: plan.errorCode,
    evidence: planEvidence(plan, canReadEconomic),
    updatedAt: plan.updatedAt,
  };
}

export function buildPlanCollections(input: {
  plans: TarsPlan[];
  blockedCases: ActionCaseRecord[];
  canReadEconomic: boolean;
}) {
  const views = input.plans.map(plan => planView(plan, input.canReadEconomic));
  const terminal = new Set<TarsPlan["status"]>([
    "completed",
    "partially_completed",
    "failed",
    "canceled",
  ]);
  return {
    activePlans: views.filter(item =>
      ["draft", "running", "verifying", "waiting_technical"].includes(
        item.status
      )
    ),
    waitingQuestions: views.filter(item => item.status === "waiting_user"),
    waitingApprovals: views.filter(item => item.status === "waiting_approval"),
    blockedCases: input.blockedCases.map(item => ({
      id: item.id,
      title: item.title,
      priority: item.priority,
      link: item.link,
      updatedAt: item.updatedAt,
    })),
    recentOutcomes: views
      .filter(item => terminal.has(item.status))
      .slice(0, 12),
  };
}

type ProposalInput = {
  id: number;
  tipo: string;
  titolo: string;
  motivazione: string;
  confidenza: "alta" | "media" | "bassa";
  payload?: Record<string, unknown> | null;
  commessaId: number | null;
  clienteId: number | null;
  chiaveAzione?: string;
  esecuzioneId?: number | null;
  evidenceRefs?: StructuredEvidenceRef[];
  createdAt: Date;
};

type ExecutionInput = {
  id: number;
  esito: string;
  createdAt: Date;
  toolCacheHits?: number;
  proposteDuplicateBloccate?: number;
  tokensCacheRead?: number;
  tokensIn?: number;
  comunicazioneId?: number | null;
  evidenceRefs?: StructuredEvidenceRef[];
  contextCacheHit?: boolean;
  factsRead?: number;
  factsRevalidated?: number;
};

const URGENZA: Record<string, number> = {
  domanda: 96,
  crea_lead: 92,
  ticket: 90,
  bozza_risposta: 86,
  collega_comunicazione: 84,
  pagamento: 82,
  avanzamento_stato: 76,
  collega_fattura: 72,
  segnalazione: 70,
  modifica_commessa: 66,
  modifica_cliente: 62,
  aggiornamento_magazzino: 58,
  nota_timeline: 52,
  rinomina_documento: 44,
  miglioramento_processo: 38,
};

const IMPATTO: Record<string, number> = {
  crea_lead: 96,
  pagamento: 94,
  ticket: 90,
  collega_fattura: 88,
  avanzamento_stato: 84,
  domanda: 82,
  bozza_risposta: 78,
  collega_comunicazione: 74,
  segnalazione: 72,
  modifica_commessa: 68,
  modifica_cliente: 64,
  aggiornamento_magazzino: 60,
  miglioramento_processo: 58,
  nota_timeline: 48,
  rinomina_documento: 35,
};

function confidenceWeight(value: TarsPriority["confidence"]): number {
  return value === "alta" ? 100 : value === "media" ? 65 : 30;
}

function score(item: TarsPriority): number {
  return (
    item.urgency * 0.5 +
    item.impact * 0.35 +
    confidenceWeight(item.confidence) * 0.15
  );
}

export function rankTarsPriorities(items: TarsPriority[]): TarsPriority[] {
  const ordinate = [...items]
    .filter(item => item.evidence.length > 0)
    .sort((a, b) => {
      const scoreDiff = score(b) - score(a);
      if (scoreDiff !== 0) return scoreDiff;
      const dueA = a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const dueB = b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
      if (dueA !== dueB) return dueA - dueB;
      return a.canonicalKey.localeCompare(b.canonicalKey);
    });
  const viste = new Set<string>();
  return ordinate.filter(item => {
    if (viste.has(item.canonicalKey)) return false;
    viste.add(item.canonicalKey);
    return true;
  });
}

function idNumerico(value: unknown): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function dataOpzionale(value: unknown): Date | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function evidenceForProposal(
  proposal: ProposalInput,
  execution: ExecutionInput | undefined
): TarsEvidence[] {
  const payload = proposal.payload ?? {};
  const structured = [
    ...(proposal.evidenceRefs ?? []),
    ...(execution?.evidenceRefs ?? []),
  ];
  const structuredEvidence = structured.map(item => {
    const source = item.sourceType.toLowerCase();
    const type: TarsEvidence["type"] =
      source === "fattura_fic"
        ? "fattura_fic"
        : source === "documento"
          ? "documento"
          : source === "cliente"
            ? "cliente"
            : source === "commessa"
              ? "commessa"
              : source === "comunicazione"
                ? payload.canale === "whatsapp" ||
                  String(item.label).toLowerCase().includes("whatsapp")
                  ? "whatsapp"
                  : "email"
                : "registro";
    const occurredAt = new Date(item.version);
    return {
      type,
      id: item.sourceId,
      label: item.label,
      occurredAt: Number.isNaN(occurredAt.getTime()) ? null : occurredAt,
    };
  });
  if (structuredEvidence.length > 0) {
    const seen = new Set<string>();
    return structuredEvidence
      .filter(item => {
        const key = `${item.type}:${item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 3);
  }
  const evidence: TarsEvidence[] = [];
  const comunicazioneId =
    idNumerico(payload.comunicazioneId) ?? execution?.comunicazioneId ?? null;
  if (comunicazioneId != null) {
    const channel = payload.canale === "whatsapp" ? "whatsapp" : "email";
    evidence.push({
      type: channel,
      id: String(comunicazioneId),
      label: `${channel === "whatsapp" ? "WhatsApp" : "Email"} #${comunicazioneId}`,
      occurredAt: proposal.createdAt,
    });
  }
  if (proposal.commessaId != null) {
    evidence.push({
      type: "commessa",
      id: String(proposal.commessaId),
      label: String(
        payload.commessaCodice ?? `Commessa #${proposal.commessaId}`
      ),
      occurredAt: null,
    });
  }
  if (proposal.clienteId != null) {
    evidence.push({
      type: "cliente",
      id: String(proposal.clienteId),
      label: `Cliente #${proposal.clienteId}`,
      occurredAt: null,
    });
  }
  const fatturaId = idNumerico(payload.fatturaId);
  if (fatturaId != null) {
    evidence.push({
      type: "fattura_fic",
      id: String(fatturaId),
      label: String(payload.fatturaNumero ?? `Fattura #${fatturaId}`),
      occurredAt: null,
    });
  }
  if (evidence.length === 0 && execution) {
    evidence.push({
      type: "registro",
      id: String(execution.id),
      label: `Analisi Tars #${execution.id}`,
      occurredAt: execution.createdAt,
    });
  }
  return evidence.slice(0, 3);
}

function conclusionFor(proposal: ProposalInput): string {
  switch (proposal.tipo) {
    case "domanda":
      return "Tars è fermo finché non riceve questa decisione.";
    case "crea_lead":
      return "È una possibile opportunità commerciale da prendere in carico.";
    case "ticket":
      return "C'è una richiesta post-vendita da presidiare.";
    case "pagamento":
      return "Il movimento economico richiede una verifica.";
    case "collega_fattura":
      return "La fattura può completare il fascicolo della commessa.";
    case "miglioramento_processo":
      return "Tars ha rilevato un pattern operativo migliorabile.";
    default:
      return "Tars ha preparato un'azione verificabile da decidere.";
  }
}

export function buildCommandCenterSnapshot(input: {
  now?: Date;
  active: boolean;
  openaiReady: boolean;
  proposals: ProposalInput[];
  executions: ExecutionInput[];
  plans?: TarsPlan[];
  blockedCases?: ActionCaseRecord[];
  canReadEconomic?: boolean;
  limit?: number;
}): TarsCommandCenterSnapshot {
  const now = input.now ?? new Date();
  const executions = [...input.executions].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
  const executionById = new Map(executions.map(item => [item.id, item]));
  const priorities = rankTarsPriorities(
    input.proposals.map(proposal => {
      const execution = proposal.esecuzioneId
        ? executionById.get(proposal.esecuzioneId)
        : undefined;
      const payload = proposal.payload ?? {};
      return {
        id: `proposta:${proposal.id}`,
        canonicalKey: proposal.chiaveAzione ?? `proposta:${proposal.id}`,
        title: proposal.titolo,
        conclusion: conclusionFor(proposal),
        reason: proposal.motivazione,
        confidence: proposal.confidenza,
        urgency: URGENZA[proposal.tipo] ?? 50,
        impact: IMPATTO[proposal.tipo] ?? 50,
        dueAt: dataOpzionale(payload.scadenza) ?? dataOpzionale(payload.data),
        clienteId: proposal.clienteId,
        commessaId: proposal.commessaId,
        proposalId: proposal.id,
        evidence: evidenceForProposal(proposal, execution),
        createdAt: proposal.createdAt,
      } satisfies TarsPriority;
    })
  ).slice(0, input.limit ?? 12);

  const errorCutoff = now.getTime() - 24 * 60 * 60 * 1_000;
  const failedRuns = executions.filter(
    item => item.esito === "errore" && item.createdAt.getTime() >= errorCutoff
  ).length;
  const duplicateAvoided = executions.reduce(
    (total, item) => total + (item.proposteDuplicateBloccate ?? 0),
    0
  );
  const toolCacheHits = executions.reduce(
    (total, item) => total + (item.toolCacheHits ?? 0),
    0
  );
  const cacheRead = executions.reduce(
    (total, item) => total + (item.tokensCacheRead ?? 0),
    0
  );
  const uncachedInput = executions.reduce(
    (total, item) => total + (item.tokensIn ?? 0),
    0
  );
  const cacheReadPercent =
    cacheRead + uncachedInput > 0
      ? Math.round((cacheRead / (cacheRead + uncachedInput)) * 100)
      : 0;
  const contextCacheHits = executions.filter(
    item => item.contextCacheHit
  ).length;
  const factsRead = executions.reduce(
    (total, item) => total + (item.factsRead ?? 0),
    0
  );
  const factsRevalidated = executions.reduce(
    (total, item) => total + (item.factsRevalidated ?? 0),
    0
  );
  const proposalsWithEvidence = input.proposals.filter(
    proposal =>
      (proposal.evidenceRefs?.length ?? 0) > 0 ||
      proposal.commessaId != null ||
      proposal.clienteId != null ||
      idNumerico(proposal.payload?.comunicazioneId) != null
  ).length;
  const evidenceCoveragePercent =
    input.proposals.length > 0
      ? Math.round((proposalsWithEvidence / input.proposals.length) * 100)
      : 100;
  const pending = input.proposals.length;
  const title =
    pending === 0
      ? "Nessuna decisione urgente"
      : `${pending} ${pending === 1 ? "decisione richiede" : "decisioni richiedono"} attenzione`;

  const planCollections = buildPlanCollections({
    plans: input.plans ?? [],
    blockedCases: input.blockedCases ?? [],
    canReadEconomic: input.canReadEconomic ?? false,
  });
  return {
    generatedAt: now,
    status: !input.active
      ? "disabled"
      : !input.openaiReady || failedRuns > 0
        ? "degraded"
        : "ready",
    brief: {
      title,
      summary:
        pending === 0
          ? "Le proposte sono allineate. Tars continua a osservare comunicazioni e processi."
          : "Le priorità sono ordinate per urgenza, impatto e affidabilità dei dati.",
      highlights: priorities.slice(0, 3).map(item => item.title),
    },
    priorities,
    ...planCollections,
    metrics: {
      pending,
      failedRuns,
      duplicateAvoided,
      toolCacheHits,
      cacheReadPercent,
      contextCacheHits,
      factsRead,
      factsRevalidated,
      evidenceCoveragePercent,
      lastRunAt: executions[0]?.createdAt ?? null,
    },
  };
}
