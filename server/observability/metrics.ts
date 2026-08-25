import { kvSql } from "../_core/persistence";
import { eventConsumerRegistry } from "../events/registry";
import { getSseConnectionCount } from "../notifications/sse";
import { getTarsPlanRepository } from "../tars/planner/repository";
import { esecuzioni } from "../tars/stores";

const ALLOWED_LABELS = new Set([
  "sede",
  "consumer",
  "workflow",
  "versione",
  "stato",
  "classe_rischio",
]);

export function assertMetricLabels(labels: Record<string, string | number>) {
  for (const key of Object.keys(labels)) {
    if (!ALLOWED_LABELS.has(key)) throw new Error(`METRIC_LABEL_DENIED:${key}`);
  }
}

type ConsumerMetric = {
  consumer: string;
  pending: number;
  processing: number;
  completed: number;
  deadLetter: number;
};

async function eventMetrics(sedeId: number): Promise<ConsumerMetric[]> {
  const defaults = eventConsumerRegistry.list().map(consumer => ({
    consumer: consumer.name,
    pending: 0,
    processing: 0,
    completed: 0,
    deadLetter: 0,
  }));
  if (!kvSql) return defaults;
  try {
    const rows = await kvSql`
      SELECT p.consumer_name, p.status, COUNT(*)::int AS count
      FROM business_event_processing p
      JOIN business_events e ON e.id = p.event_id
      WHERE e.sede_id = ${sedeId}
      GROUP BY p.consumer_name, p.status`;
    const byConsumer = new Map(defaults.map(item => [item.consumer, item]));
    for (const row of rows) {
      const name = String(row.consumer_name);
      const metric = byConsumer.get(name) ?? {
        consumer: name,
        pending: 0,
        processing: 0,
        completed: 0,
        deadLetter: 0,
      };
      const key =
        row.status === "dead_letter" ? "deadLetter" : String(row.status);
      if (key in metric) (metric as any)[key] = Number(row.count);
      byConsumer.set(name, metric);
    }
    return Array.from(byConsumer.values()).sort((a, b) =>
      a.consumer.localeCompare(b.consumer)
    );
  } catch {
    return defaults;
  }
}

async function pendingNotifications(sedeId: number): Promise<number> {
  if (!kvSql) return 0;
  try {
    const rows = await kvSql`SELECT COUNT(*)::int AS count FROM notifications
      WHERE sede_id = ${sedeId} AND status IN ('unread', 'seen', 'read')
        AND (expires_at IS NULL OR expires_at > NOW())`;
    return Number(rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

export async function collectOperationalDiagnostics(sedeId: number) {
  const [consumers, notificationPending, plans] = await Promise.all([
    eventMetrics(sedeId),
    pendingNotifications(sedeId),
    getTarsPlanRepository().listBySite({ sedeId, limit: 10_000 }),
  ]);
  const planCounts = new Map<string, number>();
  for (const plan of plans) {
    planCounts.set(plan.status, (planCounts.get(plan.status) ?? 0) + 1);
  }
  const workflowGroups = new Map<
    string,
    {
      workflow: string;
      version: string;
      status: string;
      runs: number;
      cacheHits: number;
      tokensIn: number;
      tokensOut: number;
      tokensCacheRead: number;
    }
  >();
  for (const execution of esecuzioni.filter(item => item.sedeId === sedeId)) {
    const workflow = execution.trigger;
    const version = execution.workflowVersion ?? "legacy";
    const status = execution.esito;
    const key = `${workflow}:${version}:${status}`;
    const metric = workflowGroups.get(key) ?? {
      workflow,
      version,
      status,
      runs: 0,
      cacheHits: 0,
      tokensIn: 0,
      tokensOut: 0,
      tokensCacheRead: 0,
    };
    metric.runs += 1;
    metric.cacheHits += execution.toolCacheHits ?? 0;
    metric.tokensIn += execution.tokensIn ?? 0;
    metric.tokensOut += execution.tokensOut ?? 0;
    metric.tokensCacheRead += execution.tokensCacheRead ?? 0;
    workflowGroups.set(key, metric);
  }
  return {
    generatedAt: new Date(),
    events: {
      consumers,
      deadLetter: consumers.reduce((sum, item) => sum + item.deadLetter, 0),
    },
    notifications: {
      pending: notificationPending,
      sseConnections: getSseConnectionCount(sedeId),
    },
    plans: Array.from(planCounts.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => a.status.localeCompare(b.status)),
    workflows: Array.from(workflowGroups.values()).sort((a, b) =>
      `${a.workflow}:${a.version}:${a.status}`.localeCompare(
        `${b.workflow}:${b.version}:${b.status}`
      )
    ),
  };
}
