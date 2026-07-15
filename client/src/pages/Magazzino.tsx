import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Package,
  Plus,
  Trash2,
  Search,
  MapPin,
  ChevronDown,
  ChevronUp,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import StatoChip from "@/components/StatoChip";
import ConfirmDialog from "@/components/ConfirmDialog";
import { STATI_ORDER } from "@/lib/stato";

// Commesse can hold warehouse products only past "aggiornamento_contratto".
const CONTRATTO_IDX = STATI_ORDER.indexOf("aggiornamento_contratto");
function isEligible(c: any): boolean {
  const idx = STATI_ORDER.indexOf(c.stato);
  return idx > CONTRATTO_IDX && c.stato !== "archiviata" && !c.archivedAt;
}

const emptyForm = {
  nome: "",
  quantita: "1",
  fornitore: "",
  dataConsegna: "",
  note: "",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString("it-IT");
}

export default function Magazzino() {
  const [, setLocation] = useLocation();
  const commesse = trpc.commesse.list.useQuery({});
  const prodotti = trpc.magazzino.list.useQuery({});
  const utils = trpc.useUtils();

  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
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

  const isOpen = (c: any) =>
    expanded[c.id] ?? (byCommessa.get(c.id)?.length ?? 0) > 0;

  function submitForm(commessaId: number) {
    if (!form.nome.trim()) return;
    create.mutate({
      commessaId,
      nome: form.nome.trim(),
      quantita: Math.max(1, parseInt(form.quantita) || 1),
      fornitore: form.fornitore.trim() || undefined,
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
            Prodotti e consegne per commessa — disponibile dopo l'Aggiornamento
            Contratto
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
                    onClick={() => {
                      if (p.commessa) {
                        setExpanded((m) => ({ ...m, [p.commessaId]: true }));
                        setFiltro("tutte");
                        setSearch(p.commessa.codice ?? "");
                      }
                    }}
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

      {/* Commesse */}
      <div className="space-y-3">
        {eligibili.map((c: any) => {
          const rows = byCommessa.get(c.id) ?? [];
          const open = isOpen(c);
          const d = digest.get(c.id);
          const arrivati = d?.arrivati ?? 0;
          return (
            <Card
              key={c.id}
              className={`overflow-hidden ${(d?.late ?? 0) > 0 ? "border-danger/40" : ""}`}
            >
              <CardHeader className="py-3 px-4">
                <button
                  className="w-full flex items-center gap-3 text-left"
                  onClick={() =>
                    setExpanded((m) => ({ ...m, [c.id]: !open }))
                  }
                >
                  <span className="codice-mono text-[11px] text-text-3 shrink-0">
                    {c.codice}
                  </span>
                  <span className="text-sm font-semibold truncate">{c.cliente}</span>
                  <span
                    role="link"
                    title="Apri commessa"
                    className="shrink-0 text-text-3 hover:text-primary cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLocation(`/commesse/${c.id}`);
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </span>
                  {c.citta && (
                    <span className="text-xs text-text-3 items-center gap-0.5 hidden sm:flex">
                      <MapPin className="h-3 w-3" />
                      {c.citta}
                    </span>
                  )}
                  <StatoChip stato={c.stato} className="shrink-0" />
                  <span className="flex-1" />
                  {(d?.late ?? 0) > 0 && (
                    <Badge variant="danger" className="shrink-0">
                      {d!.late} in ritardo
                    </Badge>
                  )}
                  {d?.next && (
                    <span className="hidden md:inline-flex items-center gap-1 text-xs text-text-2 shrink-0">
                      <CalendarClock className="h-3 w-3" />
                      {fmtDate(d.next)}
                    </span>
                  )}
                  {rows.length > 0 && (
                    <Badge
                      variant={arrivati === rows.length ? "success" : "secondary"}
                      className="shrink-0"
                    >
                      <Package className="h-3 w-3 mr-1" />
                      {arrivati}/{rows.length} arrivati
                    </Badge>
                  )}
                  {open ? (
                    <ChevronUp className="h-4 w-4 text-text-3 shrink-0" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-text-3 shrink-0" />
                  )}
                </button>
              </CardHeader>

              {open && (
                <CardContent className="px-4 pb-4 pt-0 space-y-3 border-t">
                  {rows.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left">
                            <th className="eyebrow !text-text-3 py-2 pr-3">Prodotto</th>
                            <th className="eyebrow !text-text-3 py-2 pr-3 w-14">Q.tà</th>
                            <th className="eyebrow !text-text-3 py-2 pr-3">Fornitore</th>
                            <th className="eyebrow !text-text-3 py-2 pr-3">Consegna</th>
                            <th className="eyebrow !text-text-3 py-2 pr-3">Arrivato</th>
                            <th className="eyebrow !text-text-3 py-2 pr-3">Note</th>
                            <th className="w-9"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((p: any) => {
                            const late =
                              !p.arrivato &&
                              p.dataConsegna &&
                              p.dataConsegna <
                                new Date().toISOString().split("T")[0];
                            return (
                              <tr key={p.id} className="border-t border-border/60">
                                <td className="py-2 pr-3 font-medium">
                                  {p.nome}
                                </td>
                                <td className="py-2 pr-3 tabular-nums">
                                  {p.quantita}
                                </td>
                                <td className="py-2 pr-3 text-text-2">
                                  {p.fornitore || "—"}
                                </td>
                                <td className="py-2 pr-3">
                                  <span
                                    className={`inline-flex items-center gap-1.5 ${
                                      p.arrivato
                                        ? "text-success"
                                        : late
                                        ? "text-danger font-semibold"
                                        : "text-text-1"
                                    }`}
                                  >
                                    {p.arrivato ? (
                                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                    ) : (
                                      <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                                    )}
                                    {/* Suppliers slip: the date is editable right here. */}
                                    <Input
                                      type="date"
                                      value={p.dataConsegna ?? ""}
                                      onChange={(e) =>
                                        update.mutate({
                                          id: p.id,
                                          dataConsegna: e.target.value || null,
                                        })
                                      }
                                      className={`h-7 w-[135px] px-1.5 text-xs ${
                                        late ? "border-danger/50 text-danger" : ""
                                      }`}
                                    />
                                    {late && <span className="shrink-0">in ritardo</span>}
                                  </span>
                                </td>
                                <td className="py-2 pr-3">
                                  <Switch
                                    checked={p.arrivato}
                                    onCheckedChange={(v) =>
                                      update.mutate({ id: p.id, arrivato: v })
                                    }
                                  />
                                </td>
                                <td className="py-2 pr-3 text-xs text-text-2 max-w-[220px] truncate" title={p.note ?? ""}>
                                  {p.note || "—"}
                                </td>
                                <td className="py-2">
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    className="text-danger"
                                    title="Elimina prodotto"
                                    onClick={() =>
                                      setDeleteTarget({ id: p.id, nome: p.nome })
                                    }
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {formFor === c.id ? (
                    <div className="flex gap-2 flex-wrap items-end rounded-md border border-border bg-surface-2 p-3">
                      <div className="space-y-1 flex-[2] min-w-[160px]">
                        <label className="text-xs font-medium">Prodotto *</label>
                        <Input
                          autoFocus
                          placeholder="Es. Finestra PVC 120×140"
                          value={form.nome}
                          onChange={(e) => setForm({ ...form, nome: e.target.value })}
                          className="h-9"
                        />
                      </div>
                      <div className="space-y-1 w-20">
                        <label className="text-xs font-medium">Q.tà</label>
                        <Input
                          type="number"
                          min={1}
                          value={form.quantita}
                          onChange={(e) => setForm({ ...form, quantita: e.target.value })}
                          className="h-9"
                        />
                      </div>
                      <div className="space-y-1 flex-1 min-w-[130px]">
                        <label className="text-xs font-medium">Fornitore</label>
                        <Input
                          value={form.fornitore}
                          onChange={(e) => setForm({ ...form, fornitore: e.target.value })}
                          className="h-9"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium">Data consegna</label>
                        <Input
                          type="date"
                          value={form.dataConsegna}
                          onChange={(e) => setForm({ ...form, dataConsegna: e.target.value })}
                          className="h-9"
                        />
                      </div>
                      <div className="space-y-1 flex-1 min-w-[130px]">
                        <label className="text-xs font-medium">Note</label>
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
                </CardContent>
              )}
            </Card>
          );
        })}

        {eligibili.length === 0 && !commesse.isLoading && (
          <Card>
            <CardContent className="py-12 text-center text-sm text-text-2">
              <Package className="h-8 w-8 mx-auto mb-2 text-text-3" />
              Nessuna commessa oltre l'Aggiornamento Contratto
              {search ? " che corrisponde alla ricerca" : ""}.
            </CardContent>
          </Card>
        )}
      </div>

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
