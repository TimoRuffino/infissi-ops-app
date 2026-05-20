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
  Mic,
  Handshake,
} from "lucide-react";
import { toast } from "sonner";

import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ── Types & helpers ──────────────────────────────────────────────────────────

type Row = { userId: number; nome: string; cognome: string; count: number };

// A podium tier: everyone sharing the same commesse count. `rank` is the
// competition rank (1224 style) of the whole group.
type Group = { count: number; rank: number; rows: Row[] };

function initials(nome: string, cognome: string): string {
  return `${nome?.[0] ?? ""}${cognome?.[0] ?? ""}`.toUpperCase() || "?";
}

function pick<T>(arr: T[], seed: number): T {
  return arr[((seed % arr.length) + arr.length) % arr.length];
}

function fullName(r: Row): string {
  return `${r.nome ?? ""} ${r.cognome ?? ""}`.trim() || "Venditore";
}

// Group rows by count (rows arrive sorted desc, alpha tie-break). Each group
// gets a competition rank: 2 people tied 1st → next group is rank 3.
function buildGroups(rows: Row[]): Group[] {
  const byCount = new Map<number, Row[]>();
  for (const r of rows) {
    const list = byCount.get(r.count);
    if (list) list.push(r);
    else byCount.set(r.count, [r]);
  }
  const counts = Array.from(byCount.keys()).sort((a, b) => b - a);
  const groups: Group[] = [];
  let placed = 0;
  for (const c of counts) {
    const rs = byCount.get(c)!;
    groups.push({ count: c, rank: placed + 1, rows: rs });
    placed += rs.length;
  }
  return groups;
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
  "Non conto le commesse: le commesse contano me. 🧮",
  "Sono nato stanco, ma di vincere mai. 🏆",
  "Dietro ogni mia firma c'è un cliente felice e un collega invidioso. ✍️",
  "Modestamente? No, neanche quella. 👑",
];

// Big, rotating "jury" one-liners — the loud, visible jokes.
const JURY_COMMENTS = [
  "La giuria ha deliberato: chi vende di più… vince. Rivoluzionario. 🎤",
  "Promemoria motivazionale: le commesse non si firmano da sole. Quasi mai.",
  "Il secondo posto è il primo dei non-primi. Filosofia pura. 🧠",
  "Breaking news: scoperto legame tra «telefonare ai clienti» e «vincere».",
  "Chi è ultimo oggi, domani… è comunque in classifica. Coraggio. 🥄",
  "Regola d'oro della giuria: sorridi, firma, ripeti. 🔁",
  "Dato curioso: nessuno ha mai vinto restando seduto. Citazione non verificata.",
  "Il talento conta. La costanza fattura. 💸",
  "La classifica si aggiorna da sola. Voi no — datevi una mossa. 😏",
  "Sondaggio interno: 9 venditori su 10 vorrebbero essere il 10°… dall'alto.",
  "Caffè bevuti dalla giuria: tanti. Fiducia in voi: anche di più. ☕",
  "Oggi pari merito, domani chissà. Il bello della gara è questo. 🎲",
];

const CLICK_LINES = [
  "{n} scalda i motori! 🔥",
  "Un applauso per {n}! 👏",
  "{n}: «la prossima commessa è mia». 💪",
  "{n} ha sganciato i coriandoli! 🎉",
  "Occhio, {n} è in modalità squalo. 🦈",
  "{n} firma anche nel sonno. 😴✍️",
  "{n} non molla un colpo. 🥊",
  "La giuria stravede per {n}. E pure i clienti. ❤️",
  "{n} ha appena fatto tremare la classifica. 🌋",
];

const FUN_FACTS = [
  "Lo sapevi? Una commessa firmata rende felici almeno 3 persone e 1 gestionale.",
  "Statistica ufficiosa: il 100% di chi non molla, prima o poi vince.",
  "Il podio è freddo. La gloria, no. 🔥",
  "Ogni «no» è un «sì» che si è perso per strada.",
  "I venditori bravi non contano le ore. Contano le firme. ✍️",
  "Curiosità: il sorriso al telefono si sente. Provare per credere. 📞",
];

