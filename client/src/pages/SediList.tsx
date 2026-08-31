import { useState } from "react";
import { Store, Plus, Pencil, MapPin, Power } from "lucide-react";
import { toast } from "sonner";

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type EditForm = {
  id?: number;
  nome: string;
  citta: string;
  indirizzo: string;
  attiva: boolean;
};

const EMPTY: EditForm = { nome: "", citta: "", indirizzo: "", attiva: true };

export default function SediList() {
  const sedi = trpc.sedi.listAll.useQuery();
  const utils = trpc.useUtils();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<EditForm>(EMPTY);

  const create = trpc.sedi.create.useMutation({
    onSuccess: () => {
      utils.sedi.invalidate();
      setDialogOpen(false);
      toast.success("Sede creata", { icon: "🏢" });
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.sedi.update.useMutation({
    onSuccess: () => {
      utils.sedi.invalidate();
      setDialogOpen(false);
      toast.success("Sede aggiornata");
    },
    onError: (e) => toast.error(e.message),
  });

  function openCreate() {
    setForm(EMPTY);
    setDialogOpen(true);
  }
  function openEdit(s: any) {
    setForm({
      id: s.id,
      nome: s.nome ?? "",
      citta: s.citta ?? "",
      indirizzo: s.indirizzo ?? "",
      attiva: !!s.attiva,
    });
    setDialogOpen(true);
  }

  function save() {
    if (!form.nome.trim()) return;
    if (form.id) {
      update.mutate({
        id: form.id,
        nome: form.nome,
        citta: form.citta || null,
        indirizzo: form.indirizzo || null,
        attiva: form.attiva,
      });
    } else {
      create.mutate({
        nome: form.nome,
        citta: form.citta || undefined,
        indirizzo: form.indirizzo || undefined,
      });
    }
  }

  const list = sedi.data ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Store className="h-6 w-6 text-primary" />
            Sedi
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Ogni sede (showroom) è completamente separata: commesse, clienti,
            calendario e tutto il resto sono indipendenti. Una nuova sede parte
            vuota. Assegna le sedi agli utenti dalla pagina Utenti.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />
          Nuova sede
        </Button>
      </div>

      {/* List */}
      {sedi.isLoading && (
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {list.map((s: any) => (
          <Card key={s.id} className={s.attiva ? "" : "opacity-60"}>
            <CardContent className="flex items-start justify-between gap-3 p-4">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <Store className="h-4 w-4 text-primary shrink-0" />
                  <span className="font-semibold">{s.nome}</span>
                  {s.id === 1 && (
                    <Badge variant="secondary" className="text-[10px]">
                      Predefinita
                    </Badge>
                  )}
                  {!s.attiva && (
                    <Badge variant="outline" className="text-[10px]">
                      Disattivata
                    </Badge>
                  )}
                </div>
                {(s.indirizzo || s.citta) && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {s.indirizzo}
                    {s.indirizzo && s.citta ? ", " : ""}
                    {s.citta}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {s.id !== 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title={s.attiva ? "Disattiva" : "Riattiva"}
                    onClick={() =>
                      update.mutate({ id: s.id, attiva: !s.attiva })
                    }
                  >
                    <Power
                      className={`h-3.5 w-3.5 ${
                        s.attiva ? "text-success" : "text-muted-foreground"
                      }`}
                    />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => openEdit(s)}
                  title="Modifica"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {form.id ? "Modifica sede" : "Nuova sede"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input
                value={form.nome}
                autoFocus
                placeholder="Es. Sarzana"
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Città</Label>
                <Input
                  value={form.citta}
                  onChange={(e) => setForm({ ...form, citta: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Indirizzo</Label>
                <Input
                  value={form.indirizzo}
                  onChange={(e) =>
                    setForm({ ...form, indirizzo: e.target.value })
                  }
                />
              </div>
            </div>
            <Button
              onClick={save}
              disabled={!form.nome.trim() || create.isPending || update.isPending}
            >
              {form.id ? "Salva modifiche" : "Crea sede"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
