import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Shield,
  Plus,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Calendar,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";

type DeleteTarget = { id: number; label: string } | null;

function daysUntil(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function getScadenzaStatus(dateStr: string) {
  const days = daysUntil(dateStr);
  if (days < 0) return { label: "Scaduta", color: "bg-red-100 text-red-800", icon: AlertTriangle };
  if (days <= 90) return { label: `Scade tra ${days}gg`, color: "bg-amber-100 text-amber-800", icon: Clock };
  if (days <= 365) return { label: `${Math.ceil(days / 30)} mesi`, color: "bg-blue-100 text-blue-800", icon: Calendar };
  return { label: `${Math.floor(days / 365)} anni`, color: "bg-green-100 text-green-800", icon: CheckCircle2 };
}

const tipoLabels: Record<string, string> = {
  prodotto: "Prodotto",
  posa: "Posa in opera",
  accessorio: "Accessorio",
  vetro: "Vetro",
  altro: "Altro",
};

export default function GaranzieList() {
  const [filter, setFilter] = useState<string | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const garanzie = trpc.garanzie.list.useQuery(filter ? { tipo: filter } : {});
  const stats = trpc.garanzie.stats.useQuery();
  const commesse = trpc.commesse.list.useQuery({});
  const utils = trpc.useUtils();

  const createGaranzia = trpc.garanzie.create.useMutation({
    onSuccess: () => {
      utils.garanzie.invalidate();
      setDialogOpen(false);
      setForm({
        commessaId: "",
        tipo: "prodotto",
        descrizione: "",
        fornitore: "",
        dataInizio: new Date().toISOString().split("T")[0],
        durataMesi: "60",
        documentoRif: "",
        note: "",
      });
    },
  });

  const updateGaranzia = trpc.garanzie.update.useMutation({
    onSuccess: () => {
      utils.garanzie.invalidate();
      setEditOpen(false);
      setEditId(null);
    },
  });

  const deleteGaranzia = trpc.garanzie.delete.useMutation({
    onSuccess: () => {
      utils.garanzie.invalidate();
      setDeleteTarget(null);
    },
  });

  const [form, setForm] = useState({
    commessaId: "",
    tipo: "prodotto" as const,
    descrizione: "",
    fornitore: "",
    dataInizio: new Date().toISOString().split("T")[0],
    durataMesi: "60",
    documentoRif: "",
    note: "",
  });

  const [editForm, setEditForm] = useState({
    tipo: "prodotto" as string,
    descrizione: "",
    fornitore: "",
    documentoRif: "",
    note: "",
  });

  function openEdit(g: any) {
    setEditId(g.id);
    setEditForm({
      tipo: g.tipo,
      descrizione: g.descrizione,
      fornitore: g.fornitore ?? "",
      documentoRif: g.documentoRif ?? "",
      note: g.note ?? "",
    });
    setEditOpen(true);
  }

  const s = stats.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6" />
            Garanzie
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gestione e monitoraggio scadenze garanzie
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Nuova garanzia
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Registra garanzia</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1.5">
                <Label>Commessa *</Label>
                <Select
                  value={form.commessaId}
                  onValueChange={(v) => setForm({ ...form, commessaId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleziona commessa" />
                  </SelectTrigger>
                  <SelectContent>
                    {commesse.data?.map((c: any) => (
                      <SelectItem key={c.id} value={c.id.toString()}>
                        {c.codice} — {c.cliente}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Tipo</Label>
                  <Select
                    value={form.tipo}
                    onValueChange={(v: any) => setForm({ ...form, tipo: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="prodotto">Prodotto</SelectItem>
                      <SelectItem value="posa">Posa in opera</SelectItem>
                      <SelectItem value="accessorio">Accessorio</SelectItem>
                      <SelectItem value="vetro">Vetro</SelectItem>
                      <SelectItem value="altro">Altro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Durata (mesi)</Label>
                  <Input
                    type="number"
                    value={form.durataMesi}
                    onChange={(e) =>
                      setForm({ ...form, durataMesi: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Descrizione *</Label>
                <Input
                  value={form.descrizione}
                  onChange={(e) =>
                    setForm({ ...form, descrizione: e.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Fornitore</Label>
                  <Input
                    value={form.fornitore}
                    onChange={(e) =>
                      setForm({ ...form, fornitore: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Data inizio</Label>
                  <Input
                    type="date"
                    value={form.dataInizio}
                    onChange={(e) =>
                      setForm({ ...form, dataInizio: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Riferimento documento</Label>
                <Input
                  placeholder="GAR-2026-..."
                  value={form.documentoRif}
                  onChange={(e) =>
                    setForm({ ...form, documentoRif: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Note</Label>
                <Textarea
                  rows={2}
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </div>
              <Button
                onClick={() =>
                  createGaranzia.mutate({
                    commessaId: parseInt(form.commessaId),
                    tipo: form.tipo as any,
                    descrizione: form.descrizione,
                    fornitore: form.fornitore || undefined,
                    dataInizio: form.dataInizio,
                    durataMesi: parseInt(form.durataMesi) || 60,
                    documentoRif: form.documentoRif || undefined,
                    note: form.note || undefined,
                  })
                }
                disabled={
                  !form.commessaId ||
                  !form.descrizione ||
                  createGaranzia.isPending
                }
              >
                Registra
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Totali
            </p>
            <p className="text-2xl font-bold">{s?.total ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Attive
            </p>
            <p className="text-2xl font-bold text-green-700">
              {s?.attive ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card
          className={
            (s?.inScadenza ?? 0) > 0
              ? "border-l-4 border-l-amber-400"
              : ""
          }
        >
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              In scadenza (90gg)
            </p>
            <p className="text-2xl font-bold text-amber-600">
              {s?.inScadenza ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card
          className={
            (s?.scadute ?? 0) > 0
              ? "border-l-4 border-l-destructive"
              : ""
          }
        >
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Scadute
            </p>
            <p className="text-2xl font-bold text-destructive">
              {s?.scadute ?? "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        <Button
          variant={!filter ? "default" : "outline"}
          size="sm"
          onClick={() => setFilter(undefined)}
        >
          Tutte
        </Button>
        {Object.entries(tipoLabels).map(([key, label]) => (
          <Button
            key={key}
            variant={filter === key ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {/* List */}
      {garanzie.data?.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Nessuna garanzia registrata.
        </div>
      ) : (
        <div className="grid gap-3">
          {garanzie.data?.map((g: any) => {
            const status = getScadenzaStatus(g.dataScadenza);
            const StatusIcon = status.icon;
            return (
              <Card key={g.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">
                          {g.descrizione}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {tipoLabels[g.tipo] ?? g.tipo}
                        </Badge>
                        {g.documentoRif && (
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {g.documentoRif}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {g.fornitore && <span>Fornitore: {g.fornitore}</span>}
                        <span>
                          Dal {g.dataInizio} al {g.dataScadenza}
                        </span>
                        <span>{g.durataMesi} mesi</span>
                      </div>
                      {g.note && (
                        <p className="text-xs text-muted-foreground border-l-2 pl-2">
                          {g.note}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div
                        className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${status.color}`}
                      >
                        <StatusIcon className="h-3.5 w-3.5" />
                        {status.label}
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(g)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:text-red-700" onClick={() => setDeleteTarget({ id: g.id, label: g.descrizione })}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={(o) => { setEditOpen(o); if (!o) setEditId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Modifica garanzia</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select value={editForm.tipo} onValueChange={(v) => setEditForm({ ...editForm, tipo: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prodotto">Prodotto</SelectItem>
                    <SelectItem value="posa">Posa in opera</SelectItem>
                    <SelectItem value="accessorio">Accessorio</SelectItem>
                    <SelectItem value="vetro">Vetro</SelectItem>
                    <SelectItem value="altro">Altro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Fornitore</Label>
                <Input value={editForm.fornitore} onChange={(e) => setEditForm({ ...editForm, fornitore: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Descrizione</Label>
              <Input value={editForm.descrizione} onChange={(e) => setEditForm({ ...editForm, descrizione: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Riferimento documento</Label>
              <Input value={editForm.documentoRif} onChange={(e) => setEditForm({ ...editForm, documentoRif: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Textarea rows={2} value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} />
            </div>
            <Button
              onClick={() => editId && updateGaranzia.mutate({
                id: editId,
                tipo: editForm.tipo as any,
                descrizione: editForm.descrizione || undefined,
                fornitore: editForm.fornitore || undefined,
                documentoRif: editForm.documentoRif || undefined,
                note: editForm.note || undefined,
              })}
              disabled={updateGaranzia.isPending}
            >
              Aggiorna
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Elimina garanzia"
        description={`Eliminare "${deleteTarget?.label}"? Questa azione non puo essere annullata.`}
        onConfirm={() => deleteTarget && deleteGaranzia.mutate(deleteTarget.id)}
      />
    </div>
  );
}
