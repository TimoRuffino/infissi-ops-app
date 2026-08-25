export type NotificationStreamEvent = {
  notificationId: number;
  entityRefs: Array<{ type: string; id: string }>;
};

export function parseNotificationEvent(value: string): NotificationStreamEvent | null {
  try {
    const parsed = JSON.parse(value);
    if (!Number.isInteger(parsed?.notificationId) || parsed.notificationId <= 0) return null;
    if (!Array.isArray(parsed.entityRefs)) return null;
    const entityRefs = parsed.entityRefs.filter(
      (item: unknown): item is { type: string; id: string } =>
        !!item &&
        typeof item === "object" &&
        typeof (item as any).type === "string" &&
        typeof (item as any).id === "string"
    );
    if (entityRefs.length !== parsed.entityRefs.length) return null;
    return { notificationId: parsed.notificationId, entityRefs };
  } catch {
    return null;
  }
}

export function reconnectDelayMs(attempt: number) {
  return Math.min(30_000, 1_000 * 2 ** Math.max(0, Math.trunc(attempt)));
}

export function selectLeaderTab(
  peers: Map<string, number>,
  now: number,
  staleMs = 12_000
): string | null {
  const active = Array.from(peers.entries())
    .filter(([, lastSeen]) => now - lastSeen <= staleMs)
    .map(([id]) => id)
    .sort();
  return active[0] ?? null;
}
