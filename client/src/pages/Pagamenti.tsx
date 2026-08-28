import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Banknote, Search, Plus, CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import StatoChip from "@/components/StatoChip";
import { TIPO_PAGAMENTO_LABEL, tipoPagamentoSuggerito } from "./CommessaDetail";
import { formatEuro, parseEuroPositivo } from "@/lib/euro";
import BreakEvenPanel from "@/components/economia/BreakEvenPanel";

const METODO_LABEL: Record<string, string> = {
  bonifico: "Bonifico",
  contanti: "Contanti",
  assegno: "Assegno",
  pos: "POS",
  finanziamento: "Finanziamento",
  altro: "Altro",
};

const fmt = formatEuro;

/**
 * L'anno di una commessa.
 *
 * `dataApertura` e' il dato giusto quando c'e'; il codice `COM-2026-035` lo
 * porta comunque scritto dentro, e resta l'unica fonte per i fascicoli
 * vecchi senza data. `createdAt` e' l'ultima spiaggia.
 */
function annoCommessa(c: any): number | null {
  const apertura = String(c?.dataApertura ?? "").slice(0, 4);
  if (/^\d{4}$/.test(apertura)) return Number(apertura);
  const daCodice = /^COM-(\d{4})-/i.exec(String(c?.codice ?? ""));
  if (daCodice) return Number(daCodice[1]);
  const creata = c?.createdAt ? new Date(c.createdAt) : null;
  return creata && !Number.isNaN(creata.getTime()) ? creata.getFullYear() : null;
}

const fmtData = (iso: string | null) =>
  iso ? new Date(iso + (String(iso).length === 10 ? "T12:00:00" : "")).toLocaleDateString("it-IT") : "—";

