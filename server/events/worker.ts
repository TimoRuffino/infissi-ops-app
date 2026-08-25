import { randomUUID } from "node:crypto";
import {
  getBusinessEventRepository,
  type BusinessEventRepository,
} from "./repository";
import {
  eventConsumerRegistry,
  type EventConsumerRegistry,
} from "./registry";

function errorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as any).code;
    if (typeof code === "string" && code.trim()) return code;
    const name = (error as any).name;
    if (typeof name === "string" && name.trim()) return name;
  }
  return "EVENT_CONSUMER_FAILED";
}

function retryAt(now: Date, attempts: number): Date {
  const delayMs = Math.min(15 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
  return new Date(now.getTime() + delayMs);
}

export async function runEventWorkerOnce(input: {
  repository: BusinessEventRepository;
  registry: EventConsumerRegistry;
  consumerName: string;
  workerId: string;
  now?: Date;
  limit?: number;
}): Promise<{ claimed: number; processed: number; failed: number }> {
  const consumer = input.registry.get(input.consumerName);
  if (!consumer) throw new Error(`EVENT_CONSUMER_NOT_FOUND:${input.consumerName}`);
  const now = input.now ?? new Date();
  const events = await input.repository.claim({
    consumerName: consumer.name,
    workerId: input.workerId,
    eventTypes: consumer.eventTypes === "*" ? undefined : [...consumer.eventTypes],
    limit: input.limit ?? 25,
    now,
  });
  let processed = 0;
  let failed = 0;

  await Promise.all(
    events.map(async event => {
      try {
        await consumer.handle(event);
        const completed = await input.repository.complete({
          eventId: event.id,
          consumerName: consumer.name,
          workerId: input.workerId,
          now: new Date(),
        });
        if (completed) processed += 1;
      } catch (error) {
        const state = await input.repository.getProcessing(event.id, consumer.name);
        await input.repository.fail({
          eventId: event.id,
          consumerName: consumer.name,
          workerId: input.workerId,
          errorCode: errorCode(error),
          retryAt: retryAt(now, state?.attempts ?? 1),
          now,
        });
        failed += 1;
      }
    })
  );

  return { claimed: events.length, processed, failed };
}

export function startEventWorkers(options: {
  repository?: BusinessEventRepository;
  registry?: EventConsumerRegistry;
  pollMs?: number;
  staleLeaseMs?: number;
} = {}): { stop(): Promise<void> } {
  const repository = options.repository ?? getBusinessEventRepository();
  const registry = options.registry ?? eventConsumerRegistry;
  const workerId = `events-${process.pid}-${randomUUID().slice(0, 8)}`;
  const pollMs = Math.max(250, options.pollMs ?? 1_000);
  const staleLeaseMs = Math.max(10_000, options.staleLeaseMs ?? 5 * 60_000);
  const active = new Set<Promise<unknown>>();
  let stopping = false;

  const tick = () => {
    if (stopping) return;
    const now = new Date();
    const recovery = repository.recoverStale({
      cutoff: new Date(now.getTime() - staleLeaseMs),
      now,
    });
    active.add(recovery);
    void recovery.finally(() => active.delete(recovery));
    for (const consumer of registry.list()) {
      const run = runEventWorkerOnce({
        repository,
        registry,
        consumerName: consumer.name,
        workerId,
        now,
      }).catch(error => {
        console.error(`[events] consumer ${consumer.name} worker failed:`, error);
      });
      active.add(run);
      void run.finally(() => active.delete(run));
    }
  };

  const timer = setInterval(tick, pollMs);
  timer.unref();
  tick();

  return {
    async stop() {
      stopping = true;
      clearInterval(timer);
      await Promise.allSettled(Array.from(active));
    },
  };
}
