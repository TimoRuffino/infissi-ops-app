// Dashboard (`/`) — archetipo «Dashboard per ruolo» di Frame & Flow.
//
// Composizione: «Da fare oggi» domina la colonna principale (~8/12) con il
// pulse dei KPI e il calendario; la colonna laterale (~4/12) porta la
// situazione Tars (briefing deterministico, zero token), gli interventi di
// oggi e le commesse recenti. Sotto: pipeline per stato, approfondimenti
// (grafici in chunk lazy: recharts non pesa sul primo paint) e priorità.
//
// Il contratto funzionale è il PRD §26 e NON cambia qui: feed personalizzato
// cap 8 con scope per ruolo, importi solo con `pagamento.read` (il server li
// omette agli altri), KPI «spenti» a zero, calendario settimanale con filtri.
import { trpc } from "@/lib/trpc";
import {
  CALENDARI,
  CALENDAR_COLOR_MAP,
  CALENDAR_SOFT_MAP,
} from "@/lib/calendario";
import { formatEuroSimbolo } from "@/lib/euro";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  Landmark,
  Mail as MailIcon,
} from "lucide-react";
import { useLocation } from "wouter";
import { lazy, Suspense, useState, useMemo } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { isDirezione } from "@/lib/roles";
import StatoChip from "@/components/StatoChip";
import TarsBriefing from "@/components/TarsBriefing";
import { statoColorVar, statoLabel, STATI_ORDER } from "@/lib/stato";
import {
  CheckCircle2,
  ArrowRight,
  ClipboardList,
  Ticket as TicketIcon,
  ShieldAlert,
  Banknote,
} from "lucide-react";

// I grafici (recharts) vivono in un chunk separato: si scaricano solo
// quando c'è qualcosa da disegnare.
const DashboardApprofondimenti = lazy(
  () => import("@/components/dashboard/DashboardApprofondimenti")
);

// KPI tile — contratto §26.3.
// - Zero → «spento»: numero in text-3, nessun accento, non cliccabile.
// - >0 e azionabile → barra d'accento (3px, colore semantico) + card che
//   naviga alla lista già filtrata. Feedback via bordo e ombra: niente
//   sollevamenti a molla sui contenitori.
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
  icon: React.ComponentType<{ className?: string }>;
  accentClass?: string;
  onClick?: () => void;
}) {
  const numeric = typeof value === "number" ? value : parseInt(String(value), 10);
  const isZero = numeric === 0;
  const dead = isZero || !onClick;

  return (
    <Card
      className={`relative overflow-hidden gap-0 py-5 transition-[border-color,box-shadow,transform] ${
        dead
          ? ""
          : "cursor-pointer hover:border-border-strong hover:shadow-sm active:scale-[0.995]"
      }`}
      onClick={dead ? undefined : onClick}
      role={dead ? undefined : "button"}
      tabIndex={dead ? undefined : 0}
      onKeyDown={
        dead
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
      }
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
  );
}

