import { trpc } from "@/lib/trpc";
import { formatEuroSimbolo } from "@/lib/euro";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MapPin,
  Calendar,
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Clock,
  Search,
  Filter,
  Eye,
  EyeOff,
  LayoutGrid,
  ChevronDown,
  ChevronUp,
  Package,
  HardHat,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import ConfirmDialog from "@/components/ConfirmDialog";
import { PRIORITA_VARIANT, PRIORITA_LABEL } from "@/lib/stato";

type ColonnaConfig = {
  id: string;
  label: string;
  short: string;
  dot: string;
  accent: string;
  ring: string;
};

type FaseConfig = {
  id: string;
  label: string;
  description: string;
  colonne: ReadonlyArray<ColonnaConfig>;
};

const FASI: ReadonlyArray<FaseConfig> = [
  {
    id: "vendita",
    label: "Vendita",
    description: "Dal preventivo alla conferma",
    colonne: [
      { id: "preventivo",              label: "Preventivo",              short: "Preventivo",     dot: "bg-st-preventivo",  accent: "bg-slate-50",  ring: "border-slate-200" },
      { id: "misure_esecutive",        label: "Misure Esecutive",        short: "Misure",         dot: "bg-st-preventivo",  accent: "bg-blue-50",   ring: "border-blue-200" },
      { id: "aggiornamento_contratto", label: "Aggiornamento Contratto", short: "Agg. Contratto", dot: "bg-st-preventivo",  accent: "bg-cyan-50",   ring: "border-cyan-200" },
    ],
  },
  {
    id: "ordine",
    label: "Ordine & Produzione",
    description: "Fatturazione, ordine, costruzione",
    colonne: [
      { id: "fatture_pagamento",       label: "Fatture / Pagamento",     short: "Fatture",        dot: "bg-st-ordine",  accent: "bg-amber-50",  ring: "border-amber-200" },
      { id: "da_ordinare",             label: "Da Ordinare",             short: "Da Ordinare",    dot: "bg-st-ordine", accent: "bg-yellow-50", ring: "border-yellow-200" },
      { id: "produzione",              label: "Produzione",              short: "Produzione",     dot: "bg-st-ordine", accent: "bg-indigo-50", ring: "border-indigo-200" },
    ],
  },
  {
    id: "consegna",
    label: "Consegna & Posa",
    description: "Secondo acconto, attesa, posa",
    colonne: [
      { id: "ordini_ultimazione",      label: "Richiesta Secondo Acconto", short: "2° Acconto",   dot: "bg-st-produzione", accent: "bg-purple-50", ring: "border-purple-200" },
      { id: "attesa_posa",             label: "Attesa Posa",             short: "Attesa Posa",    dot: "bg-st-produzione", accent: "bg-orange-50", ring: "border-orange-200" },
    ],
  },
  {
    id: "chiusura",
    label: "Chiusura",
    description: "Saldo e interventi finali",
    colonne: [
      { id: "finiture_saldo",          label: "Finiture / Saldo",        short: "Finiture",       dot: "bg-st-pagamento",  accent: "bg-green-50",  ring: "border-green-200" },
      { id: "interventi_regolazioni",  label: "Interventi / Regolaz.",   short: "Interventi",     dot: "bg-st-pagamento",   accent: "bg-teal-50",   ring: "border-teal-200" },
    ],
  },
];

// Flat list derived from FASI — preserves stato order for prev/next navigation
const COLONNE_FLAT: ReadonlyArray<ColonnaConfig> = FASI.flatMap((f) => f.colonne);

const prioritaOrder: Record<string, number> = { urgente: 0, alta: 1, media: 2, bassa: 3 };

// Solid left-edge color per priority — makes the card priority readable
// without parsing the badge.
const PRIORITA_EDGE: Record<string, string> = {
  urgente: "var(--color-danger)",
  alta: "var(--color-warning)",
  media: "var(--primary)",
  bassa: "var(--color-text-3)",
};

// Columns show at most this many cards; the rest collapse behind
// "Mostra altre N" so a busy column doesn't force endless scrolling.
const VISIBLE_LIMIT = 5;

function daysSince(date: string | Date): number {
  return Math.floor(
    Math.abs(Date.now() - new Date(date).getTime()) / 86400000
  );
}

