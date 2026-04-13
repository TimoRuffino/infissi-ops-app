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
import { Users, Plus, Phone, UserCircle, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";

type DeleteTarget = { id: number; label: string } | null;

export default function SquadreList() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const squadre = trpc.squadre.list.useQuery();
  const interventi = trpc.interventi.list.useQuery({});
  const utils = trpc.useUtils();

  const createSquadra = trpc.squadre.create.useMutation({
    onSuccess: () => {
      utils.squadre.invalidate();
      setDialogOpen(false);
      resetForm();
    },
  });

  const updateSquadra = trpc.squadre.update.useMutation({
    onSuccess: () => {
      utils.squadre.invalidate();
      setDialogOpen(false);
      setEditId(null);
      resetForm();
    },
  });

  const deleteSquadra = trpc.squadre.delete.useMutation({
    onSuccess: () => {
      utils.squadre.invalidate();
      setDeleteTarget(null);
    },
  });

  const [form, setForm] = useState({
    nome: "",
    caposquadra: "",
    telefono: "",
    note: "",
  });

  function resetForm() {
    setForm({ nome: "", caposquadra: "", telefono: "", note: "" });
  }

  function openEdit(s: any) {
    setEditId(s.id);
    setForm({
      nome: s.nome,
      caposquadra: s.caposquadra ?? "",
      telefono: s.telefono ?? "",
      note: s.note ?? "",
    });
    setDialogOpen(true);
  }

  function handleSave() {
    if (editId) {
      updateSquadra.mutate({
        id: editId,
        nome: form.nome || undefined,
        caposquadra: form.caposquadra || undefined,
        telefono: form.telefono || undefined,
        note: form.note || undefined,
      });
    } else {
      createSquadra.mutate({
        nome: form.nome,
        caposquadra: form.caposquadra || undefined,
        telefono: form.telefono || undefined,
        note: form.note || undefined,
      });
    }
  }

  // Count active interventi per squadra
  function interventiCount(squadraId: number) {
    return (
      interventi.data?.filter(
        (i: any) =>
          i.squadraId === squadraId &&
          (i.stato === "pianificato" || i.stato === "in_corso")
      ).length ?? 0
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6" />
            Squadre
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gestione squadre operative
          </p>
        </div>
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) {
              setEditId(null);
              resetForm();
            }
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Nuova squadra
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {editId ? "Modifica squadra" : "Nuova squadra"}
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1.5">
                <Label>Nome squadra *</Label>
                <Input
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Caposquadra</Label>
                  <Input
                    value={form.caposquadra}
                    onChange={(e) =>
                      setForm({ ...form, caposquadra: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Telefono</Label>
                  <Input
                    value={form.telefono}
                    onChange={(e) =>
                      setForm({ ...form, telefono: e.target.value })
                    }
                  />
                </div>
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
                onClick={handleSave}
                disabled={
                  !form.nome ||
                  createSquadra.isPending ||
                  updateSquadra.isPending
                }
              >
                {editId ? "Aggiorna" : "Crea squadra"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* List */}
      {squadre.data?.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Nessuna squadra registrata.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {squadre.data?.map((s: any) => {
            const active = interventiCount(s.id);
            return (
              <Card key={s.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-base">{s.nome}</h3>
                      {s.caposquadra && (
                        <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                          <UserCircle className="h-3.5 w-3.5" />
                          {s.caposquadra}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(s)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700" onClick={() => setDeleteTarget({ id: s.id, label: s.nome })}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {s.telefono && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                      <Phone className="h-3 w-3" />
                      {s.telefono}
                    </p>
                  )}

                  {s.note && (
                    <p className="text-xs text-muted-foreground border-l-2 pl-2 mb-3">
                      {s.note}
                    </p>
                  )}

                  <div className="flex items-center gap-2">
                    <Badge
                      variant={active > 0 ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {active} interventi attivi
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Elimina squadra"
        description={`Eliminare "${deleteTarget?.label}"? Questa azione non puo essere annullata.`}
        onConfirm={() => deleteTarget && deleteSquadra.mutate(deleteTarget.id)}
      />
    </div>
  );
}
