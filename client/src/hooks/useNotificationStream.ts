import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  parseNotificationEvent,
  reconnectDelayMs,
  selectLeaderTab,
  type NotificationStreamEvent,
} from "@/lib/notificationStream";

type StreamState = "disabled" | "connecting" | "open" | "fallback";
type ChannelMessage =
  | { type: "presence"; tabId: string; at: number }
  | { type: "notification"; event: NotificationStreamEvent; lastEventId: string };

export function useNotificationStream(): {
  state: StreamState;
  lastEventId: string | null;
} {
  const config = trpc.tars.config.get.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const utils = trpc.useUtils();
  const enabled = config.data?.platformFlags.realtimeNotifications === true;
  const [state, setState] = useState<StreamState>("disabled");
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const lastEventIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof EventSource === "undefined") {
      setState("disabled");
      return;
    }
    const tabId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const peers = new Map<string, number>([[tabId, Date.now()]]);
    const channel = typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel("ruffino-notifications");
    let source: EventSource | null = null;
    let errors = 0;
    let reconnectTimer: number | null = null;
    let pollTimer: number | null = null;
    let stopped = false;

    const refresh = (event?: NotificationStreamEvent) => {
      void utils.notifiche.feed.invalidate();
      void utils.notifiche.unreadCount.invalidate();
      void utils.notifiche.list.invalidate();
      void utils.notifiche.count.invalidate();
      for (const ref of event?.entityRefs ?? []) {
        if (ref.type === "commessa") void utils.commesse.invalidate();
        if (ref.type === "cliente") void utils.clienti.invalidate();
        if (ref.type === "ticket") void utils.ticket.invalidate();
      }
    };

    const receive = (event: NotificationStreamEvent, eventId: string) => {
      lastEventIdRef.current = eventId;
      setLastEventId(eventId);
      refresh(event);
    };

    const closeSource = () => {
      source?.close();
      source = null;
    };

    const startPolling = () => {
      if (pollTimer != null) return;
      setState("fallback");
      refresh();
      pollTimer = window.setInterval(() => refresh(), 30_000);
    };

    const openSource = () => {
      if (stopped || source) return;
      setState("connecting");
      const after = lastEventIdRef.current
        ? `?after=${encodeURIComponent(lastEventIdRef.current)}`
        : "";
      source = new EventSource(`/api/events/notifications${after}`, { withCredentials: true });
      source.onopen = () => {
        errors = 0;
        if (pollTimer != null) window.clearInterval(pollTimer);
        pollTimer = null;
        setState("open");
      };
      source.addEventListener("notification", raw => {
        const message = raw as MessageEvent<string>;
        const parsed = parseNotificationEvent(message.data);
        if (!parsed) return;
        const eventId = message.lastEventId || String(parsed.notificationId);
        receive(parsed, eventId);
        channel?.postMessage({ type: "notification", event: parsed, lastEventId: eventId } satisfies ChannelMessage);
      });
      source.onerror = () => {
        errors += 1;
        closeSource();
        if (errors >= 3) startPolling();
        reconnectTimer = window.setTimeout(openSource, reconnectDelayMs(errors));
      };
    };

    const elect = () => {
      const now = Date.now();
      peers.set(tabId, now);
      peers.forEach((seenAt, id) => {
        if (now - seenAt > 12_000) peers.delete(id);
      });
      const leader = channel ? selectLeaderTab(peers, now) : tabId;
      if (leader === tabId) openSource();
      else closeSource();
    };

    if (channel) {
      channel.onmessage = message => {
        const data = message.data as ChannelMessage;
        if (data?.type === "presence") {
          peers.set(data.tabId, data.at);
          elect();
        }
        if (data?.type === "notification") receive(data.event, data.lastEventId);
      };
    }
    const announce = () => {
      const at = Date.now();
      peers.set(tabId, at);
      channel?.postMessage({ type: "presence", tabId, at } satisfies ChannelMessage);
      elect();
    };
    announce();
    const presenceTimer = window.setInterval(announce, 5_000);

    return () => {
      stopped = true;
      closeSource();
      channel?.close();
      window.clearInterval(presenceTimer);
      if (pollTimer != null) window.clearInterval(pollTimer);
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
    };
  }, [enabled, utils]);

  return { state, lastEventId };
}
