import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Ruler,
  AlertTriangle,
  ClipboardCheck,
  Hammer,
  FileText,
  Contact,
  Trash2,
  ChevronRight,
  Pencil,
} from "lucide-react";
import { useState } from "react";
import { useLocation, useParams } from "wouter";
import ConfirmDialog from "@/components/ConfirmDialog";
import TimelineOrdine from "@/components/TimelineOrdine";

const statoAperturaColors: Record<string, string> = {
  da_rilevare: "bg-gray-100 text-gray-700",
  rilevata: "bg-blue-100 text-blue-800",
  ordinata: "bg-purple-100 text-purple-800",
  consegnata: "bg-amber-100 text-amber-800",
  in_posa: "bg-orange-100 text-orange-800",
  posata: "bg-green-100 text-green-800",
  verificata: "bg-emerald-100 text-emerald-800",
};

export default function CommessaDetail() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const commessaId = parseInt(params.id ?? "0");

  const commessa = trpc.commesse.byId.useQuery(commessaId);
  const aperture = trpc.aperture.byCommessa.useQuery(commessaId);
  const interventi = trpc.interventi.list.useQuery({ commessaId });
  const anomalie = trpc.anomalie.list.useQuery({ commessaId });

  const squadre = trpc.squadre.list.useQuery();

  const utils = trpc.useUtils();
  const [deleteTarget, setDeleteTarget] = useState<{ type: string; id: number; label: string } | null>(null);
  const [interventoDialog, setInterventoDialog] = useState(false);
  const [interventoForm, setInterventoForm] = useState({
    tipo: "posa" as string,
    dataPianificata: "",
    squadraId: "" as string,
    indirizzo: "",
    note: "",
  });

  const deleteApertura = trpc.aperture.delete.useMutation({
    onSuccess: () => { utils.aperture.byCommessa.invalidate(commessaId); setDeleteTarget(null); },
  });
  const deleteIntervento = trpc.interventi.delete.useMutation({
    onSuccess: () => { utils.interventi.list.invalidate(); setDeleteTarget(null); },
  });
  const createIntervento = trpc.interventi.create.useMutation({
    onSuccess: () => {
      utils.interventi.list.invalidate();
      setInterventoDialog(false);
      setInterventoForm({ tipo: "posa", dataPianificata: "", squadraId: "", indirizzo: "", note: "" });
    },
  });
  const updateCommessa = trpc.commesse.update.useMutation({
    onSuccess: () => utils.commesse.byId.invalidate(commessaId),
  });
  const deleteCommessa = trpc.commesse.delete.useMutation({
    onSuccess: () => { setDeleteTarget(null); setLocation("/commesse"); },
  });

  const [aperturaDialog, setAperturaDialog] = useState(false);
  const [aperturaForm, setAperturaForm] = useState({
    codice: "",
    descrizione: "",
    piano: "",
    locale: "",
    tipologia: "finestra" as const,
    larghezza: "",
    altezza: "",
    materiale: "",
    colore: "",
    vetro: "",
    noteRilievo: "",
    criticitaAccesso: "",
  });

  const createApertura = trpc.aperture.create.useMutation({
    onSuccess: () => {
      utils.aperture.byCommessa.invalidate(commessaId);
      setAperturaDialog(false);
      setAperturaForm({
        codice: "",
        descrizione: "",
        piano: "",
        locale: "",
        tipologia: "finestra",
        larghezza: "",
        altezza: "",
        materiale: "",
        colore: "",
        vetro: "",
        noteRilievo: "",
        criticitaAccesso: "",
      });
    },
  });

  const c = commessa.data;
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
              {c.indirizzo}, {c.citta}
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
          {c.dataConsegnaPrevista && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              Consegna prevista: {c.dataConsegnaPrevista}
            </span>
          )}
        </div>
        {c.note && (
          <p className="text-sm text-muted-foreground mt-2 border-l-2 pl-3">
            {c.note}
          </p>
        )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="aperture">
        <TabsList>
          <TabsTrigger value="aperture">
            Aperture ({aperture.data?.length ?? 0})
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

        {/* Aperture Tab */}
        <TabsContent value="aperture" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Dialog open={aperturaDialog} onOpenChange={setAperturaDialog}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Nuova apertura
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Nuova apertura — Rilievo</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3 py-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Codice *</Label>
                      <Input
                        placeholder="A1-F01"
                        value={aperturaForm.codice}
                        onChange={(e) =>
                          setAperturaForm({
                            ...aperturaForm,
                            codice: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Tipologia</Label>
                      <Select
                        value={aperturaForm.tipologia}
                        onValueChange={(v: any) =>
                          setAperturaForm({ ...aperturaForm, tipologia: v })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="finestra">Finestra</SelectItem>
                          <SelectItem value="portafinestra">
                            Portafinestra
                          </SelectItem>
                          <SelectItem value="porta">Porta</SelectItem>
                          <SelectItem value="scorrevole">Scorrevole</SelectItem>
                          <SelectItem value="fisso">Fisso</SelectItem>
                          <SelectItem value="altro">Altro</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Descrizione</Label>
                    <Input
                      value={aperturaForm.descrizione}
                      onChange={(e) =>
                        setAperturaForm({
                          ...aperturaForm,
                          descrizione: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Piano</Label>
                      <Input
                        placeholder="PT, 1, 2..."
                        value={aperturaForm.piano}
                        onChange={(e) =>
                          setAperturaForm({
                            ...aperturaForm,
                            piano: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Locale</Label>
                      <Input
                        placeholder="Soggiorno, Camera..."
                        value={aperturaForm.locale}
                        onChange={(e) =>
                          setAperturaForm({
                            ...aperturaForm,
                            locale: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label>Larghezza (mm)</Label>
                      <Input
                        type="number"
                        value={aperturaForm.larghezza}
                        onChange={(e) =>
                          setAperturaForm({
                            ...aperturaForm,
                            larghezza: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Altezza (mm)</Label>
                      <Input
                        type="number"
                        value={aperturaForm.altezza}
                        onChange={(e) =>
                          setAperturaForm({
                            ...aperturaForm,
                            altezza: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Materiale</Label>
                      <Input
                        placeholder="PVC, Alluminio..."
                        value={aperturaForm.materiale}
                        onChange={(e) =>
                          setAperturaForm({
                            ...aperturaForm,
                            materiale: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Colore</Label>
                      <Input
                        value={aperturaForm.colore}
                        onChange={(e) =>
                          setAperturaForm({
                            ...aperturaForm,
                            colore: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Vetro</Label>
                      <Input
                        placeholder="Doppio vetro 4/16/4..."
                        value={aperturaForm.vetro}
                        onChange={(e) =>
                          setAperturaForm({
                            ...aperturaForm,
                            vetro: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Note rilievo</Label>
                    <Textarea
                      rows={2}
                      value={aperturaForm.noteRilievo}
                      onChange={(e) =>
                        setAperturaForm({
                          ...aperturaForm,
                          noteRilievo: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Criticita accesso</Label>
                    <Textarea
                      rows={2}
                      placeholder="Passaggi stretti, scale, ascensore..."
                      value={aperturaForm.criticitaAccesso}
                      onChange={(e) =>
                        setAperturaForm({
                          ...aperturaForm,
                          criticitaAccesso: e.target.value,
                        })
                      }
                    />
                  </div>
                  <Button
                    onClick={() =>
                      createApertura.mutate({
                        commessaId,
                        ...aperturaForm,
                        larghezza: aperturaForm.larghezza || undefined,
                        altezza: aperturaForm.altezza || undefined,
                        noteRilievo: aperturaForm.noteRilievo || undefined,
                        criticitaAccesso:
                          aperturaForm.criticitaAccesso || undefined,
                      })
                    }
                    disabled={
                      !aperturaForm.codice || createApertura.isPending
                    }
                  >
                    Salva apertura
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {aperture.data?.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Nessuna apertura registrata. Inizia il rilievo aggiungendo le
              aperture.
            </div>
          ) : (
            <div className="grid gap-3">
              {aperture.data?.map((a: any) => (
                <Card key={a.id} className="hover:shadow-sm transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold">
                            {a.codice}
                          </span>
                          <span
                            className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-sm ${statoAperturaColors[a.stato] ?? "bg-gray-100"}`}
                          >
                            {a.stato.replace(/_/g, " ")}
                          </span>
                          <Badge variant="outline" className="text-[10px]">
                            {a.tipologia}
                          </Badge>
                        </div>
                        {a.descrizione && (
                          <p className="text-sm font-medium">
                            {a.descrizione}
                          </p>
                        )}
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          {a.piano && <span>Piano: {a.piano}</span>}
                          {a.locale && <span>Locale: {a.locale}</span>}
                          {a.larghezza && a.altezza && (
                            <span className="flex items-center gap-1">
                              <Ruler className="h-3 w-3" />
                              {a.larghezza} x {a.altezza} mm
                            </span>
                          )}
                          {a.materiale && <span>{a.materiale}</span>}
                          {a.colore && <span>{a.colore}</span>}
                        </div>
                        {a.noteRilievo && (
                          <p className="text-xs text-muted-foreground border-l-2 pl-2 mt-1">
                            {a.noteRilievo}
                          </p>
                        )}
                        {a.criticitaAccesso && (
                          <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                            <AlertTriangle className="h-3 w-3" />
                            {a.criticitaAccesso}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          onClick={() =>
                            setLocation(
                              `/commesse/${commessaId}/aperture/${a.id}/rilievo`
                            )
                          }
                        >
                          <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
                          Rilievo
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 px-2"
                          onClick={() => setDeleteTarget({ type: "apertura", id: a.id, label: a.codice })}
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
                          <SelectItem value="sopralluogo">Sopralluogo</SelectItem>
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
                      indirizzo: interventoForm.indirizzo || c.indirizzo ? `${c.indirizzo}, ${c.citta}` : undefined,
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

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Eliminare ${deleteTarget?.type ?? ""}?`}
        description={`Stai per eliminare "${deleteTarget?.label}". Questa azione non puo essere annullata.`}
        onConfirm={() => {
          if (!deleteTarget) return;
          if (deleteTarget.type === "apertura") deleteApertura.mutate(deleteTarget.id);
          else if (deleteTarget.type === "intervento") deleteIntervento.mutate(deleteTarget.id);
          else if (deleteTarget.type === "commessa") deleteCommessa.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
