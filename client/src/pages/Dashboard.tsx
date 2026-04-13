import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Building2,
  AlertTriangle,
  TicketCheck,
  CalendarClock,
  TrendingUp,
  Shield,
  Users,
  Hammer,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useLocation } from "wouter";
import { useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  accent,
  onClick,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: any;
  accent?: boolean;
  onClick?: () => void;
}) {
  return (
    <Card
      className={`cursor-pointer transition-all hover:shadow-md ${accent ? "border-l-4 border-l-destructive" : ""}`}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tracking-tight">{value}</div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}

const PIE_COLORS = ["#4f46e5", "#0d9488", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

// ── Calendar types with colors (PRD Sez.11.2) ──
const CALENDARI = [
  { key: "rilievo", label: "Misure Esecutive", color: "#2563eb" },
  { key: "posa", label: "Posa", color: "#059669" },
  { key: "assistenza", label: "Interventi/Regolazioni", color: "#d97706" },
  { key: "sopralluogo", label: "Showroom/Sopralluogo", color: "#7c3aed" },
  { key: "altro", label: "Altro", color: "#6b7280" },
] as const;

const CALENDAR_COLOR_MAP: Record<string, string> = Object.fromEntries(
  CALENDARI.map((c) => [c.key, c.color])
);

function getWeekDates(baseDate: Date): Date[] {
  const d = new Date(baseDate);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  const monday = new Date(d);
  monday.setDate(diff);
  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    dates.push(date);
  }
  return dates;
}

function formatDateKey(d: Date) {
  return d.toISOString().split("T")[0];
}

const GIORNI = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
const MESI = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];

function CalendarioSettimana({
  interventi,
  onEventClick,
}: {
  interventi: any[];
  onEventClick: (i: any) => void;
}) {
  const [baseDate, setBaseDate] = useState(() => new Date());
  const [activeCalendari, setActiveCalendari] = useState<Set<string>>(
    () => new Set(CALENDARI.map((c) => c.key))
  );

  const weekDates = useMemo(() => getWeekDates(baseDate), [baseDate]);
  const today = formatDateKey(new Date());

  const eventiByDay = useMemo(() => {
    const map: Record<string, any[]> = {};
    weekDates.forEach((d) => (map[formatDateKey(d)] = []));
    interventi
      .filter((i) => activeCalendari.has(i.tipo))
      .forEach((i) => {
        if (i.dataPianificata && map[i.dataPianificata]) {
          map[i.dataPianificata].push(i);
        }
      });
    return map;
  }, [interventi, weekDates, activeCalendari]);

  function prevWeek() {
    setBaseDate((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() - 7);
      return n;
    });
  }
  function nextWeek() {
    setBaseDate((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() + 7);
      return n;
    });
  }
  function goToday() {
    setBaseDate(new Date());
  }

  function toggleCalendario(key: string) {
    setActiveCalendari((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const weekLabel = `${weekDates[0].getDate()} ${MESI[weekDates[0].getMonth()]} — ${weekDates[6].getDate()} ${MESI[weekDates[6].getMonth()]} ${weekDates[6].getFullYear()}`;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <CalendarClock className="h-4 w-4" />
            Calendario settimanale
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={prevWeek}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={goToday}>
              Oggi
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={nextWeek}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{weekLabel}</p>
        {/* Calendar filters */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {CALENDARI.map((cal) => (
            <button
              key={cal.key}
              onClick={() => toggleCalendario(cal.key)}
              className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border transition-all ${
                activeCalendari.has(cal.key)
                  ? "border-transparent text-white"
                  : "border-border text-muted-foreground bg-background"
              }`}
              style={
                activeCalendari.has(cal.key)
                  ? { backgroundColor: cal.color }
                  : undefined
              }
            >
              {cal.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1">
          {weekDates.map((d, idx) => {
            const key = formatDateKey(d);
            const isToday = key === today;
            const dayEvents = eventiByDay[key] ?? [];
            return (
              <div key={key} className="min-h-[100px]">
                <div
                  className={`text-center text-xs font-medium py-1 rounded-t ${
                    isToday
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <div>{GIORNI[idx]}</div>
                  <div className={`text-base font-bold ${isToday ? "" : "text-foreground"}`}>
                    {d.getDate()}
                  </div>
                </div>
                <div className="space-y-1 mt-1">
                  {dayEvents.map((ev: any) => (
                    <div
                      key={ev.id}
                      onClick={() => onEventClick(ev)}
                      className="text-[10px] leading-tight p-1 rounded cursor-pointer hover:opacity-80 transition-opacity text-white truncate"
                      style={{ backgroundColor: CALENDAR_COLOR_MAP[ev.tipo] ?? "#6b7280" }}
                      title={ev.note}
                    >
                      {ev.note}
                    </div>
                  ))}
                  {dayEvents.length === 0 && (
                    <div className="text-[10px] text-muted-foreground text-center py-2">—</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const commesseStats = trpc.commesse.stats.useQuery();
  const anomalieStats = trpc.anomalie.stats.useQuery();
  const ticketStats = trpc.ticket.stats.useQuery();
  const garanzieStats = trpc.garanzie.stats.useQuery();
  const interventiOggi = trpc.interventi.list.useQuery({
    from: new Date().toISOString().split("T")[0],
    to: new Date().toISOString().split("T")[0],
  });
  const interventiSettimana = trpc.interventi.list.useQuery({});
  const commesseRecenti = trpc.commesse.list.useQuery({});
  const squadre = trpc.squadre.list.useQuery();

  const cs = commesseStats.data;
  const as_ = anomalieStats.data;
  const ts = ticketStats.data;
  const gs = garanzieStats.data;

  // Compute chart data from interventi
  const interventiByTipo = (() => {
    const map: Record<string, number> = {};
    interventiSettimana.data?.forEach((i: any) => {
      map[i.tipo] = (map[i.tipo] ?? 0) + 1;
    });
    return Object.entries(map).map(([tipo, count]) => ({
      name: tipo.charAt(0).toUpperCase() + tipo.slice(1),
      valore: count,
    }));
  })();

  // Compute squadre workload
  const squadreWorkload = (() => {
    const map: Record<number, { nome: string; attivi: number; completati: number }> = {};
    squadre.data?.forEach((s: any) => {
      map[s.id] = { nome: s.nome, attivi: 0, completati: 0 };
    });
    interventiSettimana.data?.forEach((i: any) => {
      if (i.squadraId && map[i.squadraId]) {
        if (i.stato === "completato") map[i.squadraId].completati++;
        else map[i.squadraId].attivi++;
      }
    });
    return Object.values(map);
  })();

  // Commesse by stato for pie chart
  const commesseByStato = (() => {
    const map: Record<string, number> = {};
    commesseRecenti.data?.forEach((c: any) => {
      const label = c.stato.replace(/_/g, " ");
      map[label] = (map[label] ?? 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  })();

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Panoramica operativa
        </p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Commesse attive"
          value={cs?.inCorso ?? "—"}
          subtitle={`${cs?.total ?? 0} totali`}
          icon={Building2}
          onClick={() => setLocation("/commesse")}
        />
        <StatCard
          title="Anomalie aperte"
          value={(as_?.aperte ?? 0) + (as_?.inGestione ?? 0)}
          subtitle={as_?.critiche ? `${as_.critiche} critiche` : undefined}
          icon={AlertTriangle}
          accent={(as_?.critiche ?? 0) > 0}
        />
        <StatCard
          title="Ticket aperti"
          value={(ts?.aperti ?? 0) + (ts?.assegnati ?? 0)}
          subtitle={`${ts?.inLavorazione ?? 0} in lavorazione`}
          icon={TicketCheck}
          onClick={() => setLocation("/ticket")}
        />
        <StatCard
          title="Interventi oggi"
          value={interventiOggi.data?.length ?? "—"}
          icon={CalendarClock}
          onClick={() => setLocation("/planning")}
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Squadre attive"
          value={squadre.data?.length ?? "—"}
          icon={Users}
          onClick={() => setLocation("/squadre")}
        />
        <StatCard
          title="Garanzie attive"
          value={gs?.attive ?? "—"}
          subtitle={gs?.inScadenza ? `${gs.inScadenza} in scadenza` : undefined}
          icon={Shield}
          accent={(gs?.inScadenza ?? 0) > 0}
          onClick={() => setLocation("/garanzie")}
        />
        <StatCard
          title="Interventi totali"
          value={interventiSettimana.data?.length ?? "—"}
          subtitle={`${interventiSettimana.data?.filter((i: any) => i.stato === "completato").length ?? 0} completati`}
          icon={Hammer}
          onClick={() => setLocation("/planning")}
        />
        <StatCard
          title="Urgenze"
          value={cs?.urgenti ?? 0}
          subtitle="commesse urgenti"
          icon={AlertTriangle}
          accent={(cs?.urgenti ?? 0) > 0}
          onClick={() => setLocation("/commesse")}
        />
      </div>

      {/* Calendar - primary element (PRD Sez.11) */}
      <CalendarioSettimana
        interventi={interventiSettimana.data ?? []}
        onEventClick={(ev) => {
          if (ev.tipo === "posa" || ev.tipo === "assistenza") {
            setLocation(`/posa/${ev.id}`);
          } else {
            setLocation("/planning");
          }
        }}
      />

      {/* Charts Row */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Interventi by tipo */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Hammer className="h-4 w-4" />
              Interventi per tipo
            </CardTitle>
          </CardHeader>
          <CardContent>
            {interventiByTipo.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={interventiByTipo}>
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="valore" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Nessun dato disponibile
              </p>
            )}
          </CardContent>
        </Card>

        {/* Commesse by stato */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Commesse per stato
            </CardTitle>
          </CardHeader>
          <CardContent>
            {commesseByStato.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={commesseByStato}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, value }) => `${name} (${value})`}
                    labelLine={false}
                  >
                    {commesseByStato.map((_, idx) => (
                      <Cell
                        key={idx}
                        fill={PIE_COLORS[idx % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Nessun dato disponibile
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Squadre workload */}
      {squadreWorkload.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Users className="h-4 w-4" />
              Carico di lavoro per squadra
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={squadreWorkload} layout="vertical">
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                <YAxis type="category" dataKey="nome" tick={{ fontSize: 12 }} width={120} />
                <Tooltip />
                <Legend />
                <Bar dataKey="attivi" name="Attivi" fill="#4f46e5" stackId="a" radius={[0, 0, 0, 0]} />
                <Bar dataKey="completati" name="Completati" fill="#0d9488" stackId="a" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Two-column section */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Interventi del giorno */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <CalendarClock className="h-4 w-4" />
              Interventi di oggi
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!interventiOggi.data?.length ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Nessun intervento pianificato per oggi
              </p>
            ) : (
              <div className="space-y-3">
                {interventiOggi.data.map((i: any) => (
                  <div
                    key={i.id}
                    className="flex items-start justify-between border-b pb-3 last:border-0 last:pb-0 cursor-pointer hover:bg-muted/50 -mx-2 px-2 py-1 rounded"
                    onClick={() =>
                      i.tipo === "posa" || i.tipo === "assistenza"
                        ? setLocation(`/posa/${i.id}`)
                        : setLocation("/planning")
                    }
                  >
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{i.note}</p>
                      <p className="text-xs text-muted-foreground">
                        {i.indirizzo}
                      </p>
                    </div>
                    <Badge
                      variant={
                        i.stato === "in_corso" ? "default" : "secondary"
                      }
                      className="text-xs shrink-0"
                    >
                      {i.stato.replace(/_/g, " ")}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Commesse recenti */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Commesse recenti
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {commesseRecenti.data?.slice(0, 5).map((c: any) => (
                <div
                  key={c.id}
                  className="flex items-start justify-between border-b pb-3 last:border-0 last:pb-0 cursor-pointer hover:bg-muted/50 -mx-2 px-2 py-1 rounded"
                  onClick={() => setLocation(`/commesse/${c.id}`)}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">
                        {c.codice}
                      </span>
                      {c.priorita === "urgente" && (
                        <Badge
                          variant="destructive"
                          className="text-[10px] px-1.5 py-0"
                        >
                          URGENTE
                        </Badge>
                      )}
                      {c.priorita === "alta" && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 border-destructive text-destructive"
                        >
                          ALTA
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium">{c.cliente}</p>
                  </div>
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {c.stato.replace(/_/g, " ")}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick anomalies view */}
      {(as_?.critiche ?? 0) > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Anomalie critiche da gestire
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              Ci sono{" "}
              <strong>{as_?.critiche} anomalie con priorita critica</strong> non
              ancora risolte. Verifica lo stato nella sezione commesse.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
