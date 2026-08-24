import type { ActionCaseRepository } from "./repository";
import type { ActionCaseRecord, ActionStatus } from "./types";

type Scope = "mine" | "site";

function isDirection(roles: string[]): boolean {
  return roles.includes("direzione");
}

function roleTargets(record: ActionCaseRecord): string[] {
  return record.signals
    .map(signal => signal.targetRole)
    .filter((role): role is string => typeof role === "string");
}

function isMine(record: ActionCaseRecord, userId: number, roles: string[]): boolean {
  if (record.assigneeUserId === userId) return true;
  return (
    record.assigneeUserId == null &&
    roleTargets(record).some(role => roles.includes(role))
  );
}

export function canAccessActionCase(
  record: ActionCaseRecord,
  userId: number,
  roles: string[],
  scope: Scope = "mine"
): boolean {
  return scope === "site" ? isDirection(roles) : isMine(record, userId, roles);
}

function isVisibleNow(record: ActionCaseRecord, now: Date): boolean {
  if (record.status === "risolta") return false;
  if (
    record.status === "rinviata" &&
    record.snoozedUntil &&
    record.snoozedUntil.getTime() > now.getTime()
  ) {
    return false;
  }
  if (
    record.status === "in_attesa" &&
    record.reviewAt &&
    record.reviewAt.getTime() > now.getTime()
  ) {
    return false;
  }
  return true;
}

async function allCases(
  repository: ActionCaseRepository,
  sedeId: number
): Promise<ActionCaseRecord[]> {
  const items: ActionCaseRecord[] = [];
  let cursor: string | null = null;
  do {
    const page = await repository.list({ sedeId, cursor, limit: 100 });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

export async function listActionCases(input: {
  repository: ActionCaseRepository;
  sedeId: number;
  userId: number;
  roles: string[];
  scope: Scope;
  now: Date;
  statuses?: ActionStatus[];
  limit?: number;
  cursor?: string | null;
}) {
  if (input.scope === "site" && !isDirection(input.roles)) {
    throw new Error("FORBIDDEN");
  }
  const offset = input.cursor ? Math.max(0, Number(input.cursor) || 0) : 0;
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const cases = (await allCases(input.repository, input.sedeId))
    .filter(record => input.scope === "site" || isMine(record, input.userId, input.roles))
    .filter(record => !input.statuses || input.statuses.includes(record.status))
    .sort((a, b) => {
      if (a.priorityScore !== b.priorityScore) {
        return b.priorityScore - a.priorityScore;
      }
      const dueA = a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const dueB = b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (dueA !== dueB) return dueA - dueB;
      return a.id - b.id;
    });
  const items = cases.slice(offset, offset + limit);
  return {
    items,
    nextCursor: cases.length > offset + limit ? String(offset + limit) : null,
  };
}

export async function getActionCenterSummary(input: {
  repository: ActionCaseRepository;
  sedeId: number;
  userId: number;
  roles: string[];
  now: Date;
}) {
  const records = (await allCases(input.repository, input.sedeId))
    .filter(record => isMine(record, input.userId, input.roles))
    .filter(record => isVisibleNow(record, input.now));
  const badge = records.filter(record => {
    if (record.priority !== "critica" && record.priority !== "alta") return false;
    return !record.dueAt || record.dueAt.getTime() <= input.now.getTime();
  });
  return {
    badgeCount: badge.length,
    badgeLabel: badge.length > 9 ? "9+" : String(badge.length),
    critical: badge.filter(record => record.priority === "critica").length,
    high: badge.filter(record => record.priority === "alta").length,
    totalPersonal: records.length,
  };
}

export type ActionTransition =
  | "take"
  | "assign"
  | "snooze"
  | "wait"
  | "resolve"
  | "dismiss";

export async function transitionActionCase(input: {
  repository: ActionCaseRepository;
  sedeId: number;
  caseId: number;
  expectedFingerprint: string;
  userId: number;
  roles: string[];
  action: ActionTransition;
  assigneeUserId?: number | null;
  until?: Date | null;
  reason?: string;
  counterpart?: string;
  now: Date;
}): Promise<ActionCaseRecord> {
  const record = await input.repository.findById(input.sedeId, input.caseId);
  if (!record) throw new Error("NOT_FOUND");
  const direction = isDirection(input.roles);
  const mine = isMine(record, input.userId, input.roles);
  if (!direction && !mine && input.action !== "take") throw new Error("FORBIDDEN");
  if (!direction && input.action === "assign") throw new Error("FORBIDDEN");

  let status: ActionStatus;
  let assignee = record.assigneeUserId;
  let reviewAt = record.reviewAt;
  let snoozedUntil = record.snoozedUntil;
  let eventType: string = input.action;
  const metadata: Record<string, unknown> = {};

  switch (input.action) {
    case "take":
      status = "in_carico";
      assignee = input.userId;
      eventType = "presa_in_carico";
      break;
    case "assign":
      if (input.assigneeUserId == null) throw new Error("ASSIGNEE_REQUIRED");
      status = "in_carico";
      assignee = input.assigneeUserId;
      eventType = "assegnata";
      break;
    case "snooze":
      if (!input.until || input.until.getTime() <= input.now.getTime()) {
        throw new Error("FUTURE_DATE_REQUIRED");
      }
      status = "rinviata";
      snoozedUntil = input.until;
      reviewAt = null;
      metadata.reason = input.reason?.trim() || null;
      eventType = "rinviata";
      break;
    case "wait":
      if (!input.until || !input.reason?.trim() || !input.counterpart?.trim()) {
        throw new Error("WAIT_DETAILS_REQUIRED");
      }
      status = "in_attesa";
      reviewAt = input.until;
      snoozedUntil = null;
      metadata.reason = input.reason.trim();
      metadata.counterpart = input.counterpart.trim();
      eventType = "in_attesa";
      break;
    case "dismiss":
      if (!input.reason?.trim()) throw new Error("REASON_REQUIRED");
      status = "risolta";
      metadata.reason = input.reason.trim();
      metadata.dismissed = true;
      eventType = "non_rilevante";
      break;
    case "resolve":
      status = "risolta";
      eventType = "risolta";
      break;
  }

  return input.repository.transition({
    sedeId: input.sedeId,
    id: input.caseId,
    expectedFingerprint: input.expectedFingerprint,
    status,
    assigneeUserId: assignee,
    reviewAt,
    snoozedUntil,
    actorUserId: input.userId,
    eventType,
    metadata,
    now: input.now,
  });
}
