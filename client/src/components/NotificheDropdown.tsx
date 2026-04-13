import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bell, AlertTriangle, Clock, Shield, Hammer, Truck, MessageSquareWarning } from "lucide-react";
import { useMemo } from "react";
import { useLocation } from "wouter";

type Notification = {
  id: string;
  icon: any;
  title: string;
  detail: string;
  type: "warning" | "info" | "danger";
  path: string;
};

export default function NotificheDropdown() {
  const [, setLocation] = useLocation();
  const refetchOpts = { refetchInterval: 30000 }; // 30s auto-sync
  const anomalieStats = trpc.anomalie.stats.useQuery(undefined, refetchOpts);
  const garanzieStats = trpc.garanzie.stats.useQuery(undefined, refetchOpts);
  const interventiOggi = trpc.interventi.list.useQuery({
    from: new Date().toISOString().split("T")[0],
    to: new Date().toISOString().split("T")[0],
  }, refetchOpts);
  const ticketStats = trpc.ticket.stats.useQuery(undefined, refetchOpts);
  const reclamiStats = trpc.reclamiRifacimenti.reclami.stats.useQuery(undefined, refetchOpts);
  const rifacimentiStats = trpc.reclamiRifacimenti.rifacimenti.stats.useQuery(undefined, refetchOpts);
  const fornitoriStats = trpc.fornitori.stats.useQuery(undefined, refetchOpts);

  const notifications = useMemo(() => {
    const items: Notification[] = [];

    const critiche = anomalieStats.data?.critiche ?? 0;
    if (critiche > 0) {
      items.push({
        id: "anomalie-critiche",
        icon: AlertTriangle,
        title: `${critiche} anomalie critiche`,
        detail: "Richiedono attenzione immediata",
        type: "danger",
        path: "/commesse",
      });
    }

    const garInScadenza = garanzieStats.data?.inScadenza ?? 0;
    if (garInScadenza > 0) {
      items.push({
        id: "garanzie-scadenza",
        icon: Shield,
        title: `${garInScadenza} garanzie in scadenza`,
        detail: "Scadono entro 90 giorni",
        type: "warning",
        path: "/garanzie",
      });
    }

    const garScadute = garanzieStats.data?.scadute ?? 0;
    if (garScadute > 0) {
      items.push({
        id: "garanzie-scadute",
        icon: Shield,
        title: `${garScadute} garanzie scadute`,
        detail: "Necessaria azione",
        type: "danger",
        path: "/garanzie",
      });
    }

    const oggi = interventiOggi.data?.length ?? 0;
    if (oggi > 0) {
      items.push({
        id: "interventi-oggi",
        icon: Hammer,
        title: `${oggi} interventi oggi`,
        detail: "Verificare pianificazione",
        type: "info",
        path: "/planning",
      });
    }

    const ticketAperti = (ticketStats.data?.aperti ?? 0) + (ticketStats.data?.assegnati ?? 0);
    if (ticketAperti > 0) {
      items.push({
        id: "ticket-aperti",
        icon: Clock,
        title: `${ticketAperti} ticket aperti`,
        detail: "In attesa di gestione",
        type: "warning",
        path: "/ticket",
      });
    }

    const reclamiAperti = (reclamiStats.data?.aperti ?? 0) + (reclamiStats.data?.inGestione ?? 0);
    if (reclamiAperti > 0) {
      items.push({
        id: "reclami-aperti",
        icon: MessageSquareWarning,
        title: `${reclamiAperti} reclami aperti`,
        detail: "Da gestire",
        type: "warning",
        path: "/reclami",
      });
    }

    const rifAperti = (rifacimentiStats.data?.aperti ?? 0) + (rifacimentiStats.data?.inGestione ?? 0);
    if (rifAperti > 0) {
      items.push({
        id: "rifacimenti-aperti",
        icon: AlertTriangle,
        title: `${rifAperti} rifacimenti aperti`,
        detail: `Costo stimato: €${rifacimentiStats.data?.costoTotaleStimato?.toLocaleString("it-IT") ?? 0}`,
        type: "danger",
        path: "/reclami",
      });
    }

    const ordiniAttivi = fornitoriStats.data?.ordiniAttivi ?? 0;
    if (ordiniAttivi > 0) {
      items.push({
        id: "ordini-attivi",
        icon: Truck,
        title: `${ordiniAttivi} ordini in corso`,
        detail: `Importo: €${(fornitoriStats.data?.importoPendente ?? 0).toLocaleString("it-IT")}`,
        type: "info",
        path: "/fornitori",
      });
    }

    return items;
  }, [anomalieStats.data, garanzieStats.data, interventiOggi.data, ticketStats.data, reclamiStats.data, rifacimentiStats.data, fornitoriStats.data]);

  const dangerCount = notifications.filter((n) => n.type === "danger").length;
  const totalCount = notifications.length;

  const typeColors = {
    danger: "text-destructive",
    warning: "text-amber-600",
    info: "text-blue-600",
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="relative h-9 w-9 flex items-center justify-center rounded-lg hover:bg-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Bell className="h-4 w-4 text-muted-foreground" />
          {totalCount > 0 && (
            <span
              className={`absolute -top-0.5 -right-0.5 h-4 min-w-4 px-0.5 flex items-center justify-center rounded-full text-[9px] font-bold text-white ${dangerCount > 0 ? "bg-destructive" : "bg-amber-500"}`}
            >
              {totalCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="p-3 border-b">
          <p className="text-sm font-semibold">Notifiche</p>
        </div>
        {notifications.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Nessuna notifica
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {notifications.map((n) => (
              <button
                key={n.id}
                className="w-full text-left p-3 hover:bg-muted/50 transition-colors border-b last:border-0 flex items-start gap-3"
                onClick={() => setLocation(n.path)}
              >
                <n.icon className={`h-4 w-4 mt-0.5 shrink-0 ${typeColors[n.type]}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="text-xs text-muted-foreground">{n.detail}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
