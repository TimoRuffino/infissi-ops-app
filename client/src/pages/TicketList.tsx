import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Plus, Clock, AlertCircle, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";

type DeleteTarget = { id: number; label: string } | null;

const statoTicketColors: Record<string, string> = {
  aperto: "bg-red-100 text-red-800",
  assegnato: "bg-amber-100 text-amber-800",
  in_lavorazione: "bg-blue-100 text-blue-800",
  risolto: "bg-green-100 text-green-800",
  chiuso: "bg-gray-100 text-gray-600",
};

export default function TicketList() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filtroStato, setFiltroStato] = useState("tutti");
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const tickets = trpc.ticket.list.useQuery(
    filtroStato !== "tutti" ? { stato: filtroStato } : {}
  );
  const commesse = trpc.commesse.list.useQuery({});
  const utils = trpc.useUtils();

  const createTicket = trpc.ticket.create.useMutation({
    onSuccess: () => {
      utils.ticket.invalidate();
      setDialogOpen(false);
    },
  });

  const updateTicket = trpc.ticket.update.useMutation({
    onSuccess: () => {
      utils.ticket.invalidate();
      setEditOpen(false);
      setEditId(null);
    },
  });

  const updateStato = trpc.ticket.updateStato.useMutation({
    onSuccess: () => utils.ticket.invalidate(),
  });

  const deleteTicket = trpc.ticket.delete.useMutation({
    onSuccess: () => {
      utils.ticket.invalidate();
      setDeleteTarget(null);
    },
  });

  const [form, setForm] = useState({
    commessaId: "",
    oggetto: "",
    descrizione: "",
    categoria: "regolazione" as const,
    priorita: "media" as const,
  });

  const [editForm, setEditForm] = useState({
    oggetto: "",
    descrizione: "",
    categoria: "regolazione" as string,
    priorita: "media" as string,
  });

  function openEdit(t: any) {
    setEditId(t.id);
    setEditForm({
      oggetto: t.oggetto,
      descrizione: t.descrizione ?? "",
      categoria: t.categoria,
      priorita: t.priorita,
    });
    setEditOpen(true);
  }

  function handleCreate() {
    if (!form.commessaId || !form.oggetto) return;
    createTicket.mutate({
      commessaId: parseInt(form.commessaId),
      oggetto: form.oggetto,
      descrizione: form.descrizione || undefined,
      categoria: form.categoria,
      priorita: form.priorita,
    });
    setForm({
      commessaId: "",
      oggetto: "",
      descrizione: "",
      categoria: "regolazione",
      priorita: "media",
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Post-Vendita</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gestione ticket e assistenza
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Nuovo ticket
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Apri ticket</DialogTitle>
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
              <div className="space-y-1.5">
                <Label>Oggetto *</Label>
                <Input
                  value={form.oggetto}
                  onChange={(e) =>
                    setForm({ ...form, oggetto: e.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Categoria</Label>
                  <Select
                    value={form.categoria}
                    onValueChange={(v: any) =>
                      setForm({ ...form, categoria: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="difetto_prodotto">
                        Difetto prodotto
                      </SelectItem>
                      <SelectItem value="difetto_posa">
                        Difetto posa
                      </SelectItem>
                      <SelectItem value="regolazione">Regolazione</SelectItem>
                      <SelectItem value="sostituzione">
                        Sostituzione
                      </SelectItem>
                      <SelectItem value="garanzia">Garanzia</SelectItem>
                      <SelectItem value="altro">Altro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
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
              <div className="space-y-1.5">
                <Label>Descrizione</Label>
                <Textarea
                  rows={3}
                  value={form.descrizione}
                  onChange={(e) =>
                    setForm({ ...form, descrizione: e.target.value })
                  }
                />
              </div>
              <Button onClick={handleCreate} disabled={createTicket.isPending}>
                Apri ticket
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filtro stato */}
      <div className="flex gap-2 flex-wrap">
        {["tutti", "aperto", "assegnato", "in_lavorazione", "risolto", "chiuso"].map(
          (s) => (
            <Button
              key={s}
              variant={filtroStato === s ? "default" : "outline"}
              size="sm"
              onClick={() => setFiltroStato(s)}
              className="text-xs capitalize"
            >
              {s === "tutti" ? "Tutti" : s.replace(/_/g, " ")}
            </Button>
          )
        )}
      </div>

      {/* Ticket list */}
      <div className="grid gap-3">
        {tickets.data?.map((t: any) => {
          const commessa = commesse.data?.find(
            (c: any) => c.id === t.commessaId
          );
          return (
            <Card key={t.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">
                        TK-{String(t.id).padStart(4, "0")}
                      </span>
                      <span
                        className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-sm ${statoTicketColors[t.stato] ?? "bg-gray-100"}`}
                      >
                        {t.stato.replace(/_/g, " ")}
                      </span>
                      {(t.priorita === "urgente" || t.priorita === "alta") && (
                        <Badge
                          variant="destructive"
                          className="text-[10px] px-1.5 py-0"
                        >
                          {t.priorita.toUpperCase()}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px]">
                        {t.categoria.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <h3 className="text-sm font-semibold">{t.oggetto}</h3>
                    {t.descrizione && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {t.descrizione}
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {commessa && (
                        <span>
                          {commessa.codice} — {commessa.cliente}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(t.createdAt).toLocaleDateString("it-IT")}
                      </span>
                    </div>
                    {t.esitoIntervento && (
                      <p className="text-xs border-l-2 border-green-500 pl-2 text-muted-foreground">
                        Esito: {t.esitoIntervento}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {t.stato === "aperto" && (
                      <Button variant="outline" size="sm" className="text-xs h-7" disabled={updateStato.isPending} onClick={() => updateStato.mutate({ id: t.id, stato: "assegnato" })}>
                        Assegna
                      </Button>
                    )}
                    {t.stato === "assegnato" && (
                      <Button variant="outline" size="sm" className="text-xs h-7" disabled={updateStato.isPending} onClick={() => updateStato.mutate({ id: t.id, stato: "in_lavorazione" })}>
                        Lavora
                      </Button>
                    )}
                    {t.stato === "in_lavorazione" && (
                      <Button variant="outline" size="sm" className="text-xs h-7" disabled={updateStato.isPending} onClick={() => updateStato.mutate({ id: t.id, stato: "risolto" })}>
                        Risolvi
                      </Button>
                    )}
                    {t.stato === "risolto" && (
                      <Button variant="outline" size="sm" className="text-xs h-7" disabled={updateStato.isPending} onClick={() => updateStato.mutate({ id: t.id, stato: "chiuso" })}>
                        Chiudi
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(t)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:text-red-700" onClick={() => setDeleteTarget({ id: t.id, label: t.oggetto })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {tickets.data?.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Nessun ticket trovato</p>
          </div>
        )}
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={(o) => { setEditOpen(o); if (!o) setEditId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Modifica ticket</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Oggetto</Label>
              <Input value={editForm.oggetto} onChange={(e) => setEditForm({ ...editForm, oggetto: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <Select value={editForm.categoria} onValueChange={(v) => setEditForm({ ...editForm, categoria: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="difetto_prodotto">Difetto prodotto</SelectItem>
                    <SelectItem value="difetto_posa">Difetto posa</SelectItem>
                    <SelectItem value="regolazione">Regolazione</SelectItem>
                    <SelectItem value="sostituzione">Sostituzione</SelectItem>
                    <SelectItem value="garanzia">Garanzia</SelectItem>
                    <SelectItem value="altro">Altro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Priorita</Label>
                <Select value={editForm.priorita} onValueChange={(v) => setEditForm({ ...editForm, priorita: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bassa">Bassa</SelectItem>
                    <SelectItem value="media">Media</SelectItem>
                    <SelectItem value="alta">Alta</SelectItem>
                    <SelectItem value="urgente">Urgente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Descrizione</Label>
              <Textarea rows={3} value={editForm.descrizione} onChange={(e) => setEditForm({ ...editForm, descrizione: e.target.value })} />
            </div>
            <Button
              onClick={() => editId && updateTicket.mutate({
                id: editId,
                oggetto: editForm.oggetto || undefined,
                descrizione: editForm.descrizione || undefined,
                categoria: editForm.categoria as any,
                priorita: editForm.priorita as any,
              })}
              disabled={updateTicket.isPending}
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
        title="Elimina ticket"
        description={`Eliminare "${deleteTarget?.label}"? Questa azione non puo essere annullata.`}
        onConfirm={() => deleteTarget && deleteTicket.mutate(deleteTarget.id)}
      />
    </div>
  );
}
