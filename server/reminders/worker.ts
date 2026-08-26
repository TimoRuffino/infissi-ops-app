import {
  getNotificationRepository,
  type NotificationRepository,
} from "../notifications/repository";
import {
  publishNotificationSignal,
  type NotificationSignal,
} from "../notifications/sse";
import { getUtentiStore } from "../routers/utenti";
import {
  getReminderRepository,
  type ReminderRepository,
} from "./repository";

const REMINDER_WORKER_INTERVAL_MS = 15_000;

export async function runReminderWorkerOnce(input: {
  reminders: ReminderRepository;
  notifications: NotificationRepository;
  publish: (signal: NotificationSignal) => Promise<unknown> | unknown;
  isRecipientActive: (sedeId: number, userId: number) => Promise<boolean>;
  now: Date;
  limit?: number;
}) {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 100);
  await input.reminders.claimDue({ now: input.now, limit });
  const pending = await input.reminders.listPendingNotification(limit);
  let projected = 0;

  for (const reminder of pending) {
    try {
      if (
        !(await input.isRecipientActive(
          reminder.sedeId,
          reminder.recipientUserId,
        ))
      ) {
        continue;
      }

      const result = await input.notifications.upsert({
        sedeId: reminder.sedeId,
        recipientUserId: reminder.recipientUserId,
        canonicalKey: `reminder:${reminder.id}:${reminder.revision}`,
        type: "reminder",
        priority: "normal",
        title: "Promemoria",
        body: reminder.text,
        link: reminder.commessaId
          ? `/commesse/${reminder.commessaId}`
          : "/tars?tab=chat",
        groupKey: `reminder:${reminder.id}`,
        sourceEventId: null,
        entityRefs: reminder.commessaId
          ? [{ type: "commessa", id: String(reminder.commessaId) }]
          : [],
        createdAt: reminder.remindAt,
        expiresAt: null,
      });
      const marked = await input.reminders.markNotificationProjected({
        id: reminder.id,
        revision: reminder.revision,
        now: input.now,
      });
      if (!marked) continue;

      await input.publish({
        notificationId: result.id,
        recipientUserId: reminder.recipientUserId,
        sedeId: reminder.sedeId,
      });
      projected += 1;
    } catch (error) {
      console.warn("[reminders] notification projection failed", {
        code: error instanceof Error ? error.name : "UNKNOWN",
      });
    }
  }

  return { projected };
}

async function isRecipientActive(sedeId: number, userId: number) {
  const user = getUtentiStore().find((candidate: any) => candidate.id === userId);
  return Boolean(
    user?.attivo &&
      Array.isArray(user.sediIds) &&
      user.sediIds.includes(sedeId),
  );
}

export function startReminderWorker(options: {
  run?: () => Promise<unknown>;
  intervalMs?: number;
} = {}) {
  if (process.env.REMINDER_WORKER_ENABLED === "false") {
    console.info("[reminders] worker disabled by configuration");
    return { stop() {} };
  }

  const run =
    options.run ??
    (() =>
      runReminderWorkerOnce({
        reminders: getReminderRepository(),
        notifications: getNotificationRepository(),
        publish: publishNotificationSignal,
        isRecipientActive,
        now: new Date(),
      }));
  let running = false;
  const runSafely = async () => {
    if (running) return;
    running = true;
    try {
      await run();
    } catch (error) {
      console.warn("[reminders] worker iteration failed", {
        code: error instanceof Error ? error.name : "UNKNOWN",
      });
    } finally {
      running = false;
    }
  };

  void runSafely();
  const timer = setInterval(
    () => void runSafely(),
    options.intervalMs ?? REMINDER_WORKER_INTERVAL_MS,
  );
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
