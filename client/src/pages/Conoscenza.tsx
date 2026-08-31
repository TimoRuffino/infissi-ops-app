// /conoscenza — il registro delle regole aziendali (solo direzione).
// Regole scritte a mano, mai dedotte. Nata per alimentare il prompt del
// vecchio agente (rimosso il 28/08/2026): oggi è consultazione interna, e il
// futuro agente la rileggerà da qui.

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ConfirmDialog from "@/components/ConfirmDialog";
import { BookOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const CATEGORIE: Array<{ value: string; label: string }> = [
  { value: "fornitori", label: "Fornitori" },
  { value: "processo", label: "Processo" },
  { value: "clienti", label: "Clienti" },
  { value: "terminologia", label: "Terminologia" },
  { value: "convenzioni", label: "Convenzioni" },
  { value: "preferenze_comunicazione", label: "Comunicazione" },
];

type Editing = { mode: "create" } | { mode: "edit"; voce: any } | null;

export default function Conoscenza() {
  const utils = trpc.useUtils();
  const voci = trpc.conoscenza.list.useQuery();
  const [editing, setEditing] = useState<Editing>(null);
  const [daEliminare, setDaEliminare] = useState<any>(null);
  const [categoria, setCategoria] = useState("convenzioni");
  const [titolo, setTitolo] = useState("");
  const [contenuto, setContenuto] = useState("");

  const invalidate = () => utils.conoscenza.invalidate();
  const create = trpc.conoscenza.create.useMutation({
    onSuccess: () => {
      toast.success("Voce aggiunta");
      setEditing(null);
      invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const update = trpc.conoscenza.update.useMutation({
    onSuccess: () => {
      setEditing(null);
      invalidate();
    },
    onError: e => toast.error(e.message),
  });
  const remove = trpc.conoscenza.delete.useMutation({
    onSuccess: () => {
      toast.success("Voce eliminata");
      setDaEliminare(null);
      invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const apriCreate = () => {
    setCategoria("convenzioni");
    setTitolo("");
    setContenuto("");
    setEditing({ mode: "create" });
  };
  const apriEdit = (voce: any) => {
    setCategoria(voce.categoria);
    setTitolo(voce.titolo);
    setContenuto(voce.contenuto);
    setEditing({ mode: "edit", voce });
  };
  const salva = () => {
    if (!titolo.trim() || !contenuto.trim()) return;
    if (editing?.mode === "create") {
      create.mutate({ categoria: categoria as any, titolo, contenuto });
    } else if (editing?.mode === "edit") {
      update.mutate({
        id: editing.voce.id,
        categoria: categoria as any,
        titolo,
        contenuto,
      });
    }
  };

  const rows = voci.data ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl min-w-0 space-y-5">
      <PageHeader
        eyebrow="Amministrazione"
        title="Conoscenza aziendale"
        description="Regole, convenzioni e preferenze scritte dalle persone: una fonte interna consultabile e governata."
        metadata={
          <span>
            {rows.length} {rows.length === 1 ? "voce" : "voci"}
          </span>
        }
        primaryAction={
          <Button onClick={apriCreate}>
            <Plus className="h-4 w-4" /> Nuova voce
          </Button>
        }
      />

      <DataSurface
        density="comfortable"
        tone="default"
        title="Registro delle regole"
        description="Le voci inattive restano visibili alla direzione ma non devono alimentare i flussi operativi."
        state={
          voci.isLoading
            ? {
                kind: "loading",
                title: "Caricamento conoscenza",
                description: "Sto preparando le regole aziendali.",
                rows: 3,
              }
            : rows.length === 0
              ? {
                  kind: "empty",
                  title: "Ancora nessuna voce",
                  description:
                    "Comincia dalle convenzioni che devono restare condivise nel tempo.",
                  action: (
                    <Button onClick={apriCreate}>
                      <Plus className="h-4 w-4" /> Nuova voce
                    </Button>
                  ),
                }
              : undefined
        }
      >
        <div className="space-y-2">
          {rows.map((v: any) => (
            <Card key={v.id} className={v.attiva ? "" : "opacity-60"}>
              <CardContent className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">
                      {CATEGORIE.find(c => c.value === v.categoria)?.label ??
                        v.categoria}
                    </Badge>
                    <span className="font-medium text-sm">{v.titolo}</span>
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {v.contenuto}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch
                    checked={v.attiva}
                    onCheckedChange={attiva =>
                      update.mutate({ id: v.id, attiva })
                    }
                    title={v.attiva ? "Attiva" : "Disattivata"}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => apriEdit(v)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setDaEliminare(v)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </DataSurface>

      <Dialog
        open={editing !== null}
        onOpenChange={o => !o && setEditing(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.mode === "create" ? "Nuova voce" : "Modifica voce"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Categoria</Label>
              <Select value={categoria} onValueChange={setCategoria}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIE.map(c => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Titolo</Label>
              <Input
                value={titolo}
                onChange={e => setTitolo(e.target.value)}
                placeholder="Es. Piano pagamenti standard"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Contenuto</Label>
              <Textarea
                value={contenuto}
                onChange={e => setContenuto(e.target.value)}
                rows={4}
                placeholder="Es. 50% alla firma, 40% a merce pronta, 10% a saldo posa. Deroghe solo con approvazione della direzione."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                Annulla
              </Button>
              <Button
                onClick={salva}
                disabled={
                  !titolo.trim() ||
                  !contenuto.trim() ||
                  create.isPending ||
                  update.isPending
                }
              >
                Salva
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={daEliminare !== null}
        onOpenChange={(o: boolean) => !o && setDaEliminare(null)}
        title="Eliminare la voce?"
        description={`«${daEliminare?.titolo}» — se vuoi solo sospenderla, disattivala con l'interruttore.`}
        confirmLabel="Elimina voce"
        onConfirm={() => daEliminare && remove.mutate(daEliminare.id)}
      />
    </div>
  );
}
