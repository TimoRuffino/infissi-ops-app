import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Trophy,
  Crown,
  Sparkles,
  TrendingUp,
  Users,
  PartyPopper,
  Flame,
  Quote,
} from "lucide-react";
import { toast } from "sonner";

import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ── Types & helpers ──────────────────────────────────────────────────────────

type Row = { userId: number; nome: string; cognome: string; count: number };

function initials(nome: string, cognome: string): string {
  return `${nome?.[0] ?? ""}${cognome?.[0] ?? ""}`.toUpperCase() || "?";
}

function pick<T>(arr: T[], seed: number): T {
  return arr[((seed % arr.length) + arr.length) % arr.length];
}

// Animated count-up — eases a number from 0 to `target` on mount/change.
function useCountUp(target: number, durationMs = 900): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setVal(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return val;
}

// ── Witty content ────────────────────────────────────────────────────────────

const WINNER_QUOTES = [
  "Le commesse mi inseguono, non il contrario. 😎",
  "Ho firmato così tanti contratti che la penna ha chiesto le ferie. 🖊️",
  "Campione in carica. Accetto applausi e caffè. ☕",
  "Il segreto? Dire sempre di sì, poi capire come. 🤝",
  "Numero uno. Pure l'autostima è salita sul podio. 📈",
  "Vendere è facile. Difficile è restare umile — ci provo. 😇",
];

const PLACE_TITLE = [
  "Re delle Commesse 👑",
  "A un soffio dalla gloria 🥈",
  "Sul podio, col fiatone 🥉",
];

const REST_LABELS = [
  "In rimonta 🏃",
  "A tutto gas 🔥",
  "Sotto con le firme ✍️",
  "Scalda i motori 🚗",
  "Carica la rincorsa 🎯",
];

const CLICK_LINES = [
  "{n} scalda i motori! 🔥",
  "Un applauso per {n}! 👏",
  "{n}: «la prossima commessa è mia». 💪",
  "{n} ha sganciato i coriandoli! 🎉",
  "Occhio, {n} è in modalità squalo. 🦈",
  "{n} firma anche nel sonno. 😴✍️",
];

const FUN_FACTS = [
  "Lo sapevi? Una commessa firmata rende felici almeno 3 persone e 1 gestionale.",
  "Statistica ufficiosa: il 100% di chi non molla, prima o poi vince.",
  "Il podio è freddo. La gloria, no.",
  "Ogni «no» è un «sì» che si è perso per strada.",
];

// Per-place visual config. Index 0 = 1° posto.
const PLACE = [
  {
    medal: "🥇",
    ring: "ring-amber-400",
    grad: "from-amber-300 via-yellow-400 to-amber-500",
    text: "text-amber-900",
    pedestal: "from-amber-400 to-yellow-500",
    height: "h-44",
    avatar: "h-24 w-24 text-2xl",
  },
  {
    medal: "🥈",
    ring: "ring-slate-300",
    grad: "from-slate-200 via-slate-300 to-slate-400",
    text: "text-slate-700",
    pedestal: "from-slate-300 to-slate-400",
    height: "h-32",
    avatar: "h-20 w-20 text-xl",
  },
  {
    medal: "🥉",
    ring: "ring-orange-400",
    grad: "from-orange-300 via-amber-500 to-orange-600",
    text: "text-orange-950",
    pedestal: "from-orange-400 to-amber-600",
    height: "h-24",
    avatar: "h-20 w-20 text-xl",
  },
];

const CONFETTI_COLORS = [
  "#f59e0b",
  "#fbbf24",
  "#fde68a",
  "#fb923c",
  "#a78bfa",
  "#34d399",
  "#60a5fa",
  "#f472b6",
  "#ffffff",
];

