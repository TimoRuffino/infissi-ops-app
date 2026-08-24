import type { ActionCaseRepository } from "./repository";
import type { ActionCaseDraft, ActionCaseRecord } from "./types";

export type ActionCenterMode = "legacy" | "shadow" | "active";

export function parseActionCenterMode(value: string | undefined): ActionCenterMode {
  return value === "legacy" || value === "active" || value === "shadow"
    ? value
    : "shadow";
}

export type ReconcileResult = {
  created: number;
  updated: number;
  unchanged: number;
  autoResolved: number;
  reopened: number;
  queuedForTars: number;
};

async function listAll(
  repository: ActionCaseRepository,
  sedeId: number
): Promise<ActionCaseRecord[]> {
  const out: ActionCaseRecord[] = [];
  let cursor: string | null = null;
  do {
    const page = await repository.list({ sedeId, limit: 100, cursor });
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

function shouldQueueTars(draft: ActionCaseDraft): boolean {
  return draft.priority === "critica" || draft.priority === "alta";
}

export async function reconcileActionCases(input: {
  repository: ActionCaseRepository;
  sedeId: number;
  drafts: ActionCaseDraft[];
  now: Date;
}): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    autoResolved: 0,
    reopened: 0,
    queuedForTars: 0,
  };
  const current = await listAll(input.repository, input.sedeId);
  const beforeByKey = new Map(current.map(record => [record.canonicalKey, record]));
  const activeKeys = new Set<string>();

  for (const draft of input.drafts) {
    if (draft.sedeId !== input.sedeId) continue;
    activeKeys.add(draft.canonicalKey);
    const before = beforeByKey.get(draft.canonicalKey) ?? null;
    const upsert = await input.repository.upsertDraft(draft, input.now);
    if (upsert.created) result.created += 1;
    else if (upsert.changed) result.updated += 1;
    else result.unchanged += 1;

    let record = upsert.record;
    const evidenceChanged = before != null &&
      before.signalFingerprint !== draft.signalFingerprint;
    const snoozeExpired =
      record.status === "rinviata" &&
      record.snoozedUntil != null &&
      record.snoozedUntil.getTime() <= input.now.getTime();
    const shouldReopen =
      (record.status === "risolta" && evidenceChanged) ||
      (record.status === "rinviata" && evidenceChanged) ||
      snoozeExpired;

    if (shouldReopen) {
      record = await input.repository.transition({
        sedeId: input.sedeId,
        id: record.id,
        expectedFingerprint: record.signalFingerprint,
        status: "da_valutare",
        assigneeUserId: record.assigneeUserId,
        reviewAt: null,
        snoozedUntil: null,
        actorUserId: null,
        eventType: evidenceChanged ? "riaperta_nuove_evidenze" : "rinvio_scaduto",
        now: input.now,
      });
      result.reopened += 1;
    }

    if ((upsert.created || upsert.changed) && shouldQueueTars(draft)) {
      await input.repository.markAnalysis({
        sedeId: input.sedeId,
        id: record.id,
        status: "in_coda",
        fingerprint: record.signalFingerprint,
        now: input.now,
      });
      result.queuedForTars += 1;
    }
  }

  for (const record of current) {
    if (record.status === "risolta" || activeKeys.has(record.canonicalKey)) continue;
    await input.repository.transition({
      sedeId: input.sedeId,
      id: record.id,
      expectedFingerprint: record.signalFingerprint,
      status: "risolta",
      assigneeUserId: record.assigneeUserId,
      reviewAt: null,
      snoozedUntil: null,
      actorUserId: null,
      eventType: "auto_risolta",
      now: input.now,
    });
    result.autoResolved += 1;
  }

  return result;
}
