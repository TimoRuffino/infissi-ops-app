import { trpc } from "@/lib/trpc";
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
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";

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
      { id: "preventivo",              label: "Preventivo",              short: "Preventivo",     dot: "bg-slate-500",  accent: "bg-slate-50",  ring: "border-slate-200" },
      { id: "misure_esecutive",        label: "Misure Esecutive",        short: "Misure",         dot: "bg-blue-500",   accent: "bg-blue-50",   ring: "border-blue-200" },
      { id: "aggiornamento_contratto", label: "Aggiornamento Contratto", short: "Agg. Contratto", dot: "bg-cyan-500",   accent: "bg-cyan-50",   ring: "border-cyan-200" },
    ],
  },
  {
    id: "ordine",
    label: "Ordine & Produzione",
    description: "Fatturazione, ordine, costruzione",
    colonne: [
      { id: "fatture_pagamento",       label: "Fatture / Pagamento",     short: "Fatture",        dot: "bg-amber-500",  accent: "bg-amber-50",  ring: "border-amber-200" },
      { id: "da_ordinare",             label: "Da Ordinare",             short: "Da Ordinare",    dot: "bg-yellow-500", accent: "bg-yellow-50", ring: "border-yellow-200" },
      { id: "produzione",              label: "Produzione",              short: "Produzione",     dot: "bg-indigo-500", accent: "bg-indigo-50", ring: "border-indigo-200" },
    ],
  },
  {
    id: "consegna",
    label: "Consegna & Posa",
    description: "Secondo acconto, attesa, posa",
    colonne: [
      { id: "ordini_ultimazione",      label: "Richiesta Secondo Acconto", short: "2° Acconto",   dot: "bg-purple-500", accent: "bg-purple-50", ring: "border-purple-200" },
      { id: "attesa_posa",             label: "Attesa Posa",             short: "Attesa Posa",    dot: "bg-orange-500", accent: "bg-orange-50", ring: "border-orange-200" },
    ],
  },
  {
    id: "chiusura",
    label: "Chiusura",
    description: "Saldo e interventi finali",
    colonne: [
      { id: "finiture_saldo",          label: "Finiture / Saldo",        short: "Finiture",       dot: "bg-green-500",  accent: "bg-green-50",  ring: "border-green-200" },
      { id: "interventi_regolazioni",  label: "Interventi / Regolaz.",   short: "Interventi",     dot: "bg-teal-500",   accent: "bg-teal-50",   ring: "border-teal-200" },
    ],
  },
];

// Flat list derived from FASI — preserves stato order for prev/next navigation
const COLONNE_FLAT: ReadonlyArray<ColonnaConfig> = FASI.flatMap((f) => f.colonne);

const prioritaColors: Record<string, string> = {
  urgente: "bg-red-100 text-red-800 border-red-200",
  alta:    "bg-orange-100 text-orange-800 border-orange-200",
  media:   "bg-slate-100 text-slate-700 border-slate-200",
  bassa:   "bg-slate-50 text-slate-500 border-slate-200",
};

const prioritaOrder: Record<string, number> = { urgente: 0, alta: 1, media: 2, bassa: 3 };

export default function KanbanBoard() {
  const [, setLocation] = useLocation();
  const commesse = trpc.commesse.list.useQuery({});
  const utils = trpc.useUtils();

  const [consegnaTarget, setConsegnaTarget] = useState<{ id: number; codice: string } | null>(null);
  const [consegnaDate, setConsegnaDate] = useState("");
  const [search, setSearch] = useState("");
  const [filtroPriorita, setFiltroPriorita] = useState<string>("tutte");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [faseFiltro, setFaseFiltro] = useState<string>("tutte");
  const [fasiCollapsed, setFasiCollapsed] = useState<Record<string, boolean>>({});
  const [moveError, setMoveError] = useState<string | null>(null);

  const updateCommessa = trpc.commesse.update.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      setMoveError(null);
    },
    onError: (err) => setMoveError(err.message ?? "Errore spostamento"),
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
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <LayoutGrid className="h-6 w-6" />
            Board Commesse
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Flusso per fasi — scorri verticalmente per vedere tutto
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Card className="px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Attive</div>
            <div className="text-xl font-bold leading-none mt-1">{totals.total}</div>
          </Card>
          <Card className="px-3 py-2 border-red-200">
            <div className="text-[10px] uppercase tracking-wide text-red-600">Urgenti</div>
            <div className="text-xl font-bold leading-none mt-1 text-red-700">{totals.urgenti}</div>
          </Card>
          <Card className="px-3 py-2 border-orange-200">
            <div className="text-[10px] uppercase tracking-wide text-orange-600">Alte</div>
            <div className="text-xl font-bold leading-none mt-1 text-orange-700">{totals.alte}</div>
          </Card>
          <Card className="px-3 py-2 border-amber-200">
            <div className="text-[10px] uppercase tracking-wide text-amber-600">Consegne da confermare</div>
            <div className="text-xl font-bold leading-none mt-1 text-amber-700">{totals.inProduzione}</div>
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
          <SelectTrigger className="w-[170px] h-9">
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
                            {items.map((c: any) => {
                              const isProduzione = c.stato === "produzione";
                              const needsConsegna = isProduzione && !c.dataConsegnaConfermata;
                              return (
                                <Card
                                  key={c.id}
                                  className={`cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all ${
                                    needsConsegna ? "ring-2 ring-amber-400" : ""
                                  }`}
                                  onClick={() => setLocation(`/commesse/${c.id}`)}
                                >
                                  <CardContent className="p-2.5 space-y-1.5">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-mono text-[10px] text-muted-foreground truncate">
                                        {c.codice}
                                      </span>
                                      <Badge className={`text-[9px] px-1.5 py-0 border ${prioritaColors[c.priorita] ?? ""}`}>
                                        {c.priorita === "urgente" && <AlertTriangle className="h-2 w-2 mr-0.5" />}
                                        {c.priorita?.toUpperCase() ?? ""}
                                      </Badge>
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
                                          className="group inline-flex h-10 flex-col items-center justify-center gap-0 rounded-md border border-emerald-600 bg-emerald-600 px-1.5 py-1 leading-tight text-white shadow-sm transition-all hover:bg-emerald-700 hover:shadow-md active:scale-[0.98]"
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
                            {items.length === 0 && (
                              <p className="text-[11px] text-muted-foreground text-center py-6 italic">
                                Nessuna commessa
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
    </div>
  );
}
