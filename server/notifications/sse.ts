import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { createContext as defaultCreateContext } from "../_core/context";
import { kvSql } from "../_core/persistence";
import {
  getNotificationRepository,
  type NotificationRepository,
} from "./repository";

export type NotificationSignal = {
  notificationId: number;
  recipientUserId: number;
  sedeId: number;
};

export type NotificationHub = {
  publish(signal: NotificationSignal): void;
  subscribe(
    scope: { recipientUserId: number; sedeId: number },
    listener: (signal: NotificationSignal) => void
  ): () => void;
};

export function createNotificationHub(): NotificationHub {
  const listeners = new Map<
    string,
    Set<(signal: NotificationSignal) => void>
  >();
  const key = (userId: number, sedeId: number) => `${sedeId}:${userId}`;
  return {
    publish(signal) {
      listeners
        .get(key(signal.recipientUserId, signal.sedeId))
        ?.forEach(listener => listener(signal));
    },
    subscribe(scope, listener) {
      const scopeKey = key(scope.recipientUserId, scope.sedeId);
      const scoped = listeners.get(scopeKey) ?? new Set();
      scoped.add(listener);
      listeners.set(scopeKey, scoped);
      return () => {
        scoped.delete(listener);
        if (!scoped.size) listeners.delete(scopeKey);
      };
    },
  };
}

export const notificationHub = createNotificationHub();
const activeConnectionsBySite = new Map<number, number>();

export function getSseConnectionCount(sedeId: number): number {
  return activeConnectionsBySite.get(sedeId) ?? 0;
}
const notificationInstanceId = `${process.pid}-${randomUUID()}`;
const PG_CHANNEL = "ruffino_notifications_changed";

export async function publishNotificationSignal(signal: NotificationSignal) {
  notificationHub.publish(signal);
  if (!kvSql) return;
  try {
    await kvSql.notify(
      PG_CHANNEL,
      JSON.stringify({ ...signal, origin: notificationInstanceId })
    );
  } catch (error) {
    const code =
      error &&
      typeof error === "object" &&
      typeof (error as any).code === "string"
        ? (error as any).code
        : "PG_NOTIFY_FAILED";
    console.warn(`[notifications] postgres notify failed: ${code}`);
  }
}

export async function startNotificationPgBridge() {
  if (!kvSql) return { stop: async () => {} };
  const listener = await kvSql.listen(PG_CHANNEL, value => {
    try {
      const parsed = JSON.parse(value);
      if (parsed.origin === notificationInstanceId) return;
      if (
        Number.isInteger(parsed.notificationId) &&
        Number.isInteger(parsed.recipientUserId) &&
        Number.isInteger(parsed.sedeId)
      ) {
        notificationHub.publish({
          notificationId: parsed.notificationId,
          recipientUserId: parsed.recipientUserId,
          sedeId: parsed.sedeId,
        });
      }
    } catch {
      console.warn("[notifications] postgres signal ignored: INVALID_PAYLOAD");
    }
  });
  return { stop: () => listener.unlisten() };
}

function eventFrame(notification: {
  id: number;
  entityRefs: Array<{ type: string; id: string }>;
}) {
  return `id: ${notification.id}\nevent: notification\ndata: ${JSON.stringify({
    notificationId: notification.id,
    entityRefs: notification.entityRefs,
  })}\n\n`;
}

export function createNotificationSseHandler(
  options: {
    repository?: NotificationRepository;
    hub?: NotificationHub;
    createContext?: (input: { req: Request; res: Response }) => Promise<any>;
    heartbeatMs?: number;
  } = {}
) {
  const repository = options.repository ?? getNotificationRepository();
  const hub = options.hub ?? notificationHub;
  const createContext =
    options.createContext ??
    ((input: { req: Request; res: Response }) =>
      defaultCreateContext({ ...input, info: {} as any }));
  const heartbeatMs = Math.max(5_000, options.heartbeatMs ?? 25_000);

  return async (req: Request, res: Response) => {
    const context = await createContext({ req, res });
    if (!context.user || context.sedeId == null) {
      res.status(401).end();
      return;
    }
    const recipientUserId = Number(context.user.id);
    const sedeId = Number(context.sedeId);
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    activeConnectionsBySite.set(sedeId, getSseConnectionCount(sedeId) + 1);

    const queryAfter =
      typeof req.query?.after === "string" ? req.query.after : undefined;
    let lastSent = Number(
      req.get("last-event-id") ??
        req.headers["last-event-id"] ??
        queryAfter ??
        0
    );
    if (!Number.isInteger(lastSent) || lastSent < 0) lastSent = 0;
    const replay = await repository.listAfterId({
      sedeId,
      recipientUserId,
      afterId: lastSent,
      limit: 100,
      now: new Date(),
    });
    for (const item of replay) {
      res.write(eventFrame(item));
      lastSent = Math.max(lastSent, item.id);
    }

    const unsubscribe = hub.subscribe({ recipientUserId, sedeId }, signal => {
      if (signal.notificationId <= lastSent) return;
      void repository
        .findById(signal.notificationId, recipientUserId, sedeId)
        .then(item => {
          if (!item || item.id <= lastSent) return;
          res.write(eventFrame(item));
          lastSent = item.id;
        });
    });
    const heartbeat = setInterval(
      () => res.write(": heartbeat\n\n"),
      heartbeatMs
    );
    heartbeat.unref();
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      unsubscribe();
      const remaining = Math.max(0, getSseConnectionCount(sedeId) - 1);
      if (remaining) activeConnectionsBySite.set(sedeId, remaining);
      else activeConnectionsBySite.delete(sedeId);
    };
    res.once("close", cleanup);
    res.once("finish", cleanup);
  };
}
