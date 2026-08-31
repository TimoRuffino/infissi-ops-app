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
import { HardHat, Plus, Phone, UserCircle, Pencil, Trash2, Building2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useAuth } from "@/_core/hooks/useAuth";
import { isDirezione } from "@/lib/roles";
import StatoChip from "@/components/StatoChip";
import { toast } from "sonner";

// Fasi in cui la commessa è "in mano alla squadra": dalla posa in poi.
const FASI_POSA = ["attesa_posa", "finiture_saldo", "interventi_regolazioni"];

type DeleteTarget = { id: number; label: string } | null;

export default function SquadreList() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const [, setLocation] = useLocation();
  const { user } = useAuth();
  // La lista è aperta a tutti i ruoli (serve sapere chi è in cantiere);
  // creare/modificare/eliminare resta direzione, come lato server.
  const puoModificare = isDirezione(user);

  const squadre = trpc.squadre.list.useQuery();
  const interventi = trpc.interventi.list.useQuery({});
  const commesse = trpc.commesse.list.useQuery({});
  const utils = trpc.useUtils();

  // Commesse assegnate a ciascuna squadra, solo quelle ancora attive: è la
  // risposta a "questa squadra su cosa sta lavorando?".
  const commessePerSquadra = useMemo(() => {
    const m = new Map<number, any[]>();
    for (const c of commesse.data ?? []) {
      if (!c.squadraId || c.archivedAt || c.stato === "archiviata") continue;
      const arr = m.get(c.squadraId) ?? [];
      arr.push(c);
      m.set(c.squadraId, arr);
    }
    return m;
  }, [commesse.data]);

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
      toast.success("Squadra eliminata");
    },
    onError: (e) => toast.error(e.message ?? "Eliminazione non riuscita"),
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
          <h1 className="font-display text-[28px] leading-[34px] font-bold tracking-[-0.02em] flex items-center gap-2">
            <HardHat className="h-6 w-6 text-primary" />
            Squadre di posa
          </h1>
          <p className="text-text-2 text-sm mt-1">
            Chi è in cantiere e su quali commesse
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
          {puoModificare && (
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Nuova squadra
              </Button>
            </DialogTrigger>
          )}
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
            const assegnate = (commessePerSquadra.get(s.id) ?? []).sort(
              (a: any, b: any) => {
                // Prima le commesse già in fase di posa: sono quelle su cui
                // la squadra è operativa adesso.
                const ap = FASI_POSA.includes(a.stato) ? 0 : 1;
                const bp = FASI_POSA.includes(b.stato) ? 0 : 1;
                return ap - bp || String(a.codice).localeCompare(String(b.codice));
              }
            );
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
                    {puoModificare && (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(s)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-danger hover:text-danger" onClick={() => setDeleteTarget({ id: s.id, label: s.nome })}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
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

                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant={active > 0 ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {active} interventi attivi
                    </Badge>
                    {assegnate.length > 0 && (
                      <Badge variant="outline" className="text-xs">
                        {assegnate.length}{" "}
                        {assegnate.length === 1 ? "commessa" : "commesse"}
                      </Badge>
                    )}
                  </div>

                  {/* Commesse assegnate: il "su cosa sta lavorando" della
                      squadra, con le fasi di posa in evidenza. */}
                  {assegnate.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border space-y-1">
                      {assegnate.map((c: any) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setLocation(`/commesse/${c.id}`)}
                          className="w-full flex items-start gap-2 text-left text-xs rounded-md px-1.5 py-1.5 hover:bg-surface-2"
                        >
                          <Building2 className="h-3 w-3 text-text-3 shrink-0 mt-0.5" />
                          {/* Due righe: in una sola il nome finiva troncato a
                              tre lettere, schiacciato da codice e chip. */}
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium truncate">
                              {c.cliente}
                            </span>
                            <span className="flex items-center gap-1.5 mt-0.5">
                              <span className="codice-mono text-text-3">
                                {c.codice}
                              </span>
                              <StatoChip stato={c.stato} />
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
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
        confirmLabel="Elimina squadra"
        onConfirm={() => deleteTarget && deleteSquadra.mutate(deleteTarget.id)}
      />
    </div>
  );
}
