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
import {
  Plus,
  Clock,
  AlertCircle,
  Pencil,
  Trash2,
  Undo2,
  Upload,
  Download,
  Eye,
  Paperclip,
  X,
  File as FileIcon,
} from "lucide-react";
import { useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import SearchSelect from "@/components/SearchSelect";
import FilePreviewDialog, {
  type FilePreview,
} from "@/components/FilePreviewDialog";

type DeleteTarget = { id: number; label: string } | null;

const statoTicketColors: Record<string, string> = {
  aperto: "bg-red-100 text-red-800",
  assegnato: "bg-amber-100 text-amber-800",
  in_lavorazione: "bg-blue-100 text-blue-800",
  risolto: "bg-green-100 text-green-800",
  chiuso: "bg-gray-100 text-gray-600",
};

// Staged files added before ticket is created — uploaded right after the ticket
// row lands so that ticketId exists.
type PendingFile = { file: File; note: string };

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function TicketList() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filtroStato, setFiltroStato] = useState("tutti");
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [expandedTicket, setExpandedTicket] = useState<number | null>(null);
  const [preview, setPreview] = useState<
    (FilePreview & { allegatoId: number }) | null
  >(null);
  // Staged files to attach on creation. Uploaded after the ticket row lands.
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  // Per-ticket upload input (when attaching files to an existing ticket).
  const [uploadingFor, setUploadingFor] = useState<number | null>(null);

  const tickets = trpc.ticket.list.useQuery(
    filtroStato !== "tutti" ? { stato: filtroStato } : {}
  );
  const commesse = trpc.commesse.list.useQuery({});
  const utils = trpc.useUtils();

  const createTicket = trpc.ticket.create.useMutation({
    onSuccess: async (created) => {
      // Chain: upload any staged files against the new ticket.id, then reset
      // the form + close. Parallel uploads keep the UX snappy.
      if (pendingFiles.length > 0) {
        await Promise.all(
          pendingFiles.map(async (pf) => {
            const base64 = await fileToBase64(pf.file);
            return uploadAllegato.mutateAsync({
              ticketId: created.id,
              nome: pf.file.name,
              mimeType: pf.file.type || "application/octet-stream",
              size: pf.file.size,
              dataBase64: base64,
              note: pf.note || undefined,
            });
          })
        );
      }
      utils.ticket.invalidate();
      utils.ticketAllegati.invalidate();
      setDialogOpen(false);
      setPendingFiles([]);
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

  const rollbackStato = trpc.ticket.rollbackStato.useMutation({
    onSuccess: () => utils.ticket.invalidate(),
  });

  const deleteTicket = trpc.ticket.delete.useMutation({
    onSuccess: () => {
      utils.ticket.invalidate();
      utils.ticketAllegati.invalidate();
      setDeleteTarget(null);
    },
  });

  const uploadAllegato = trpc.ticketAllegati.upload.useMutation({
    onSuccess: () => utils.ticketAllegati.invalidate(),
  });

  const deleteAllegato = trpc.ticketAllegati.delete.useMutation({
    onSuccess: () => utils.ticketAllegati.invalidate(),
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
    // Reset form fields but keep dialog open until async upload completes.
    setForm({
      commessaId: "",
      oggetto: "",
      descrizione: "",
      categoria: "regolazione",
      priorita: "media",
    });
  }

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    setPendingFiles((prev) => [
      ...prev,
      ...picked.map((f) => ({ file: f, note: "" })),
    ]);
    // Clear the native input so the same file can be re-picked after removal.
    e.target.value = "";
  }

  async function handleAttachToExisting(ticketId: number, fileList: FileList) {
    const picked = Array.from(fileList);
    if (picked.length === 0) return;
    for (const f of picked) {
      const base64 = await fileToBase64(f);
      await uploadAllegato.mutateAsync({
        ticketId,
        nome: f.name,
        mimeType: f.type || "application/octet-stream",
        size: f.size,
        dataBase64: base64,
      });
    }
  }

  async function openAllegatoPreview(allegatoId: number) {
    const a: any = await utils.ticketAllegati.byId.fetch(allegatoId);
    if (!a?.dataBase64) return;
    const byteChars = atob(a.dataBase64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      bytes[i] = byteChars.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: a.mimeType });
    const url = URL.createObjectURL(blob);
    setPreview({
      allegatoId: a.id,
      nome: a.nome,
      mimeType: a.mimeType,
      url,
    });
  }

  async function downloadAllegato(allegatoId: number) {
    const a: any = await utils.ticketAllegati.byId.fetch(allegatoId);
    if (!a?.dataBase64) return;
    const byteChars = atob(a.dataBase64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      bytes[i] = byteChars.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: a.mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = a.nome;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function closePreview() {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  const commessaOptions = (commesse.data ?? []).map((c: any) => ({
    value: String(c.id),
    label: `${c.codice} — ${c.cliente}`,
    keywords: [c.codice, c.cliente, c.citta, c.indirizzo]
      .filter(Boolean)
      .join(" "),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Post-Vendita</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gestione ticket e assistenza
          </p>
        </div>
        <Dialog
          open={dialogOpen}
          onOpenChange={(o) => {
            setDialogOpen(o);
            if (!o) setPendingFiles([]);
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Nuovo ticket
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Apri ticket</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1.5">
                <Label>Commessa *</Label>
                <SearchSelect
                  options={commessaOptions}
                  value={form.commessaId}
                  onChange={(v) => setForm({ ...form, commessaId: v })}
                  placeholder="Seleziona commessa"
                  searchPlaceholder="Cerca per codice, cliente..."
                />
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

              {/* Attachments — staged, uploaded once ticket is created */}
              <div className="space-y-1.5">
                <Label>Allegati</Label>
                <div className="space-y-2">
                  {pendingFiles.length > 0 && (
                    <div className="space-y-1">
                      {pendingFiles.map((pf, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 text-xs rounded border px-2 py-1 bg-muted/40"
                        >
                          <FileIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate flex-1">{pf.file.name}</span>
                          <span className="text-muted-foreground shrink-0">
                            {(pf.file.size / 1024).toFixed(0)} KB
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-red-600 hover:text-red-700"
                            onClick={() =>
                              setPendingFiles((prev) =>
                                prev.filter((_, j) => j !== i)
                              )
                            }
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <label className="flex items-center justify-center gap-2 text-xs border border-dashed rounded-md py-2.5 cursor-pointer hover:bg-muted/40 transition-colors">
                    <Upload className="h-3.5 w-3.5" />
                    <span>Aggiungi file</span>
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={handleFilePick}
                    />
                  </label>
                </div>
              </div>

              <Button onClick={handleCreate} disabled={createTicket.isPending}>
                {createTicket.isPending ? "Creazione..." : "Apri ticket"}
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
          const isExpanded = expandedTicket === t.id;
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
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedTicket(isExpanded ? null : t.id)
                        }
                        className="flex items-center gap-1 hover:text-foreground"
                      >
                        <Paperclip className="h-3 w-3" />
                        <AllegatiCount ticketId={t.id} />
                      </button>
                    </div>
                    {t.esitoIntervento && (
                      <p className="text-xs border-l-2 border-green-500 pl-2 text-muted-foreground">
                        Esito: {t.esitoIntervento}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Rollback one step — hidden on first state */}
                    {t.stato !== "aperto" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7"
                        disabled={rollbackStato.isPending}
                        onClick={() => rollbackStato.mutate({ id: t.id })}
                        title="Torna allo stato precedente"
                      >
                        <Undo2 className="h-3 w-3 mr-1" />
                        Indietro
                      </Button>
                    )}
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

                {isExpanded && (
                  <AllegatiPanel
                    ticketId={t.id}
                    uploading={uploadingFor === t.id}
                    onUpload={async (fl) => {
                      setUploadingFor(t.id);
                      try {
                        await handleAttachToExisting(t.id, fl);
                      } finally {
                        setUploadingFor(null);
                      }
                    }}
                    onPreview={(id) => openAllegatoPreview(id)}
                    onDownload={(id) => downloadAllegato(id)}
                    onDelete={(id) => deleteAllegato.mutate(id)}
                  />
                )}
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

      {/* Preview dialog — reusable, large */}
      <FilePreviewDialog
        preview={preview}
        onClose={closePreview}
        onDownload={() => preview && downloadAllegato(preview.allegatoId)}
      />

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

// ── Helper components ──────────────────────────────────────────────────────

function AllegatiCount({ ticketId }: { ticketId: number }) {
  const list = trpc.ticketAllegati.byTicket.useQuery(ticketId);
  const n = list.data?.length ?? 0;
  return <>{n} {n === 1 ? "allegato" : "allegati"}</>;
}

function AllegatiPanel({
  ticketId,
  uploading,
  onUpload,
  onPreview,
  onDownload,
  onDelete,
}: {
  ticketId: number;
  uploading: boolean;
  onUpload: (fl: FileList) => void;
  onPreview: (allegatoId: number) => void;
  onDownload: (allegatoId: number) => void;
  onDelete: (allegatoId: number) => void;
}) {
  const list = trpc.ticketAllegati.byTicket.useQuery(ticketId);

  return (
    <div className="mt-3 pt-3 border-t space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground">
          Allegati ({list.data?.length ?? 0})
        </p>
        <label className="flex items-center gap-1.5 text-xs text-primary hover:underline cursor-pointer">
          <Upload className="h-3 w-3" />
          {uploading ? "Caricamento..." : "Carica file"}
          <input
            type="file"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onUpload(e.target.files);
                e.target.value = "";
              }
            }}
          />
        </label>
      </div>
      {list.data && list.data.length > 0 ? (
        <div className="space-y-1">
          {list.data.map((a: any) => (
            <div
              key={a.id}
              className="flex items-center gap-2 text-xs rounded border px-2 py-1.5 bg-muted/30"
            >
              <FileIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate flex-1 font-medium">{a.nome}</span>
              <span className="text-muted-foreground shrink-0">
                {(a.size / 1024).toFixed(0)} KB
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onPreview(a.id)}
                title="Anteprima"
              >
                <Eye className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onDownload(a.id)}
                title="Scarica"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-red-600 hover:text-red-700"
                onClick={() => onDelete(a.id)}
                title="Elimina"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">
          Nessun allegato. Usa "Carica file" per aggiungerne.
        </p>
      )}
    </div>
  );
}
