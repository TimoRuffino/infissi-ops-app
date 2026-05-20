import { useMemo } from "react";
import { Trophy, Crown, Medal, Sparkles, TrendingUp, Users } from "lucide-react";

import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

// ── Helpers ──────────────────────────────────────────────────────────────────

type Row = { userId: number; nome: string; cognome: string; count: number };

function initials(nome: string, cognome: string): string {
  return `${nome?.[0] ?? ""}${cognome?.[0] ?? ""}`.toUpperCase() || "?";
}

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

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Classifica() {
  const classifica = trpc.commesse.classificaVenditori.useQuery();
  const rows: Row[] = (classifica.data ?? []) as Row[];

  const { top3, rest, totalCommesse, maxCount } = useMemo(() => {
    const t3 = rows.slice(0, 3);
    const r = rows.slice(3);
    const total = rows.reduce((s, x) => s + x.count, 0);
    const max = rows.reduce((m, x) => Math.max(m, x.count), 0);
    return { top3: t3, rest: r, totalCommesse: total, maxCount: max };
  }, [rows]);

  // Visual podium order: 2° — 1° — 3° so the winner stands in the centre.
  const podiumOrder: Array<{ row: Row; place: number } | null> = [
    top3[1] ? { row: top3[1], place: 1 } : null,
    top3[0] ? { row: top3[0], place: 0 } : null,
    top3[2] ? { row: top3[2], place: 2 } : null,
  ];

  return (
    <div className="space-y-8">
      {/* Local keyframes — dependency-free animations. */}
      <style>{`
        @keyframes classifica-bob {
          0%,100% { transform: translateY(0) rotate(-4deg); }
          50%     { transform: translateY(-7px) rotate(4deg); }
        }
        @keyframes classifica-rise {
          0%   { transform: translateY(28px) scale(0.96); opacity: 0; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes classifica-sparkle {
          0%,100% { transform: scale(0.6) rotate(0deg); opacity: 0.35; }
          50%     { transform: scale(1.15) rotate(25deg); opacity: 1; }
        }
        @keyframes classifica-shine {
          0%   { background-position: -160% 0; }
          100% { background-position: 260% 0; }
        }
      `}</style>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="h-7 w-7 text-amber-500" />
            Classifica Venditori
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            I commerciali in gara, ordinati per numero di commesse attive (da
            «Misure esecutive» in poi). Chi ne ha di più sale sul gradino più
            alto del podio. 🏆
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs gap-1">
            <Users className="h-3 w-3" />
            {rows.length} in gara
          </Badge>
          <Badge variant="secondary" className="text-xs gap-1">
            <TrendingUp className="h-3 w-3" />
            {totalCommesse} commesse
          </Badge>
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
              Nessun commerciale in gara. Aggiungi utenti con ruolo
              «commerciale» dalla pagina Utenti.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Podium */}
      {!classifica.isLoading && rows.length > 0 && (
        <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-b from-amber-50/60 via-background to-background p-6 sm:p-10">
          {/* faint backdrop trophy */}
          <Trophy className="pointer-events-none absolute -right-6 -top-6 h-40 w-40 text-amber-200/40" />

          <div className="relative flex items-end justify-center gap-3 sm:gap-6">
            {podiumOrder.map((slot, i) => {
              if (!slot) return <div key={i} className="w-24 sm:w-36" />;
              const { row, place } = slot;
              const cfg = PLACE[place];
              const isWinner = place === 0;
              return (
                <div
                  key={row.userId}
                  className="flex w-24 flex-col items-center sm:w-36"
                  style={{
                    animation: `classifica-rise 0.5s ease-out ${i * 0.12}s both`,
                  }}
                >
                  {/* Crown for the winner */}
                  {isWinner && (
                    <div
                      className="mb-1"
                      style={{
                        animation: "classifica-bob 2.2s ease-in-out infinite",
                      }}
                    >
                      <Crown className="h-9 w-9 text-amber-400 drop-shadow" />
                    </div>
                  )}

                  {/* Avatar + sparkles */}
                  <div className="relative">
                    {isWinner && (
                      <>
                        <Sparkles
                          className="absolute -left-5 top-1 h-4 w-4 text-amber-400"
                          style={{
                            animation:
                              "classifica-sparkle 1.6s ease-in-out infinite",
                          }}
                        />
                        <Sparkles
                          className="absolute -right-4 -top-2 h-5 w-5 text-yellow-400"
                          style={{
                            animation:
                              "classifica-sparkle 1.9s ease-in-out 0.4s infinite",
                          }}
                        />
                      </>
                    )}
                    <Avatar
                      className={`${cfg.avatar} border-4 border-white shadow-lg ring-4 ${cfg.ring}`}
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

                  {/* Name + count */}
                  <p className="mt-3 text-center text-sm font-bold leading-tight">
                    {row.nome}
                    <br />
                    <span className="font-semibold text-muted-foreground">
                      {row.cognome}
                    </span>
                  </p>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-2xl font-extrabold tabular-nums">
                      {row.count}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      commesse
                    </span>
                  </div>

                  {/* Pedestal */}
                  <div
                    className={`mt-2 flex w-full ${cfg.height} items-start justify-center rounded-t-lg bg-gradient-to-b ${cfg.pedestal} shadow-inner`}
                  >
                    <span
                      className="mt-2 select-none text-3xl font-black text-white/90"
                      style={{ textShadow: "0 2px 4px rgba(0,0,0,0.25)" }}
                    >
                      {place + 1}°
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Rest of the ranking (4° onwards) */}
      {rest.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Inseguitori
          </h2>
          {rest.map((row, idx) => {
            const rank = idx + 4;
            const pct = maxCount > 0 ? (row.count / maxCount) * 100 : 0;
            return (
              <Card key={row.userId} className="overflow-hidden">
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
                    <p className="truncate text-sm font-semibold">
                      {row.nome} {row.cognome}
                    </p>
                    {/* relative bar */}
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary/60 to-primary"
                        style={{ width: `${Math.max(pct, 4)}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-baseline gap-1 shrink-0">
                    <span className="text-xl font-bold tabular-nums">
                      {row.count}
                    </span>
                    <span className="text-[10px] uppercase text-muted-foreground">
                      commesse
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Playful footer when nobody has any active commessa yet */}
      {!classifica.isLoading && rows.length > 0 && totalCommesse === 0 && (
        <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
          <Medal className="h-4 w-4" />
          Gara ancora aperta — nessuno ha commesse attive. Che vinca il
          migliore! 🚀
        </p>
      )}
    </div>
  );
}
