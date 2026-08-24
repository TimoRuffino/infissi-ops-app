import { trpc } from "@/lib/trpc";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Bell,
  AlertTriangle,
  Clock,
  Info,
  CheckCheck,
  CalendarClock,
  Ticket,
  ShieldAlert,
  Truck,
} from "lucide-react";
import { useLocation } from "wouter";

const severityColors = {
  urgent: "text-danger",
  warning: "text-warning",
  info: "text-info",
} as const;

const typeIcon: Record<string, any> = {
  consegna: Truck,
  garanzia: ShieldAlert,
  ticket: Ticket,
  intervento: CalendarClock,
};
const severityIcon = {
  urgent: AlertTriangle,
  warning: Clock,
  info: Info,
} as const;

const priorityColor: Record<string, string> = {
  critica: "bg-danger",
  alta: "bg-warning",
  normale: "bg-info",
};

function ActionBell({ count, label }: { count: number; label: string }) {
  const [, setLocation] = useLocation();
  const cases = trpc.notifiche.cases.list.useQuery({
    scope: "mine",
    statuses: ["da_valutare", "in_carico"],
    limit: 3,
  }, { refetchInterval: 60_000 });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={count > 0 ? `${count} azioni richiedono attenzione` : "Nessuna azione urgente"}
          className="relative flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-9 lg:w-9"
        >
          <Bell className="h-4 w-4 text-muted-foreground" />
          {count > 0 && (
            <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-0.5 text-[9px] font-bold text-white">
              {label}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(24rem,calc(100vw-1rem))] p-0">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">Da fare adesso</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {count > 0 ? `${count} eccezioni personali` : "Nessuna eccezione personale"}
          </p>
        </div>
        {(cases.data?.items.length ?? 0) === 0 ? (
          <div className="px-4 py-7 text-center text-sm text-muted-foreground">
            La tua coda urgente è sotto controllo.
          </div>
        ) : (
          <div>
            {cases.data!.items.map((item: any) => (
              <button
                key={item.id}
                className="flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-muted/55"
                onClick={() => setLocation("/tars?tab=oggi")}
              >
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${priorityColor[item.priority] ?? "bg-info"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{item.title}</span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{item.nextAction.label}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="p-2">
          <Button variant="ghost" className="w-full justify-between" onClick={() => setLocation("/tars?tab=oggi")}>
            Apri Centro Azioni <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LegacyBell() {
  const [, setLocation] = useLocation();
  const notifiche = trpc.notifiche.list.useQuery(undefined, { refetchInterval: 60_000 });
  const utils = trpc.useUtils();
  const markRead = trpc.notifiche.markRead.useMutation({ onSuccess: () => utils.notifiche.invalidate() });
  const markAllRead = trpc.notifiche.markAllRead.useMutation({ onSuccess: () => utils.notifiche.invalidate() });
  const items = notifiche.data ?? [];
  const unread = items.filter((item: any) => !item.read);
  const unreadUrgent = unread.filter((item: any) => item.severity === "urgent").length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={unread.length > 0 ? `Notifiche: ${unread.length} da leggere` : "Notifiche"}
          className="relative flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-9 lg:w-9"
        >
          <Bell className="h-4 w-4 text-muted-foreground" />
          {unread.length > 0 && (
            <span aria-hidden="true" className={`absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[9px] font-bold text-white ${unreadUrgent > 0 ? "bg-danger" : "bg-warning"}`}>
              {unread.length}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(24rem,calc(100vw-1rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <div>
            <p className="text-sm font-semibold">Notifiche</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{unread.length > 0 ? `${unread.length} da leggere` : "Tutto letto"}</p>
          </div>
          {unread.length > 0 && (
            <Button variant="ghost" size="sm" disabled={markAllRead.isPending} onClick={() => markAllRead.mutate()}>
              <CheckCheck className="h-3.5 w-3.5" /> Segna tutte lette
            </Button>
          )}
        </div>
        {items.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Nessuna notifica.</div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {items.map((item: any) => {
              const Icon = typeIcon[item.type] ?? severityIcon[item.severity as keyof typeof severityIcon] ?? Info;
              return (
                <button
                  key={item.id}
                  className={`flex w-full items-start gap-3 border-b p-3 text-left transition-colors last:border-0 ${item.read ? "opacity-55 hover:opacity-80" : "hover:bg-muted/50"}`}
                  onClick={() => {
                    if (!item.read) markRead.mutate({ ids: [item.id] });
                    setLocation(item.link ?? (item.commessaId ? `/commesse/${item.commessaId}` : "/"));
                  }}
                >
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${severityColors[item.severity as keyof typeof severityColors] ?? ""}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{item.cliente}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{item.message}</span>
                  </span>
                  {!item.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                </button>
              );
            })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function NotificheDropdown() {
  const summary = trpc.notifiche.summary.useQuery(undefined, { refetchInterval: 60_000 });
  if (summary.data?.mode === "active") {
    return <ActionBell count={summary.data.badgeCount} label={summary.data.badgeLabel} />;
  }
  return <LegacyBell />;
}
