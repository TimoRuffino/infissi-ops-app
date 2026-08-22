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
  metrics: {
    pending: number;
    failedRuns: number;
    duplicateAvoided: number;
    toolCacheHits: number;
    cacheReadPercent: number;
    lastRunAt: Date | null;
  };
};

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
      label: String(payload.commessaCodice ?? `Commessa #${proposal.commessaId}`),
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
        dueAt:
          dataOpzionale(payload.scadenza) ?? dataOpzionale(payload.data),
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
    item =>
      item.esito === "errore" && item.createdAt.getTime() >= errorCutoff
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
  const pending = input.proposals.length;
  const title =
    pending === 0
      ? "Nessuna decisione urgente"
      : `${pending} ${pending === 1 ? "decisione richiede" : "decisioni richiedono"} attenzione`;

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
    metrics: {
      pending,
      failedRuns,
      duplicateAvoided,
      toolCacheHits,
      cacheReadPercent,
      lastRunAt: executions[0]?.createdAt ?? null,
    },
  };
}