// Pipeline per stato: dove sono le commesse, in un colpo d'occhio. Segmenti
// proporzionali con i colori di famiglia (mai il colore da solo: la legenda
// porta etichetta e conteggio) e clic verso il Board. Sostituisce il donut.
function PipelineCommesse({
  commesse,
  onOpen,
}: {
  commesse: any[];
  onOpen: () => void;
}) {
  const conteggi = STATI_ORDER.map((s) => ({
    stato: s,
    n: commesse.filter((c) => c.stato === s).length,
  })).filter((x) => x.n > 0);
  const totale = conteggi.reduce((acc, x) => acc + x.n, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Commesse per stato
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onOpen}>
            Apri il Board
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
        <p className="text-xs text-text-3">
          {totale} attive in sede · fonte: commesse non archiviate
        </p>
      </CardHeader>
      <CardContent>
        {totale === 0 ? (
          <p className="text-sm text-text-3 py-4 text-center">
            Nessuna commessa attiva in sede.
          </p>
        ) : (
          <>
            <div
              className="flex h-2.5 items-stretch gap-px overflow-hidden rounded-full"
              aria-hidden="true"
            >
              {conteggi.map((x) => (
                <span
                  key={x.stato}
                  style={{
                    backgroundColor: statoColorVar(x.stato),
                    flexGrow: x.n,
                  }}
                  className="min-w-[6px] basis-0"
                  title={`${statoLabel(x.stato)}: ${x.n}`}
                />
              ))}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {conteggi.map((x) => (
                <li key={x.stato} className="flex items-center gap-1.5 text-xs">
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: statoColorVar(x.stato) }}
                  />
                  <span className="text-text-2">{statoLabel(x.stato)}</span>
                  <span className="font-semibold tabular-nums text-text-1">
                    {x.n}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

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
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={prevWeek} aria-label="Settimana precedente">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={goToday}>
              Oggi
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={nextWeek} aria-label="Settimana successiva">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{weekLabel}</p>
        {/* Filtri per calendario: testo colorato su fondo tenue, leggibile
            in entrambi i temi (niente bianco su tinta piena). */}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {CALENDARI.map((cal) => {
            const attivo = activeCalendari.has(cal.key);
            return (
              <button
                key={cal.key}
                onClick={() => toggleCalendario(cal.key)}
                aria-pressed={attivo}
                className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border transition-colors ${
                  attivo
                    ? ""
                    : "border-border text-muted-foreground bg-background"
                }`}
                style={
                  attivo
                    ? {
                        backgroundColor: cal.soft,
                        color: cal.color,
                        borderColor: `color-mix(in srgb, ${cal.color} 35%, transparent)`,
                      }
                    : undefined
                }
              >
                {cal.label}
              </button>
            );
          })}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1">
          {weekDates.map((d, idx) => {
            const key = formatDateKey(d);
            const isToday = key === today;
            const dayEvents = eventiByDay[key] ?? [];
            return (
              <div key={key} className="min-h-[100px] min-w-0">
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
                      className="text-[10px] font-medium leading-tight p-1 rounded cursor-pointer hover:opacity-80 transition-opacity truncate"
                      style={{
                        backgroundColor:
                          CALENDAR_SOFT_MAP[ev.tipo] ?? "var(--color-cal-altro-soft)",
                        color: CALENDAR_COLOR_MAP[ev.tipo] ?? "var(--color-cal-altro)",
                      }}
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
  // Il lavoro nuovo: posta e fatture da riconciliare. retry:false — per i
  // ruoli senza accesso il server rifiuta e la riga semplicemente non compare.
  const comStats = trpc.mail.comunicazioni.stats.useQuery(undefined, {
    ...liveOpts,
    retry: false,
  });
  const ficListQ = trpc.ficFatture.list.useQuery(
    { anno: new Date().getFullYear() },
    { ...liveOpts, retry: false }
  );
  // Briefing Tars nella colonna laterale: deterministico, zero token, e a
  // flag spento la query non parte nemmeno.
  const interruttoriQ = trpc.platform.interruttori.useQuery(undefined, {
    staleTime: 300_000,
  });
  const tarsAcceso = Boolean(interruttoriQ.data?.tars);

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

  // ── "Da fare oggi" — personalized action feed (contratto PRD §26.2) ────────
  // Direzione sees the whole sede; everyone else only what's assigned to them
  // (commessa.assegnatoA, legacy fallback createdBy). Merged sources, sorted
  // by urgency, capped at 8.
  const direzione = isDirezione(user);
  const uid = user?.id as number | undefined;
  const ruoliUtente: string[] = ((user as any)?.ruoli ?? []) as string[];

  type TodoItem = {
    key: string;
    rank: number;
    icon: React.ComponentType<{ className?: string }>;
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

    // 3b. Saldi residui nelle fasi finali — soldi da incassare. La cifra
    // compare solo per chi ha `pagamento.read` (il server la omette agli
    // altri); il bit `daSaldare` arriva per tutti (slice 2).
    for (const c of commesse) {
      if (!["attesa_posa", "finiture_saldo", "interventi_regolazioni"].includes(c.stato)) continue;
      if (!(c as any).daSaldare) continue;
      if (!isMine(c)) continue;
      const tot = (c as any).importoTotale;
      const residuo =
        tot != null ? tot - ((c as any).importoIncassato ?? 0) : null;
      items.push({
        key: `saldo-${c.id}`,
        rank: 2,
        icon: Banknote,
        iconClass: "bg-warning-soft text-warning",
        title:
          residuo != null && residuo > 0
            ? `Da incassare ${formatEuroSimbolo(residuo)} — ${c.cliente}`
            : `Da incassare il saldo — ${c.cliente}`,
        sub: c.codice,
        stato: c.stato,
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

    // 6. Il lavoro nuovo, aggregato in una riga per fonte: le fatture senza
    //    riscontro nel CRM.
    const daRiconciliare = (ficListQ.data ?? []).filter(
      (fa: any) => fa.stato === "da_riconciliare" || fa.stato === "non_abbinabile"
    ).length;
    if (daRiconciliare > 0) {
      items.push({
        key: "fic-riconcilia",
        rank: 2.5,
        icon: Landmark,
        iconClass: "bg-warning-soft text-warning",
        title: `${daRiconciliare} fattur${daRiconciliare === 1 ? "a" : "e"} senza riscontro nel CRM`,
        cta: "Riconcilia",
        onClick: () => setLocation("/economia"),
      });
    }

    return items.sort((a, b) => a.rank - b.rank).slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    commesseRecenti.data,
    interventiOggi.data,
    ticketListQ.data,
    garanzieListQ.data,
    comStats.data,
    ficListQ.data,
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

  const commesseAttive = useMemo(
    () =>
      (commesseRecenti.data ?? []).filter(
        (c: any) => !c.archivedAt && c.stato !== "archiviata"
      ),
    [commesseRecenti.data]
  );
  const mostraApprofondimenti =
    interventiByTipo.length > 0 || squadreWorkload.length > 0;

  return (
    <div className="space-y-6">
      {/* Header — greeting + date (§26.1) */}
      <div>
        <h1 className="font-display text-[28px] leading-[34px] font-bold tracking-[-0.02em]">
          {firstName ? `Ciao ${firstName}` : "Ciao"} — ecco la tua giornata
        </h1>
        <p className="text-text-2 text-sm mt-1 capitalize">{todayLabel}</p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-12">
        {/* ── Colonna principale: il lavoro di oggi domina ── */}
        <div className="min-w-0 space-y-6 lg:col-span-8">
          {/* Da fare oggi — personalized action feed (§26.2) */}
          <Card className="border-l-[3px] border-l-primary rf-frame-reveal">
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

          {/* Pulse — the 4 actionable KPIs (§26.3) */}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
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

          {/* Calendar (§26.4) */}
          <CalendarioSettimana
            interventi={interventiSettimana.data ?? []}
            onEventClick={(ev) => {
              // Ogni evento apre il Planning: la vecchia rotta /posa/:id non
              // esiste piu e portava sul 404.
              setLocation("/planning");
            }}
          />
        </div>

        {/* ── Colonna laterale: situazione e contesto ── */}
        <div className="min-w-0 space-y-6 lg:col-span-4">
          <TarsBriefing enabled={tarsAcceso} />

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
                      onClick={() => setLocation("/planning")}
                    >
                      <div className="space-y-1 min-w-0">
                        <p className="text-sm font-medium truncate">{i.note}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {i.indirizzo}
                        </p>
                      </div>
                      <Badge
                        variant={i.stato === "in_corso" ? "default" : "secondary"}
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
              {!commesseRecenti.data?.length ? (
                <p className="text-sm text-text-3 py-4 text-center">
                  Nessuna commessa in sede.
                </p>
              ) : (
                <div className="space-y-3">
                  {commesseRecenti.data.slice(0, 5).map((c: any) => (
                    <div
                      key={c.id}
                      className="flex items-start justify-between border-b pb-3 last:border-0 last:pb-0 cursor-pointer hover:bg-muted/50 -mx-2 px-2 py-1 rounded"
                      onClick={() => setLocation(`/commesse/${c.id}`)}
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="codice-mono text-text-3">{c.codice}</span>
                          {c.priorita === "urgente" && (
                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                              URGENTE
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm font-medium truncate">{c.cliente}</p>
                      </div>
                      <StatoChip stato={c.stato} className="shrink-0" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Secondary KPIs — small, shown only when > 0 (§26.3) */}
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
          (comStats.data?.nuove ?? 0) > 0 && (
            <StatCard
              key="com"
              title="Comunicazioni nuove"
              value={comStats.data!.nuove}
              subtitle="email e WhatsApp da leggere"
              icon={MailIcon}
              accentClass="bg-info"
              onClick={() => setLocation("/comunicazioni")}
            />
          ),
        ].filter(Boolean);
        if (secondary.length === 0) return null;
        return (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{secondary}</div>
        );
      })()}

      {/* Pipeline per stato — al posto del donut (§26.3) */}
      <PipelineCommesse
        commesse={commesseAttive}
        onOpen={() => setLocation("/kanban")}
      />

      {/* Approfondimenti (recharts, chunk lazy): montati solo se c'è
          qualcosa da disegnare — una sede vuota non scarica i grafici. */}
      {mostraApprofondimenti && (
        <Suspense
          fallback={
            <div className="grid gap-6 lg:grid-cols-2">
              <Skeleton className="h-[300px] rounded-xl" />
              <Skeleton className="h-[300px] rounded-xl" />
            </div>
          }
        >
          <DashboardApprofondimenti
            interventiByTipo={interventiByTipo}
            squadreWorkload={squadreWorkload}
          />
        </Suspense>
      )}

      {/* Clienti per priorità commesse */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Flame className="h-4 w-4" />
            Clienti per priorità commesse
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {([
              { key: "urgente", label: "Urgente", box: "border-danger/50 bg-danger-soft/70", badge: "bg-danger text-white" },
              // Testo scuro su fondo tenue, non bianco su tinta piena: il
              // bianco su ambra dava 1.72:1 — un badge che nessuno legge.
              { key: "alta", label: "Alta", box: "border-danger/30 bg-surface", badge: "bg-danger-soft text-danger" },
              { key: "media", label: "Media", box: "border-warning/30 bg-surface", badge: "bg-warning-soft text-warning" },
              { key: "bassa", label: "Bassa", box: "border-border-strong bg-surface-2", badge: "bg-surface-2 text-text-2" },
            ] as const).map((pri) => {
              const list: any[] = (commessePerPriorita.data as any)?.[pri.key] ?? [];
              return (
                <div key={pri.key} className={`rounded-md border ${pri.box} p-3`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-sm ${pri.badge}`}>
                      {pri.label}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">{list.length}</span>
                  </div>
                  {list.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">—</p>
                  ) : (
                    <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
                      {list.map((c) => (
                        <div
                          key={c.id}
                          className="cursor-pointer rounded-sm border border-border-soft bg-surface p-2 hover:border-border-strong transition-colors"
                          onClick={() => setLocation(`/commesse/${c.id}`)}
                        >
                          <div className="codice-mono text-[10px] text-muted-foreground">{c.codice}</div>
                          <div className="text-xs font-medium truncate">{c.cliente}</div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            {statoLabel(c.stato)}
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
        <Card className="border-danger/30 bg-danger-soft/40">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2 text-danger">
              <AlertTriangle className="h-4 w-4" />
              Anomalie critiche da gestire
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              Ci sono{" "}
              <strong>{as_?.critiche} anomalie con priorità critica</strong> non
              ancora risolte. Verifica lo stato nella sezione commesse.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
