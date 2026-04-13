import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, MapPin, Calendar, User, Trash2 } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import ConfirmDialog from "@/components/ConfirmDialog";

type DeleteTarget = { id: number; label: string } | null;

const statoColors: Record<string, string> = {
  preventivo: "bg-slate-100 text-slate-700",
  misure_esecutive: "bg-blue-100 text-blue-800",
  aggiornamento_contratto: "bg-cyan-100 text-cyan-800",
  fatture_pagamento: "bg-amber-100 text-amber-800",
  da_ordinare: "bg-yellow-100 text-yellow-800",
  produzione: "bg-indigo-100 text-indigo-800",
  ordini_ultimazione: "bg-purple-100 text-purple-800",
  attesa_posa: "bg-orange-100 text-orange-800",
  finiture_saldo: "bg-green-100 text-green-800",
  interventi_regolazioni: "bg-teal-100 text-teal-800",
  archiviata: "bg-gray-100 text-gray-600",
};

const prioritaStyle: Record<string, string> = {
  urgente: "destructive",
  alta: "outline",
  media: "secondary",
  bassa: "secondary",
};

export default function CommesseList() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [filtroStato, setFiltroStato] = useState<string>("tutti");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const commesse = trpc.commesse.list.useQuery({
    search: search || undefined,
    stato: filtroStato !== "tutti" ? filtroStato : undefined,
  });
  const clientiList = trpc.clienti.list.useQuery({});

  const utils = trpc.useUtils();
  const createMutation = trpc.commesse.create.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      utils.clienti.invalidate();
      setDialogOpen(false);
    },
  });

  const deleteCommessa = trpc.commesse.delete.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      setDeleteTarget(null);
    },
  });

  const [form, setForm] = useState({
    codice: "",
    clienteId: "" as string, // stored as string for select value
    cliente: "",
    indirizzo: "",
    citta: "",
    telefono: "",
    email: "",
    priorita: "media" as const,
    note: "",
    dataConsegnaPrevista: "",
  });

  function handleClienteSelect(clienteIdStr: string) {
    if (clienteIdStr === "__new__") {
      setForm({ ...form, clienteId: "", cliente: "", indirizzo: "", citta: "", telefono: "", email: "" });
      return;
    }
    const id = parseInt(clienteIdStr, 10);
    const c = clientiList.data?.find((x: any) => x.id === id);
    if (c) {
      setForm({
        ...form,
        clienteId: clienteIdStr,
        cliente: c.ragioneSociale,
        indirizzo: c.indirizzo ?? "",
        citta: c.citta ?? "",
        telefono: c.telefono ?? "",
        email: c.email ?? "",
      });
    }
  }

  function handleCreate() {
    if (!form.codice || !form.cliente) return;
    createMutation.mutate({
      codice: form.codice,
      clienteId: form.clienteId ? parseInt(form.clienteId, 10) : undefined,
      cliente: form.cliente,
      indirizzo: form.indirizzo || undefined,
      citta: form.citta || undefined,
      telefono: form.telefono || undefined,
      email: form.email || undefined,
      priorita: form.priorita,
      note: form.note || undefined,
      dataConsegnaPrevista: form.dataConsegnaPrevista || undefined,
    });
    setForm({
      codice: "",
      clienteId: "",
      cliente: "",
      indirizzo: "",
      citta: "",
      telefono: "",
      email: "",
      priorita: "media",
      note: "",
      dataConsegnaPrevista: "",
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Commesse</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Archivio commesse e stato avanzamento
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Nuova commessa
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Nuova commessa</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Codice *</Label>
                  <Input
                    placeholder="COM-2026-005"
                    value={form.codice}
                    onChange={(e) =>
                      setForm({ ...form, codice: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Priorita</Label>
                  <Select
                    value={form.priorita}
                    onValueChange={(v: any) =>
                      setForm({ ...form, priorita: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bassa">Bassa</SelectItem>
                      <SelectItem value="media">Media</SelectItem>
                      <SelectItem value="alta">Alta</SelectItem>
                      <SelectItem value="urgente">Urgente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Cliente *</Label>
                <Select
                  value={form.clienteId || "__new__"}
                  onValueChange={handleClienteSelect}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Seleziona cliente..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__new__">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <User className="h-3.5 w-3.5" />
                        Cliente non registrato
                      </span>
                    </SelectItem>
                    {clientiList.data?.map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.ragioneSociale}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.clienteId === "" && (
                  <Input
                    placeholder="Nome cliente *"
                    value={form.cliente}
                    onChange={(e) => setForm({ ...form, cliente: e.target.value })}
                    className="mt-1.5"
                  />
                )}
                {form.clienteId !== "" && (
                  <p className="text-xs text-muted-foreground mt-1">{form.cliente}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Indirizzo</Label>
                  <Input
                    value={form.indirizzo}
                    onChange={(e) =>
                      setForm({ ...form, indirizzo: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Citta</Label>
                  <Input
                    value={form.citta}
                    onChange={(e) =>
                      setForm({ ...form, citta: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Telefono</Label>
                  <Input
                    value={form.telefono}
                    onChange={(e) =>
                      setForm({ ...form, telefono: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    value={form.email}
                    onChange={(e) =>
                      setForm({ ...form, email: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Consegna prevista</Label>
                <Input
                  type="date"
                  value={form.dataConsegnaPrevista}
                  onChange={(e) =>
                    setForm({ ...form, dataConsegnaPrevista: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Note</Label>
                <Textarea
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  rows={2}
                />
              </div>
              <Button onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creazione..." : "Crea commessa"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cerca per codice, cliente, citta..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filtroStato} onValueChange={setFiltroStato}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Stato" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tutti">Tutti gli stati</SelectItem>
            <SelectItem value="preventivo">Preventivo</SelectItem>
            <SelectItem value="misure_esecutive">Misure esecutive</SelectItem>
            <SelectItem value="aggiornamento_contratto">Agg. contratto</SelectItem>
            <SelectItem value="fatture_pagamento">Fatture/Pagamento</SelectItem>
            <SelectItem value="da_ordinare">Da ordinare</SelectItem>
            <SelectItem value="produzione">Produzione</SelectItem>
            <SelectItem value="ordini_ultimazione">Ordini ultimazione</SelectItem>
            <SelectItem value="attesa_posa">Attesa posa</SelectItem>
            <SelectItem value="finiture_saldo">Finiture/Saldo</SelectItem>
            <SelectItem value="interventi_regolazioni">Interventi/Regolaz.</SelectItem>
            <SelectItem value="archiviata">Archiviata</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Commesse grid */}
      <div className="grid gap-3">
        {commesse.data?.map((c: any) => (
          <Card
            key={c.id}
            className="cursor-pointer transition-all hover:shadow-md hover:border-foreground/20"
            onClick={() => setLocation(`/commesse/${c.id}`)}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-muted-foreground">
                      {c.codice}
                    </span>
                    <span
                      className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-sm ${statoColors[c.stato] ?? "bg-gray-100"}`}
                    >
                      {c.stato.replace(/_/g, " ")}
                    </span>
                    {(c.priorita === "urgente" || c.priorita === "alta") && (
                      <Badge
                        variant={prioritaStyle[c.priorita] as any}
                        className={`text-[10px] px-1.5 py-0 ${c.priorita === "alta" ? "border-destructive text-destructive" : ""}`}
                      >
                        {c.priorita.toUpperCase()}
                      </Badge>
                    )}
                  </div>
                  <h3 className="font-semibold text-sm">{c.cliente}</h3>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    {c.indirizzo && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {c.indirizzo}, {c.citta}
                      </span>
                    )}
                    {c.dataConsegnaPrevista && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Consegna: {c.dataConsegnaPrevista}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-red-600 hover:text-red-700 shrink-0"
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: c.id, label: `${c.codice} — ${c.cliente}` }); }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        {commesse.data?.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm">Nessuna commessa trovata</p>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Elimina commessa"
        description={`Eliminare "${deleteTarget?.label}"? Questa azione non puo essere annullata.`}
        onConfirm={() => deleteTarget && deleteCommessa.mutate(deleteTarget.id)}
      />
    </div>
  );
}
