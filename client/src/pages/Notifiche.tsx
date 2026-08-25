import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Bell, BellRing, CheckCheck, Inbox, RefreshCw, Settings2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NotificationGroup } from "@/components/notifications/NotificationGroup";
import type { NotificationItemData } from "@/components/notifications/NotificationItem";

type View = "mine" | "critical" | "resolved";

export default function Notifiche() {
  const [, setLocation] = useLocation();
  const [view, setView] = useState<View>("mine");
  const utils = trpc.useUtils();
  const query = trpc.notifiche.feed.useQuery({
    limit: 50,
    statuses: view === "resolved" ? ["resolved"] : undefined,
    priorities: view === "critical" ? ["critical"] : undefined,
  });
  const unread = trpc.notifiche.unreadCount.useQuery();
  const refresh = () => utils.notifiche.invalidate();
  const markRead = trpc.notifiche.markRead.useMutation({ onSuccess: refresh });
  const resolve = trpc.notifiche.resolve.useMutation({ onSuccess: refresh });
  const items = (query.data?.items ?? []) as NotificationItemData[];
  const groups = useMemo(() => {
    const grouped = new Map<string, NotificationItemData[]>();
    for (const item of items) {
      const key = item.groupKey ?? "altre";
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return Array.from(grouped.entries());
  }, [items]);
  const readId = (item: NotificationItemData) => item.legacy ? item.id : Number(item.id);

  return (
    <div className="mx-auto w-full max-w-6xl min-w-0 space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
            <BellRing className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-normal">Notifiche</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Responsabilita personali, aggiornamenti e scadenze da non perdere
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Aggiorna notifiche" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Button variant="outline" onClick={() => setLocation("/notifiche?view=impostazioni")}>
            <Settings2 className="h-4 w-4" /> Preferenze
          </Button>
        </div>
      </header>

      <div className="flex flex-col gap-3 border-y bg-card/70 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:rounded-lg sm:border">
        <Tabs value={view} onValueChange={value => setView(value as View)}>
          <TabsList className="grid w-full grid-cols-3 sm:w-auto">
            <TabsTrigger value="mine"><Bell className="h-4 w-4" /> Per me</TabsTrigger>
            <TabsTrigger value="critical">Critiche</TabsTrigger>
            <TabsTrigger value="resolved"><CheckCheck className="h-4 w-4" /> Risolte</TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="px-1 text-xs text-muted-foreground">
          {unread.data?.count ?? 0} da leggere
        </p>
      </div>

      <div className="overflow-hidden border-y bg-card sm:rounded-lg sm:border">
        {query.isLoading ? (
          <div className="space-y-2 p-4" role="status">
            {[0, 1, 2, 3].map(item => <div key={item} className="h-20 animate-pulse rounded-lg bg-muted" />)}
            <span className="sr-only">Caricamento notifiche</span>
          </div>
        ) : query.isError ? (
          <div className="px-5 py-14 text-center">
            <p className="text-sm font-semibold">Non riesco ad aggiornare le notifiche</p>
            <Button variant="outline" className="mt-3" onClick={() => query.refetch()}>Riprova</Button>
          </div>
        ) : groups.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <Inbox className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold">Nessuna notifica in questa vista</p>
            <p className="mt-1 text-sm text-muted-foreground">Quando servira la tua attenzione, la troverai qui.</p>
          </div>
        ) : (
          groups.map(([key, group]) => (
            <NotificationGroup
              key={key}
              label={key === "altre" ? "Altre notifiche" : group[0]?.title ?? key}
              items={group}
              onOpen={item => {
                if (item.status === "unread" || item.status === "seen") markRead.mutate({ ids: [readId(item)] });
                setLocation(item.link);
              }}
              onRead={item => markRead.mutate({ ids: [readId(item)] })}
              onResolve={item => resolve.mutate({ ids: [Number(item.id)] })}
            />
          ))
        )}
      </div>
    </div>
  );
}
