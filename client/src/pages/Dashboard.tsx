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
  Flame,
} from "lucide-react";
import { useLocation } from "wouter";
import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/_core/hooks/useAuth";
import { isDirezione } from "@/lib/roles";
import StatoChip from "@/components/StatoChip";
import {
  CheckCircle2,
  ArrowRight,
  ClipboardList,
  Ticket as TicketIcon,
  ShieldAlert,
} from "lucide-react";
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

// KPI tile — redesign §4.1.
// - Zero value → "spento": number in text-3, no accent, not clickable.
// - >0 + actionable → left accent bar (3px, semantic colour) + clickable card
//   that navigates to the already-filtered list.
function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  accentClass = "bg-primary",
  onClick,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: any;
  accentClass?: string; // tailwind bg-* for the left accent bar
  onClick?: () => void;
}) {
  const numeric = typeof value === "number" ? value : parseInt(String(value), 10);
  const isZero = numeric === 0;
  const dead = isZero || !onClick;

  return (
    <motion.div
      whileHover={dead ? undefined : { y: -3 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
    >
      <Card
        className={`relative overflow-hidden gap-0 py-5 transition-all ${
          dead ? "" : "cursor-pointer hover:shadow-md"
        }`}
        onClick={dead ? undefined : onClick}
      >
        {!dead && (
          <span
            className={`absolute left-0 top-0 bottom-0 w-[3px] ${accentClass}`}
          />
        )}
        <CardHeader className="flex flex-row items-start justify-between pb-2">
          <span className="eyebrow">{title}</span>
          <Icon
            className={`h-[18px] w-[18px] shrink-0 ${
              dead ? "text-text-3/60" : "text-text-3"
            }`}
          />
        </CardHeader>
        <CardContent>
          <div
            className={`text-[30px] leading-[34px] font-bold tabular-nums ${
              isZero ? "text-text-3" : "text-text-1"
            }`}
          >
            {value}
          </div>
          {subtitle && (
            <p className="text-[13px] text-text-2 mt-1">{subtitle}</p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// Donut palette — §2.1 state colours.
const PIE_COLORS = ["#3A5BDC", "#7A5AF0", "#C026D3", "#D97706", "#0E9384", "#15803D", "#475467"];

// ── Calendar types with colors (PRD Sez.11.2) ──
const CALENDARI = [
  { key: "rilievo", label: "Rilievo", color: "#2563eb" },
  { key: "posa", label: "Posa", color: "#059669" },
  { key: "assistenza", label: "Interventi/Regolazioni", color: "#d97706" },
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

  // Keep dashboard synced: poll every 30s + refetch on focus/mount/reconnect
  // (focus/mount/reconnect come from global QueryClient defaults in main.tsx).
  const liveOpts = {
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  } as const;

  const commesseStats = trpc.commesse.stats.useQuery(undefined, liveOpts);
  const anomalieStats = trpc.anomalie.stats.useQuery(undefined, liveOpts);
  const ticketStats = trpc.ticket.stats.useQuery(undefined, liveOpts);
  const garanzieStats = trpc.garanzie.stats.useQuery(undefined, liveOpts);
  const interventiOggiRaw = trpc.interventi.list.useQuery(
    {
      from: new Date().toISOString().split("T")[0],
      to: new Date().toISOString().split("T")[0],
    },
    liveOpts
  );
  const interventiSettimanaRaw = trpc.interventi.list.useQuery({}, liveOpts);
  const commesseRecenti = trpc.commesse.list.useQuery({}, liveOpts);
  const commessePerPriorita = trpc.commesse.byPriorita.useQuery(undefined, liveOpts);
  const squadre = trpc.squadre.list.useQuery(undefined, liveOpts);
  // Sources for the personalized "Da fare oggi" feed.
  const ticketListQ = trpc.ticket.list.useQuery({}, liveOpts);
  const garanzieListQ = trpc.garanzie.list.useQuery({}, liveOpts);

  // Filter out any legacy "annullato" records so deleted appointments never
  // show up on the dashboard even before the server-side cleanup kicks in.
  const interventiOggi = useMemo(
    () => ({
      ...interventiOggiRaw,
      data: interventiOggiRaw.data?.filter((i: any) => i.stato !== "annullato"),
    }),
    [interventiOggiRaw]
  );
  const interventiSettimana = useMemo(
    () => ({
      ...interventiSettimanaRaw,
      data: interventiSettimanaRaw.data?.filter((i: any) => i.stato !== "annullato"),
    }),
    [interventiSettimanaRaw]
  );

  const cs = commesseStats.data;
  const as_ = anomalieStats.data;
  const ts = ticketStats.data;
  const gs = garanzieStats.data;

  const { user } = useAuth();
  const firstName = (user?.name ?? "").trim().split(/\s+/)[0] || "";
  const todayLabel = new Date().toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // Kept sede-wide for the KPI tile below (the personalized feed has its own
  // filtering).
  const consegneDaConfermare = useMemo(
    () =>
      (commesseRecenti.data ?? []).filter(
        (c: any) =>
          c.stato === "produzione" && !c.dataConsegnaConfermata && !c.archivedAt
      ),
    [commesseRecenti.data]
  );
  const ticketAperti = (ts?.aperti ?? 0) + (ts?.assegnati ?? 0);

  // ── "Da fare oggi" — personalized action feed ──────────────────────────────
  // Direzione sees the whole sede; everyone else only what's assigned to them
  // (commessa.assegnatoA, legacy fallback createdBy). Merged sources, sorted
  // by urgency, capped at 8.
  const direzione = isDirezione(user);
  const uid = user?.id as number | undefined;
  const ruoliUtente: string[] = ((user as any)?.ruoli ?? []) as string[];

  type TodoItem = {
    key: string;
    rank: number;
    icon: any;
    iconClass: string;
    title: string;
    sub?: string;
    stato?: string;
    cta?: string;
    onClick: () => void;
  };

  const todoItems = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    const isMine = (c: any) =>
      direzione ||
      c.assegnatoA === uid ||
      (c.assegnatoA == null && c.createdBy === uid);
    const commesse = (commesseRecenti.data ?? []).filter(
      (c: any) => !c.archivedAt && c.stato !== "archiviata"
    );
    const byId = new Map<number, any>(commesse.map((c: any) => [c.id, c]));
    const items: TodoItem[] = [];

    // 1. Interventi di oggi ancora senza squadra — blocca il lavoro di oggi.
    for (const i of interventiOggi.data ?? []) {
      if (i.squadraId || i.stato !== "pianificato") continue;
      const cm = i.commessaId ? byId.get(i.commessaId) : null;
      if (cm ? !isMine(cm) : !direzione) continue;
      items.push({
        key: `int-${i.id}`,
        rank: 0,
        icon: CalendarClock,
        iconClass: "bg-danger-soft text-danger",
        title: `Assegna la squadra — ${cm?.cliente ?? i.indirizzo ?? i.tipo}${i.oraInizio ? ` (${i.oraInizio})` : ""}`,
        sub: cm?.codice,
        cta: "Apri calendario",
        onClick: () => setLocation("/planning"),
      });
    }

    // 2. Commesse urgenti.
    for (const c of commesse) {
      if (c.priorita !== "urgente") continue;
      if (!isMine(c)) continue;
      items.push({
        key: `urg-${c.id}`,
        rank: 1,
        icon: Flame,
        iconClass: "bg-danger-soft text-danger",
        title: `Commessa urgente — ${c.cliente}`,
        sub: c.codice,
        stato: c.stato,
        onClick: () => setLocation(`/commesse/${c.id}`),
      });
    }

    // 3. Consegne da confermare (produzione senza data confermata).
    for (const c of commesse) {
      if (c.stato !== "produzione" || c.dataConsegnaConfermata) continue;
      if (!isMine(c)) continue;
      items.push({
        key: `cons-${c.id}`,
        rank: 2,
        icon: CalendarClock,
        iconClass: "bg-warning-soft text-warning",
        title: `Conferma la data di consegna — ${c.cliente}`,
        sub: c.codice,
        cta: "Conferma consegna",
        onClick: () => setLocation(`/commesse/${c.id}`),
      });
    }

    // 4. Ticket aperti/assegnati sulle mie commesse (urgenti salgono di rank).
    for (const t of ticketListQ.data ?? []) {
      if (t.stato !== "aperto" && t.stato !== "assegnato") continue;
      const cm = t.commessaId ? byId.get(t.commessaId) : null;
      if (!cm || !isMine(cm)) continue;
      items.push({
        key: `tick-${t.id}`,
        rank: t.priorita === "urgente" ? 1 : 3,
        icon: TicketIcon,
        iconClass:
          t.priorita === "urgente"
            ? "bg-danger-soft text-danger"
            : "bg-info-soft text-info",
        title: `Ticket #${t.id} ${t.oggetto} — ${cm.cliente}`,
        sub: cm.codice,
        onClick: () => setLocation("/ticket"),
      });
    }

    // 5. Garanzie scadute / in scadenza entro 30gg (direzione+amministrazione).
    if (direzione || ruoliUtente.includes("amministrazione")) {
      const soon = new Date(Date.now() + 30 * 86400000)
        .toISOString()
        .split("T")[0];
      for (const g of garanzieListQ.data ?? []) {
        if (g.stato !== "attiva" || g.dataScadenza > soon) continue;
        const scaduta = g.dataScadenza < today;
        items.push({
          key: `gar-${g.id}`,
          rank: scaduta ? 1 : 4,
          icon: ShieldAlert,
          iconClass: scaduta
            ? "bg-danger-soft text-danger"
            : "bg-warning-soft text-warning",
          title: `${scaduta ? "Garanzia scaduta" : "Garanzia in scadenza"} — ${g.descrizione}`,
          sub: `scadenza ${new Date(g.dataScadenza + "T12:00:00").toLocaleDateString("it-IT")}`,
          onClick: () => setLocation("/garanzie"),
        });
      }
    }

    return items.sort((a, b) => a.rank - b.rank).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    commesseRecenti.data,
    interventiOggi.data,
    ticketListQ.data,
    garanzieListQ.data,
    direzione,
    uid,
  ]);

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
      {/* Header — greeting + date (§5) */}
      <div>
        <h1 className="font-display text-[28px] leading-[34px] font-bold tracking-[-0.02em]">
          {firstName ? `Ciao ${firstName}` : "Ciao"} — ecco la tua giornata
        </h1>
        <p className="text-text-2 text-sm mt-1 capitalize">{todayLabel}</p>
      </div>

      {/* Da fare oggi — personalized action feed (§4.1) */}
      <Card className="border-l-[3px] border-l-primary">
        <CardHeader className="pb-2">
          <CardTitle className="text-[15px] font-semibold flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" />
              Da fare oggi
            </span>
            <span className="eyebrow !text-text-3 font-normal">
              {direzione ? "Tutta la sede" : "Le tue attività"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {todoItems.length === 0 ? (
            <div className="flex items-center gap-3 rounded-md px-2 py-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-success-soft text-success">
                <CheckCircle2 className="h-4 w-4" />
              </span>
              <p className="text-sm text-text-2">
                Niente da fare per ora — nessuna urgenza, consegna o ticket
                {direzione ? " in sede" : " assegnato a te"}.
              </p>
            </div>
          ) : (
            todoItems.map((item) => (
              <div
                key={item.key}
                className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-2 cursor-pointer transition-colors"
                onClick={item.onClick}
              >
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${item.iconClass}`}
                >
                  <item.icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-1 truncate">
                    {item.title}
                  </p>
                  <div className="flex items-center gap-2">
                    {item.sub && (
                      <span className="codice-mono text-text-3">{item.sub}</span>
                    )}
                    {item.stato && <StatoChip stato={item.stato} />}
                  </div>
                </div>
                {item.cta ? (
                  <Button size="sm" variant="outline" className="shrink-0">
                    {item.cta}
                  </Button>
                ) : (
                  <ArrowRight className="h-4 w-4 text-text-3 shrink-0" />
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Primary KPIs — the 4 actionable metrics (§4.1) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Commesse attive"
          value={cs?.inCorso ?? 0}
          subtitle={`${cs?.inCorso ?? 0} attive · ${cs?.total ?? 0} in totale`}
          icon={Building2}
          accentClass="bg-primary"
          onClick={() => setLocation("/commesse")}
        />
        <StatCard
          title="Urgenze"
          value={cs?.urgenti ?? 0}
          subtitle="commesse urgenti"
          icon={Flame}
          accentClass="bg-danger"
          onClick={() => setLocation("/commesse")}
        />
        <StatCard
          title="Consegne da confermare"
          value={consegneDaConfermare.length}
          subtitle="in produzione, senza data"
          icon={CalendarClock}
          accentClass="bg-warning"
          onClick={() => setLocation("/kanban")}
        />
        <StatCard
          title="Ticket aperti"
          value={ticketAperti}
          subtitle={`${ts?.inLavorazione ?? 0} in lavorazione`}
          icon={TicketCheck}
          accentClass="bg-info"
          onClick={() => setLocation("/reclami")}
        />
      </div>

      {/* Secondary KPIs — small, shown only when > 0 (§4.1) */}
      {(() => {
        const interventiTot = interventiSettimana.data?.length ?? 0;
        const anomalieOpen = (as_?.aperte ?? 0) + (as_?.inGestione ?? 0);
        const secondary = [
          (gs?.attive ?? 0) > 0 && (
            <StatCard
              key="gar"
              title="Garanzie attive"
              value={gs?.attive ?? 0}
              subtitle={gs?.inScadenza ? `${gs.inScadenza} in scadenza` : undefined}
              icon={Shield}
              accentClass="bg-warning"
              onClick={() => setLocation("/garanzie")}
            />
          ),
          (squadre.data?.length ?? 0) > 0 && (
            <StatCard
              key="sq"
              title="Squadre attive"
              value={squadre.data?.length ?? 0}
              icon={Users}
              accentClass="bg-primary"
              onClick={() => setLocation("/squadre")}
            />
          ),
          interventiTot > 0 && (
            <StatCard
              key="int"
              title="Interventi settimana"
              value={interventiTot}
              subtitle={`${interventiSettimana.data?.filter((i: any) => i.stato === "completato").length ?? 0} completati`}
              icon={Hammer}
              accentClass="bg-info"
              onClick={() => setLocation("/planning")}
            />
          ),
          anomalieOpen > 0 && (
            <StatCard
              key="ano"
              title="Anomalie aperte"
              value={anomalieOpen}
              subtitle={as_?.critiche ? `${as_.critiche} critiche` : undefined}
              icon={AlertTriangle}
              accentClass="bg-danger"
              onClick={() => setLocation("/commesse")}
            />
          ),
        ].filter(Boolean);
        if (secondary.length === 0) return null;
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{secondary}</div>
        );
      })()}

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
                  <Bar dataKey="valore" fill="#3A5BDC" radius={[4, 4, 0, 0]} />
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
                <Bar dataKey="attivi" name="Attivi" fill="#3A5BDC" stackId="a" radius={[0, 0, 0, 0]} />
                <Bar dataKey="completati" name="Completati" fill="#0E9384" stackId="a" radius={[0, 4, 4, 0]} />
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
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <CalendarClock className="h-9 w-9 text-text-3" />
                <p className="text-[15px] font-semibold">Nessun intervento oggi</p>
                <Button size="sm" variant="outline" onClick={() => setLocation("/planning")}>
                  Pianifica un rilievo
                </Button>
              </div>
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

      {/* Clienti per priorita commesse */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Flame className="h-4 w-4" />
            Clienti per priorita commesse
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {([
              { key: "urgente", label: "Urgente", color: "border-red-400 bg-red-50", badge: "bg-red-600 text-white" },
              { key: "alta", label: "Alta", color: "border-orange-400 bg-orange-50", badge: "bg-orange-500 text-white" },
              { key: "media", label: "Media", color: "border-amber-300 bg-amber-50", badge: "bg-amber-400 text-white" },
              { key: "bassa", label: "Bassa", color: "border-slate-300 bg-slate-50", badge: "bg-slate-400 text-white" },
            ] as const).map((pri) => {
              const list: any[] = (commessePerPriorita.data as any)?.[pri.key] ?? [];
              return (
                <div key={pri.key} className={`rounded-md border ${pri.color} p-3`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-sm ${pri.badge}`}>
                      {pri.label}
                    </span>
                    <span className="text-xs text-muted-foreground">{list.length}</span>
                  </div>
                  {list.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">—</p>
                  ) : (
                    <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
                      {list.map((c) => (
                        <div
                          key={c.id}
                          className="cursor-pointer rounded-sm bg-white p-2 hover:shadow-sm transition-shadow"
                          onClick={() => setLocation(`/commesse/${c.id}`)}
                        >
                          <div className="font-mono text-[9px] text-muted-foreground">{c.codice}</div>
                          <div className="text-xs font-medium truncate">{c.cliente}</div>
                          <div className="text-[10px] text-muted-foreground uppercase truncate">
                            {c.stato.replace(/_/g, " ")}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

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
