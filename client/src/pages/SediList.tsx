import { useState } from "react";
import { Store, Plus, Pencil, MapPin, Power } from "lucide-react";
import { toast } from "sonner";

import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
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
      toast.success("Sede creata");
    },
    onError: e => toast.error(e.message),
  });
  const update = trpc.sedi.update.useMutation({
    onSuccess: () => {
      utils.sedi.invalidate();
      setDialogOpen(false);
      toast.success("Sede aggiornata");
    },
    onError: e => toast.error(e.message),
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
    <div className="mx-auto w-full max-w-6xl min-w-0 space-y-5">
      <PageHeader
        eyebrow="Amministrazione"
        title="Sedi"
        description="Ogni showroom è un perimetro operativo separato: commesse, clienti e calendario non si mescolano."
        metadata={
          <span>
            {list.length}{" "}
            {list.length === 1 ? "sede configurata" : "sedi configurate"}
          </span>
        }
        primaryAction={
          <Button className="min-h-11" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Nuova sede
          </Button>
        }
      />

      <DataSurface
        density="comfortable"
        tone="default"
        title="Showroom e perimetri"
        description="Assegna una sede agli utenti dalla pagina Utenti. La sede predefinita resta sempre disponibile."
        state={
          sedi.isLoading
            ? {
                kind: "loading",
                title: "Caricamento sedi",
                description: "Sto preparando l'elenco degli showroom.",
                rows: 3,
              }
            : sedi.isError
              ? {
                  kind: "error",
                  title: "Non riesco a caricare le sedi",
                  description: "Controlla la connessione e riprova.",
                  action: (
                    <Button variant="outline" onClick={() => sedi.refetch()}>
                      Riprova
                    </Button>
                  ),
                }
              : list.length === 0
                ? {
                    kind: "empty",
                    title: "Nessuna sede configurata",
                    description:
                      "Crea il primo showroom per separare dati e attività operative.",
                    action: (
                      <Button onClick={openCreate}>
                        <Plus className="h-4 w-4" /> Nuova sede
                      </Button>
                    ),
                  }
                : undefined
        }
      >
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {list.map((s: any) => (
            <div key={s.id} className={s.attiva ? undefined : "opacity-60"}>
              <DataSurface density="compact" tone="sunken">
                <div className="flex min-w-0 items-start justify-between gap-3">
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
                        variant="quiet"
                        size="icon"
                        className="min-h-11 min-w-11"
                        aria-label={
                          s.attiva ? "Disattiva sede" : "Riattiva sede"
                        }
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
                      variant="quiet"
                      size="icon"
                      className="min-h-11 min-w-11"
                      onClick={() => openEdit(s)}
                      aria-label="Modifica sede"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </DataSurface>
            </div>
          ))}
        </div>
      </DataSurface>

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
                onChange={e => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Città</Label>
                <Input
                  value={form.citta}
                  onChange={e => setForm({ ...form, citta: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Indirizzo</Label>
                <Input
                  value={form.indirizzo}
                  onChange={e =>
                    setForm({ ...form, indirizzo: e.target.value })
                  }
                />
              </div>
            </div>
            <Button
              onClick={save}
              disabled={
                !form.nome.trim() || create.isPending || update.isPending
              }
            >
              {form.id ? "Salva modifiche" : "Crea sede"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
