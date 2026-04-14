import { trpc } from "@/lib/trpc";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bell, AlertTriangle, Clock, Info } from "lucide-react";
import { useLocation } from "wouter";

const severityColors = {
  urgent: "text-destructive",
  warning: "text-amber-600",
  info: "text-blue-600",
} as const;

const severityIcon = {
  urgent: AlertTriangle,
  warning: Clock,
  info: Info,
} as const;

export default function NotificheDropdown() {
  const [, setLocation] = useLocation();
  const refetchOpts = { refetchInterval: 60000 }; // 1min auto-sync
  const notifiche = trpc.notifiche.list.useQuery(undefined, refetchOpts);

  const items = notifiche.data ?? [];
  const urgentCount = items.filter((n: any) => n.severity === "urgent").length;
  const totalCount = items.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="relative h-9 w-9 flex items-center justify-center rounded-lg hover:bg-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Bell className="h-4 w-4 text-muted-foreground" />
          {totalCount > 0 && (
            <span
              className={`absolute -top-0.5 -right-0.5 h-4 min-w-4 px-0.5 flex items-center justify-center rounded-full text-[9px] font-bold text-white ${urgentCount > 0 ? "bg-destructive" : "bg-amber-500"}`}
            >
              {totalCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 p-0">
        <div className="p-3 border-b">
          <p className="text-sm font-semibold">Notifiche</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Avvisi personalizzati in base al ruolo e alle commesse
          </p>
        </div>
        {items.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Nessuna notifica
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {items.map((n: any) => {
              const Icon = severityIcon[n.severity as keyof typeof severityIcon] ?? Info;
              return (
                <button
                  key={n.id}
                  className="w-full text-left p-3 hover:bg-muted/50 transition-colors border-b last:border-0 flex items-start gap-3"
                  onClick={() => setLocation(`/commesse/${n.commessaId}`)}
                >
                  <Icon
                    className={`h-4 w-4 mt-0.5 shrink-0 ${severityColors[n.severity as keyof typeof severityColors] ?? ""}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {n.commessaCodice}
                      </span>
                      <span className="text-[10px] font-semibold uppercase px-1.5 py-0 rounded-sm bg-muted">
                        {n.statoLabel}
                      </span>
                    </div>
                    <p className="text-sm font-medium mt-0.5">{n.cliente}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
