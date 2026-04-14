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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  MapPin,
  Phone,
  Mail,
  Building2,
  User,
  Landmark,
  Home,
  Calendar,
  Pencil,
  Trash2,
  Plus,
} from "lucide-react";
import { useState } from "react";
import { useLocation, useParams } from "wouter";
import ConfirmDialog from "@/components/ConfirmDialog";

const tipoIcons: Record<string, any> = {
  privato: User,
  azienda: Building2,
  condominio: Home,
  ente_pubblico: Landmark,
};

const ruoloLabels: Record<string, string> = {
  cliente_finale: "Cliente finale",
  architetto: "Architetto",
  direttore_lavori: "Dir. lavori",
  amministratore: "Amministratore",
  altro: "Altro",
};

const praticaEdiliziaLabels: Record<string, string> = {
  nessuna: "Nessuna pratica edilizia",
  cil: "CIL",
  cila: "CILA",
  scia: "SCIA",
};

export default function ClienteDetail() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const clienteId = parseInt(params.id ?? "0");

  const cliente = trpc.clienti.byId.useQuery(clienteId);
  const commesse = trpc.commesse.list.useQuery({});
  const interventi = trpc.interventi.list.useQuery({});
  const ticketList = trpc.ticket.list.useQuery({});
  const garanzieList = trpc.garanzie.list.useQuery({});

  const utils = trpc.useUtils();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editForm, setEditForm] = useState<any>(null);

  // Add dialogs
  const [addCommessaOpen, setAddCommessaOpen] = useState(false);
  const [addInterventoOpen, setAddInterventoOpen] = useState(false);
  const [addTicketOpen, setAddTicketOpen] = useState(false);
  const [addGaranziaOpen, setAddGaranziaOpen] = useState(false);

  const [commessaForm, setCommessaForm] = useState({
    priorita: "media" as "bassa" | "media" | "alta" | "urgente",
    consegnaIndicativa: "60" as "30" | "60" | "90",
    note: "",
  });
  const [interventoForm, setInterventoForm] = useState({
    commessaId: 0,
    tipo: "rilievo",
    dataPianificata: "",
    note: "",
  });
  const [ticketForm, setTicketForm] = useState({
    commessaId: 0,
    oggetto: "",
    descrizione: "",
    categoria: "regolazione",
    priorita: "media" as "bassa" | "media" | "alta" | "urgente",
  });
  const [garanziaForm, setGaranziaForm] = useState({
    commessaId: 0,
    tipo: "prodotto" as "prodotto" | "posa" | "accessorio",
    descrizione: "",
    fornitore: "",
    dataInizio: "",
    dataScadenza: "",
    durataMesi: 120,
  });

  const updateCliente = trpc.clienti.update.useMutation({
    onSuccess: () => {
      utils.clienti.byId.invalidate(clienteId);
      setEditOpen(false);
    },
  });
  const deleteCliente = trpc.clienti.delete.useMutation({
    onSuccess: () => {
      setDeleteOpen(false);
      setLocation("/clienti");
    },
  });

  const createCommessa = trpc.commesse.create.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      utils.clienti.byId.invalidate(clienteId);
      setAddCommessaOpen(false);
    },
  });
  const createIntervento = trpc.interventi.create.useMutation({
    onSuccess: () => {
      utils.interventi.invalidate();
      setAddInterventoOpen(false);
    },
  });
  const createTicket = trpc.ticket.create.useMutation({
    onSuccess: () => {
      utils.ticket.invalidate();
      setAddTicketOpen(false);
    },
  });
  const createGaranzia = trpc.garanzie.create.useMutation({
    onSuccess: () => {
      utils.garanzie.invalidate();
      setAddGaranziaOpen(false);
    },
  });

  const c = cliente.data;

  if (!c) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        {cliente.isLoading ? "Caricamento..." : "Cliente non trovato"}
      </div>
    );
  }

  const TipoIcon = tipoIcons[c.tipo] ?? User;
  const displayName = `${c.nome ?? ""} ${c.cognome ?? ""}`.trim();

  const clienteCommesse =
    commesse.data?.filter((cm: any) => c.commesseIds?.includes(cm.id)) ?? [];

  const commessaIds = clienteCommesse.map((cm: any) => cm.id);

  const clienteInterventi =
    interventi.data?.filter((i: any) => commessaIds.includes(i.commessaId)) ?? [];
  const clienteTicket =
    ticketList.data?.filter((t: any) => commessaIds.includes(t.commessaId)) ?? [];
  const clienteGaranzie =
    garanzieList.data?.filter((g: any) => commessaIds.includes(g.commessaId)) ?? [];

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/clienti")}
          className="mb-2 -ml-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Clienti
        </Button>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <TipoIcon className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-2xl font-bold tracking-tight">{displayName}</h1>
              <Badge variant="outline" className="text-xs">
                {c.tipo?.replace(/_/g, " ")}
              </Badge>
              {c.detrazione && (
                <Badge variant="secondary" className="text-xs">
                  Detrazione
                </Badge>
              )}
              {c.interesseFinanziamento && (
                <Badge variant="secondary" className="text-xs">
                  Finanziamento
                </Badge>
              )}
              {c.praticaEdilizia && c.praticaEdilizia !== "nessuna" && (
                <Badge variant="secondary" className="text-xs uppercase">
                  {c.praticaEdilizia}
                </Badge>
              )}
            </div>

            <div className="flex gap-4 flex-wrap mt-2 text-sm text-muted-foreground">
              {c.indirizzo && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {c.indirizzo}, {c.cap} {c.citta}
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
            </div>

            {c.codiceFiscale && (
              <p className="text-xs text-muted-foreground mt-1">
                CF: {c.codiceFiscale}
                {c.partitaIva && ` — P.IVA: ${c.partitaIva}`}
              </p>
            )}
          </div>
          <div className="flex gap-1.5 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditForm({
                  nome: c.nome ?? "",
                  cognome: c.cognome ?? "",
                  tipo: c.tipo ?? "privato",
                  indirizzo: c.indirizzo ?? "",
                  citta: c.citta ?? "",
                  cap: c.cap ?? "",
                  telefono: c.telefono ?? "",
                  email: c.email ?? "",
                  codiceFiscale: c.codiceFiscale ?? "",
                  partitaIva: c.partitaIva ?? "",
                  detrazione: !!c.detrazione,
                  interesseFinanziamento: !!c.interesseFinanziamento,
                  praticaEdilizia: c.praticaEdilizia ?? "nessuna",
                  note: c.note ?? "",
                });
                setEditOpen(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5 mr-1" /> Modifica
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 hover:bg-red-50"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {c.note && (
          <p className="text-sm text-muted-foreground mt-2 border-l-2 pl-3">
            {c.note}
          </p>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Commesse
            </p>
            <p className="text-2xl font-bold">{clienteCommesse.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Interventi
            </p>
            <p className="text-2xl font-bold">{clienteInterventi.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Ticket
            </p>
            <p className="text-2xl font-bold">{clienteTicket.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Garanzie
            </p>
            <p className="text-2xl font-bold">{clienteGaranzie.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Referenti */}
      {c.referenti?.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              Referenti ({c.referenti.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {c.referenti.map((r: any, idx: number) => (
                <div key={idx} className="border rounded-lg p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{r.nome}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {ruoloLabels[r.ruolo] ?? r.ruolo}
                    </Badge>
                  </div>
                  {r.telefono && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      {r.telefono}
                    </p>
                  )}
                  {r.email && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {r.email}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="commesse">
        <TabsList>
          <TabsTrigger value="commesse">
            Commesse ({clienteCommesse.length})
          </TabsTrigger>
          <TabsTrigger value="interventi">
            Interventi ({clienteInterventi.length})
          </TabsTrigger>
          <TabsTrigger value="ticket">
            Ticket ({clienteTicket.length})
          </TabsTrigger>
          <TabsTrigger value="garanzie">
            Garanzie ({clienteGaranzie.length})
          </TabsTrigger>
        </TabsList>

        {/* Commesse */}
        <TabsContent value="commesse" className="space-y-3 mt-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setAddCommessaOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Nuova commessa
            </Button>
          </div>
          {clienteCommesse.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nessuna commessa associata
            </p>
          ) : (
            clienteCommesse.map((cm: any) => (
              <Card
                key={cm.id}
                className="cursor-pointer hover:shadow-sm transition-shadow"
                onClick={() => setLocation(`/commesse/${cm.id}`)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{cm.codice}</span>
                        <Badge variant="secondary" className="text-xs uppercase">
                          {cm.stato.replace(/_/g, " ")}
                        </Badge>
                        {cm.priorita === "urgente" && (
                          <Badge variant="destructive" className="text-xs">
                            URGENTE
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm font-medium">{cm.cliente}</p>
                      {cm.indirizzo && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {cm.indirizzo}
                          {cm.citta ? `, ${cm.citta}` : ""}
                        </p>
                      )}
                    </div>
                    {(cm.dataConsegnaConfermata || cm.consegnaIndicativa) && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {cm.dataConsegnaConfermata
                          ? cm.dataConsegnaConfermata
                          : `+${cm.consegnaIndicativa}gg`}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Interventi */}
        <TabsContent value="interventi" className="space-y-3 mt-4">
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={clienteCommesse.length === 0}
              onClick={() => {
                setInterventoForm({
                  ...interventoForm,
                  commessaId: clienteCommesse[0]?.id ?? 0,
                });
                setAddInterventoOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> Nuovo intervento
            </Button>
          </div>
          {clienteInterventi.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nessun intervento
            </p>
          ) : (
            clienteInterventi.map((i: any) => (
              <Card key={i.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs uppercase">
                          {i.tipo}
                        </Badge>
                        <Badge
                          variant={i.stato === "completato" ? "secondary" : "default"}
                          className="text-xs"
                        >
                          {i.stato.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      {i.note && <p className="text-sm">{i.note}</p>}
                      {i.dataPianificata && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {i.dataPianificata}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Ticket */}
        <TabsContent value="ticket" className="space-y-3 mt-4">
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={clienteCommesse.length === 0}
              onClick={() => {
                setTicketForm({
                  ...ticketForm,
                  commessaId: clienteCommesse[0]?.id ?? 0,
                });
                setAddTicketOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> Nuovo ticket
            </Button>
          </div>
          {clienteTicket.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nessun ticket
            </p>
          ) : (
            clienteTicket.map((t: any) => (
              <Card key={t.id}>
                <CardContent className="p-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {t.categoria.replace(/_/g, " ")}
                      </Badge>
                      <Badge
                        variant={
                          t.priorita === "alta" || t.priorita === "urgente"
                            ? "destructive"
                            : "secondary"
                        }
                        className="text-xs"
                      >
                        {t.priorita}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {t.stato.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <p className="text-sm font-medium">{t.oggetto}</p>
                    {t.descrizione && (
                      <p className="text-xs text-muted-foreground">{t.descrizione}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Garanzie */}
        <TabsContent value="garanzie" className="space-y-3 mt-4">
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={clienteCommesse.length === 0}
              onClick={() => {
                setGaranziaForm({
                  ...garanziaForm,
                  commessaId: clienteCommesse[0]?.id ?? 0,
                });
                setAddGaranziaOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> Nuova garanzia
            </Button>
          </div>
          {clienteGaranzie.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Nessuna garanzia
            </p>
          ) : (
            clienteGaranzie.map((g: any) => (
              <Card key={g.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{g.descrizione}</p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px]">
                          {g.tipo}
                        </Badge>
                        <span>
                          {g.dataInizio} — {g.dataScadenza}
                        </span>
                        {g.fornitore && <span>{g.fornitore}</span>}
                      </div>
                    </div>
                    <Badge
                      variant={g.stato === "attiva" ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {g.stato}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Modifica cliente</DialogTitle>
          </DialogHeader>
          {editForm && (
            <div className="grid gap-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Nome</Label>
                  <Input
                    value={editForm.nome}
                    onChange={(e) =>
                      setEditForm({ ...editForm, nome: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Cognome</Label>
                  <Input
                    value={editForm.cognome}
                    onChange={(e) =>
                      setEditForm({ ...editForm, cognome: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select
                  value={editForm.tipo}
                  onValueChange={(v) => setEditForm({ ...editForm, tipo: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="privato">Privato</SelectItem>
                    <SelectItem value="azienda">Azienda</SelectItem>
                    <SelectItem value="condominio">Condominio</SelectItem>
                    <SelectItem value="ente_pubblico">Ente pubblico</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5 col-span-2">
                  <Label>Indirizzo</Label>
                  <Input
                    value={editForm.indirizzo}
                    onChange={(e) =>
                      setEditForm({ ...editForm, indirizzo: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>CAP</Label>
                  <Input
                    value={editForm.cap}
                    onChange={(e) =>
                      setEditForm({ ...editForm, cap: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Citta</Label>
                  <Input
                    value={editForm.citta}
                    onChange={(e) =>
                      setEditForm({ ...editForm, citta: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Telefono</Label>
                  <Input
                    value={editForm.telefono}
                    onChange={(e) =>
                      setEditForm({ ...editForm, telefono: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input
                    value={editForm.email}
                    onChange={(e) =>
                      setEditForm({ ...editForm, email: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Codice Fiscale</Label>
                  <Input
                    value={editForm.codiceFiscale}
                    onChange={(e) =>
                      setEditForm({ ...editForm, codiceFiscale: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Partita IVA</Label>
                  <Input
                    value={editForm.partitaIva}
                    onChange={(e) =>
                      setEditForm({ ...editForm, partitaIva: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <div className="text-sm font-medium">Detrazione</div>
                  </div>
                  <Switch
                    checked={editForm.detrazione}
                    onCheckedChange={(v) =>
                      setEditForm({ ...editForm, detrazione: v })
                    }
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <div className="text-sm font-medium">Finanziamento</div>
                  </div>
                  <Switch
                    checked={editForm.interesseFinanziamento}
                    onCheckedChange={(v) =>
                      setEditForm({ ...editForm, interesseFinanziamento: v })
                    }
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Pratica edilizia</Label>
                <Select
                  value={editForm.praticaEdilizia}
                  onValueChange={(v) =>
                    setEditForm({ ...editForm, praticaEdilizia: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nessuna">Nessuna pratica edilizia</SelectItem>
                    <SelectItem value="cil">CIL</SelectItem>
                    <SelectItem value="cila">CILA</SelectItem>
                    <SelectItem value="scia">SCIA</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Note</Label>
                <Textarea
                  rows={2}
                  value={editForm.note}
                  onChange={(e) =>
                    setEditForm({ ...editForm, note: e.target.value })
                  }
                />
              </div>
              <Button
                onClick={() =>
                  updateCliente.mutate({
                    id: clienteId,
                    nome: editForm.nome,
                    cognome: editForm.cognome,
                    tipo: editForm.tipo as any,
                    indirizzo: editForm.indirizzo || undefined,
                    citta: editForm.citta || undefined,
                    cap: editForm.cap || undefined,
                    telefono: editForm.telefono || undefined,
                    email: editForm.email || undefined,
                    codiceFiscale: editForm.codiceFiscale || undefined,
                    partitaIva: editForm.partitaIva || undefined,
                    detrazione: editForm.detrazione,
                    interesseFinanziamento: editForm.interesseFinanziamento,
                    praticaEdilizia: editForm.praticaEdilizia,
                    note: editForm.note || undefined,
                  })
                }
                disabled={updateCliente.isPending}
              >
                Salva modifiche
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Commessa dialog */}
      <Dialog open={addCommessaOpen} onOpenChange={setAddCommessaOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuova commessa per {displayName}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="text-xs text-muted-foreground">
              Codice commessa assegnato automaticamente
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Priorità</Label>
                <Select
                  value={commessaForm.priorita}
                  onValueChange={(v: any) =>
                    setCommessaForm({ ...commessaForm, priorita: v })
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
              <div className="space-y-1.5">
                <Label>Consegna indicativa</Label>
                <Select
                  value={commessaForm.consegnaIndicativa}
                  onValueChange={(v: any) =>
                    setCommessaForm({ ...commessaForm, consegnaIndicativa: v })
                  }
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
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Textarea
                rows={2}
                value={commessaForm.note}
                onChange={(e) =>
                  setCommessaForm({ ...commessaForm, note: e.target.value })
                }
              />
            </div>
            <Button
              onClick={() =>
                createCommessa.mutate({
                  clienteId,
                  cliente: displayName,
                  indirizzo: c.indirizzo || undefined,
                  citta: c.citta || undefined,
                  telefono: c.telefono || undefined,
                  email: c.email || undefined,
                  priorita: commessaForm.priorita,
                  consegnaIndicativa: commessaForm.consegnaIndicativa,
                  note: commessaForm.note || undefined,
                })
              }
              disabled={createCommessa.isPending}
            >
              Crea commessa
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Intervento dialog */}
      <Dialog open={addInterventoOpen} onOpenChange={setAddInterventoOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuovo intervento</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Commessa</Label>
              <Select
                value={String(interventoForm.commessaId)}
                onValueChange={(v) =>
                  setInterventoForm({ ...interventoForm, commessaId: Number(v) })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {clienteCommesse.map((cm: any) => (
                    <SelectItem key={cm.id} value={String(cm.id)}>
                      {cm.codice}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select
                  value={interventoForm.tipo}
                  onValueChange={(v: any) =>
                    setInterventoForm({ ...interventoForm, tipo: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
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
                <Input
                  type="date"
                  value={interventoForm.dataPianificata}
                  onChange={(e) =>
                    setInterventoForm({
                      ...interventoForm,
                      dataPianificata: e.target.value,
                    })
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Textarea
                rows={2}
                value={interventoForm.note}
                onChange={(e) =>
                  setInterventoForm({ ...interventoForm, note: e.target.value })
                }
              />
            </div>
            <Button
              onClick={() =>
                createIntervento.mutate({
                  commessaId: interventoForm.commessaId,
                  tipo: interventoForm.tipo as any,
                  dataPianificata: interventoForm.dataPianificata || undefined,
                  note: interventoForm.note || undefined,
                })
              }
              disabled={
                !interventoForm.commessaId ||
                !interventoForm.dataPianificata ||
                createIntervento.isPending
              }
            >
              Crea intervento
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Ticket dialog */}
      <Dialog open={addTicketOpen} onOpenChange={setAddTicketOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuovo ticket</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Commessa</Label>
              <Select
                value={String(ticketForm.commessaId)}
                onValueChange={(v) =>
                  setTicketForm({ ...ticketForm, commessaId: Number(v) })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {clienteCommesse.map((cm: any) => (
                    <SelectItem key={cm.id} value={String(cm.id)}>
                      {cm.codice}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Oggetto</Label>
              <Input
                value={ticketForm.oggetto}
                onChange={(e) =>
                  setTicketForm({ ...ticketForm, oggetto: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Descrizione</Label>
              <Textarea
                rows={2}
                value={ticketForm.descrizione}
                onChange={(e) =>
                  setTicketForm({ ...ticketForm, descrizione: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <Select
                  value={ticketForm.categoria}
                  onValueChange={(v) =>
                    setTicketForm({ ...ticketForm, categoria: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="regolazione">Regolazione</SelectItem>
                    <SelectItem value="difetto_posa">Difetto posa</SelectItem>
                    <SelectItem value="difetto_prodotto">Difetto prodotto</SelectItem>
                    <SelectItem value="altro">Altro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Priorità</Label>
                <Select
                  value={ticketForm.priorita}
                  onValueChange={(v: any) =>
                    setTicketForm({ ...ticketForm, priorita: v })
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
            <Button
              onClick={() =>
                createTicket.mutate({
                  commessaId: ticketForm.commessaId,
                  oggetto: ticketForm.oggetto,
                  descrizione: ticketForm.descrizione || undefined,
                  categoria: ticketForm.categoria as any,
                  priorita: ticketForm.priorita,
                })
              }
              disabled={
                !ticketForm.commessaId ||
                !ticketForm.oggetto ||
                createTicket.isPending
              }
            >
              Crea ticket
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Garanzia dialog */}
      <Dialog open={addGaranziaOpen} onOpenChange={setAddGaranziaOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuova garanzia</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Commessa</Label>
              <Select
                value={String(garanziaForm.commessaId)}
                onValueChange={(v) =>
                  setGaranziaForm({ ...garanziaForm, commessaId: Number(v) })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {clienteCommesse.map((cm: any) => (
                    <SelectItem key={cm.id} value={String(cm.id)}>
                      {cm.codice}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select
                  value={garanziaForm.tipo}
                  onValueChange={(v: any) =>
                    setGaranziaForm({ ...garanziaForm, tipo: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prodotto">Prodotto</SelectItem>
                    <SelectItem value="posa">Posa</SelectItem>
                    <SelectItem value="accessorio">Accessorio</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Durata (mesi)</Label>
                <Input
                  type="number"
                  value={garanziaForm.durataMesi}
                  onChange={(e) =>
                    setGaranziaForm({
                      ...garanziaForm,
                      durataMesi: Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Descrizione</Label>
              <Input
                value={garanziaForm.descrizione}
                onChange={(e) =>
                  setGaranziaForm({
                    ...garanziaForm,
                    descrizione: e.target.value,
                  })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Fornitore</Label>
              <Input
                value={garanziaForm.fornitore}
                onChange={(e) =>
                  setGaranziaForm({
                    ...garanziaForm,
                    fornitore: e.target.value,
                  })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Data inizio</Label>
                <Input
                  type="date"
                  value={garanziaForm.dataInizio}
                  onChange={(e) =>
                    setGaranziaForm({
                      ...garanziaForm,
                      dataInizio: e.target.value,
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Data scadenza</Label>
                <Input
                  type="date"
                  value={garanziaForm.dataScadenza}
                  onChange={(e) =>
                    setGaranziaForm({
                      ...garanziaForm,
                      dataScadenza: e.target.value,
                    })
                  }
                />
              </div>
            </div>
            <Button
              onClick={() =>
                createGaranzia.mutate({
                  commessaId: garanziaForm.commessaId,
                  tipo: garanziaForm.tipo,
                  descrizione: garanziaForm.descrizione,
                  fornitore: garanziaForm.fornitore || undefined,
                  dataInizio: garanziaForm.dataInizio,
                  durataMesi: garanziaForm.durataMesi,
                })
              }
              disabled={
                !garanziaForm.commessaId ||
                !garanziaForm.descrizione ||
                !garanziaForm.dataInizio ||
                !garanziaForm.dataScadenza ||
                createGaranzia.isPending
              }
            >
              Crea garanzia
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Eliminare cliente?"
        description={`Stai per eliminare "${displayName}". Questa azione non puo essere annullata.`}
        onConfirm={() => deleteCliente.mutate(clienteId)}
      />
    </div>
  );
}
