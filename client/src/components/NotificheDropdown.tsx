import { trpc } from "@/lib/trpc";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
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

// Type-specific icon beats a generic severity icon: the operator learns to
// scan for "truck = consegna, ticket = assistenza" at a glance.
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

export default function NotificheDropdown() {
  const [, setLocation] = useLocation();
  const refetchOpts = { refetchInterval: 60000 }; // 1min auto-sync
  const notifiche = trpc.notifiche.list.useQuery(undefined, refetchOpts);
  const utils = trpc.useUtils();

  const markRead = trpc.notifiche.markRead.useMutation({
    onSuccess: () => utils.notifiche.invalidate(),
  });
  const markAllRead = trpc.notifiche.markAllRead.useMutation({
    onSuccess: () => utils.notifiche.invalidate(),
  });

  const items = notifiche.data ?? [];
  const unread = items.filter((n: any) => !n.read);
  const unreadUrgent = unread.filter((n: any) => n.severity === "urgent").length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="relative h-9 w-9 flex items-center justify-center rounded-lg hover:bg-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Bell className="h-4 w-4 text-muted-foreground" />
          {unread.length > 0 && (
            <span
              className={`absolute -top-0.5 -right-0.5 h-4 min-w-4 px-0.5 flex items-center justify-center rounded-full text-[9px] font-bold text-white ${unreadUrgent > 0 ? "bg-danger" : "bg-warning"}`}
            >
              {unread.length}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 p-0">
        <div className="p-3 border-b flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Notifiche</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {unread.length > 0
                ? `${unread.length} da leggere — personalizzate per te`
                : "Tutto letto — personalizzate per te"}
            </p>
          </div>
          {unread.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs shrink-0"
              disabled={markAllRead.isPending}
              onClick={(e) => {
                e.preventDefault();
                markAllRead.mutate();
              }}
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1" />
              Segna tutte lette
            </Button>
          )}
        </div>
        {items.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Nessuna notifica — quando una commessa, un ticket o una garanzia
            richiederà la tua attenzione la troverai qui.
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {items.map((n: any) => {
              const Icon =
                typeIcon[n.type] ??
                severityIcon[n.severity as keyof typeof severityIcon] ??
                Info;
              return (
                <button
                  key={n.id}
                  className={`w-full text-left p-3 transition-colors border-b last:border-0 flex items-start gap-3 ${
                    n.read ? "opacity-55 hover:opacity-80" : "hover:bg-muted/50"
                  }`}
                  onClick={() => {
                    if (!n.read) markRead.mutate({ ids: [n.id] });
                    setLocation(n.link ?? (n.commessaId ? `/commesse/${n.commessaId}` : "/"));
                  }}
                >
                  <Icon
                    className={`h-4 w-4 mt-0.5 shrink-0 ${severityColors[n.severity as keyof typeof severityColors] ?? ""}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {n.commessaCodice && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {n.commessaCodice}
                        </span>
                      )}
                      <span className="text-[10px] font-semibold uppercase px-1.5 py-0 rounded-sm bg-muted">
                        {n.statoLabel}
                      </span>
                    </div>
                    <p className="text-sm font-medium mt-0.5">{n.cliente}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                  </div>
                  {!n.read && (
                    <span className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1.5" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