export default function KanbanBoard() {
  const [, setLocation] = useLocation();
  const commesse = trpc.commesse.list.useQuery({});
  // Warehouse products per commessa — shown on the card so posa can be
  // planned around real material arrivals.
  const magazzino = trpc.magazzino.list.useQuery({});
  const squadre = trpc.squadre.list.useQuery();
  const squadreById = useMemo(() => {
    const m = new Map<number, any>();
    for (const s of squadre.data ?? []) m.set(s.id, s);
    return m;
  }, [squadre.data]);
  const utils = trpc.useUtils();

  const prodottiByCommessa = useMemo(() => {
    const map = new Map<number, any[]>();
    for (const p of magazzino.data ?? []) {
      if (!map.has(p.commessaId)) map.set(p.commessaId, []);
      map.get(p.commessaId)!.push(p);
    }
    return map;
  }, [magazzino.data]);

  const [consegnaTarget, setConsegnaTarget] = useState<{ id: number; codice: string } | null>(null);
  const [consegnaDate, setConsegnaDate] = useState("");
  const [search, setSearch] = useState("");
  const [filtroPriorita, setFiltroPriorita] = useState<string>("tutte");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [faseFiltro, setFaseFiltro] = useState<string>("tutte");
  const [fasiCollapsed, setFasiCollapsed] = useState<Record<string, boolean>>({});
  // Columns the operator expanded past VISIBLE_LIMIT.
  const [expandedCols, setExpandedCols] = useState<Record<string, boolean>>({});
  const [moveError, setMoveError] = useState<string | null>(null);
  // "Procedi comunque" confirmation for file-gate bypass. Fires when the
  // server rejects a forward transition with a `DOC_GATE_BLOCKED:` prefixed
  // error — the operator can confirm to retry with `force: true`, or cancel
  // and upload the file first.
  const [forceMoveTarget, setForceMoveTarget] = useState<{
    commessaId: number;
    newStato: string;
    message: string;
  } | null>(null);

  const DOC_GATE_PREFIX = "DOC_GATE_BLOCKED:";

  const updateCommessa = trpc.commesse.update.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      setMoveError(null);
      setForceMoveTarget(null);
    },
    onError: (err, variables) => {
      const msg = err.message ?? "";
      if (msg.startsWith(DOC_GATE_PREFIX) && variables?.stato) {
        // Surface the confirm dialog instead of a generic error — the
        // operator can decide to proceed without the file.
        setForceMoveTarget({
          commessaId: variables.id,
          newStato: variables.stato as string,
          message: msg.slice(DOC_GATE_PREFIX.length).trim(),
        });
        setMoveError(null);
      } else {
        setMoveError(msg || "Errore spostamento");
      }
    },
  });

  const confermaDataConsegna = trpc.commesse.confermaDataConsegna.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      setConsegnaTarget(null);
      setConsegnaDate("");
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (commesse.data ?? []).filter((c: any) => {
      if (filtroPriorita !== "tutte" && c.priorita !== filtroPriorita) return false;
      if (q) {
        const hay = `${c.codice ?? ""} ${c.cliente ?? ""} ${c.citta ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [commesse.data, search, filtroPriorita]);

  const byStato = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const col of COLONNE_FLAT) map[col.id] = [];
    for (const c of filtered) {
      if (map[c.stato]) map[c.stato].push(c);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => {
        const pa = prioritaOrder[a.priorita] ?? 9;
        const pb = prioritaOrder[b.priorita] ?? 9;
        if (pa !== pb) return pa - pb;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    }
    return map;
  }, [filtered]);

  const totals = useMemo(() => {
    const list = commesse.data ?? [];
    const active = list.filter((c: any) => c.stato !== "archiviata");
    const urgenti = active.filter((c: any) => c.priorita === "urgente").length;
    const alte = active.filter((c: any) => c.priorita === "alta").length;
    const inProduzione = active.filter((c: any) => c.stato === "produzione" && !c.dataConsegnaConfermata).length;
    return { total: active.length, urgenti, alte, inProduzione };
  }, [commesse.data]);

  function handleMove(commessaId: number, newStato: string) {
    setMoveError(null);
    updateCommessa.mutate({ id: commessaId, stato: newStato as any });
  }

  const fasiVisibili = FASI.filter(
    (f) => faseFiltro === "tutte" || faseFiltro === f.id
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-[28px] leading-[34px] font-bold tracking-[-0.02em] flex items-center gap-2">
            <LayoutGrid className="h-6 w-6 text-primary" />
            Board Commesse
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Flusso per fasi — scorri verticalmente per vedere tutto
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Card className="px-3 py-2 gap-0">
            <div className="eyebrow">Attive</div>
            <div className="text-xl font-bold leading-none mt-1 tabular-nums">{totals.total}</div>
          </Card>
          <Card className="px-3 py-2 gap-0 border-danger/30">
            <div className="eyebrow !text-danger">Urgenti</div>
            <div className="text-xl font-bold leading-none mt-1 tabular-nums text-danger">{totals.urgenti}</div>
          </Card>
          <Card className="px-3 py-2 gap-0 border-warning/30">
            <div className="eyebrow !text-warning">Alte</div>
            <div className="text-xl font-bold leading-none mt-1 tabular-nums text-warning">{totals.alte}</div>
          </Card>
          <Card className="px-3 py-2 gap-0 border-warning/30">
            <div className="eyebrow !text-warning">Consegne da confermare</div>
            <div className="text-xl font-bold leading-none mt-1 tabular-nums text-warning">{totals.inProduzione}</div>
          </Card>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cerca codice, cliente, città..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Select value={filtroPriorita} onValueChange={setFiltroPriorita}>
          <SelectTrigger className="w-[170px] h-9" aria-label="Filtra per priorità">
            <Filter className="h-3.5 w-3.5 mr-1.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tutte">Tutte le priorità</SelectItem>
            <SelectItem value="urgente">Urgente</SelectItem>
            <SelectItem value="alta">Alta</SelectItem>
            <SelectItem value="media">Media</SelectItem>
            <SelectItem value="bassa">Bassa</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setHideEmpty((v) => !v)}
          className="h-9"
        >
          {hideEmpty ? <Eye className="h-3.5 w-3.5 mr-1.5" /> : <EyeOff className="h-3.5 w-3.5 mr-1.5" />}
          {hideEmpty ? "Mostra vuote" : "Nascondi vuote"}
        </Button>
      </div>

      {/* Phase chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Button
          variant={faseFiltro === "tutte" ? "default" : "outline"}
          size="sm"
          className="h-8 text-xs"
          onClick={() => setFaseFiltro("tutte")}
        >
          Tutte le fasi
        </Button>
        {FASI.map((f) => {
          const count = f.colonne.reduce((s, c) => s + (byStato[c.id]?.length ?? 0), 0);
          return (
            <Button
              key={f.id}
              variant={faseFiltro === f.id ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setFaseFiltro(f.id)}
            >
              {f.label}
              <Badge variant="secondary" className="ml-1.5 h-4 px-1.5 text-[10px]">
                {count}
              </Badge>
            </Button>
          );
        })}
      </div>

      {moveError && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="p-3 text-sm text-red-800 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {moveError}
          </CardContent>
        </Card>
      )}

      {/* Phase stacks */}
      <div className="space-y-4">
        {fasiVisibili.map((fase) => {
          const colonne = hideEmpty
            ? fase.colonne.filter((c) => (byStato[c.id]?.length ?? 0) > 0)
            : fase.colonne;
          if (colonne.length === 0) return null;

          const fasePz = fase.colonne.reduce((s, c) => s + (byStato[c.id]?.length ?? 0), 0);
          const faseUrgenti = fase.colonne.reduce(
            (s, c) => s + (byStato[c.id]?.filter((x: any) => x.priorita === "urgente").length ?? 0),
            0
          );
          const collapsed = fasiCollapsed[fase.id];

          return (
            <section
              key={fase.id}
              className="rounded-xl border bg-card/30"
            >
              {/* Phase header */}
              <button
                onClick={() => setFasiCollapsed((m) => ({ ...m, [fase.id]: !m[fase.id] }))}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors rounded-t-xl"
                aria-label={collapsed ? "Espandi fase" : "Comprimi fase"}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <h2 className="text-sm font-bold uppercase tracking-wide">{fase.label}</h2>
                  <span className="text-xs text-muted-foreground hidden sm:inline">· {fase.description}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {faseUrgenti > 0 && (
                    <Badge className="bg-red-100 text-red-800 text-[10px] h-5 px-1.5">
                      <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                      {faseUrgenti}
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-[11px] h-5">{fasePz}</Badge>
                  {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                </div>
              </button>

              {!collapsed && (
                <div className="px-3 pb-3">
                  <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
                    {colonne.map((col) => {
                      const items = byStato[col.id] ?? [];
                      const allColIdx = COLONNE_FLAT.findIndex((c) => c.id === col.id);
                      const prevCol = allColIdx > 0 ? COLONNE_FLAT[allColIdx - 1] : null;
                      const nextCol = allColIdx < COLONNE_FLAT.length - 1 ? COLONNE_FLAT[allColIdx + 1] : null;
                      const prevStato = prevCol?.id ?? null;
                      const nextStato = nextCol?.id ?? null;
                      const urgentiCount = items.filter((c: any) => c.priorita === "urgente").length;

                      return (
                        <div key={col.id} className="flex flex-col min-w-0">
                          {/* Column header */}
                          <div className={`flex items-center gap-2 rounded-t-lg border border-b-0 px-3 py-2 ${col.accent} ${col.ring}`}>
                            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${col.dot}`} />
                            <span className="text-xs font-semibold uppercase tracking-wide truncate flex-1">
                              {col.label}
                            </span>
                            {urgentiCount > 0 && (
                              <Badge className="bg-red-100 text-red-800 text-[10px] h-5 px-1.5 shrink-0">
                                <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                                {urgentiCount}
                              </Badge>
                            )}
                            <Badge variant="secondary" className="text-[11px] h-5 shrink-0">
                              {items.length}
                            </Badge>
                          </div>

                          {/* Cards container */}
                          <div className={`flex-1 space-y-2 min-h-[120px] bg-muted/10 rounded-b-lg border border-t-0 p-2 ${col.ring}`}>
                            {(expandedCols[col.id]
                              ? items
                              : items.slice(0, VISIBLE_LIMIT)
                            ).map((c: any) => {
                              const isProduzione = c.stato === "produzione";
                              const needsConsegna = isProduzione && !c.dataConsegnaConfermata;
                              const fermo = daysSince(c.updatedAt);
                              return (
                                <Card
                                  key={c.id}
                                  className={`cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all ${
                                    needsConsegna ? "ring-2 ring-amber-400" : ""
                                  }`}
                                  style={{
                                    borderLeftColor:
                                      PRIORITA_EDGE[c.priorita] ?? "#94a3b8",
                                    borderLeftWidth: 3,
                                  }}
                                  onClick={() => setLocation(`/commesse/${c.id}`)}
                                >
                                  <CardContent className="p-2.5 space-y-1.5">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="codice-mono text-[10px] text-text-3 truncate">
                                        {c.codice}
                                      </span>
                                      <span className="flex items-center gap-1 shrink-0">
                                        {fermo >= 5 && (
                                          <span
                                            title={`Nessun aggiornamento da ${fermo} giorni`}
                                            className={`inline-flex items-center gap-0.5 rounded px-1 py-px text-[9px] font-bold ${
                                              fermo >= 10
                                                ? "bg-danger-soft text-danger"
                                                : "bg-warning-soft text-warning"
                                            }`}
                                          >
                                            <Clock className="h-2.5 w-2.5" />
                                            {fermo}gg
                                          </span>
                                        )}
                                        <Badge variant={PRIORITA_VARIANT[c.priorita] ?? "secondary"}>
                                          {c.priorita === "urgente" && <AlertTriangle className="h-2.5 w-2.5" />}
                                          {PRIORITA_LABEL[c.priorita] ?? c.priorita}
                                        </Badge>
                                      </span>
                                    </div>

                                    <p className="text-sm font-semibold leading-tight truncate" title={c.cliente}>
                                      {c.cliente}
                                    </p>

                                    {c.citta && (
                                      <p className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
                                        <MapPin className="h-3 w-3 shrink-0" />
                                        {c.citta}
                                      </p>
                                    )}

                                    {c.dataConsegnaConfermata ? (
                                      <div className="flex items-center gap-1 text-[11px] font-medium text-green-700 bg-green-50 rounded px-1.5 py-0.5">
                                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                                        Consegna: {new Date(c.dataConsegnaConfermata).toLocaleDateString("it-IT")}
                                      </div>
                                    ) : c.consegnaIndicativa ? (
                                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                        <Calendar className="h-3 w-3 shrink-0" />
                                        Indicativa: +{c.consegnaIndicativa}gg
                                      </div>
                                    ) : null}

                                    {/* Squadra di posa: chi va in cantiere.
                                        Solo dalle fasi di posa in poi, dove
                                        la domanda è viva; se manca lo dice. */}
                                    {(() => {
                                      const FASI_POSA = ["attesa_posa", "finiture_saldo", "interventi_regolazioni"];
                                      if (!FASI_POSA.includes(c.stato)) return null;
                                      const sq = squadreById.get((c as any).squadraId);
                                      return sq ? (
                                        <div className="flex items-center gap-1 text-[11px] text-info bg-info-soft rounded px-1.5 py-0.5">
                                          <HardHat className="h-3 w-3 shrink-0" />
                                          <span className="truncate">{sq.nome}</span>
                                        </div>
                                      ) : (
                                        <div className="flex items-center gap-1 text-[11px] text-warning bg-warning-soft rounded px-1.5 py-0.5">
                                          <HardHat className="h-3 w-3 shrink-0" />
                                          Squadra da assegnare
                                        </div>
                                      );
                                    })()}

                                    {(() => {
                                      // Sul Board niente cifre: solo il bit
                                      // `daSaldare` del server (slice 2,
                                      // decisione direzione 28/08/2026). Gli
                                      // importi vivono in /pagamenti e nella
                                      // scheda, dietro capability.
                                      const FASI_SALDO = ["attesa_posa", "finiture_saldo", "interventi_regolazioni"];
                                      if (!(c as any).daSaldare || !FASI_SALDO.includes(c.stato)) return null;
                                      return (
                                        <div className="flex items-center gap-1 text-[11px] font-semibold text-danger bg-danger-soft rounded px-1.5 py-0.5">
                                          Da saldare
                                        </div>
                                      );
                                    })()}

                                    {(() => {
                                      const prods = prodottiByCommessa.get(c.id) ?? [];
                                      if (prods.length === 0) return null;
                                      const today = new Date().toISOString().split("T")[0];
                                      const shortDate = (iso: string | null) =>
                                        iso
                                          ? new Date(iso + "T12:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })
                                          : "—";
                                      return (
                                        <div className="space-y-0.5 rounded bg-surface-2/70 border border-border/60 px-1.5 py-1">
                                          {prods.slice(0, 2).map((p: any) => {
                                            const late = !p.arrivato && p.dataConsegna && p.dataConsegna < today;
                                            return (
                                              <div
                                                key={p.id}
                                                title={`${p.nome} ×${p.quantita}${p.fornitore ? ` — ${p.fornitore}` : ""}${p.arrivato ? " (arrivato)" : late ? " (in ritardo)" : ""}`}
                                                className={`flex items-center gap-1 text-[10px] leading-tight ${
                                                  p.arrivato
                                                    ? "text-success"
                                                    : late
                                                    ? "text-danger font-semibold"
                                                    : "text-text-2"
                                                }`}
                                              >
                                                <Package className="h-2.5 w-2.5 shrink-0" />
                                                <span className="truncate flex-1">{p.nome}</span>
                                                <span className="tabular-nums shrink-0">
                                                  {p.arrivato ? "✓" : shortDate(p.dataConsegna)}
                                                </span>
                                              </div>
                                            );
                                          })}
                                          {prods.length > 2 && (
                                            <div className="text-[9px] text-text-3 pl-3.5">
                                              +{prods.length - 2} altri prodotti
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })()}

                                    {needsConsegna && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7 w-full text-[10px] border-amber-400 text-amber-700 hover:bg-amber-50"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setConsegnaTarget({ id: c.id, codice: c.codice });
                                          setConsegnaDate("");
                                        }}
                                      >
                                        <Clock className="h-3 w-3 mr-1" />
                                        Aggiorna data consegna
                                      </Button>
                                    )}

                                    <div className="grid grid-cols-2 gap-1.5 pt-2 mt-1 border-t">
                                      {prevCol ? (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleMove(c.id, prevCol.id);
                                          }}
                                          title={`Torna a ${prevCol.label}`}
                                          className="group inline-flex h-10 flex-col items-center justify-center gap-0 rounded-md border border-slate-300 bg-slate-50 px-1.5 py-1 leading-tight text-slate-700 transition-all hover:border-slate-400 hover:bg-slate-100 hover:shadow-sm active:scale-[0.98]"
                                        >
                                          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wide">
                                            <ChevronLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
                                            Indietro
                                          </span>
                                          <span className="block w-full truncate text-[9px] font-normal text-slate-500">
                                            {prevCol.short}
                                          </span>
                                        </button>
                                      ) : (
                                        <div />
                                      )}
                                      {nextCol ? (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleMove(c.id, nextCol.id);
                                          }}
                                          title={`Avanza a ${nextCol.label}`}
                                          className="group inline-flex h-10 flex-col items-center justify-center gap-0 rounded-md border border-success bg-success px-1.5 py-1 leading-tight text-white shadow-sm transition-all hover:bg-success/90 hover:shadow-md active:scale-[0.98]"
                                        >
                                          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wide">
                                            Avanza
                                            <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                                          </span>
                                          <span className="block w-full truncate text-[9px] font-normal opacity-90">
                                            {nextCol.short}
                                          </span>
                                        </button>
                                      ) : (
                                        <div />
                                      )}
                                    </div>
                                  </CardContent>
                                </Card>
                              );
                            })}
                            {items.length > VISIBLE_LIMIT && (
                              <button
                                onClick={() =>
                                  setExpandedCols((m) => ({
                                    ...m,
                                    [col.id]: !m[col.id],
                                  }))
                                }
                                className="w-full flex items-center justify-center gap-1 rounded-md border border-dashed border-border bg-surface py-1.5 text-[11px] font-semibold text-primary hover:bg-surface-2 transition-colors"
                              >
                                {expandedCols[col.id] ? (
                                  <>
                                    <ChevronUp className="h-3.5 w-3.5" />
                                    Mostra meno
                                  </>
                                ) : (
                                  <>
                                    <ChevronDown className="h-3.5 w-3.5" />
                                    Mostra altre {items.length - VISIBLE_LIMIT}
                                  </>
                                )}
                              </button>
                            )}
                            {items.length === 0 && (
                              <p className="text-[11px] text-text-3 text-center py-6">
                                Nessuna commessa in questa fase
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <Dialog open={!!consegnaTarget} onOpenChange={(o) => !o && setConsegnaTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Aggiorna data consegna — {consegnaTarget?.codice}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <p className="text-sm text-muted-foreground">
              Inserisci la data di consegna prevista confermata dal produttore. Sarà visibile sulla commessa nel board.
            </p>
            <div className="space-y-1.5">
              <Label>Data consegna</Label>
              <Input
                type="date"
                value={consegnaDate}
                onChange={(e) => setConsegnaDate(e.target.value)}
              />
            </div>
            <Button
              onClick={() => consegnaTarget && confermaDataConsegna.mutate({ id: consegnaTarget.id, dataConsegna: consegnaDate })}
              disabled={!consegnaDate || confermaDataConsegna.isPending}
            >
              Conferma data
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* "Procedi comunque" dialog — surfaces the server's DOC_GATE_BLOCKED
          message and retries the move with `force: true` on confirm. */}
      <ConfirmDialog
        open={!!forceMoveTarget}
        onOpenChange={(open) => !open && setForceMoveTarget(null)}
        title="File richiesto non caricato"
        description={forceMoveTarget?.message ?? ""}
        destructive={false}
        confirmLabel="Procedi comunque"
        onConfirm={() => {
          if (!forceMoveTarget) return;
          updateCommessa.mutate({
            id: forceMoveTarget.commessaId,
            stato: forceMoveTarget.newStato as any,
            force: true,
          });
        }}
      />
    </div>
  );
}
