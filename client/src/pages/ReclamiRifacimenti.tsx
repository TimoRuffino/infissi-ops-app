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
  AlertTriangle,
  RefreshCw,
  Trash2,
  Pencil,
  Clock,
} from "lucide-react";
import { useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";

type DeleteTarget = { type: "reclamo" | "rifacimento"; id: number; label: string } | null;

const statoReclamoColors: Record<string, string> = {
  aperto: "bg-red-100 text-red-800",
  in_gestione: "bg-amber-100 text-amber-800",
  risolto: "bg-green-100 text-green-800",
  chiuso: "bg-gray-100 text-gray-600",
};

const statoRifacimentoColors: Record<string, string> = {
  aperto: "bg-red-100 text-red-800",
  in_gestione: "bg-amber-100 text-amber-800",
  in_produzione: "bg-indigo-100 text-indigo-800",
  completato: "bg-green-100 text-green-800",
  chiuso: "bg-gray-100 text-gray-600",
};

export default function ReclamiRifacimenti() {
  const [reclamoDialogOpen, setReclamoDialogOpen] = useState(false);
  const [rifacimentoDialogOpen, setRifacimentoDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const reclami = trpc.reclamiRifacimenti.reclami.list.useQuery({});
  const rifacimenti = trpc.reclamiRifacimenti.rifacimenti.list.useQuery({});
  const reclamiStats = trpc.reclamiRifacimenti.reclami.stats.useQuery();
  const rifacimentiStats = trpc.reclamiRifacimenti.rifacimenti.stats.useQuery();
  const commesse = trpc.commesse.list.useQuery({});
  const utils = trpc.useUtils();

  const createReclamo = trpc.reclamiRifacimenti.reclami.create.useMutation({
    onSuccess: () => { utils.reclamiRifacimenti.reclami.invalidate(); setReclamoDialogOpen(false); },
  });
  const updateReclamo = trpc.reclamiRifacimenti.reclami.update.useMutation({
    onSuccess: () => utils.reclamiRifacimenti.invalidate(),
  });
  const deleteReclamo = trpc.reclamiRifacimenti.reclami.delete.useMutation({
    onSuccess: () => { utils.reclamiRifacimenti.reclami.invalidate(); setDeleteTarget(null); },
  });

  const createRifacimento = trpc.reclamiRifacimenti.rifacimenti.create.useMutation({
    onSuccess: () => { utils.reclamiRifacimenti.rifacimenti.invalidate(); setRifacimentoDialogOpen(false); },
  });
  const updateRifacimento = trpc.reclamiRifacimenti.rifacimenti.update.useMutation({
    onSuccess: () => utils.reclamiRifacimenti.invalidate(),
  });
  const deleteRifacimento = trpc.reclamiRifacimenti.rifacimenti.delete.useMutation({
    onSuccess: () => { utils.reclamiRifacimenti.rifacimenti.invalidate(); setDeleteTarget(null); },
  });

  const [reclamoForm, setReclamoForm] = useState({ commessaId: "", clienteNome: "", descrizione: "", responsabile: "" });
  const [rifacimentoForm, setRifacimentoForm] = useState({
    commessaId: "", clienteNome: "", descrizione: "", elemento: "",
    fornitoreCoinvolto: "", costoStimato: "", responsabilita: "interna" as string, responsabile: "",
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reclami & Rifacimenti</h1>
        <p className="text-muted-foreground text-sm mt-1">Gestione reclami e rifacimenti post-vendita</p>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <AlertTriangle className="h-3.5 w-3.5 text-red-600" /> Reclami aperti
            </div>
            <p className="text-2xl font-bold">{reclamiStats.data?.aperti ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Clock className="h-3.5 w-3.5" /> Reclami in gestione
            </div>
            <p className="text-2xl font-bold">{reclamiStats.data?.inGestione ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <RefreshCw className="h-3.5 w-3.5 text-indigo-600" /> Rifacimenti aperti
            </div>
            <p className="text-2xl font-bold">
              {(rifacimentiStats.data?.aperti ?? 0) + (rifacimentiStats.data?.inGestione ?? 0) + (rifacimentiStats.data?.inProduzione ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              Costo stimato rifacimenti
            </div>
            <p className="text-2xl font-bold">
              {(rifacimentiStats.data?.costoTotaleStimato ?? 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" })}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="reclami">
        <TabsList>
          <TabsTrigger value="reclami">Reclami ({reclami.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="rifacimenti">Rifacimenti ({rifacimenti.data?.length ?? 0})</TabsTrigger>
        </TabsList>

        {/* ── Reclami ────────────────────────────────────────────── */}
        <TabsContent value="reclami" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setReclamoDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Nuovo reclamo
            </Button>
          </div>
          {reclami.data?.map((r: any) => (
            <Card key={r.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{r.clienteNome}</span>
                      <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-sm ${statoReclamoColors[r.stato] ?? ""}`}>
                        {r.stato.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="text-sm">{r.descrizione}</p>
                    {r.soluzione && (
                      <p className="text-xs text-green-700 bg-green-50 rounded px-2 py-1">Soluzione: {r.soluzione}</p>
                    )}
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span>Apertura: {r.dataApertura}</span>
                      {r.responsabile && <span>Resp: {r.responsabile}</span>}
                      {r.dataRisoluzione && <span>Risolto: {r.dataRisoluzione}</span>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    {r.stato === "aperto" && (
                      <Button variant="outline" size="sm" className="text-xs h-7" disabled={updateReclamo.isPending} onClick={() => updateReclamo.mutate({ id: r.id, stato: "in_gestione" })}>
                        Gestisci
                      </Button>
                    )}
                    {r.stato === "in_gestione" && (
                      <Button variant="outline" size="sm" className="text-xs h-7" disabled={updateReclamo.isPending} onClick={() => updateReclamo.mutate({ id: r.id, stato: "risolto" })}>
                        Risolvi
                      </Button>
                    )}
                    {r.stato === "risolto" && (
                      <Button variant="outline" size="sm" className="text-xs h-7" disabled={updateReclamo.isPending} onClick={() => updateReclamo.mutate({ id: r.id, stato: "chiuso" })}>
                        Chiudi
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={() => setDeleteTarget({ type: "reclamo", id: r.id, label: r.descrizione.slice(0, 30) })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {reclami.data?.length === 0 && (
            <p className="text-center py-12 text-muted-foreground text-sm">Nessun reclamo.</p>
          )}
        </TabsContent>

        {/* ── Rifacimenti ────────────────────────────────────────── */}
        <TabsContent value="rifacimenti" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setRifacimentoDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Nuovo rifacimento
            </Button>
          </div>
          {rifacimenti.data?.map((r: any) => (
            <Card key={r.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{r.clienteNome}</span>
                      <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-sm ${statoRifacimentoColors[r.stato] ?? ""}`}>
                        {r.stato.replace(/_/g, " ")}
                      </span>
                      <Badge variant={r.responsabilita === "interna" ? "secondary" : "outline"} className="text-[10px]">
                        {r.responsabilita}
                      </Badge>
                    </div>
                    <p className="text-sm">{r.descrizione}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      {r.elemento && <span>Elemento: {r.elemento}</span>}
                      {r.fornitoreCoinvolto && <span>Fornitore: {r.fornitoreCoinvolto}</span>}
                      {r.costoStimato != null && (
                        <span className="font-semibold">{r.costoStimato.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}</span>
                      )}
                      <span>Apertura: {r.dataApertura}</span>
                      {r.responsabile && <span>Resp: {r.responsabile}</span>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    {r.stato === "aperto" && (
                      <Button variant="outline" size="sm" className="text-xs h-7" disabled={updateRifacimento.isPending} onClick={() => updateRifacimento.mutate({ id: r.id, stato: "in_gestione" })}>
                        Gestisci
                      </Button>
                    )}
                    {r.stato === "in_gestione" && (
                      <Button variant="outline" size="sm" className="text-xs h-7" disabled={updateRifacimento.isPending} onClick={() => updateRifacimento.mutate({ id: r.id, stato: "in_produzione" })}>
                        In produzione
                      </Button>
                    )}
                    {r.stato === "in_produzione" && (
                      <Button variant="outline" size="sm" className="text-xs h-7" disabled={updateRifacimento.isPending} onClick={() => updateRifacimento.mutate({ id: r.id, stato: "completato" })}>
                        Completa
                      </Button>
                    )}
                    {r.stato === "completato" && (
                      <Button variant="outline" size="sm" className="text-xs h-7" disabled={updateRifacimento.isPending} onClick={() => updateRifacimento.mutate({ id: r.id, stato: "chiuso" })}>
                        Chiudi
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={() => setDeleteTarget({ type: "rifacimento", id: r.id, label: r.descrizione.slice(0, 30) })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {rifacimenti.data?.length === 0 && (
            <p className="text-center py-12 text-muted-foreground text-sm">Nessun rifacimento.</p>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Create reclamo dialog ────────────────────────────────── */}
      <Dialog open={reclamoDialogOpen} onOpenChange={setReclamoDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nuovo reclamo</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Commessa *</Label>
              <Select value={reclamoForm.commessaId} onValueChange={(v) => {
                const c = commesse.data?.find((c: any) => c.id === parseInt(v));
                setReclamoForm({ ...reclamoForm, commessaId: v, clienteNome: c?.cliente ?? "" });
              }}>
                <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
                <SelectContent>
                  {commesse.data?.map((c: any) => (
                    <SelectItem key={c.id} value={c.id.toString()}>{c.codice} — {c.cliente}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Descrizione *</Label>
              <Textarea rows={3} value={reclamoForm.descrizione} onChange={(e) => setReclamoForm({ ...reclamoForm, descrizione: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Responsabile</Label>
              <Input value={reclamoForm.responsabile} onChange={(e) => setReclamoForm({ ...reclamoForm, responsabile: e.target.value })} />
            </div>
            <Button onClick={() => {
              if (!reclamoForm.commessaId || !reclamoForm.descrizione) return;
              createReclamo.mutate({
                commessaId: parseInt(reclamoForm.commessaId),
                clienteNome: reclamoForm.clienteNome,
                descrizione: reclamoForm.descrizione,
                responsabile: reclamoForm.responsabile || undefined,
              });
              setReclamoForm({ commessaId: "", clienteNome: "", descrizione: "", responsabile: "" });
            }} disabled={createReclamo.isPending}>
              Crea reclamo
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Create rifacimento dialog ────────────────────────────── */}
      <Dialog open={rifacimentoDialogOpen} onOpenChange={setRifacimentoDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Nuovo rifacimento</DialogTitle></DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Commessa *</Label>
                <Select value={rifacimentoForm.commessaId} onValueChange={(v) => {
                  const c = commesse.data?.find((c: any) => c.id === parseInt(v));
                  setRifacimentoForm({ ...rifacimentoForm, commessaId: v, clienteNome: c?.cliente ?? "" });
                }}>
                  <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
                  <SelectContent>
                    {commesse.data?.map((c: any) => (
                      <SelectItem key={c.id} value={c.id.toString()}>{c.codice} — {c.cliente}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Responsabilita</Label>
                <Select value={rifacimentoForm.responsabilita} onValueChange={(v) => setRifacimentoForm({ ...rifacimentoForm, responsabilita: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="interna">Interna</SelectItem>
                    <SelectItem value="esterna">Esterna</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Descrizione *</Label>
              <Textarea rows={2} value={rifacimentoForm.descrizione} onChange={(e) => setRifacimentoForm({ ...rifacimentoForm, descrizione: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Elemento da rifare</Label>
                <Input value={rifacimentoForm.elemento} onChange={(e) => setRifacimentoForm({ ...rifacimentoForm, elemento: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Fornitore coinvolto</Label>
                <Input value={rifacimentoForm.fornitoreCoinvolto} onChange={(e) => setRifacimentoForm({ ...rifacimentoForm, fornitoreCoinvolto: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Costo stimato</Label>
                <Input type="number" step="0.01" value={rifacimentoForm.costoStimato} onChange={(e) => setRifacimentoForm({ ...rifacimentoForm, costoStimato: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Responsabile</Label>
                <Input value={rifacimentoForm.responsabile} onChange={(e) => setRifacimentoForm({ ...rifacimentoForm, responsabile: e.target.value })} />
              </div>
            </div>
            <Button onClick={() => {
              if (!rifacimentoForm.commessaId || !rifacimentoForm.descrizione || !rifacimentoForm.elemento) return;
              createRifacimento.mutate({
                commessaId: parseInt(rifacimentoForm.commessaId),
                clienteNome: rifacimentoForm.clienteNome,
                descrizione: rifacimentoForm.descrizione,
                elemento: rifacimentoForm.elemento,
                fornitoreCoinvolto: rifacimentoForm.fornitoreCoinvolto || undefined,
                costoStimato: rifacimentoForm.costoStimato ? parseFloat(rifacimentoForm.costoStimato) : undefined,
                responsabilita: rifacimentoForm.responsabilita as any,
                responsabile: rifacimentoForm.responsabile || undefined,
              });
              setRifacimentoForm({ commessaId: "", clienteNome: "", descrizione: "", elemento: "", fornitoreCoinvolto: "", costoStimato: "", responsabilita: "interna", responsabile: "" });
            }} disabled={createRifacimento.isPending}>
              Crea rifacimento
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={deleteTarget?.type === "reclamo" ? "Elimina reclamo" : "Elimina rifacimento"}
        description={`Eliminare "${deleteTarget?.label}"?`}
        onConfirm={() => {
          if (!deleteTarget) return;
          if (deleteTarget.type === "reclamo") deleteReclamo.mutate(deleteTarget.id);
          else deleteRifacimento.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
