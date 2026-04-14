import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  ArrowLeft,
  Plus,
  MapPin,
  Phone,
  Mail,
  Calendar,
  Hammer,
  FileText,
  Contact,
  Trash2,
  ChevronRight,
  Pencil,
  Upload,
  Download,
  File as FileIcon,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { useState } from "react";
import { useLocation, useParams } from "wouter";
import ConfirmDialog from "@/components/ConfirmDialog";
import TimelineOrdine from "@/components/TimelineOrdine";

const tipoDocColors: Record<string, string> = {
  preventivo: "bg-blue-100 text-blue-800",
  contratto: "bg-green-100 text-green-800",
  foto: "bg-amber-100 text-amber-800",
  altro: "bg-slate-100 text-slate-700",
};

export default function CommessaDetail() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const commessaId = parseInt(params.id ?? "0");

  const commessa = trpc.commesse.byId.useQuery(commessaId);
  const documenti = trpc.preventiviContratti.byCommessa.useQuery(commessaId);
  const interventi = trpc.interventi.list.useQuery({ commessaId });
  const anomalie = trpc.anomalie.list.useQuery({ commessaId });
  const squadre = trpc.squadre.list.useQuery();

  const utils = trpc.useUtils();
  const [deleteTarget, setDeleteTarget] = useState<{ type: string; id: number; label: string } | null>(null);
  const [interventoDialog, setInterventoDialog] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [consegnaDialog, setConsegnaDialog] = useState(false);
  const [uploadDialog, setUploadDialog] = useState(false);

  const [interventoForm, setInterventoForm] = useState({
    tipo: "posa" as string,
    dataPianificata: "",
    squadraId: "" as string,
    indirizzo: "",
    note: "",
  });

  const [editForm, setEditForm] = useState({
    indirizzo: "",
    citta: "",
    telefono: "",
    email: "",
    priorita: "media" as "bassa" | "media" | "alta" | "urgente",
    consegnaIndicativa: "60" as "30" | "60" | "90",
    note: "",
  });

  const [consegnaDate, setConsegnaDate] = useState("");

  const [uploadForm, setUploadForm] = useState({
    file: null as File | null,
    tipo: "preventivo" as "preventivo" | "contratto" | "foto" | "altro",
    note: "",
  });

  const deleteIntervento = trpc.interventi.delete.useMutation({
    onSuccess: () => { utils.interventi.list.invalidate(); setDeleteTarget(null); },
  });
  const deleteDocumento = trpc.preventiviContratti.delete.useMutation({
    onSuccess: () => { utils.preventiviContratti.byCommessa.invalidate(commessaId); setDeleteTarget(null); },
  });
  const createIntervento = trpc.interventi.create.useMutation({
    onSuccess: () => {
      utils.interventi.list.invalidate();
      setInterventoDialog(false);
      setInterventoForm({ tipo: "posa", dataPianificata: "", squadraId: "", indirizzo: "", note: "" });
    },
  });
  const updateCommessa = trpc.commesse.update.useMutation({
    onSuccess: () => {
      utils.commesse.byId.invalidate(commessaId);
      setEditDialog(false);
    },
  });
  const confermaDataConsegna = trpc.commesse.confermaDataConsegna.useMutation({
    onSuccess: () => {
      utils.commesse.byId.invalidate(commessaId);
      setConsegnaDialog(false);
      setConsegnaDate("");
    },
  });
  const uploadDocumento = trpc.preventiviContratti.upload.useMutation({
    onSuccess: () => {
      utils.preventiviContratti.byCommessa.invalidate(commessaId);
      setUploadDialog(false);
      setUploadForm({ file: null, tipo: "preventivo", note: "" });
    },
  });
  const deleteCommessa = trpc.commesse.delete.useMutation({
    onSuccess: () => { setDeleteTarget(null); setLocation("/commesse"); },
  });

  function openEdit() {
    if (!commessa.data) return;
    const c: any = commessa.data;
    setEditForm({
      indirizzo: c.indirizzo ?? "",
      citta: c.citta ?? "",
      telefono: c.telefono ?? "",
      email: c.email ?? "",
      priorita: c.priorita ?? "media",
      consegnaIndicativa: c.consegnaIndicativa ?? "60",
      note: c.note ?? "",
    });
    setEditDialog(true);
  }

  async function handleUpload() {
    if (!uploadForm.file) return;
    const file = uploadForm.file;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1] ?? "";
      uploadDocumento.mutate({
        commessaId,
        nome: file.name,
        tipo: uploadForm.tipo,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        dataBase64: base64,
        note: uploadForm.note || undefined,
      });
    };
    reader.readAsDataURL(file);
  }

  function downloadDocumento(docId: number) {
    // Fetch full record with data and trigger download via blob
    utils.preventiviContratti.byId.fetch(docId).then((doc: any) => {
      if (!doc?.dataBase64) return;
      const byteChars = atob(doc.dataBase64);
      const bytes = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
      const blob = new Blob([bytes], { type: doc.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.nome;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  const c: any = commessa.data;
  if (!c) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        {commessa.isLoading ? "Caricamento..." : "Commessa non trovata"}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/commesse")}
          className="mb-2 -ml-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Commesse
        </Button>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs text-muted-foreground">
                {c.codice}
              </span>
              <Badge variant="secondary" className="text-xs uppercase">
                {c.stato.replace(/_/g, " ")}
              </Badge>
              {c.priorita === "urgente" && (
                <Badge variant="destructive" className="text-xs">
                  URGENTE
                </Badge>
              )}
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{c.cliente}</h1>
          </div>
          <div className="flex gap-1.5 shrink-0">
            {c.clienteId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation(`/clienti/${c.clienteId}`)}
              >
                <Contact className="h-3.5 w-3.5 mr-1" />
                Scheda cliente
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={openEdit}>
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Modifica
            </Button>
            {c.stato !== "archiviata" && (() => {
              const next: Record<string, string> = {
                preventivo: "misure_esecutive", misure_esecutive: "aggiornamento_contratto",
                aggiornamento_contratto: "fatture_pagamento", fatture_pagamento: "da_ordinare",
                da_ordinare: "produzione", produzione: "ordini_ultimazione",
                ordini_ultimazione: "attesa_posa", attesa_posa: "finiture_saldo",
                finiture_saldo: "interventi_regolazioni", interventi_regolazioni: "archiviata",
              };
              const nextStato = next[c.stato];
              return nextStato ? (
                <Button
                  size="sm"
                  onClick={() => updateCommessa.mutate({ id: commessaId, stato: nextStato as any })}
                  disabled={updateCommessa.isPending}
                >
                  <ChevronRight className="h-3.5 w-3.5 mr-1" />
                  {nextStato.replace(/_/g, " ")}
                </Button>
              ) : null;
            })()}
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 hover:bg-red-50"
              onClick={() => setDeleteTarget({ type: "commessa", id: commessaId, label: c.codice })}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Info pills */}
        <div className="flex gap-4 flex-wrap mt-3 text-sm text-muted-foreground">
          {c.indirizzo && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {c.indirizzo}{c.citta ? `, ${c.citta}` : ""}
            </span>
          )}
          {c.telefono && (
            <span className="flex items-center gap-1">
              <Phone className="h-3.5 w-3.5" />
              {c.telefono}
            </span>
          )}
          {c.email && (
            <span className="flex items-center gap-1">
              <Mail className="h-3.5 w-3.5" />
              {c.email}
            </span>
          )}
          {c.dataConsegnaConfermata ? (
            <span className="flex items-center gap-1 font-medium text-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
              Data consegna prevista: {new Date(c.dataConsegnaConfermata).toLocaleDateString("it-IT")}
            </span>
          ) : c.consegnaIndicativa ? (
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              Consegna indicativa: +{c.consegnaIndicativa} giorni
            </span>
          ) : null}
        </div>
        {c.note && (
          <p className="text-sm text-muted-foreground mt-2 border-l-2 pl-3">
            {c.note}
          </p>
        )}

        {/* Produzione trigger: ask for delivery date confirmation */}
        {c.stato === "produzione" && !c.dataConsegnaConfermata && (
          <Card className="mt-4 border-amber-300 bg-amber-50/50">
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-amber-600 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Commessa in produzione</p>
                  <p className="text-xs text-muted-foreground">
                    Aggiorna la data di consegna prevista per finalizzare lo stato
                  </p>
                </div>
              </div>
              <Button size="sm" onClick={() => setConsegnaDialog(true)}>
                <Calendar className="h-3.5 w-3.5 mr-1" />
                Aggiorna data consegna
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="preventivi">
        <TabsList>
          <TabsTrigger value="preventivi">
            Preventivi / Contratti ({documenti.data?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="interventi">
            Interventi ({interventi.data?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="anomalie">
            Anomalie ({anomalie.data?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="timeline">
            Timeline ordine
          </TabsTrigger>
        </TabsList>

        {/* Preventivi/Contratti Tab */}
        <TabsContent value="preventivi" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Dialog open={uploadDialog} onOpenChange={setUploadDialog}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Upload className="h-4 w-4 mr-1" />
                  Carica file
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Carica file</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3 py-2">
                  <div className="space-y-1.5">
                    <Label>Tipo documento</Label>
                    <Select
                      value={uploadForm.tipo}
                      onValueChange={(v: any) => setUploadForm({ ...uploadForm, tipo: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="preventivo">Preventivo</SelectItem>
                        <SelectItem value="contratto">Contratto</SelectItem>
                        <SelectItem value="foto">Foto</SelectItem>
                        <SelectItem value="altro">Altro</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>File (max 10MB)</Label>
                    <Input
                      type="file"
                      onChange={(e) =>
                        setUploadForm({
                          ...uploadForm,
                          file: e.target.files?.[0] ?? null,
                        })
                      }
                    />
                    {uploadForm.file && (
                      <p className="text-xs text-muted-foreground">
                        {uploadForm.file.name} — {(uploadForm.file.size / 1024).toFixed(1)} KB
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>Note</Label>
                    <Textarea
                      rows={2}
                      value={uploadForm.note}
                      onChange={(e) => setUploadForm({ ...uploadForm, note: e.target.value })}
                    />
                  </div>
                  <Button
                    onClick={handleUpload}
                    disabled={!uploadForm.file || uploadDocumento.isPending}
                  >
                    {uploadDocumento.isPending ? "Caricamento..." : "Carica"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {documenti.data?.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Nessun documento caricato. Carica preventivi, contratti o foto.
            </div>
          ) : (
            <div className="grid gap-2">
              {documenti.data?.map((d: any) => (
                <Card key={d.id}>
                  <CardContent className="p-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <FileIcon className="h-5 w-5 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm truncate">{d.nome}</span>
                          <Badge
                            variant="secondary"
                            className={`text-[10px] ${tipoDocColors[d.tipo] ?? ""}`}
                          >
                            {d.tipo}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                          <span>{(d.size / 1024).toFixed(1)} KB</span>
                          <span>{new Date(d.createdAt).toLocaleDateString("it-IT")}</span>
                        </div>
                        {d.note && (
                          <p className="text-xs text-muted-foreground mt-1">{d.note}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => downloadDocumento(d.id)}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => setDeleteTarget({ type: "documento", id: d.id, label: d.nome })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Interventi Tab */}
        <TabsContent value="interventi" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Dialog open={interventoDialog} onOpenChange={setInterventoDialog}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" /> Nuovo intervento
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nuovo intervento</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3 py-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Tipo *</Label>
                      <Select value={interventoForm.tipo} onValueChange={(v) => setInterventoForm({ ...interventoForm, tipo: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="rilievo">Rilievo</SelectItem>
                          <SelectItem value="posa">Posa</SelectItem>
                          <SelectItem value="assistenza">Assistenza</SelectItem>
                          <SelectItem value="altro">Altro</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Data pianificata</Label>
                      <Input type="date" value={interventoForm.dataPianificata} onChange={(e) => setInterventoForm({ ...interventoForm, dataPianificata: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Squadra</Label>
                    <Select value={interventoForm.squadraId} onValueChange={(v) => setInterventoForm({ ...interventoForm, squadraId: v })}>
                      <SelectTrigger><SelectValue placeholder="Nessuna" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Nessuna</SelectItem>
                        {squadre.data?.map((s: any) => (
                          <SelectItem key={s.id} value={String(s.id)}>{s.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Indirizzo</Label>
                    <Input value={interventoForm.indirizzo} onChange={(e) => setInterventoForm({ ...interventoForm, indirizzo: e.target.value })} placeholder={c.indirizzo ? `${c.indirizzo}, ${c.citta}` : ""} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Note</Label>
                    <Textarea rows={2} value={interventoForm.note} onChange={(e) => setInterventoForm({ ...interventoForm, note: e.target.value })} />
                  </div>
                  <Button
                    onClick={() => createIntervento.mutate({
                      commessaId,
                      tipo: interventoForm.tipo as any,
                      dataPianificata: interventoForm.dataPianificata || undefined,
                      squadraId: interventoForm.squadraId && interventoForm.squadraId !== "__none__" ? parseInt(interventoForm.squadraId) : null,
                      indirizzo: interventoForm.indirizzo || (c.indirizzo ? `${c.indirizzo}, ${c.citta}` : undefined),
                      note: interventoForm.note || undefined,
                    })}
                    disabled={createIntervento.isPending}
                  >
                    Crea intervento
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {interventi.data?.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Nessun intervento pianificato per questa commessa.
            </div>
          ) : (
            <div className="grid gap-3">
              {interventi.data?.map((i: any) => (
                <Card key={i.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs uppercase">
                            {i.tipo}
                          </Badge>
                          <Badge
                            variant={
                              i.stato === "in_corso"
                                ? "default"
                                : i.stato === "completato"
                                  ? "secondary"
                                  : "outline"
                            }
                            className="text-xs"
                          >
                            {i.stato.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        {i.note && (
                          <p className="text-sm font-medium">{i.note}</p>
                        )}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {i.dataPianificata && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {i.dataPianificata}
                            </span>
                          )}
                          {i.indirizzo && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {i.indirizzo}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        {(i.tipo === "posa" || i.tipo === "assistenza") && (
                          <Button variant="outline" size="sm" className="text-xs" onClick={() => setLocation(`/posa/${i.id}`)}>
                            <Hammer className="h-3.5 w-3.5 mr-1" /> Posa
                          </Button>
                        )}
                        {(i.stato === "in_corso" || i.stato === "completato") && (
                          <Button variant="outline" size="sm" className="text-xs" onClick={() => setLocation(`/verbale/${i.id}`)}>
                            <FileText className="h-3.5 w-3.5 mr-1" /> Verbale
                          </Button>
                        )}
                        <Button
                          variant="ghost" size="sm"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 px-2"
                          onClick={() => setDeleteTarget({ type: "intervento", id: i.id, label: `${i.tipo} ${i.dataPianificata ?? ""}` })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Anomalie Tab */}
        <TabsContent value="anomalie" className="space-y-4 mt-4">
          {anomalie.data?.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Nessuna anomalia segnalata per questa commessa.
            </div>
          ) : (
            <div className="grid gap-3">
              {anomalie.data?.map((a: any) => (
                <Card
                  key={a.id}
                  className={
                    a.priorita === "critica"
                      ? "border-destructive/40"
                      : ""
                  }
                >
                  <CardContent className="p-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            a.priorita === "critica" || a.priorita === "alta"
                              ? "destructive"
                              : "outline"
                          }
                          className="text-[10px]"
                        >
                          {a.priorita}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px] uppercase">
                          {a.categoria.replace(/_/g, " ")}
                        </Badge>
                        <Badge
                          variant={
                            a.stato === "aperta"
                              ? "outline"
                              : a.stato === "risolta"
                                ? "secondary"
                                : "default"
                          }
                          className="text-[10px]"
                        >
                          {a.stato}
                        </Badge>
                      </div>
                      <p className="text-sm">{a.descrizione}</p>
                      {a.risoluzione && (
                        <p className="text-xs text-muted-foreground border-l-2 border-green-500 pl-2">
                          Risoluzione: {a.risoluzione}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Timeline ordine tab */}
        <TabsContent value="timeline" className="mt-4">
          <TimelineOrdine commessaId={commessaId} />
        </TabsContent>
      </Tabs>

      {/* Edit commessa dialog */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Modifica commessa {c.codice}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Priorita</Label>
                <Select
                  value={editForm.priorita}
                  onValueChange={(v: any) => setEditForm({ ...editForm, priorita: v })}
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
              <div className="space-y-1.5">
                <Label>Consegna indicativa</Label>
                <Select
                  value={editForm.consegnaIndicativa}
                  onValueChange={(v: any) => setEditForm({ ...editForm, consegnaIndicativa: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">+30 giorni</SelectItem>
                    <SelectItem value="60">+60 giorni</SelectItem>
                    <SelectItem value="90">+90 giorni</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Indirizzo</Label>
                <Input value={editForm.indirizzo} onChange={(e) => setEditForm({ ...editForm, indirizzo: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Citta</Label>
                <Input value={editForm.citta} onChange={(e) => setEditForm({ ...editForm, citta: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Telefono</Label>
                <Input value={editForm.telefono} onChange={(e) => setEditForm({ ...editForm, telefono: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Textarea
                rows={3}
                value={editForm.note}
                onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
              />
            </div>
            <Button
              onClick={() => updateCommessa.mutate({
                id: commessaId,
                indirizzo: editForm.indirizzo,
                citta: editForm.citta,
                telefono: editForm.telefono,
                email: editForm.email,
                priorita: editForm.priorita,
                consegnaIndicativa: editForm.consegnaIndicativa,
                note: editForm.note,
              })}
              disabled={updateCommessa.isPending}
            >
              Salva modifiche
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Conferma data consegna dialog (produzione) */}
      <Dialog open={consegnaDialog} onOpenChange={setConsegnaDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Aggiorna data consegna</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <p className="text-sm text-muted-foreground">
              Inserisci la data di consegna prevista confermata dal produttore.
            </p>
            <div className="space-y-1.5">
              <Label>Data consegna</Label>
              <Input
                type="date"
                value={consegnaDate}
                onChange={(e) => setConsegnaDate(e.target.value)}
              />
            </div>
            <Button
              onClick={() => confermaDataConsegna.mutate({ id: commessaId, dataConsegna: consegnaDate })}
              disabled={!consegnaDate || confermaDataConsegna.isPending}
            >
              Conferma data
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Eliminare ${deleteTarget?.type ?? ""}?`}
        description={`Stai per eliminare "${deleteTarget?.label}". Questa azione non puo essere annullata.`}
        onConfirm={() => {
          if (!deleteTarget) return;
          if (deleteTarget.type === "documento") deleteDocumento.mutate(deleteTarget.id);
          else if (deleteTarget.type === "intervento") deleteIntervento.mutate(deleteTarget.id);
          else if (deleteTarget.type === "commessa") deleteCommessa.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
