import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../_core/context";
import {
  STATI_COMMESSA,
  type StatoCommessa,
} from "../routers/commesse";
import {
  DOC_TIPO_LABEL,
  REQUIRED_DOC_TIPI_PER_STATO,
  type DocTipo,
} from "../routers/preventiviContratti";

export type ClosureBlockerCode =
  | "saldo"
  | "documenti"
  | "timeline"
  | "ticket"
  | "interventi";

export type ClosureReadiness = {
  ready: boolean;
  commessaId: number;
  currentState: string;
  saldoResiduo: number;
  missingDocumentGroups: DocTipo[][];
  incompleteTimelineSteps: Array<{
    id: number;
    ordine: number;
    titolo: string;
    stato: string;
  }>;
  openTicketIds: number[];
  openInterventionIds: number[];
  blockers: Array<{
    code: ClosureBlockerCode;
    label: string;
    action: string;
  }>;
  fingerprint: string;
};

export type ClosureDataSource = {
  loadCommessa: (id: number) => Promise<any | null>;
  loadDocuments: (commessaId: number) => Promise<any[]>;
  loadTimeline: (commessaId: number) => Promise<any[]>;
  loadTickets: (commessaId: number) => Promise<any[]>;
  loadInterventions: (commessaId: number) => Promise<any[]>;
};

async function defaultSource(ctx: TrpcContext): Promise<ClosureDataSource> {
  const { appRouter } = await import("../routers");
  const caller = appRouter.createCaller(ctx);
  return {
    loadCommessa: id => caller.commesse.byId(id),
    loadDocuments: commessaId =>
      caller.preventiviContratti.byCommessa(commessaId),
    loadTimeline: commessaId => caller.timeline.byCommessa(commessaId),
    loadTickets: commessaId => caller.ticket.list({ commessaId }),
    loadInterventions: commessaId => caller.interventi.list({ commessaId }),
  };
}

function groupsFromState(stato: string): DocTipo[][] {
  const start = STATI_COMMESSA.indexOf(stato as StatoCommessa);
  if (start < 0) return [];
  const groups: DocTipo[][] = [];
  const seen = new Set<string>();
  for (const current of STATI_COMMESSA.slice(start, -1)) {
    const required = REQUIRED_DOC_TIPI_PER_STATO[current] ?? [];
    if (required.length === 0) continue;
    const key = [...required].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push([...required]);
  }
  return groups;
}

function stableFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function evaluateClosureReadiness(
  ctx: TrpcContext,
  commessaId: number,
  source?: ClosureDataSource
): Promise<ClosureReadiness> {
  const data = source ?? (await defaultSource(ctx));
  const commessa = await data.loadCommessa(commessaId);
  if (!commessa || Number(commessa.sedeId) !== (ctx.sedeId ?? 1)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Commessa non trovata." });
  }

  const [documents, timeline, tickets, interventions] = await Promise.all([
    data.loadDocuments(commessaId),
    data.loadTimeline(commessaId),
    data.loadTickets(commessaId),
    data.loadInterventions(commessaId),
  ]);
  const documentTypes = new Set<DocTipo>(
    documents.map(document => document.tipo as DocTipo)
  );
  const missingDocumentGroups = groupsFromState(commessa.stato).filter(
    group => !group.some(type => documentTypes.has(type))
  );
  const saldoResiduo = Math.max(
    0,
    Number(commessa.importoTotale ?? 0) - Number(commessa.importoIncassato ?? 0)
  );
  const incompleteTimelineSteps = timeline
    .filter(step => step.stato !== "completato")
    .map(step => ({
      id: Number(step.id),
      ordine: Number(step.stepNumber ?? step.ordine ?? 0),
      titolo: String(step.label ?? step.titolo ?? `Step ${step.id}`),
      stato: String(step.stato),
    }));
  const timelineInProgress = incompleteTimelineSteps.filter(
    step => step.stato === "in_corso"
  );
  const openTicketIds = tickets
    .filter(ticket => !["chiuso", "completato"].includes(ticket.stato))
    .map(ticket => Number(ticket.id));
  const openInterventionIds = interventions
    .filter(intervention => intervention.stato !== "completato")
    .map(intervention => Number(intervention.id));
  const blockers: ClosureReadiness["blockers"] = [];

  if (saldoResiduo > 0.01) {
    blockers.push({
      code: "saldo",
      label: `Saldo residuo ${saldoResiduo.toFixed(2)} euro`,
      action: "Verifica e registra il saldo cliente.",
    });
  }
  if (missingDocumentGroups.length > 0) {
    blockers.push({
      code: "documenti",
      label: `Documenti mancanti: ${missingDocumentGroups
        .map(group => group.map(type => DOC_TIPO_LABEL[type]).join(" o "))
        .join(", ")}`,
      action: "Completa il fascicolo con i documenti obbligatori.",
    });
  }
  if (timelineInProgress.length > 0) {
    blockers.push({
      code: "timeline",
      label: `${timelineInProgress.length} passaggi della timeline ancora in corso`,
      action: "Concludi o correggi i passaggi ancora in lavorazione.",
    });
  }
  if (openTicketIds.length > 0) {
    blockers.push({
      code: "ticket",
      label: `${openTicketIds.length} ticket ancora aperti`,
      action: "Chiudi o risolvi i ticket collegati.",
    });
  }
  if (openInterventionIds.length > 0) {
    blockers.push({
      code: "interventi",
      label: `${openInterventionIds.length} interventi non completati`,
      action: "Completa gli interventi collegati.",
    });
  }

  const fingerprint = stableFingerprint({
    currentState: commessa.stato,
    importoTotale: Number(commessa.importoTotale ?? 0),
    importoIncassato: Number(commessa.importoIncassato ?? 0),
    documents: documents
      .map(document => [Number(document.id), String(document.tipo)])
      .sort(),
    timeline: timeline
      .map(step => [Number(step.id), String(step.stato)])
      .sort(),
    tickets: tickets.map(ticket => [Number(ticket.id), String(ticket.stato)]).sort(),
    interventions: interventions
      .map(intervention => [Number(intervention.id), String(intervention.stato)])
      .sort(),
  });

  return {
    ready: blockers.length === 0,
    commessaId,
    currentState: String(commessa.stato),
    saldoResiduo,
    missingDocumentGroups,
    incompleteTimelineSteps,
    openTicketIds,
    openInterventionIds,
    blockers,
    fingerprint,
  };
}
