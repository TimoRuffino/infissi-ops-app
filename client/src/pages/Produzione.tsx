import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Factory,
  ClipboardList,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  PlayCircle,
  XCircle,
  Package,
  FileText,
  Wrench,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";

type DeleteTarget = { type: "nc" | "bom"; id: number; label: string } | null;

// ── Constants ───────────────────────────────────────────────────────────────

const bomStatoColors: Record<string, string> = {
  bozza: "bg-gray-100 text-gray-700",
  validata: "bg-blue-100 text-blue-800",
  in_produzione: "bg-amber-100 text-amber-800",
  completata: "bg-green-100 text-green-800",
};

const faseStatoIcons: Record<string, any> = {
  da_fare: Circle,
  in_corso: PlayCircle,
  completata: CheckCircle2,
  non_conforme: XCircle,
};

const faseStatoColors: Record<string, string> = {
  da_fare: "text-gray-400",
  in_corso: "text-blue-500",
  completata: "text-green-600",
  non_conforme: "text-red-600",
};

const ncGravitaColors: Record<string, string> = {
  lieve: "bg-yellow-100 text-yellow-800",
  media: "bg-orange-100 text-orange-800",
  grave: "bg-red-100 text-red-800",
  bloccante: "bg-red-200 text-red-900 font-bold",
};

const ncTipoLabels: Record<string, string> = {
  materiale_difettoso: "Materiale difettoso",
  errore_taglio: "Errore taglio",
  errore_assemblaggio: "Errore assemblaggio",
  vetro_rotto: "Vetro rotto",
  ferramenta_errata: "Ferramenta errata",
  altro: "Altro",
};

const compTipoColors: Record<string, string> = {
  profilo: "bg-blue-100 text-blue-800",
  vetro: "bg-cyan-100 text-cyan-800",
  ferramenta: "bg-amber-100 text-amber-800",
  guarnizione: "bg-green-100 text-green-800",
  accessorio: "bg-purple-100 text-purple-800",
};

// ── Component ───────────────────────────────────────────────────────────────

