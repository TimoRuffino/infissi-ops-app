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
  BellRing,
  CalendarPlus,
  Hammer,
  CheckCircle2,
  MoreHorizontal,
  Building2,
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ConfirmDialog from "@/components/ConfirmDialog";
import SearchSelect from "@/components/SearchSelect";
import FilePreviewDialog, {
  type FilePreview,
} from "@/components/FilePreviewDialog";

type DeleteTarget = { id: number; label: string } | null;

// risolto ritirato: piegato su chiuso (il backfill server converte i vecchi)
const statoTicketColors: Record<string, string> = {
  aperto: "bg-danger-soft text-danger",
  assegnato: "bg-warning-soft text-warning",
  in_lavorazione: "bg-info-soft text-info",
  chiuso: "bg-success-soft text-success",
};

const statoTicketLabel: Record<string, string> = {
  aperto: "Aperto",
  assegnato: "Assegnato",
  in_lavorazione: "In lavorazione",
  chiuso: "Chiuso",
};

const statoInterventoColors: Record<string, string> = {
  pianificato: "bg-info-soft text-info",
  in_corso: "bg-info-soft text-info",
  completato: "bg-success-soft text-success",
  sospeso: "bg-warning-soft text-warning",
};

const CATEGORIA_LABEL: Record<string, string> = {
  difetto_prodotto: "Difetto prodotto",
  difetto_posa: "Difetto posa",
  regolazione: "Regolazione",
  sostituzione: "Sostituzione",
  garanzia: "Garanzia",
  altro: "Altro",
};

// Barra colorata a sinistra: rende leggibile la coda a colpo d'occhio —
// rosso = urgente/alta ancora aperto, verde = chiuso, grigio = ordinario.
function bordoCard(t: any): string {
  if (t.stato === "chiuso") return "border-l-[3px] border-l-success";
  if (t.priorita === "urgente" || t.priorita === "alta") {
    return "border-l-[3px] border-l-danger";
  }
  return "border-l-[3px] border-l-border";
}

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

