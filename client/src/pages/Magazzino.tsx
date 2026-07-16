import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Package,
  Plus,
  Trash2,
  Search,
  MapPin,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  StickyNote,
  Timer,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import StatoChip from "@/components/StatoChip";
import ConfirmDialog from "@/components/ConfirmDialog";
import { STATI_ORDER } from "@/lib/stato";

// Commesse appear in the warehouse from "produzione" onwards.
const PRODUZIONE_IDX = STATI_ORDER.indexOf("produzione");
function isEligible(c: any): boolean {
  const idx = STATI_ORDER.indexOf(c.stato);
  return idx >= PRODUZIONE_IDX && c.stato !== "archiviata" && !c.archivedAt;
}

// Company supplier list — fixed dropdown so names stay consistent (and the
// per-supplier lead-time stats mean something).
const FORNITORI = [
  "Wnd",
  "Oknoplast",
  "Alias",
  "Pail",
  "Primed",
  "HenryGlass",
  "Palmieri",
  "Errecci",
  "Fivizzanese",
  "Oskura",
  "Korus",
  "Punto del Serramento",
  "Kopern",
  "Citea",
  "Cerrato",
  "Brianzatende",
  "Seraplastic",
  "St Scale",
  "Sharknet",
];

const emptyForm = {
  nome: "",
  quantita: "1",
  fornitore: "",
  numeroOrdine: "",
  dataOrdine: new Date().toISOString().split("T")[0],
  dataConsegna: "",
  note: "",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString("it-IT");
}

// Days between order and delivery date (lead time).
function leadDays(p: any): number | null {
  if (!p.dataOrdine || !p.dataConsegna) return null;
  const ms =
    new Date(p.dataConsegna + "T12:00:00").getTime() -
    new Date(p.dataOrdine + "T12:00:00").getTime();
  const d = Math.round(ms / 86400000);
  return d >= 0 ? d : null;
}