// ── Confetti ─────────────────────────────────────────────────────────────────
// Pure-CSS confetti rain. Re-mounted (via `key`) to replay the burst.
function Confetti({ burstId }: { burstId: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 46 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.5,
        duration: 2.4 + Math.random() * 2.2,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 6 + Math.random() * 8,
        rounded: Math.random() > 0.5,
        drift: (Math.random() - 0.5) * 120,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [burstId]
  );
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pieces.map((p) => (
        <span
          key={p.id}
          style={{
            position: "absolute",
            top: "-24px",
            left: `${p.left}%`,
            width: `${p.size}px`,
            height: `${p.size * 0.5}px`,
            background: p.color,
            borderRadius: p.rounded ? "9999px" : "1px",
            // @ts-expect-error — custom property for the keyframe
            "--drift": `${p.drift}px`,
            animation: `classifica-confetti ${p.duration}s linear ${p.delay}s forwards`,
          }}
        />
      ))}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Classifica() {
  const classifica = trpc.commesse.classificaVenditori.useQuery();
  const rows: Row[] = (classifica.data ?? []) as Row[];

  // Confetti burst counter — bumping it remounts <Confetti/> to replay.
  const [burst, setBurst] = useState(1);
  const fireConfetti = useCallback(() => setBurst((b) => b + 1), []);

  // Winner quote — cycles when the winner is clicked.
  const [quoteIdx, setQuoteIdx] = useState(0);

  // Rotating fun fact in the footer.
  const [factIdx, setFactIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFactIdx((i) => i + 1), 6000);
    return () => clearInterval(t);
  }, []);

  // Auto-confetti once the ranking has loaded with at least one player.
  const hasData = rows.length > 0;
  useEffect(() => {
    if (hasData) setBurst((b) => b + 1);
  }, [hasData]);

  const { top3, rest, totalCommesse, maxCount, gap } = useMemo(() => {
    const t3 = rows.slice(0, 3);
    const r = rows.slice(3);
    const total = rows.reduce((s, x) => s + x.count, 0);
    const max = rows.reduce((m, x) => Math.max(m, x.count), 0);
    const g = rows.length >= 2 ? rows[0].count - rows[1].count : 0;
    return { top3: t3, rest: r, totalCommesse: total, maxCount: max, gap: g };
  }, [rows]);

  // Visual podium order: 2° — 1° — 3° so the winner stands in the centre.
  const podiumOrder: Array<{ row: Row; place: number } | null> = [
    top3[1] ? { row: top3[1], place: 1 } : null,
    top3[0] ? { row: top3[0], place: 0 } : null,
    top3[2] ? { row: top3[2], place: 2 } : null,
  ];

  function celebrate(row: Row, isWinner: boolean) {
    fireConfetti();
    const line = pick(CLICK_LINES, row.userId + burst).replace(
      "{n}",
      row.nome || "Il venditore"
    );
    toast(line, { icon: "🎉" });
    if (isWinner) setQuoteIdx((i) => i + 1);
  }

  // Witty subtitle reacting to the standings.
  const standingLine = useMemo(() => {
    if (rows.length === 0) return "";
    if (rows.length === 1)
      return `${rows[0].nome} corre da solo… per ora. 🏃`;
    if (gap === 0)
      return `Testa a testa! ${rows[0].nome} e ${rows[1].nome} appaiati in vetta. 🤝`;
    return `${rows[0].nome} comanda la corsa — ${gap} commess${
      gap === 1 ? "a" : "e"
    } di margine sul secondo. 🏁`;
  }, [rows, gap]);

  return (
    <div className="space-y-8">
      {/* Local keyframes — dependency-free animations. */}
      <style>{`
        @keyframes classifica-bob {
          0%,100% { transform: translateY(0) rotate(-6deg); }
          50%     { transform: translateY(-8px) rotate(6deg); }
        }
        @keyframes classifica-rise {
          0%   { transform: translateY(28px) scale(0.96); opacity: 0; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes classifica-sparkle {
          0%,100% { transform: scale(0.6) rotate(0deg); opacity: 0.35; }
          50%     { transform: scale(1.2) rotate(28deg); opacity: 1; }
        }
        @keyframes classifica-float {
          0%,100% { transform: translateY(0); }
          50%     { transform: translateY(-6px); }
        }
        @keyframes classifica-confetti {
          0%   { transform: translate(0,0) rotate(0deg); opacity: 1; }
          100% { transform: translate(var(--drift,0), 104vh) rotate(720deg); opacity: 1; }
        }
        @keyframes classifica-wiggle {
          0%,100% { transform: rotate(0deg); }
          25%     { transform: rotate(-7deg); }
          75%     { transform: rotate(7deg); }
        }
        .classifica-spot:hover .classifica-avatar {
          animation: classifica-wiggle 0.4s ease-in-out;
        }
      `}</style>

      <Confetti key={burst} burstId={burst} />

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="h-7 w-7 text-amber-500" />
            Classifica Venditori
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {standingLine ||
              "I commerciali in gara, ordinati per commesse attive. Chi ne ha di più sale sul gradino più alto. 🏆"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="text-xs gap-1">
            <Users className="h-3 w-3" />
            {rows.length} in gara
          </Badge>
          <Badge variant="secondary" className="text-xs gap-1">
            <TrendingUp className="h-3 w-3" />
            {totalCommesse} commesse
          </Badge>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1"
            onClick={() => {
              fireConfetti();
              toast("Coriandoli in arrivo! 🎉", { icon: "🎊" });
            }}
          >
            <PartyPopper className="h-3.5 w-3.5" />
            Coriandoli
          </Button>
        </div>
      </div>

      {/* Loading */}
      {classifica.isLoading && (
        <p className="text-sm text-muted-foreground">Caricamento classifica…</p>
      )}

      {/* Empty state */}
      {!classifica.isLoading && rows.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-14 text-center space-y-2">
            <Trophy className="h-12 w-12 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Podio vuoto, eco assordante. Aggiungi utenti con ruolo
              «commerciale» dalla pagina Utenti e che la gara abbia inizio! 🏁
            </p>
          </CardContent>
        </Card>
      )}

      {/* Podium */}
      {!classifica.isLoading && rows.length > 0 && (
        <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-b from-amber-50/60 via-background to-background p-6 sm:p-10">
          <Trophy className="pointer-events-none absolute -right-6 -top-6 h-40 w-40 text-amber-200/40" />

          <div className="relative flex items-end justify-center gap-3 sm:gap-6">
            {podiumOrder.map((slot, i) =>
              slot ? (
                <PodiumSpot
                  key={slot.row.userId}
                  row={slot.row}
                  place={slot.place}
                  enterDelay={i * 0.12}
                  onCelebrate={() => celebrate(slot.row, slot.place === 0)}
                />
              ) : (
                <div key={i} className="w-24 sm:w-36" />
              )
            )}
          </div>

          {/* Winner quote bubble */}
          {top3[0] && (
            <div className="relative mt-6 flex justify-center">
              <button
                onClick={() => {
                  setQuoteIdx((q) => q + 1);
                  fireConfetti();
                }}
                className="group max-w-md rounded-2xl border bg-card px-4 py-2.5 text-center shadow-sm transition-transform hover:-translate-y-0.5"
                title="Cambia battuta"
              >
                <span className="flex items-center gap-2 text-sm italic text-muted-foreground">
                  <Quote className="h-4 w-4 shrink-0 text-amber-500" />
                  {pick(WINNER_QUOTES, quoteIdx)}
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Rest of the ranking (4° onwards) */}
      {rest.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Inseguitori
          </h2>
          {rest.map((row, idx) => (
            <RestRow
              key={row.userId}
              row={row}
              rank={idx + 4}
              isLast={idx === rest.length - 1}
              maxCount={maxCount}
              leaderCount={rows[0]?.count ?? 0}
              onCelebrate={() => celebrate(row, false)}
            />
          ))}
        </div>
      )}

      {/* Footer — playful, rotating fun fact */}
      {!classifica.isLoading && rows.length > 0 && (
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          {totalCommesse === 0
            ? "Gara ancora aperta — zero commesse attive. Che vinca il più affamato! 🍴"
            : pick(FUN_FACTS, factIdx)}
        </p>
      )}
    </div>
  );
}

// ── Podium spot ──────────────────────────────────────────────────────────────

function PodiumSpot({
  row,
  place,
  enterDelay,
  onCelebrate,
}: {
  row: Row;
  place: number;
  enterDelay: number;
  onCelebrate: () => void;
}) {
  const cfg = PLACE[place];
  const isWinner = place === 0;
  const count = useCountUp(row.count);

  return (
    <button
      type="button"
      onClick={onCelebrate}
      title="Cliccami per i coriandoli! 🎉"
      className="classifica-spot flex w-24 cursor-pointer flex-col items-center sm:w-36"
      style={{ animation: `classifica-rise 0.5s ease-out ${enterDelay}s both` }}
    >
      {/* Crown for the winner */}
      {isWinner && (
        <div
          className="mb-1"
          style={{ animation: "classifica-bob 2.2s ease-in-out infinite" }}
        >
          <Crown className="h-9 w-9 text-amber-400 drop-shadow" />
        </div>
      )}

      {/* Avatar + sparkles */}
      <div
        className="relative"
        style={
          isWinner
            ? { animation: "classifica-float 3s ease-in-out infinite" }
            : undefined
        }
      >
        {isWinner && (
          <>
            <Sparkles
              className="absolute -left-5 top-1 h-4 w-4 text-amber-400"
              style={{ animation: "classifica-sparkle 1.6s ease-in-out infinite" }}
            />
            <Sparkles
              className="absolute -right-4 -top-2 h-5 w-5 text-yellow-400"
              style={{
                animation: "classifica-sparkle 1.9s ease-in-out 0.4s infinite",
              }}
            />
          </>
        )}
        <Avatar
          className={`classifica-avatar ${cfg.avatar} border-4 border-white shadow-lg ring-4 ${cfg.ring}`}
        >
          <AvatarFallback
            className={`bg-gradient-to-br ${cfg.grad} ${cfg.text} font-bold`}
          >
            {initials(row.nome, row.cognome)}
          </AvatarFallback>
        </Avatar>
        <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-2xl drop-shadow">
          {cfg.medal}
        </span>
      </div>

      {/* Name + witty title + count */}
      <p className="mt-3 text-center text-sm font-bold leading-tight">
        {row.nome}
        <br />
        <span className="font-semibold text-muted-foreground">
          {row.cognome}
        </span>
      </p>
      <span className="mt-0.5 text-center text-[10px] font-medium text-amber-600">
        {PLACE_TITLE[place]}
      </span>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-extrabold tabular-nums">{count}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          commesse
        </span>
      </div>

      {/* Pedestal */}
      <div
        className={`mt-2 flex w-full ${cfg.height} items-start justify-center rounded-t-lg bg-gradient-to-b ${cfg.pedestal} shadow-inner transition-transform`}
      >
        <span
          className="mt-2 select-none text-3xl font-black text-white/90"
          style={{ textShadow: "0 2px 4px rgba(0,0,0,0.25)" }}
        >
          {place + 1}°
        </span>
      </div>
    </button>
  );
}

// ── Rest row ─────────────────────────────────────────────────────────────────

function RestRow({
  row,
  rank,
  isLast,
  maxCount,
  leaderCount,
  onCelebrate,
}: {
  row: Row;
  rank: number;
  isLast: boolean;
  maxCount: number;
  leaderCount: number;
  onCelebrate: () => void;
}) {
  const count = useCountUp(row.count);
  const pct = maxCount > 0 ? (row.count / maxCount) * 100 : 0;
  const distacco = leaderCount - row.count;
  // Last place gets the wooden-spoon honour; others get a rotating tag.
  const label = isLast
    ? "Cucchiaio di legno 🥄"
    : pick(REST_LABELS, rank);

  return (
    <Card
      className="cursor-pointer overflow-hidden transition-transform hover:-translate-y-0.5 hover:shadow-md"
      onClick={onCelebrate}
      title="Cliccami per i coriandoli! 🎉"
    >
      <CardContent className="flex items-center gap-3 py-3 px-4">
        <span className="w-8 shrink-0 text-center text-lg font-bold text-muted-foreground tabular-nums">
          {rank}°
        </span>
        <Avatar className="h-10 w-10 shrink-0 border">
          <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
            {initials(row.nome, row.cognome)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">
              {row.nome} {row.cognome}
            </p>
            <Badge
              variant="outline"
              className={`hidden shrink-0 text-[9px] sm:inline-flex ${
                isLast ? "border-amber-400 text-amber-700" : ""
              }`}
            >
              {label}
            </Badge>
          </div>
          {/* relative bar */}
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary"
              style={{ width: `${Math.max(pct, 4)}%` }}
            />
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold tabular-nums">{count}</span>
            <span className="text-[10px] uppercase text-muted-foreground">
              commesse
            </span>
          </div>
          {distacco > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <Flame className="h-3 w-3 text-orange-400" />
              -{distacco} dal 1°
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