export default function Pagamenti() {
  const [, setLocation] = useLocation();
  const commesse = trpc.commesse.list.useQuery({});
  const recenti = trpc.commesse.pagamentiRecenti.useQuery({ limit: 12 });
  const utils = trpc.useUtils();

  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState<string>("residuo");
  // "tutti" resta il default: questa pagina serve a incassare, e un residuo
  // del 2025 e' esattamente quello che non va nascosto per distrazione.
  const [anno, setAnno] = useState<string>("tutti");
  // Quick-register dialog target.
  const [regFor, setRegFor] = useState<any>(null);
  const [pForm, setPForm] = useState({
    importo: "",
    data: new Date().toISOString().split("T")[0],
    metodo: "bonifico",
    tipo: "",
    note: "",
  });

  const addPagamento = trpc.commesse.addPagamento.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      setRegFor(null);
      setPForm((f) => ({ ...f, importo: "", note: "" }));
      toast.success("Acconto registrato");
    },
    onError: (e) => toast.error(e.message ?? "Registrazione non riuscita"),
  });

  const tutteAttive = useMemo(
    () =>
      (commesse.data ?? []).filter(
        (c: any) => !c.archivedAt && c.stato !== "archiviata"
      ),
    [commesse.data]
  );

  const anni = useMemo(() => {
    const trovati = new Set<number>();
    for (const c of tutteAttive as any[]) {
      const a = annoCommessa(c);
      if (a != null) trovati.add(a);
    }
    return Array.from(trovati).sort((a, b) => b - a);
  }, [tutteAttive]);

  // Anno scelto: filtra TUTTO, righe e KPI insieme. Un totale che parla di
  // un perimetro diverso dall'elenco sotto e' peggio di nessun totale.
  const attive = useMemo(
    () =>
      anno === "tutti"
        ? tutteAttive
        : tutteAttive.filter((c: any) => annoCommessa(c) === Number(anno)),
    [tutteAttive, anno]
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return attive
      .map((c: any) => {
        const tot = c.importoTotale ?? null;
        const inc = c.importoIncassato ?? 0;
        const residuo = (tot ?? 0) - inc;
        return { c, tot, inc, residuo, pct: tot ? Math.min(100, Math.round((inc / tot) * 100)) : 0 };
      })
      .filter(({ c, tot, residuo }) => {
        if (q && !`${c.codice ?? ""} ${c.cliente ?? ""}`.toLowerCase().includes(q)) return false;
        if (filtro === "residuo") return !!tot && residuo > 0;
        if (filtro === "saldate") return !!tot && residuo === 0;
        if (filtro === "sovrapagate") return !!tot && residuo < 0;
        if (filtro === "senza") return !tot;
        return true;
      })
      .sort((a, b) => b.residuo - a.residuo);
  }, [attive, search, filtro]);

  const kpi = useMemo(() => {
    const conImporto = attive.filter((c: any) => c.importoTotale);
    const tot = conImporto.reduce((s: number, c: any) => s + (c.importoTotale ?? 0), 0);
    const inc = conImporto.reduce((s: number, c: any) => s + (c.importoIncassato ?? 0), 0);
    // Da incassare = somma dei residui POSITIVI commessa per commessa.
    // Prima era max(0, tot − inc) sugli aggregati: una commessa incassata in
    // eccesso cancellava il debito di un'altra, e il totale da incassare
    // usciva più basso del vero.
    let residuo = 0;
    let eccedenza = 0;
    let sovrapagate = 0;
    for (const c of conImporto as any[]) {
      const d = (c.importoTotale ?? 0) - (c.importoIncassato ?? 0);
      if (d > 0) residuo += d;
      else if (d < 0) {
        eccedenza += -d;
        sovrapagate++;
      }
    }
    return {
      tot,
      inc,
      residuo,
      eccedenza,
      sovrapagate,
      senza: attive.length - conImporto.length,
    };
  }, [attive]);

  const chip = (p: number) => {
    if (!regFor?.tot) return;
    const val = Math.min(Math.round(regFor.tot * p), Math.max(0, regFor.residuo));
    setPForm((f) => ({ ...f, importo: String(val) }));
  };

  const parse = parseEuroPositivo;

  return (
    <div className="space-y-4">
      {/* Header + KPI */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-[28px] leading-[34px] font-bold tracking-[-0.02em] flex items-center gap-2">
            <Banknote className="h-6 w-6 text-primary" />
            Pagamenti
          </h1>
          <p className="text-text-2 text-sm mt-1">
            Incassi e saldi delle commesse attive della sede
            {anno === "tutti" ? ", tutti gli anni" : `, aperte nel ${anno}`} ·{" "}
            {attive.length} {attive.length === 1 ? "commessa" : "commesse"}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Card className="px-3 py-2 gap-0">
            <div className="eyebrow">Pattuito</div>
            <div className="text-xl font-bold leading-none mt-1 tabular-nums">
              € {fmt(kpi.tot)}
            </div>
          </Card>
          <Card className="px-3 py-2 gap-0 border-success/30">
            <div className="eyebrow !text-success">Incassato</div>
            <div className="text-xl font-bold leading-none mt-1 tabular-nums text-success">
              € {fmt(kpi.inc)}
            </div>
          </Card>
          <Card className="px-3 py-2 gap-0 border-warning/30">
            <div className="eyebrow !text-warning">Da incassare</div>
            <div className="text-xl font-bold leading-none mt-1 tabular-nums text-warning">
              € {fmt(kpi.residuo)}
            </div>
          </Card>
          <Card className="px-3 py-2 gap-0">
            <div className="eyebrow">Senza importo</div>
            <div className="text-xl font-bold leading-none mt-1 tabular-nums text-text-3">
              {kpi.senza}
            </div>
          </Card>
          {kpi.sovrapagate > 0 && (
            <Card
              className="px-3 py-2 gap-0 border-danger/30 cursor-pointer"
              onClick={() => setFiltro("sovrapagate")}
              title="Mostra le commesse incassate oltre il pattuito"
            >
              <div className="eyebrow !text-danger">Incassato in più</div>
              <div className="text-xl font-bold leading-none mt-1 tabular-nums text-danger">
                € {fmt(kpi.eccedenza)}
              </div>
            </Card>
          )}
        </div>
      </div>

      <BreakEvenPanel onReview={() => setLocation("/economia?tab=acquisti")} />

      {/* Ultimi incassi */}
      {(recenti.data?.length ?? 0) > 0 && (
        <Card className="border-l-[3px] border-l-success">
          <CardContent className="py-3 px-4">
            <p className="eyebrow !text-text-3 mb-2">Ultimi incassi</p>
            <div className="flex gap-2 flex-wrap">
              {recenti.data!.map((p: any) => (
                <button
                  key={`${p.commessaId}-${p.id}`}
                  onClick={() => setLocation(`/commesse/${p.commessaId}`)}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs hover:shadow-sm transition"
                >
                  <span className="font-bold tabular-nums text-success">
                    € {fmt(p.importo)}
                  </span>
                  <span className="text-text-2 truncate max-w-[140px]">{p.cliente}</span>
                  <span className="text-text-3 tabular-nums">{fmtData(p.data)}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search + filtri */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cerca codice o cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Select value={anno} onValueChange={setAnno}>
          <SelectTrigger className="h-9 w-[130px]" aria-label="Anno di apertura">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tutti">Tutti gli anni</SelectItem>
            {anni.map(a => (
              <SelectItem key={a} value={String(a)}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1 border border-border rounded-lg p-0.5 bg-surface-2">
          {[
            ["residuo", "Con residuo"],
            ["saldate", "Saldate"],
            ...(kpi.sovrapagate > 0 ? [["sovrapagate", "Incassato in più"]] : []),
            ["senza", "Senza importo"],
            ["tutte", "Tutte"],
          ].map(([k, label]) => (
            <Button
              key={k}
              variant={filtro === k ? "default" : "ghost"}
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => setFiltro(k)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* Rows */}
      <div className="space-y-2">
        {rows.map(({ c, tot, inc, residuo, pct }) => (
          <Card
            key={c.id}
            className={`transition-all hover:shadow-sm ${
              tot && residuo > 0
                ? "border-l-[3px] border-l-warning"
                : tot && residuo < 0
                  ? "border-l-[3px] border-l-danger"
                  : tot
                    ? "border-l-[3px] border-l-success"
                    : ""
            }`}
          >
            <CardContent className="py-3 px-4 flex items-center gap-4 flex-wrap">
              <button
                className="flex items-center gap-2.5 min-w-[220px] flex-1 text-left"
                onClick={() => setLocation(`/commesse/${c.id}`)}
              >
                <span className="codice-mono text-[11px] text-text-3 shrink-0">{c.codice}</span>
                <span className="text-sm font-semibold truncate">{c.cliente}</span>
                <StatoChip stato={c.stato} className="shrink-0" />
              </button>

              {tot ? (
                <>
                  <div className="text-right w-24 shrink-0">
                    <p className="text-[10px] uppercase tracking-wide text-text-3">Pattuito</p>
                    <p className="text-sm font-semibold tabular-nums">€ {fmt(tot)}</p>
                  </div>
                  <div className="w-40 shrink-0 hidden md:block">
                    <div className="flex justify-between text-[10px] text-text-3 mb-1">
                      <span>{pct}%</span>
                      <span>€ {fmt(inc)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                      <div
                        className={`h-full ${residuo > 0 ? "bg-warning" : "bg-success"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-right w-28 shrink-0">
                    <p className="text-[10px] uppercase tracking-wide text-text-3">Residuo</p>
                    {residuo > 0 ? (
                      <p className="text-base font-bold tabular-nums text-warning">
                        € {fmt(residuo)}
                      </p>
                    ) : residuo < 0 ? (
                      /* Incassato oltre il pattuito: prima veniva mostrato
                         come "Saldata" e l'eccedenza spariva dalla vista. */
                      <p className="text-sm font-bold tabular-nums text-danger">
                        +€ {fmt(-residuo)}
                        <span className="block text-[10px] font-normal">in più</span>
                      </p>
                    ) : (
                      <p className="inline-flex items-center gap-1 text-sm font-bold text-success">
                        <CheckCircle2 className="h-4 w-4" /> Saldata
                      </p>
                    )}
                  </div>
                  {residuo > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => {
                        setRegFor({ c, tot, residuo });
                        setPForm({
                          importo: "",
                          data: new Date().toISOString().split("T")[0],
                          metodo: "bonifico",
                          tipo: tipoPagamentoSuggerito(c.nPagamenti ?? 0),
                          note: "",
                        });
                      }}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Acconto
                    </Button>
                  )}
                </>
              ) : (
                <span className="text-xs text-text-3">
                  Nessun importo pattuito — impostalo dalla scheda commessa
                </span>
              )}
            </CardContent>
          </Card>
        ))}

        {rows.length === 0 && !commesse.isLoading && (
          <Card>
            <CardContent className="py-12 text-center text-sm text-text-2">
              <Banknote className="h-8 w-8 mx-auto mb-2 text-text-3" />
              Nessuna commessa per questo filtro.
            </CardContent>
          </Card>
        )}
      </div>

      {/* Quick-register dialog */}
      <Dialog open={!!regFor} onOpenChange={(o) => !o && setRegFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Registra acconto · {regFor?.c?.codice} — {regFor?.c?.cliente}
            </DialogTitle>
          </DialogHeader>
          {regFor && (
            <div className="grid gap-3 py-1">
              <p className="text-xs text-text-2">
                Residuo attuale:{" "}
                <span className="font-bold text-warning">€ {fmt(regFor.residuo)}</span>{" "}
                su € {fmt(regFor.tot)}
              </p>
              <div className="flex gap-1.5">
                {[0.5, 0.4, 0.1].map((p) => (
                  <Button
                    key={p}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => chip(p)}
                  >
                    {Math.round(p * 100)}%
                  </Button>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    setPForm((f) => ({ ...f, importo: String(regFor.residuo), tipo: "saldo" }))
                  }
                >
                  Salda tutto
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Importo € *</Label>
                  <Input
                    autoFocus
                    inputMode="decimal"
                    value={pForm.importo}
                    onChange={(e) => setPForm({ ...pForm, importo: e.target.value })}
                    className="h-9 tabular-nums"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Data</Label>
                  <Input
                    type="date"
                    value={pForm.data}
                    onChange={(e) => setPForm({ ...pForm, data: e.target.value })}
                    className="h-9"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Metodo</Label>
                  <Select
                    value={pForm.metodo}
                    onValueChange={(v) => setPForm({ ...pForm, metodo: v })}
                  >
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(METODO_LABEL).map(([k, l]) => (
                        <SelectItem key={k} value={k}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tipo</Label>
                  <Select
                    value={pForm.tipo || "__none"}
                    onValueChange={(v) => setPForm({ ...pForm, tipo: v === "__none" ? "" : v })}
                  >
                    <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">—</SelectItem>
                      {Object.entries(TIPO_PAGAMENTO_LABEL).map(([k, l]) => (
                        <SelectItem key={k} value={k}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nota</Label>
                <Input
                  placeholder="Facoltativa"
                  value={pForm.note}
                  onChange={(e) => setPForm({ ...pForm, note: e.target.value })}
                  className="h-9"
                />
              </div>
              <Button
                disabled={!parse(pForm.importo) || addPagamento.isPending}
                onClick={() =>
                  addPagamento.mutate({
                    commessaId: regFor.c.id,
                    importo: parse(pForm.importo)!,
                    data: pForm.data || null,
                    metodo: pForm.metodo as any,
                    tipo: (pForm.tipo || null) as any,
                    note: pForm.note.trim() || undefined,
                  })
                }
              >
                Registra acconto
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