export default function TicketList({ embedded = false }: { embedded?: boolean }) {
  const [, setLocation] = useLocation();
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
  // Interventi di assistenza collegati ai ticket: una sola query, raggruppata
  // per ticketId — così ogni card mostra il suo intervento programmato.
  const interventi = trpc.interventi.list.useQuery({});
  const squadre = trpc.squadre.list.useQuery();
  const utils = trpc.useUtils();

  // Dialog "Pianifica intervento" per un ticket.
  const [pianificaFor, setPianificaFor] = useState<any>(null);
  const [pianificaForm, setPianificaForm] = useState({
    data: new Date().toISOString().split("T")[0],
    oraInizio: "",
    oraFine: "",
    squadraId: "",
    note: "",
  });
  // Dialog sollecito.
  const [sollecitaFor, setSollecitaFor] = useState<any>(null);
  const [sollecitoNota, setSollecitoNota] = useState("");

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

  const sollecita = trpc.ticket.sollecita.useMutation({
    onSuccess: () => {
      utils.ticket.invalidate();
      setSollecitaFor(null);
      setSollecitoNota("");
      toast.success("Sollecito registrato");
    },
    onError: (e) => toast.error(e.message ?? "Sollecito non riuscito"),
  });

  const creaIntervento = trpc.interventi.create.useMutation({
    onSuccess: () => {
      utils.interventi.invalidate();
      setPianificaFor(null);
      toast.success("Intervento pianificato — lo trovi anche in Calendario");
    },
    onError: (e) => toast.error(e.message ?? "Pianificazione non riuscita"),
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
      <div className={embedded ? "flex items-center justify-end" : "flex items-center justify-between"}>
        {!embedded && (
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Post-Vendita</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Gestione ticket e assistenza
            </p>
          </div>
        )}
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
                <Label>Oggetto *</Label>
                <Input
                  autoFocus
                  placeholder="Es. Persiana non chiude, vetro graffiato..."
                  value={form.oggetto}
                  onChange={(e) =>
                    setForm({ ...form, oggetto: e.target.value })
                  }
                />
              </div>
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
        {["tutti", "aperto", "assegnato", "in_lavorazione", "chiuso"].map(
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
            <Card
              key={t.id}
              className={`transition-shadow hover:shadow-sm ${bordoCard(t)} ${
                t.stato === "chiuso" ? "opacity-70 hover:opacity-100" : ""
              }`}
            >
              <CardContent className="p-4 space-y-2.5">
                {/* Riga 1 — CHI: cliente in grassetto, poi codice commessa.
                    Il ticket riguarda una commessa: il cliente è l'ancora
                    mentale, non l'oggetto. */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-bold leading-tight truncate">
                      {commessa?.cliente ?? "Cliente non collegato"}
                    </h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      {commessa && (
                        <button
                          type="button"
                          onClick={() => setLocation(`/commesse/${commessa.id}`)}
                          className="codice-mono text-xs text-text-3 hover:text-primary hover:underline"
                          title="Apri la commessa"
                        >
                          {commessa.codice}
                        </button>
                      )}
                      <span className="codice-mono text-xs text-text-3">
                        TK-{String(t.id).padStart(4, "0")}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-md ${statoTicketColors[t.stato] ?? "bg-surface-2 text-text-2"}`}
                  >
                    {statoTicketLabel[t.stato] ?? t.stato.replace(/_/g, " ")}
                  </span>
                </div>

                {/* Riga 2 — COSA: oggetto del ticket */}
                <p className="text-sm leading-snug">{t.oggetto}</p>

                {/* Riga 3 — etichette */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {CATEGORIA_LABEL[t.categoria] ?? t.categoria.replace(/_/g, " ")}
                  </Badge>
                  {(t.priorita === "urgente" || t.priorita === "alta") && (
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                      {t.priorita.toUpperCase()}
                    </Badge>
                  )}
                  {(t.solleciti?.length ?? 0) > 0 && (
                    <Badge className="text-[10px] font-normal bg-warning-soft text-warning border-transparent">
                      <BellRing className="h-3 w-3 mr-0.5" />
                      {t.solleciti.length}{" "}
                      {t.solleciti.length === 1 ? "sollecito" : "solleciti"} · ultimo{" "}
                      {new Date(
                        t.solleciti[t.solleciti.length - 1].data
                      ).toLocaleDateString("it-IT")}
                    </Badge>
                  )}
                </div>

                {/* Descrizione — spesso è la nota To Do importata: espandibile
                    invece che troncata per sempre. */}
                {t.descrizione && (
                  <button
                    type="button"
                    onClick={() => setExpandedTicket(isExpanded ? null : t.id)}
                    className="block w-full text-left rounded-md bg-surface-2 px-2.5 py-2 hover:bg-surface-2/70"
                  >
                    <p
                      className={`text-xs text-text-2 whitespace-pre-line ${isExpanded ? "" : "line-clamp-2"}`}
                    >
                      {t.descrizione}
                    </p>
                  </button>
                )}

                {/* Interventi collegati */}
                {(interventi.data ?? [])
                  .filter((i: any) => i.ticketId === t.id)
                  .map((i: any) => (
                    <div
                      key={i.id}
                      className="flex items-center gap-2 flex-wrap rounded-md border border-info/30 bg-info-soft/40 px-2.5 py-1.5 text-xs"
                    >
                      <Hammer className="h-3.5 w-3.5 text-info shrink-0" />
                      <span className="font-medium">
                        {new Date(i.dataPianificata + "T12:00:00").toLocaleDateString("it-IT")}
                        {i.oraInizio ? ` · ${i.oraInizio}` : ""}
                      </span>
                      <span className={i.squadraId ? "text-text-2" : "text-warning font-medium"}>
                        {i.squadraId
                          ? squadre.data?.find((sq: any) => sq.id === i.squadraId)?.nome ?? "Squadra"
                          : "Senza squadra"}
                      </span>
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-sm ${statoInterventoColors[i.stato] ?? ""}`}
                      >
                        {i.stato.replace(/_/g, " ")}
                      </span>
                    </div>
                  ))}

                {t.esitoIntervento && (
                  <p className="text-xs border-l-2 border-success pl-2 text-text-2">
                    Esito: {t.esitoIntervento}
                  </p>
                )}

                {/* Footer — meta a sinistra, azioni a destra. Le azioni hanno
                    una riga propria: prima competevano con il testo e andavano
                    a capo in modo disordinato. */}
                <div className="flex items-end justify-between gap-3 pt-1 border-t border-border flex-wrap">
                  <div className="flex items-center gap-3 text-xs text-text-3 pt-1.5">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(t.createdAt).toLocaleDateString("it-IT")}
                    </span>
                    <button
                      type="button"
                      onClick={() => setExpandedTicket(isExpanded ? null : t.id)}
                      className="flex items-center gap-1 hover:text-text-1"
                    >
                      <Paperclip className="h-3 w-3" />
                      <AllegatiCount ticketId={t.id} />
                    </button>
                  </div>

                  <div className="flex items-center gap-1 flex-wrap justify-end pt-1.5">
                    {/* Avanzamento: un solo bottone primario per stato */}
                    {t.stato === "aperto" && (
                      <Button size="sm" className="text-xs h-7" disabled={updateStato.isPending} onClick={() => updateStato.mutate({ id: t.id, stato: "assegnato" })}>
                        Assegna
                      </Button>
                    )}
                    {t.stato === "assegnato" && (
                      <Button size="sm" className="text-xs h-7" disabled={updateStato.isPending} onClick={() => updateStato.mutate({ id: t.id, stato: "in_lavorazione" })}>
                        Lavora
                      </Button>
                    )}
                    {t.stato === "in_lavorazione" && (
                      <Button size="sm" className="text-xs h-7" disabled={updateStato.isPending} onClick={() => updateStato.mutate({ id: t.id, stato: "chiuso" })}>
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Chiudi
                      </Button>
                    )}
                    {t.stato !== "chiuso" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs h-7 text-warning"
                          title="Registra un sollecito"
                          onClick={() => setSollecitaFor(t)}
                        >
                          <BellRing className="h-3 w-3 mr-1" />
                          Sollecita
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs h-7 text-info"
                          title="Pianifica un intervento di assistenza"
                          onClick={() => {
                            setPianificaFor(t);
                            setPianificaForm({
                              data: new Date().toISOString().split("T")[0],
                              oraInizio: "",
                              oraFine: "",
                              squadraId: "",
                              note: "",
                            });
                          }}
                        >
                          <CalendarPlus className="h-3 w-3 mr-1" />
                          Pianifica
                        </Button>
                      </>
                    )}
                    {/* Azioni secondarie raccolte nel menu ••• */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(t)}>
                          <Pencil className="h-3.5 w-3.5 mr-2" />
                          Modifica
                        </DropdownMenuItem>
                        {commessa && (
                          <DropdownMenuItem onClick={() => setLocation(`/commesse/${commessa.id}`)}>
                            <Building2 className="h-3.5 w-3.5 mr-2" />
                            Apri commessa
                          </DropdownMenuItem>
                        )}
                        {t.stato !== "aperto" && (
                          <DropdownMenuItem
                            disabled={rollbackStato.isPending}
                            onClick={() => rollbackStato.mutate({ id: t.id })}
                          >
                            <Undo2 className="h-3.5 w-3.5 mr-2" />
                            Torna indietro di uno stato
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          className="text-danger focus:text-danger"
                          onClick={() => setDeleteTarget({ id: t.id, label: t.oggetto })}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" />
                          Elimina ticket
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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

      {/* Sollecito dialog */}
      <Dialog open={!!sollecitaFor} onOpenChange={(o) => { if (!o) { setSollecitaFor(null); setSollecitoNota(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-1.5">
              <BellRing className="h-4 w-4 text-amber-600" />
              Sollecito · {sollecitaFor?.oggetto}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            {(sollecitaFor?.solleciti?.length ?? 0) > 0 && (
              <div className="text-xs text-muted-foreground space-y-1 max-h-32 overflow-y-auto">
                {sollecitaFor.solleciti.map((so: any, i: number) => (
                  <p key={i} className="border-l-2 border-amber-300 pl-2">
                    {new Date(so.data).toLocaleDateString("it-IT")}
                    {so.nota ? ` — ${so.nota}` : ""}
                  </p>
                ))}
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Nota (a chi / per cosa)</Label>
              <Input
                autoFocus
                placeholder="Es. sollecitato fornitore Wnd per pezzo di ricambio"
                value={sollecitoNota}
                onChange={(e) => setSollecitoNota(e.target.value)}
              />
            </div>
            <Button
              disabled={sollecita.isPending}
              onClick={() => sollecita.mutate({ id: sollecitaFor.id, nota: sollecitoNota || undefined })}
            >
              Registra sollecito
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pianifica intervento dialog */}
      <Dialog open={!!pianificaFor} onOpenChange={(o) => !o && setPianificaFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-1.5">
              <CalendarPlus className="h-4 w-4 text-indigo-600" />
              Pianifica intervento · {pianificaFor?.oggetto}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Data *</Label>
                <Input
                  type="date"
                  value={pianificaForm.data}
                  onChange={(e) => setPianificaForm({ ...pianificaForm, data: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Dalle</Label>
                <Input
                  type="time"
                  value={pianificaForm.oraInizio}
                  onChange={(e) => setPianificaForm({ ...pianificaForm, oraInizio: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Alle</Label>
                <Input
                  type="time"
                  value={pianificaForm.oraFine}
                  onChange={(e) => setPianificaForm({ ...pianificaForm, oraFine: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Squadra</Label>
              <Select
                value={pianificaForm.squadraId || "__none"}
                onValueChange={(v) => setPianificaForm({ ...pianificaForm, squadraId: v === "__none" ? "" : v })}
              >
                <SelectTrigger><SelectValue placeholder="Da assegnare" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Da assegnare</SelectItem>
                  {(squadre.data ?? []).map((sq: any) => (
                    <SelectItem key={sq.id} value={String(sq.id)}>{sq.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Textarea
                rows={2}
                placeholder="Materiale da portare, dettagli..."
                value={pianificaForm.note}
                onChange={(e) => setPianificaForm({ ...pianificaForm, note: e.target.value })}
              />
            </div>
            <Button
              disabled={!pianificaForm.data || creaIntervento.isPending}
              onClick={() => {
                const commessa = commesse.data?.find((c: any) => c.id === pianificaFor.commessaId);
                creaIntervento.mutate({
                  commessaId: pianificaFor.commessaId,
                  ticketId: pianificaFor.id,
                  tipo: "assistenza",
                  dataPianificata: pianificaForm.data,
                  oraInizio: pianificaForm.oraInizio || null,
                  oraFine: pianificaForm.oraFine || null,
                  squadraId: pianificaForm.squadraId ? parseInt(pianificaForm.squadraId) : null,
                  indirizzo: commessa?.indirizzo ?? undefined,
                  note: pianificaForm.note
                    ? `[${pianificaFor.oggetto}] ${pianificaForm.note}`
                    : pianificaFor.oggetto,
                });
              }}
            >
              Pianifica intervento
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