export default function Magazzino() {
  const [, setLocation] = useLocation();
  const commesse = trpc.commesse.list.useQuery({});
  const prodotti = trpc.magazzino.list.useQuery({});
  const utils = trpc.useUtils();

  const [search, setSearch] = useState("");
  // Tile clicked → full-detail dialog for that commessa.
  const [detailFor, setDetailFor] = useState<number | null>(null);
  // Quick status filter: tutte | prodotti (has products) | arrivo | ritardo | arrivati
  const [filtro, setFiltro] = useState<string>("tutte");
  // Per-commessa add form (only one open at a time keeps the state simple).
  const [formFor, setFormFor] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; nome: string } | null>(null);

  const create = trpc.magazzino.create.useMutation({
    onSuccess: () => {
      utils.magazzino.invalidate();
      setForm(emptyForm);
      toast.success("Prodotto aggiunto al magazzino");
    },
    onError: (e) => toast.error(e.message ?? "Aggiunta non riuscita"),
  });
  const update = trpc.magazzino.update.useMutation({
    onSuccess: () => utils.magazzino.invalidate(),
    onError: (e) => toast.error(e.message ?? "Salvataggio non riuscito"),
  });
  const remove = trpc.magazzino.remove.useMutation({
    onSuccess: () => {
      utils.magazzino.invalidate();
      setDeleteTarget(null);
    },
  });

  const byCommessa = useMemo(() => {
    const map = new Map<number, any[]>();
    for (const p of prodotti.data ?? []) {
      if (!map.has(p.commessaId)) map.set(p.commessaId, []);
      map.get(p.commessaId)!.push(p);
    }
    return map;
  }, [prodotti.data]);

  const today = new Date().toISOString().split("T")[0];

  // Per-commessa digest: next pending delivery date + late count.
  const digest = useMemo(() => {
    const m = new Map<number, { next: string | null; late: number; arrivati: number; tot: number }>();
    for (const [cid, rows] of Array.from(byCommessa.entries())) {
      const pending = rows.filter((p: any) => !p.arrivato && p.dataConsegna);
      m.set(cid, {
        next: pending.length ? pending.reduce((a: any, b: any) => (a.dataConsegna < b.dataConsegna ? a : b)).dataConsegna : null,
        late: rows.filter((p: any) => !p.arrivato && p.dataConsegna && p.dataConsegna < today).length,
        arrivati: rows.filter((p: any) => p.arrivato).length,
        tot: rows.length,
      });
    }
    return m;
  }, [byCommessa, today]);

  const eligibili = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (commesse.data ?? [])
      .filter(isEligible)
      .filter((c: any) => {
        if (q && !`${c.codice ?? ""} ${c.cliente ?? ""} ${c.citta ?? ""}`.toLowerCase().includes(q)) return false;
        const d = digest.get(c.id);
        if (filtro === "prodotti") return !!d;
        if (filtro === "ritardo") return (d?.late ?? 0) > 0;
        if (filtro === "arrivo") return !!d && d.arrivati < d.tot;
        if (filtro === "arrivati") return !!d && d.tot > 0 && d.arrivati === d.tot;
        return true;
      })
      .sort((a: any, b: any) => {
        // Urgency first: late deliveries, then nearest pending date, then
        // has-products, then code.
        const da = digest.get(a.id), db = digest.get(b.id);
        if ((da?.late ?? 0) > 0 !== (db?.late ?? 0) > 0) return (da?.late ?? 0) > 0 ? -1 : 1;
        const na = da?.next ?? "9999", nb = db?.next ?? "9999";
        if (na !== nb) return na.localeCompare(nb);
        if (!!da !== !!db) return da ? -1 : 1;
        return (a.codice ?? "").localeCompare(b.codice ?? "");
      });
  }, [commesse.data, search, filtro, digest, byCommessa]);

  // Next 5 pending deliveries across every commessa — operational glance.
  const prossime = useMemo(() => {
    const cmById = new Map((commesse.data ?? []).map((c: any) => [c.id, c]));
    return (prodotti.data ?? [])
      .filter((p: any) => !p.arrivato && p.dataConsegna)
      .sort((a: any, b: any) => a.dataConsegna.localeCompare(b.dataConsegna))
      .slice(0, 5)
      .map((p: any) => ({ ...p, commessa: cmById.get(p.commessaId) }));
  }, [prodotti.data, commesse.data]);

  const totProdotti = prodotti.data?.length ?? 0;
  const totArrivati = (prodotti.data ?? []).filter((p: any) => p.arrivato).length;
  const inArrivo = totProdotti - totArrivati;
  // Average lead time over arrived products that carry both dates.
  const leadMedio = useMemo(() => {
    const days = (prodotti.data ?? [])
      .filter((p: any) => p.arrivato)
      .map(leadDays)
      .filter((d: number | null): d is number => d != null);
    if (days.length === 0) return null;
    return Math.round(days.reduce((s: number, d: number) => s + d, 0) / days.length);
  }, [prodotti.data]);

  function submitForm(commessaId: number) {
    if (!form.nome.trim()) return;
    create.mutate({
      commessaId,
      nome: form.nome.trim(),
      quantita: Math.max(1, parseInt(form.quantita) || 1),
      fornitore: form.fornitore || undefined,
      numeroOrdine: form.numeroOrdine.trim() || undefined,
      dataOrdine: form.dataOrdine || undefined,
      dataConsegna: form.dataConsegna || undefined,
      note: form.note.trim() || undefined,
    });
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-[28px] leading-[34px] font-bold tracking-[-0.02em] flex items-center gap-2">
            <Package className="h-6 w-6 text-primary" />
            Magazzino
          </h1>
          <p className="text-text-2 text-sm mt-1">
            Prodotti, ordini e consegne per commessa — dallo stato Produzione in poi
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Card className="px-3 py-2 gap-0">
            <div className="eyebrow">Prodotti</div>
            <div className="text-xl font-bold leading-none mt-1 tabular-nums">
              {totProdotti}
            </div>
          </Card>
          <Card className="px-3 py-2 gap-0 border-warning/30">
            <div className="eyebrow !text-warning">In arrivo</div>
            <div className="text-xl font-bold leading-none mt-1 tabular-nums text-warning">
              {inArrivo}
            </div>
          </Card>
          <Card className="px-3 py-2 gap-0 border-success/30">
            <div className="eyebrow !text-success">Arrivati</div>
            <div className="text-xl font-bold leading-none mt-1 tabular-nums text-success">
              {totArrivati}
            </div>
          </Card>
          {leadMedio != null && (
            <Card className="px-3 py-2 gap-0 border-info/30">
              <div className="eyebrow !text-info">Lead time medio</div>
              <div className="text-xl font-bold leading-none mt-1 tabular-nums text-info">
                {leadMedio} gg
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Prossime consegne — glance strip */}
      {prossime.length > 0 && (
        <Card className="border-l-[3px] border-l-primary">
          <CardContent className="py-3 px-4">
            <p className="eyebrow !text-text-3 mb-2">Prossime consegne</p>
            <div className="flex gap-2 flex-wrap">
              {prossime.map((p: any) => {
                const late = p.dataConsegna < today;
                return (
                  <button
                    key={p.id}
                    onClick={() => setDetailFor(p.commessaId)}
                    className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition hover:shadow-sm ${
                      late
                        ? "border-danger/40 bg-danger-soft text-danger"
                        : "border-border bg-surface-2 text-text-1"
                    }`}
                  >
                    <CalendarClock className="h-3 w-3 shrink-0" />
                    <span className="font-bold tabular-nums">{fmtDate(p.dataConsegna)}</span>
                    <span className="truncate max-w-[160px]">{p.nome}</span>
                    <span className="text-text-3">· {p.commessa?.cliente ?? `#${p.commessaId}`}</span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search + filtri */}
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
        <div className="flex items-center gap-1 border border-border rounded-lg p-0.5 bg-surface-2">
          {[
            ["tutte", "Tutte"],
            ["prodotti", "Con prodotti"],
            ["arrivo", "In arrivo"],
            ["ritardo", "In ritardo"],
            ["arrivati", "Arrivati"],
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

      {/* Commesse — square tiles: glance info only, click for the full card */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {eligibili.map((c: any) => {
          const d = digest.get(c.id);
          const tot = d?.tot ?? 0;
          const arrivati = d?.arrivati ?? 0;
          const late = d?.late ?? 0;
          const complete = tot > 0 && arrivati === tot;
          return (
            <button
              key={c.id}
              onClick={() => setDetailFor(c.id)}
              className={`relative flex min-h-[150px] flex-col gap-2 rounded-xl border-2 bg-surface p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${
                late > 0
                  ? "border-danger/50"
                  : complete
                  ? "border-success/40"
                  : "border-border"
              }`}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="codice-mono text-[10px] text-text-3">{c.codice}</span>
                <StatoChip stato={c.stato} />
              </div>
              <p className="flex-1 text-[15px] font-semibold leading-snug line-clamp-2">
                {c.cliente}
              </p>
              <div className="flex w-full items-center justify-between gap-2">
                {tot > 0 ? (
                  <Badge
                    variant={complete ? "success" : "secondary"}
                    className="shrink-0"
                  >
                    <Package className="h-3 w-3 mr-1" />
                    {arrivati}/{tot}
                  </Badge>
                ) : (
                  <span className="text-xs text-text-3">Nessun prodotto</span>
                )}
                {late > 0 ? (
                  <Badge variant="danger" className="shrink-0">
                    {late} in ritardo
                  </Badge>
                ) : d?.next ? (
                  <span className="inline-flex items-center gap-1 text-xs text-text-2 shrink-0">
                    <CalendarClock className="h-3 w-3" />
                    {fmtDate(d.next)}
                  </span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      {eligibili.length === 0 && !commesse.isLoading && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-text-2">
            <Package className="h-8 w-8 mx-auto mb-2 text-text-3" />
            Nessuna commessa dallo stato Produzione in poi
            {search ? " che corrisponde alla ricerca" : ""}.
          </CardContent>
        </Card>
      )}

      {/* Detail popup — the full v3 card lives here now */}
      <Dialog
        open={detailFor != null}
        onOpenChange={(o) => {
          if (!o) {
            setDetailFor(null);
            setFormFor(null);
            setForm(emptyForm);
          }
        }}
      >
        <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
          {(() => {
            const c = (commesse.data ?? []).find((x: any) => x.id === detailFor);
            if (!c) return null;
            const rows = byCommessa.get(c.id) ?? [];
            const d = digest.get(c.id);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2.5 flex-wrap pr-6">
                    <span className="codice-mono text-[11px] text-text-3">{c.codice}</span>
                    <span className="text-base font-bold">{c.cliente}</span>
                    <StatoChip stato={c.stato} />
                    {c.citta && (
                      <span className="inline-flex items-center gap-0.5 text-xs font-normal text-text-3">
                        <MapPin className="h-3 w-3" />
                        {c.citta}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setLocation(`/commesse/${c.id}`)}
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      Apri commessa
                    </Button>
                    {(d?.late ?? 0) > 0 && (
                      <Badge variant="danger">{d!.late} in ritardo</Badge>
                    )}
                    {rows.length > 0 && (
                      <Badge
                        variant={
                          (d?.arrivati ?? 0) === rows.length ? "success" : "secondary"
                        }
                      >
                        <Package className="h-3 w-3 mr-1" />
                        {d?.arrivati ?? 0}/{rows.length} arrivati
                      </Badge>
                    )}
                  </DialogTitle>
                </DialogHeader>

                <div className="space-y-3">
                  {rows.length > 0 ? (
                    <div className="space-y-2">
                      {rows.map((p: any) => (
                        <ProdottoRow
                          key={p.id}
                          p={p}
                          today={today}
                          onUpdate={(patch) => update.mutate({ id: p.id, ...patch })}
                          onDelete={() => setDeleteTarget({ id: p.id, nome: p.nome })}
                          pending={update.isPending}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-text-3 text-center py-4">
                      Nessun prodotto a magazzino per questa commessa.
                    </p>
                  )}

                  {formFor === c.id ? (
                    <div className="rounded-lg border border-border bg-surface-2 p-3 space-y-3">
                      <div className="flex gap-3 flex-wrap items-end">
                        <div className="space-y-1 flex-[2] min-w-[180px]">
                          <Label className="text-xs">Prodotto *</Label>
                          <Input
                            autoFocus
                            placeholder="Es. Finestra PVC 120×140"
                            value={form.nome}
                            onChange={(e) => setForm({ ...form, nome: e.target.value })}
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-1 w-20">
                          <Label className="text-xs">Q.tà</Label>
                          <Input
                            type="number"
                            min={1}
                            value={form.quantita}
                            onChange={(e) => setForm({ ...form, quantita: e.target.value })}
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-1 w-44">
                          <Label className="text-xs">Fornitore</Label>
                          <Select
                            value={form.fornitore}
                            onValueChange={(v) => setForm({ ...form, fornitore: v })}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue placeholder="—" />
                            </SelectTrigger>
                            <SelectContent>
                              {FORNITORI.map((f) => (
                                <SelectItem key={f} value={f}>{f}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="flex gap-3 flex-wrap items-end">
                        <div className="space-y-1 w-32">
                          <Label className="text-xs">N° ordine</Label>
                          <Input
                            placeholder="Es. 0045"
                            value={form.numeroOrdine}
                            onChange={(e) => setForm({ ...form, numeroOrdine: e.target.value })}
                            className="h-9 font-mono"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Ordinato il</Label>
                          <Input
                            type="date"
                            value={form.dataOrdine}
                            onChange={(e) => setForm({ ...form, dataOrdine: e.target.value })}
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Consegna prevista</Label>
                          <Input
                            type="date"
                            value={form.dataConsegna}
                            onChange={(e) => setForm({ ...form, dataConsegna: e.target.value })}
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-1 flex-1 min-w-[160px]">
                          <Label className="text-xs">Note</Label>
                          <Input
                            value={form.note}
                            onChange={(e) => setForm({ ...form, note: e.target.value })}
                            className="h-9"
                          />
                        </div>
                        <div className="flex gap-1.5">
                          <Button
                            onClick={() => submitForm(c.id)}
                            disabled={!form.nome.trim() || create.isPending}
                          >
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            Aggiungi
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setFormFor(null);
                              setForm(emptyForm);
                            }}
                          >
                            Annulla
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setFormFor(c.id);
                        setForm(emptyForm);
                      }}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Aggiungi prodotto
                    </Button>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o: boolean) => !o && setDeleteTarget(null)}
        title="Elimina prodotto"
        description={`Rimuovere "${deleteTarget?.nome}" dal magazzino della commessa?`}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
      />
    </div>
  );
}

// ── Product row ──────────────────────────────────────────────────────────────
// Two-level card: labelled fields (all inline-editable) + click-to-edit note.
function ProdottoRow({
  p,
  today,
  onUpdate,
  onDelete,
  pending,
}: {
  p: any;
  today: string;
  onUpdate: (patch: any) => void;
  onDelete: () => void;
  pending: boolean;
}) {
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [qtaDraft, setQtaDraft] = useState<string | null>(null);
  const [ordineDraft, setOrdineDraft] = useState<string | null>(null);

  const late = !p.arrivato && p.dataConsegna && p.dataConsegna < today;
  const lead = leadDays(p);

  const field = (label: string, node: React.ReactNode, cls = "") => (
    <div className={`space-y-0.5 ${cls}`}>
      <p className="text-[10px] uppercase tracking-wide font-semibold text-text-3">
        {label}
      </p>
      {node}
    </div>
  );

  return (
    <div
      className={`rounded-lg border p-3 space-y-2.5 transition-colors ${
        p.arrivato
          ? "border-success/30 bg-success-soft/30"
          : late
          ? "border-danger/40 bg-danger-soft/20"
          : "border-border bg-surface"
      }`}
    >
      {/* Level 1: name + fields grid */}
      <div className="flex items-start gap-4 flex-wrap">
        <div className="min-w-[160px] flex-1">
          <p className="text-sm font-semibold leading-tight">{p.nome}</p>
          <div className="flex items-center gap-2 mt-1">
            {p.arrivato ? (
              <Badge variant="success" className="text-[10px]">
                <CheckCircle2 className="h-3 w-3 mr-0.5" />
                Arrivato
              </Badge>
            ) : late ? (
              <Badge variant="danger" className="text-[10px]">In ritardo</Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">In arrivo</Badge>
            )}
            {lead != null && (
              <span
                className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${
                  p.arrivato ? "text-success" : "text-text-2"
                }`}
                title="Giorni dall'ordine alla consegna"
              >
                <Timer className="h-3 w-3" />
                {lead} gg
              </span>
            )}
          </div>
        </div>

        {field(
          "Q.tà",
          <Input
            inputMode="numeric"
            value={qtaDraft ?? String(p.quantita)}
            onChange={(e) => setQtaDraft(e.target.value)}
            onBlur={() => {
              if (qtaDraft == null) return;
              const n = parseInt(qtaDraft);
              if (!isNaN(n) && n >= 1 && n !== p.quantita) onUpdate({ quantita: n });
              setQtaDraft(null);
            }}
            className="h-8 w-16 text-center tabular-nums"
          />
        )}

        {field(
          "Fornitore",
          <Select
            value={p.fornitore ?? ""}
            onValueChange={(v) => onUpdate({ fornitore: v || null })}
          >
            <SelectTrigger className="h-8 w-40">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {/* keep legacy free-text values selectable */}
              {p.fornitore && !FORNITORI.includes(p.fornitore) && (
                <SelectItem value={p.fornitore}>{p.fornitore}</SelectItem>
              )}
              {FORNITORI.map((f) => (
                <SelectItem key={f} value={f}>{f}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {field(
          "N° ordine",
          <Input
            placeholder="—"
            value={ordineDraft ?? (p.numeroOrdine ?? "")}
            onChange={(e) => setOrdineDraft(e.target.value)}
            onBlur={() => {
              if (ordineDraft == null) return;
              if (ordineDraft.trim() !== (p.numeroOrdine ?? ""))
                onUpdate({ numeroOrdine: ordineDraft.trim() || null });
              setOrdineDraft(null);
            }}
            className="h-8 w-24 font-mono text-xs"
          />
        )}

        {field(
          "Ordinato il",
          <Input
            type="date"
            value={p.dataOrdine ?? ""}
            onChange={(e) => onUpdate({ dataOrdine: e.target.value || null })}
            className="h-8 w-[135px] text-xs"
          />
        )}

        {field(
          "Consegna",
          <Input
            type="date"
            value={p.dataConsegna ?? ""}
            onChange={(e) => onUpdate({ dataConsegna: e.target.value || null })}
            className={`h-8 w-[135px] text-xs ${late ? "border-danger/50 text-danger" : ""}`}
          />
        )}

        {field(
          "Arrivato",
          <div className="h-8 flex items-center">
            <Switch
              checked={p.arrivato}
              onCheckedChange={(v) => onUpdate({ arrivato: v })}
              disabled={pending}
            />
          </div>
        )}

        <div className="ml-auto self-center">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-danger"
            title="Elimina prodotto"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Level 2: editable note */}
      <div className="flex items-start gap-1.5">
        <StickyNote className="h-3.5 w-3.5 shrink-0 text-amber-500 mt-[7px]" />
        <Input
          placeholder="Aggiungi nota…"
          value={noteDraft ?? (p.note ?? "")}
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={() => {
            if (noteDraft == null) return;
            if (noteDraft.trim() !== (p.note ?? ""))
              onUpdate({ note: noteDraft.trim() || null });
            setNoteDraft(null);
          }}
          className="h-8 border-transparent bg-transparent px-1.5 text-xs shadow-none hover:border-border focus-visible:border-border"
        />
      </div>
    </div>
  );
}