const REST_LABELS = [
  "In rimonta 🏃",
  "A tutto gas 🔥",
  "Sotto con le firme ✍️",
  "Scalda i motori 🚗",
  "Carica la rincorsa 🎯",
  "Pronto al sorpasso 🏎️",
];

// Per-tier visual config. Index 0 = gradino oro (punteggio più alto).
const PLACE = [
  {
    medal: "🥇",
    ring: "ring-amber-400",
    grad: "from-amber-300 via-yellow-400 to-amber-500",
    text: "text-amber-900",
    pedestal: "from-amber-400 to-yellow-500",
    height: "h-40",
    titleSolo: "Re delle Commesse 👑",
    titleMulti: "Campioni a pari merito 👑",
  },
  {
    medal: "🥈",
    ring: "ring-slate-300",
    grad: "from-slate-200 via-slate-300 to-slate-400",
    text: "text-slate-700",
    pedestal: "from-slate-300 to-slate-400",
    height: "h-28",
    titleSolo: "A un soffio dalla gloria 🥈",
    titleMulti: "Vice-campioni a pari merito 🥈",
  },
  {
    medal: "🥉",
    ring: "ring-orange-400",
    grad: "from-orange-300 via-amber-500 to-orange-600",
    text: "text-orange-950",
    pedestal: "from-orange-400 to-amber-600",
    height: "h-20",
    titleSolo: "Sul podio, col fiatone 🥉",
    titleMulti: "Bronzo condiviso 🥉",
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

  const [burst, setBurst] = useState(1);
  const fireConfetti = useCallback(() => setBurst((b) => b + 1), []);

  const [quoteIdx, setQuoteIdx] = useState(0);

  // Rotating jury comment — auto-advances, also clickable.
  const [juryIdx, setJuryIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setJuryIdx((i) => i + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const [factIdx, setFactIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFactIdx((i) => i + 1), 6500);
    return () => clearInterval(t);
  }, []);

  const groups = useMemo(() => buildGroups(rows), [rows]);

  const hasData = rows.length > 0;
  useEffect(() => {
    if (hasData) setBurst((b) => b + 1);
  }, [hasData]);

  const totalCommesse = useMemo(
    () => rows.reduce((s, x) => s + x.count, 0),
    [rows]
  );
  const maxCount = groups[0]?.count ?? 0;
  const leaderCount = groups[0]?.count ?? 0;

  // Podium = first 3 score tiers; the rest chase below.
  const podiumGroups = groups.slice(0, 3);
  const restRows: Array<{ row: Row; rank: number }> = groups
    .slice(3)
    .flatMap((g) => g.rows.map((row) => ({ row, rank: g.rank })));

  // Everyone shares the same score → one single tier.
  const allTied = groups.length === 1 && rows.length > 1;

  // Visual order of the podium: silver — gold — bronze (winner centred).
  const podiumOrder: Array<{ group: Group; tier: number } | null> = [
    podiumGroups[1] ? { group: podiumGroups[1], tier: 1 } : null,
    podiumGroups[0] ? { group: podiumGroups[0], tier: 0 } : null,
    podiumGroups[2] ? { group: podiumGroups[2], tier: 2 } : null,
  ];

  function celebrate(row: Row, isWinner: boolean) {
    fireConfetti();
    toast(pick(CLICK_LINES, row.userId + burst).replace("{n}", row.nome || "Il venditore"), {
      icon: "🎉",
    });
    if (isWinner) setQuoteIdx((i) => i + 1);
  }

  // Witty subtitle that reacts to the standings (tie-aware).
  const standingLine = useMemo(() => {
    if (rows.length === 0) return "";
    if (rows.length === 1) return `${rows[0].nome} corre da solo… per ora. 🏃`;
    if (allTied)
      return "Pari merito assoluto: siete TUTTI primi. La giuria è commossa. 👏";
    const top = groups[0];
    if (top.rows.length > 1)
      return `${top.rows.length} campioni a pari merito in vetta — testa a testa! 🤝`;
    const gap = groups[0].count - groups[1].count;
    return `${rows[0].nome} comanda la corsa — ${gap} commess${
      gap === 1 ? "a" : "e"
    } di margine sul secondo. 🏁`;
  }, [rows, groups, allTied]);

  return (
    <div className="space-y-6">
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
        @keyframes classifica-pop {
          0%   { transform: scale(0.9); opacity: 0; }
          60%  { transform: scale(1.04); }
          100% { transform: scale(1); opacity: 1; }
        }
        .classifica-person:hover .classifica-avatar {
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
              "I commerciali in gara, ordinati per commesse attive. A pari punti, pari gloria. 🏆"}
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

      {/* ── Jury banner — big, loud, rotating jokes ───────────────────────── */}
      {!classifica.isLoading && rows.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setJuryIdx((i) => i + 1);
            fireConfetti();
          }}
          title="Un'altra battuta, giuria!"
          className="group w-full text-left"
        >
          <Card className="overflow-hidden border-amber-300 bg-gradient-to-r from-amber-100 via-yellow-50 to-amber-100 transition-transform group-hover:-translate-y-0.5">
            <CardContent className="flex items-center gap-3 py-3 px-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-400 text-white shadow">
                <Mic className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">
                  Commento della giuria
                </p>
                <p
                  key={juryIdx}
                  className="text-sm font-semibold text-amber-950 sm:text-base"
                  style={{ animation: "classifica-pop 0.4s ease-out" }}
                >
                  {pick(JURY_COMMENTS, juryIdx)}
                </p>
              </div>
              <Badge variant="outline" className="hidden shrink-0 border-amber-400 text-amber-700 sm:inline-flex">
                tocca per altra 🎤
              </Badge>
            </CardContent>
          </Card>
        </button>
      )}

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

      {/* ── "Tutti primi" banner ──────────────────────────────────────────── */}
      {allTied && (
        <div
          className="rounded-2xl border-2 border-dashed border-amber-400 bg-amber-50 px-4 py-3 text-center"
          style={{ animation: "classifica-pop 0.5s ease-out" }}
        >
          <p className="flex items-center justify-center gap-2 text-base font-extrabold text-amber-800">
            <Handshake className="h-5 w-5" />
            PARI MERITO TOTALE — SIETE TUTTI PRIMI! 🥇
          </p>
          <p className="text-xs text-amber-700">
            Stesso numero di commesse per tutti. Standing ovation della giuria. 👏
          </p>
        </div>
      )}

      {/* Podium */}
      {!classifica.isLoading && rows.length > 0 && (
        <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-b from-amber-50/60 via-background to-background p-4 sm:p-8">
          <Trophy className="pointer-events-none absolute -right-6 -top-6 h-40 w-40 text-amber-200/40" />

          <div className="relative flex items-end justify-center gap-3 sm:gap-6 flex-wrap">
            {podiumOrder.map((slot, i) =>
              slot ? (
                <PodiumStep
                  key={`tier-${slot.tier}`}
                  group={slot.group}
                  tier={slot.tier}
                  enterDelay={i * 0.12}
                  onCelebrate={celebrate}
                />
              ) : (
                <div key={i} className="hidden w-28 sm:block sm:w-36" />
              )
            )}
          </div>

          {/* Winner quote bubble */}
          {groups[0] && !allTied && groups[0].rows.length === 1 && (
            <div className="relative mt-6 flex justify-center">
              <button
                onClick={() => {
                  setQuoteIdx((q) => q + 1);
                  fireConfetti();
                }}
                className="max-w-md rounded-2xl border bg-card px-4 py-2.5 text-center shadow-sm transition-transform hover:-translate-y-0.5"
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

      {/* Inseguitori (rank tiers beyond the podium) */}
      {restRows.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Inseguitori
          </h2>
          {restRows.map(({ row, rank }, idx) => (
            <RestRow
              key={row.userId}
              row={row}
              rank={rank}
              isLast={idx === restRows.length - 1}
              maxCount={maxCount}
              leaderCount={leaderCount}
              onCelebrate={() => celebrate(row, false)}
            />
          ))}
        </div>
      )}

      {/* Footer — rotating fun fact */}
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

// ── Podium step (a whole score tier) ─────────────────────────────────────────

function PodiumStep({
  group,
  tier,
  enterDelay,
  onCelebrate,
}: {
  group: Group;
  tier: number;
  enterDelay: number;
  onCelebrate: (row: Row, isWinner: boolean) => void;
}) {
  const cfg = PLACE[tier];
  const isGold = tier === 0;
  const multi = group.rows.length > 1;

  return (
    <div
      className="flex flex-col items-center"
      style={{ animation: `classifica-rise 0.5s ease-out ${enterDelay}s both` }}
    >
      {/* Crown over the gold step */}
      {isGold && (
        <div
          className="mb-1"
          style={{ animation: "classifica-bob 2.2s ease-in-out infinite" }}
        >
          <Crown className="h-9 w-9 text-amber-400 drop-shadow" />
        </div>
      )}

      {/* People sharing this tier */}
      <div className="flex flex-wrap items-end justify-center gap-3 px-1">
        {group.rows.map((row) => (
          <PodiumPerson
            key={row.userId}
            row={row}
            cfg={cfg}
            isGold={isGold}
            big={!multi}
            onCelebrate={() => onCelebrate(row, isGold)}
          />
        ))}
      </div>

      {/* Witty tier title */}
      <span className="mt-1 max-w-[12rem] text-center text-[11px] font-bold text-amber-600">
        {multi ? cfg.titleMulti : cfg.titleSolo}
      </span>

      {/* Pedestal — width follows the people row above */}
      <div
        className={`mt-2 flex min-w-[6rem] ${cfg.height} w-full items-start justify-center rounded-t-lg bg-gradient-to-b ${cfg.pedestal} shadow-inner`}
      >
        <span
          className="mt-2 select-none text-3xl font-black text-white/90"
          style={{ textShadow: "0 2px 4px rgba(0,0,0,0.25)" }}
        >
          {group.rank}°
        </span>
      </div>
    </div>
  );
}

// ── A single person on the podium ────────────────────────────────────────────

function PodiumPerson({
  row,
  cfg,
  isGold,
  big,
  onCelebrate,
}: {
  row: Row;
  cfg: (typeof PLACE)[number];
  isGold: boolean;
  big: boolean;
  onCelebrate: () => void;
}) {
  const count = useCountUp(row.count);
  const avatarSize = big
    ? isGold
      ? "h-24 w-24 text-2xl"
      : "h-20 w-20 text-xl"
    : "h-16 w-16 text-base";

  return (
    <button
      type="button"
      onClick={onCelebrate}
      title="Cliccami per i coriandoli! 🎉"
      className="classifica-person flex w-24 cursor-pointer flex-col items-center sm:w-28"
    >
      <div
        className="relative"
        style={
          isGold
            ? { animation: "classifica-float 3s ease-in-out infinite" }
            : undefined
        }
      >
        {isGold && (
          <>
            <Sparkles
              className="absolute -left-4 top-1 h-4 w-4 text-amber-400"
              style={{ animation: "classifica-sparkle 1.6s ease-in-out infinite" }}
            />
            <Sparkles
              className="absolute -right-3 -top-2 h-5 w-5 text-yellow-400"
              style={{
                animation: "classifica-sparkle 1.9s ease-in-out 0.4s infinite",
              }}
            />
          </>
        )}
        <Avatar
          className={`classifica-avatar ${avatarSize} border-4 border-white shadow-lg ring-4 ${cfg.ring}`}
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

      <p className="mt-3 text-center text-sm font-bold leading-tight">
        {row.nome}
        <br />
        <span className="font-semibold text-muted-foreground">
          {row.cognome}
        </span>
      </p>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="text-xl font-extrabold tabular-nums">{count}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          commesse
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
  const label = isLast ? "Cucchiaio di legno 🥄" : pick(REST_LABELS, rank);

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
            <p className="truncate text-sm font-semibold">{fullName(row)}</p>
            <Badge
              variant="outline"
              className={`hidden shrink-0 text-[9px] sm:inline-flex ${
                isLast ? "border-amber-400 text-amber-700" : ""
              }`}
            >
              {label}
            </Badge>
          </div>
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
