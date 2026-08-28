export type ActionPriority = "normale" | "alta" | "critica";

export type ActionStatus =
  | "da_valutare"
  | "in_carico"
  | "rinviata"
  | "in_attesa"
  | "risolta";

export type ActionTargetType =
  | "commessa"
  | "ticket"
  | "garanzia"
  | "intervento"
  | "comunicazione"
  | "proposta_tars";

export type ActionSignalKind =
  | "priority_aging"
  | "stato_daily"
  | "stato_role"
  | "consegna"
  | "saldo"
  | "garanzia"
  | "ticket"
  | "intervento"
  | "process_experiment";

export type ActionSignal = {
  sourceKey: string;
  kind: ActionSignalKind;
  sedeId: number;
  targetType: ActionTargetType;
  targetId: number;
  commessaId: number | null;
  clienteId: number | null;
  title: string;
  summary: string;
  actionLabel: string;
  priority: ActionPriority;
  priorityScore: number;
  assigneeUserId: number | null;
  targetRole: string | null;
  dueAt: Date | null;
  occurredAt: Date;
  link: string;
  fingerprint: string;
};

export type ActionCaseDraft = {
  canonicalKey: string;
  sedeId: number;
  targetType: ActionTargetType;
  targetId: number;
  commessaId: number | null;
  clienteId: number | null;
  title: string;
  priority: ActionPriority;
  priorityScore: number;
  assigneeUserId: number | null;
  dueAt: Date | null;
  link: string;
  signals: ActionSignal[];
  signalFingerprint: string;
  nextAction: {
    sourceKind: ActionSignalKind;
    label: string;
  };
};

export type TarsAnalysisStatus =
  | "non_richiesta"
  | "in_coda"
  | "in_corso"
  | "completata"
  | "errore";

export type ActionCaseRecord = ActionCaseDraft & {
  id: number;
  status: ActionStatus;
  reviewAt: Date | null;
  snoozedUntil: Date | null;
  tarsAnalysis: Record<string, unknown> | null;
  tarsAnalysisFingerprint: string | null;
  tarsAnalysisStatus: TarsAnalysisStatus;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
};

export type ActionCaseEvent = {
  id: number;
  actionCaseId: number;
  sedeId: number;
  actorUserId: number | null;
  eventType: string;
  fromStatus: ActionStatus | null;
  toStatus: ActionStatus | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type ActionCommessaSnapshot = {
  id: number;
  sedeId: number;
  codice: string;
  clienteId: number | null;
  cliente: string;
  stato: string;
  priorita: string;
  assegnatoA: number | null;
  createdBy: number | null;
  updatedAt: Date;
  archivedAt: Date | string | null;
  dataConsegnaConfermata: string | null;
  importoTotale: number | null;
  importoIncassato: number;
  // Versione non economica del registro pagamenti (conteggio+timestamp):
  // alimenta il fingerprint del caso saldo senza esporre importi.
  registroVersione?: string | null;
};

export type ActionTicketSnapshot = {
  id: number;
  sedeId: number;
  commessaId: number | null;
  clienteId: number | null;
  contatto: string | null;
  oggetto: string;
  stato: string;
  priorita: string;
  assegnatoA: number | null;
  apertoBy: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ActionGaranziaSnapshot = {
  id: number;
  sedeId: number;
  commessaId: number | null;
  descrizione: string;
  stato: string;
  dataScadenza: string;
  updatedAt: Date;
};

export type ActionInterventoSnapshot = {
  id: number;
  sedeId: number;
  commessaId: number | null;
  tipo: string;
  stato: string;
  squadraId: number | null;
  dataPianificata: string | null;
  oraInizio: string | null;
  indirizzo: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ActionSignalInput = {
  sedeId: number;
  now: Date;
  commesse: ActionCommessaSnapshot[];
  tickets: ActionTicketSnapshot[];
  garanzie: ActionGaranziaSnapshot[];
  interventi: ActionInterventoSnapshot[];
};
