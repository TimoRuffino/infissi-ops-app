import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Bell, BellRing, CheckCheck, RefreshCw, Settings2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import { NotificationGroup } from "@/components/notifications/NotificationGroup";
import type { NotificationItemData } from "@/components/notifications/NotificationItem";
import { PushPreference } from "@/components/notifications/PushPreference";

type View = "mine" | "critical" | "resolved";

export default function Notifiche() {
  const [location, setLocation] = useLocation();
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
  const readId = (item: NotificationItemData) =>
    item.legacy ? item.id : Number(item.id);
  const settingsView =
    location.includes("view=impostazioni") ||
    window.location.search.includes("view=impostazioni");

  return (
    <div className="mx-auto w-full max-w-6xl min-w-0 space-y-5">
      <PageHeader
        eyebrow="Centro azioni"
        title="Notifiche"
        description="Responsabilità personali, aggiornamenti e scadenze da non perdere."
        metadata={
          <span className="inline-flex items-center gap-1.5">
            <BellRing className="size-3.5" aria-hidden="true" />
            {unread.data?.count ?? 0} da leggere
          </span>
        }
        secondaryActions={
          <Button
            variant="toolbar"
            size="icon"
            aria-label="Aggiorna notifiche"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            <RefreshCw
              className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`}
            />
          </Button>
        }
        primaryAction={
          <Button
            variant="outline"
            onClick={() => setLocation("/notifiche?view=impostazioni")}
          >
            <Settings2 className="h-4 w-4" /> Preferenze
          </Button>
        }
      />

      {settingsView && <PushPreference />}

      <DataSurface
        density="compact"
        tone="sunken"
        toolbar={
          <p className="text-xs tabular-nums text-text-2">
            {unread.data?.count ?? 0} da leggere
          </p>
        }
      >
        <Tabs value={view} onValueChange={value => setView(value as View)}>
          <TabsList
            className={`grid w-full grid-cols-3 sm:w-auto ${settingsView ? "opacity-70" : ""}`}
          >
            <TabsTrigger value="mine">
              <Bell className="h-4 w-4" /> Per me
            </TabsTrigger>
            <TabsTrigger value="critical">Critiche</TabsTrigger>
            <TabsTrigger value="resolved">
              <CheckCheck className="h-4 w-4" /> Risolte
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </DataSurface>

      <DataSurface
        density="compact"
        tone="default"
        title="Coda notifiche"
        description="Apri una voce per raggiungere il contesto operativo collegato."
        state={
          query.isLoading
            ? {
                kind: "loading",
                title: "Caricamento notifiche",
                description: "Sto aggiornando la tua coda personale.",
                rows: 4,
              }
            : query.isError
              ? {
                  kind: "error",
                  title: "Non riesco ad aggiornare le notifiche",
                  description: "Controlla la connessione e riprova.",
                  action: (
                    <Button variant="outline" onClick={() => query.refetch()}>
                      Riprova
                    </Button>
                  ),
                }
              : groups.length === 0
                ? {
                    kind: "empty",
                    title: "Nessuna notifica in questa vista",
                    description:
                      "Quando servirà la tua attenzione, la troverai qui.",
                  }
                : undefined
        }
      >
        <div className="-mx-3 -mb-3 overflow-hidden border-t border-border-soft sm:-mx-4 sm:-mb-4">
          {groups.map(([key, group]) => (
            <NotificationGroup
              key={key}
              label={
                key === "altre" ? "Altre notifiche" : (group[0]?.title ?? key)
              }
              items={group}
              onOpen={item => {
                if (item.status === "unread" || item.status === "seen")
                  markRead.mutate({ ids: [readId(item)] });
                setLocation(item.link);
              }}
              onRead={item => markRead.mutate({ ids: [readId(item)] })}
              onResolve={item => resolve.mutate({ ids: [Number(item.id)] })}
            />
          ))}
        </div>
      </DataSurface>
    </div>
  );
}