export default function Produzione() {
  const [ncDialogOpen, setNcDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const bomStats = trpc.produzione.bom.stats.useQuery({});
  const fasiStats = trpc.produzione.fasi.stats.useQuery({});
  const ncStats = trpc.produzione.nc.stats.useQuery();
  const bomList = trpc.produzione.bom.list.useQuery({});
  const fasiList = trpc.produzione.fasi.list.useQuery({});
  const ncList = trpc.produzione.nc.list.useQuery({});

  const utils = trpc.useUtils();

  const toggleChecklist = trpc.produzione.fasi.toggleChecklist.useMutation({
    onSuccess: () => utils.produzione.fasi.invalidate(),
  });

  const updateFaseStato = trpc.produzione.fasi.updateStato.useMutation({
    onSuccess: () => {
      utils.produzione.fasi.invalidate();
    },
  });

  const createNc = trpc.produzione.nc.create.useMutation({
    onSuccess: () => {
      utils.produzione.nc.invalidate();
      setNcDialogOpen(false);
    },
  });

  const updateNcStato = trpc.produzione.nc.updateStato.useMutation({
    onSuccess: () => utils.produzione.nc.invalidate(),
  });

  const deleteNc = trpc.produzione.nc.delete.useMutation({
    onSuccess: () => {
      utils.produzione.nc.invalidate();
      setDeleteTarget(null);
    },
  });

  const deleteBom = trpc.produzione.bom.delete.useMutation({
    onSuccess: () => {
      utils.produzione.bom.invalidate();
      setDeleteTarget(null);
    },
  });

  const [ncForm, setNcForm] = useState({
    commessaId: "1",
    tipo: "altro" as string,
    gravita: "media" as string,
    descrizione: "",
    segnalataDa: "",
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Factory className="h-6 w-6" />
            Produzione & Laboratorio
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Distinte base, assemblaggio, controllo qualita
          </p>
        </div>
        <Dialog open={ncDialogOpen} onOpenChange={setNcDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50">
              <AlertTriangle className="h-4 w-4 mr-1" />
              Segnala NC
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nuova Non Conformita</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Tipo</Label>
                  <Select value={ncForm.tipo} onValueChange={(v) => setNcForm({ ...ncForm, tipo: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(ncTipoLabels).map(([k, l]) => (
                        <SelectItem key={k} value={k}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Gravita</Label>
                  <Select value={ncForm.gravita} onValueChange={(v) => setNcForm({ ...ncForm, gravita: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lieve">Lieve</SelectItem>
                      <SelectItem value="media">Media</SelectItem>
                      <SelectItem value="grave">Grave</SelectItem>
                      <SelectItem value="bloccante">Bloccante</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Descrizione *</Label>
                <Textarea rows={3} value={ncForm.descrizione} onChange={(e) => setNcForm({ ...ncForm, descrizione: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Segnalata da *</Label>
                <Input value={ncForm.segnalataDa} onChange={(e) => setNcForm({ ...ncForm, segnalataDa: e.target.value })} />
              </div>
              <Button
                onClick={() =>
                  createNc.mutate({
                    commessaId: parseInt(ncForm.commessaId),
                    tipo: ncForm.tipo as any,
                    gravita: ncForm.gravita as any,
                    descrizione: ncForm.descrizione,
                    segnalataDa: ncForm.segnalataDa,
                  })
                }
                disabled={!ncForm.descrizione || !ncForm.segnalataDa || createNc.isPending}
              >
                Segnala non conformita
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <FileText className="h-3.5 w-3.5" /> Distinte base
            </div>
            <p className="text-2xl font-bold">{bomStats.data?.totale ?? 0}</p>
            <p className="text-xs text-muted-foreground">
              {bomStats.data?.inProduzione ?? 0} in produzione
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Wrench className="h-3.5 w-3.5" /> Fasi totali
            </div>
            <p className="text-2xl font-bold">{fasiStats.data?.totale ?? 0}</p>
            <p className="text-xs text-muted-foreground">
              {fasiStats.data?.inCorso ?? 0} in corso
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> Completate
            </div>
            <p className="text-2xl font-bold">{fasiStats.data?.completate ?? 0}</p>
            <Progress
              value={fasiStats.data?.totale ? ((fasiStats.data.completate / fasiStats.data.totale) * 100) : 0}
              className="mt-1 h-1.5"
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <AlertTriangle className="h-3.5 w-3.5 text-red-600" /> Non conformita
            </div>
            <p className="text-2xl font-bold">{ncStats.data?.aperte ?? 0}</p>
            <p className="text-xs text-muted-foreground">
              aperte ({ncStats.data?.bloccanti ?? 0} bloccanti)
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Clock className="h-3.5 w-3.5" /> Da fare
            </div>
            <p className="text-2xl font-bold">{fasiStats.data?.daFare ?? 0}</p>
            <p className="text-xs text-muted-foreground">fasi in attesa</p>
          </CardContent>
        </Card>
      </div>

      {/* Main tabs */}
      <Tabs defaultValue="pipeline">
        <TabsList>
          <TabsTrigger value="pipeline">Pipeline assemblaggio</TabsTrigger>
          <TabsTrigger value="bom">Distinte base ({bomList.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="nc">Non conformita ({ncList.data?.length ?? 0})</TabsTrigger>
        </TabsList>

        {/* ── Pipeline assemblaggio ──────────────────────────────────── */}
        <TabsContent value="pipeline" className="space-y-4 mt-4">
          {fasiList.data?.map((fase: any) => {
            const Icon = faseStatoIcons[fase.stato] ?? Circle;
            const colorClass = faseStatoColors[fase.stato] ?? "";
            const completati = fase.checklistItems.filter((c: any) => c.completato).length;
            const totali = fase.checklistItems.length;
            const progress = totali > 0 ? (completati / totali) * 100 : 0;

            return (
              <Card key={fase.id} className={fase.stato === "non_conforme" ? "border-red-300" : ""}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <Icon className={`h-5 w-5 ${colorClass}`} />
                        <span className="font-semibold">{fase.fase}</span>
                        <Badge variant="outline" className="text-[10px]">
                          Fase {fase.ordine}
                        </Badge>
                        {fase.operatore && (
                          <span className="text-xs text-muted-foreground">— {fase.operatore}</span>
                        )}
                      </div>

                      {/* Progress */}
                      <div className="flex items-center gap-2">
                        <Progress value={progress} className="h-1.5 flex-1" />
                        <span className="text-xs text-muted-foreground shrink-0">
                          {completati}/{totali}
                        </span>
                      </div>

                      {/* Checklist */}
                      <div className="grid gap-1 pl-1">
                        {fase.checklistItems.map((item: any) => (
                          <label
                            key={item.id}
                            className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5"
                          >
                            <input
                              type="checkbox"
                              checked={item.completato}
                              onChange={() =>
                                toggleChecklist.mutate({
                                  faseId: fase.id,
                                  checklistItemId: item.id,
                                  completato: !item.completato,
                                  esito: !item.completato ? "ok" : undefined,
                                })
                              }
                              className="rounded"
                            />
                            <span className={item.completato ? "line-through text-muted-foreground" : ""}>
                              {item.descrizione}
                            </span>
                            {item.obbligatorio && !item.completato && (
                              <Badge variant="destructive" className="text-[9px] px-1 py-0">*</Badge>
                            )}
                            {item.esito === "non_conforme" && (
                              <AlertTriangle className="h-3 w-3 text-red-600" />
                            )}
                          </label>
                        ))}
                      </div>

                      {/* Date */}
                      <div className="flex gap-3 text-xs text-muted-foreground">
                        {fase.dataInizio && <span>Inizio: {fase.dataInizio}</span>}
                        {fase.dataFine && <span>Fine: {fase.dataFine}</span>}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-col gap-1.5 shrink-0">
                      {fase.stato === "da_fare" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateFaseStato.mutate({ id: fase.id, stato: "in_corso" })}
                        >
                          <PlayCircle className="h-3.5 w-3.5 mr-1" /> Avvia
                        </Button>
                      )}
                      {fase.stato === "in_corso" && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => updateFaseStato.mutate({ id: fase.id, stato: "completata" })}
                            disabled={fase.checklistItems.some((c: any) => c.obbligatorio && !c.completato)}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Completa
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-red-200 text-red-700"
                            onClick={() => updateFaseStato.mutate({ id: fase.id, stato: "non_conforme" })}
                          >
                            <XCircle className="h-3.5 w-3.5 mr-1" /> NC
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {fasiList.data?.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">Nessuna fase di produzione.</div>
          )}
        </TabsContent>

        {/* ── Distinte base ──────────────────────────────────────────── */}
        <TabsContent value="bom" className="space-y-4 mt-4">
          {bomList.data?.map((bom: any) => (
            <Card key={bom.id}>
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    BOM #{bom.id} — Commessa {bom.commessaId}, Apertura {bom.aperturaId}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-sm ${bomStatoColors[bom.stato] ?? ""}`}>
                      {bom.stato.replace(/_/g, " ")}
                    </span>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:text-red-700" onClick={() => setDeleteTarget({ type: "bom", id: bom.id, label: `BOM #${bom.id}` })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {bom.validataDa && (
                  <p className="text-xs text-muted-foreground mb-2">
                    Validata da {bom.validataDa} il {bom.dataValidazione}
                    {bom.noteValidazione && ` — ${bom.noteValidazione}`}
                  </p>
                )}
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-2 py-1.5">Tipo</th>
                        <th className="text-left px-2 py-1.5">Descrizione</th>
                        <th className="text-left px-2 py-1.5">Codice</th>
                        <th className="text-right px-2 py-1.5">Q.ta</th>
                        <th className="text-left px-2 py-1.5">Lotto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bom.componenti.map((c: any) => (
                        <tr key={c.id} className="border-t">
                          <td className="px-2 py-1">
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-sm ${compTipoColors[c.tipo] ?? ""}`}>
                              {c.tipo}
                            </span>
                          </td>
                          <td className="px-2 py-1">{c.descrizione}</td>
                          <td className="px-2 py-1 font-mono text-muted-foreground">{c.codiceArticolo ?? "—"}</td>
                          <td className="text-right px-2 py-1">{c.quantita} {c.unitaMisura}</td>
                          <td className="px-2 py-1 font-mono">{c.lotto ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
          {bomList.data?.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">Nessuna distinta base.</div>
          )}
        </TabsContent>

        {/* ── Non conformita ─────────────────────────────────────────── */}
        <TabsContent value="nc" className="space-y-4 mt-4">
          {ncList.data?.map((nc: any) => (
            <Card key={nc.id} className={nc.stato === "aperta" && nc.gravita === "bloccante" ? "border-red-400" : ""}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <AlertTriangle className={`h-4 w-4 ${nc.gravita === "bloccante" || nc.gravita === "grave" ? "text-red-600" : "text-amber-600"}`} />
                      <span className="font-semibold text-sm">{ncTipoLabels[nc.tipo] ?? nc.tipo}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-sm ${ncGravitaColors[nc.gravita] ?? ""}`}>
                        {nc.gravita.toUpperCase()}
                      </span>
                      <Badge variant={nc.stato === "aperta" ? "destructive" : nc.stato === "chiusa" ? "secondary" : "outline"} className="text-[10px]">
                        {nc.stato.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <p className="text-sm">{nc.descrizione}</p>
                    {nc.azioneCorrettiva && (
                      <p className="text-xs text-green-700 bg-green-50 rounded px-2 py-1">
                        Azione correttiva: {nc.azioneCorrettiva}
                      </p>
                    )}
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span>Segnalata da: {nc.segnalataDa}</span>
                      <span>Apertura: {nc.dataApertura}</span>
                      {nc.dataChiusura && <span>Chiusura: {nc.dataChiusura}</span>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {nc.stato === "aperta" && (
                      <Button size="sm" variant="outline" disabled={updateNcStato.isPending} onClick={() => updateNcStato.mutate({ id: nc.id, stato: "in_gestione" })}>
                        In gestione
                      </Button>
                    )}
                    {nc.stato === "in_gestione" && (
                      <Button size="sm" variant="outline" disabled={updateNcStato.isPending} onClick={() => updateNcStato.mutate({ id: nc.id, stato: "risolta" })}>
                        Risolta
                      </Button>
                    )}
                    {nc.stato === "risolta" && (
                      <Button size="sm" disabled={updateNcStato.isPending} onClick={() => updateNcStato.mutate({ id: nc.id, stato: "chiusa" })}>
                        Chiudi
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:text-red-700" onClick={() => setDeleteTarget({ type: "nc", id: nc.id, label: nc.descrizione.slice(0, 40) })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {ncList.data?.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">Nessuna non conformita registrata.</div>
          )}
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={deleteTarget?.type === "bom" ? "Elimina distinta base" : "Elimina non conformita"}
        description={`Eliminare "${deleteTarget?.label}"? Questa azione non puo essere annullata.`}
        onConfirm={() => {
          if (!deleteTarget) return;
          if (deleteTarget.type === "bom") deleteBom.mutate(deleteTarget.id);
          else deleteNc.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
