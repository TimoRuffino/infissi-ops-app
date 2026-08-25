import { useState } from "react";
import { useLocation } from "wouter";
import { Bell, BellRing, CheckCheck, Inbox, Settings2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { NotificationItem, type NotificationItemData } from "./notifications/NotificationItem";

export default function NotificheDropdown() {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();
  const feed = trpc.notifiche.feed.useQuery({ limit: 6 }, { refetchInterval: 60_000 });
  const unread = trpc.notifiche.unreadCount.useQuery(undefined, { refetchInterval: 60_000 });
  const refresh = () => utils.notifiche.invalidate();
  const markSeen = trpc.notifiche.markSeen.useMutation({ onSuccess: refresh });
  const markRead = trpc.notifiche.markRead.useMutation({ onSuccess: refresh });
  const resolve = trpc.notifiche.resolve.useMutation({ onSuccess: refresh });
  const items = (feed.data?.items ?? []) as NotificationItemData[];
  const count = unread.data?.count ?? 0;

  const readId = (item: NotificationItemData) => item.legacy ? item.id : Number(item.id);
  const onOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) return;
    const ids = items
      .filter(item => !item.legacy && item.status === "unread")
      .map(item => Number(item.id))
      .filter(Number.isInteger);
    if (ids.length) markSeen.mutate({ ids });
  };

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={count ? `${count} notifiche da leggere` : "Notifiche"}
          className="relative flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-9 lg:w-9"
        >
          {count ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4 text-muted-foreground" />}
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground" aria-hidden="true">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(27rem,calc(100vw-1rem))] overflow-hidden p-0">
        <div className="flex items-center justify-between gap-3 border-b bg-muted/35 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Per te</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {count ? `${count} ancora da leggere` : "Sei in pari"}
            </p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Apri impostazioni notifiche" onClick={() => setLocation("/notifiche?view=impostazioni")}>
            <Settings2 className="h-4 w-4" />
          </Button>
        </div>

        {feed.isLoading ? (
          <div className="space-y-2 p-4" role="status" aria-label="Caricamento notifiche">
            {[0, 1, 2].map(item => <div key={item} className="h-16 animate-pulse rounded-lg bg-muted" />)}
          </div>
        ) : feed.isError ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm font-medium">Aggiornamento non disponibile</p>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => feed.refetch()}>Riprova</Button>
          </div>
        ) : items.length === 0 ? (
          <div className="px-5 py-9 text-center">
            <Inbox className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">Niente da recuperare</p>
            <p className="mt-1 text-xs text-muted-foreground">Le nuove responsabilita appariranno qui.</p>
          </div>
        ) : (
          <div className="max-h-[28rem] overflow-y-auto">
            {items.map(item => (
              <NotificationItem
                key={item.canonicalKey}
                item={item}
                compact
                onOpen={() => {
                  if (item.status === "unread" || item.status === "seen") {
                    markRead.mutate({ ids: [readId(item)] });
                  }
                  setOpen(false);
                  setLocation(item.link);
                }}
                onRead={() => markRead.mutate({ ids: [readId(item)] })}
                onResolve={item.legacy ? undefined : () => resolve.mutate({ ids: [Number(item.id)] })}
              />
            ))}
          </div>
        )}

        <div className="border-t bg-muted/25 p-2">
          <Button variant="ghost" className="w-full justify-between" onClick={() => { setOpen(false); setLocation("/notifiche"); }}>
            Apri centro notifiche <CheckCheck className="h-4 w-4" />
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
