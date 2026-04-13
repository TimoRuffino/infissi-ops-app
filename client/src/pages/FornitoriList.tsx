import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus,
  Search,
  Truck,
  Package,
  Phone,
  Mail,
  MapPin,
  FileBox,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Euro,
  Pencil,
  Trash2,
  FileText,
} from "lucide-react";
import { useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";

type DeleteTarget = { type: "fornitore" | "ordine" | "listino"; id: number; label: string } | null;

const categoriaLabels: Record<string, string> = {
  pvc: "PVC",
  alluminio: "Alluminio",
  vetro: "Vetro",
  ferramenta: "Ferramenta",
  persiane: "Persiane",
  blindati: "Blindati",
  accessori: "Accessori",
  guarnizioni: "Guarnizioni",
  altro: "Altro",
};

const categoriaColors: Record<string, string> = {
  pvc: "bg-blue-100 text-blue-800",
  alluminio: "bg-sky-100 text-sky-800",
  vetro: "bg-cyan-100 text-cyan-800",
  ferramenta: "bg-amber-100 text-amber-800",
  persiane: "bg-lime-100 text-lime-800",
  blindati: "bg-stone-100 text-stone-800",
  accessori: "bg-purple-100 text-purple-800",
  guarnizioni: "bg-green-100 text-green-800",
  altro: "bg-gray-100 text-gray-600",
};

const statoOrdineColors: Record<string, string> = {
  bozza: "bg-gray-100 text-gray-700",
  inviato: "bg-blue-100 text-blue-800",
  confermato: "bg-indigo-100 text-indigo-800",
  in_transito: "bg-amber-100 text-amber-800",
  ricevuto_parziale: "bg-orange-100 text-orange-800",
  ricevuto: "bg-green-100 text-green-800",
  contestato: "bg-red-100 text-red-800",
};

export default function FornitoriList() {
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [ordineDialogOpen, setOrdineDialogOpen] = useState(false);
  const [ordineFilter, setOrdineFilter] = useState<string | undefined>(undefined);
  const [listinoDialogOpen, setListinoDialogOpen] = useState(false);
  const [listinoForm, setListinoForm] = useState({ fornitoreId: "", nome: "", versione: "", dataValidita: "", nomeFile: "", tipo: "pdf" as string, note: "" });
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const fornitori = trpc.fornitori.list.useQuery({
    search: search || undefined,
    categoria: catFilter,
    attivo: true,
  });
  const stats = trpc.fornitori.stats.useQuery();
  const ordini = trpc.fornitori.ordini.list.useQuery({
    stato: ordineFilter,
  });
  const utils = trpc.useUtils();

  const commesse = trpc.commesse.list.useQuery({});
  const listiniQuery = trpc.fornitori.listini.list.useQuery({});

  const createListino = trpc.fornitori.listini.create.useMutation({
    onSuccess: () => {
      utils.fornitori.listini.invalidate();
      setListinoDialogOpen(false);
      setListinoForm({ fornitoreId: "", nome: "", versione: "", dataValidita: "", nomeFile: "", tipo: "pdf", note: "" });
    },
  });

  const deleteListino = trpc.fornitori.listini.delete.useMutation({
    onSuccess: () => {
      utils.fornitori.listini.invalidate();
      setDeleteTarget(null);
    },
  });

  const createFornitore = trpc.fornitori.create.useMutation({
    onSuccess: () => {
      utils.fornitori.invalidate();
      setDialogOpen(false);
      setForm({ ragioneSociale: "", partitaIva: "", indirizzo: "", citta: "", telefono: "", email: "", categoria: "alluminio", referenteCommerciale: "", scontistica: "", note: "" });
    },
  });

  const updateFornitore = trpc.fornitori.update.useMutation({
    onSuccess: () => {
      utils.fornitori.invalidate();
      setEditOpen(false);
      setEditId(null);
    },
  });

  const deleteFornitore = trpc.fornitori.delete.useMutation({
    onSuccess: () => {
      utils.fornitori.invalidate();
      setDeleteTarget(null);
    },
  });

  const createOrdine = trpc.fornitori.ordini.create.useMutation({
    onSuccess: () => {
      utils.fornitori.ordini.invalidate();
      utils.fornitori.stats.invalidate();
      setOrdineDialogOpen(false);
      setOrdineForm({ fornitoreId: "", commessaId: "", codiceOrdine: "", dataConsegnaPrevista: "", noteOrdine: "", righe: [{ descrizione: "", codiceArticolo: "", quantita: "1", unitaMisura: "pz", prezzoUnitario: "" }] });
    },
  });

  const deleteOrdine = trpc.fornitori.ordini.delete.useMutation({
    onSuccess: () => {
      utils.fornitori.ordini.invalidate();
      utils.fornitori.stats.invalidate();
      setDeleteTarget(null);
    },
  });

  const [form, setForm] = useState({
    ragioneSociale: "",
    partitaIva: "",
    indirizzo: "",
    citta: "",
    telefono: "",
    email: "",
    categoria: "alluminio" as string,
    referenteCommerciale: "",
    scontistica: "",
    note: "",
  });

  const [editForm, setEditForm] = useState({
    ragioneSociale: "",
    partitaIva: "",
    indirizzo: "",
    citta: "",
    telefono: "",
    email: "",
    categoria: "alluminio" as string,
    referenteCommerciale: "",
    scontistica: "",
    note: "",
  });

  type RigaForm = { descrizione: string; codiceArticolo: string; quantita: string; unitaMisura: string; prezzoUnitario: string };
  const [ordineForm, setOrdineForm] = useState({
    fornitoreId: "",
    commessaId: "",
    codiceOrdine: "",
    dataConsegnaPrevista: "",
    noteOrdine: "",
    righe: [{ descrizione: "", codiceArticolo: "", quantita: "1", unitaMisura: "pz", prezzoUnitario: "" }] as RigaForm[],
  });

  function openEdit(f: any) {
    setEditId(f.id);
    setEditForm({
      ragioneSociale: f.ragioneSociale,
      partitaIva: f.partitaIva,
      indirizzo: f.indirizzo ?? "",
      citta: f.citta ?? "",
      telefono: f.telefono ?? "",
      email: f.email ?? "",
      categoria: f.categoria,
      referenteCommerciale: f.referenteCommerciale ?? "",
      scontistica: f.scontistica?.toString() ?? "",
      note: f.note ?? "",
    });
    setEditOpen(true);
  }

  function addRiga() {
    setOrdineForm({ ...ordineForm, righe: [...ordineForm.righe, { descrizione: "", codiceArticolo: "", quantita: "1", unitaMisura: "pz", prezzoUnitario: "" }] });
  }

  function updateRiga(idx: number, field: keyof RigaForm, value: string) {
    const righe = [...ordineForm.righe];
    righe[idx] = { ...righe[idx], [field]: value };
    setOrdineForm({ ...ordineForm, righe });
  }

  function removeRiga(idx: number) {
    setOrdineForm({ ...ordineForm, righe: ordineForm.righe.filter((_, i) => i !== idx) });
  }

  function handleCreateOrdine() {
    if (!ordineForm.fornitoreId || !ordineForm.commessaId || !ordineForm.codiceOrdine) return;
    const validRighe = ordineForm.righe.filter((r) => r.descrizione);
    if (validRighe.length === 0) return;
    createOrdine.mutate({
      fornitoreId: parseInt(ordineForm.fornitoreId),
      commessaId: parseInt(ordineForm.commessaId),
      codiceOrdine: ordineForm.codiceOrdine,
      dataConsegnaPrevista: ordineForm.dataConsegnaPrevista || undefined,
      noteOrdine: ordineForm.noteOrdine || undefined,
      righe: validRighe.map((r) => ({
        descrizione: r.descrizione,
        codiceArticolo: r.codiceArticolo || undefined,
        quantita: parseInt(r.quantita) || 1,
        unitaMisura: r.unitaMisura,
        prezzoUnitario: r.prezzoUnitario ? parseFloat(r.prezzoUnitario) : undefined,
      })),
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Truck className="h-6 w-6" />
            Fornitori
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gestione fornitori e ordini materiali
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Nuovo fornitore
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nuovo fornitore</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Ragione sociale *</Label>
                  <Input value={form.ragioneSociale} onChange={(e) => setForm({ ...form, ragioneSociale: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Partita IVA *</Label>
                  <Input value={form.partitaIva} onChange={(e) => setForm({ ...form, partitaIva: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <Select value={form.categoria} onValueChange={(v) => setForm({ ...form, categoria: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(categoriaLabels).map(([k, l]) => (
                      <SelectItem key={k} value={k}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Indirizzo</Label>
                  <Input value={form.indirizzo} onChange={(e) => setForm({ ...form, indirizzo: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Citta</Label>
                  <Input value={form.citta} onChange={(e) => setForm({ ...form, citta: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Telefono</Label>
                  <Input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Referente commerciale</Label>
                  <Input value={form.referenteCommerciale} onChange={(e) => setForm({ ...form, referenteCommerciale: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Sconto %</Label>
                  <Input type="number" step="0.5" value={form.scontistica} onChange={(e) => setForm({ ...form, scontistica: e.target.value })} placeholder="es. 15" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Note</Label>
                <Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </div>
              <Button
                onClick={() =>
                  createFornitore.mutate({
                    ragioneSociale: form.ragioneSociale,
                    partitaIva: form.partitaIva,
                    indirizzo: form.indirizzo || undefined,
                    citta: form.citta || undefined,
                    telefono: form.telefono || undefined,
                    email: form.email || undefined,
                    categoria: form.categoria as any,
                    referenteCommerciale: form.referenteCommerciale || undefined,
                    scontistica: form.scontistica ? parseFloat(form.scontistica) : undefined,
                    note: form.note || undefined,
                  })
                }
                disabled={!form.ragioneSociale || !form.partitaIva || createFornitore.isPending}
              >
                Crea fornitore
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Truck className="h-3.5 w-3.5" /> Fornitori attivi
            </div>
            <p className="text-2xl font-bold">{stats.data?.totale ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Package className="h-3.5 w-3.5" /> Ordini attivi
            </div>
            <p className="text-2xl font-bold">{stats.data?.ordiniAttivi ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Euro className="h-3.5 w-3.5" /> Importo pendente
            </div>
            <p className="text-2xl font-bold">
              {(stats.data?.importoPendente ?? 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <FileBox className="h-3.5 w-3.5" /> Categorie
            </div>
            <div className="flex gap-1 flex-wrap mt-1">
              {stats.data?.perCategoria &&
                Object.entries(stats.data.perCategoria).map(([cat, count]) => (
                  <Badge key={cat} variant="secondary" className="text-[10px]">
                    {categoriaLabels[cat] ?? cat}: {count as number}
                  </Badge>
                ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs: Fornitori / Ordini */}
      <Tabs defaultValue="fornitori">
        <TabsList>
          <TabsTrigger value="fornitori">Fornitori ({fornitori.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="ordini">Ordini ({ordini.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="listini">Listini ({listiniQuery.data?.length ?? 0})</TabsTrigger>
        </TabsList>

        {/* ── Fornitori tab ──────────────────────────────────────────── */}
        <TabsContent value="fornitori" className="space-y-4 mt-4">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cerca fornitore..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-1.5">
              <Button variant={!catFilter ? "default" : "outline"} size="sm" onClick={() => setCatFilter(undefined)}>
                Tutti
              </Button>
              {Object.entries(categoriaLabels).map(([k, l]) => (
                <Button key={k} variant={catFilter === k ? "default" : "outline"} size="sm" onClick={() => setCatFilter(k)}>
                  {l}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-3">
            {fornitori.data?.map((f: any) => (
              <Card key={f.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{f.ragioneSociale}</span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-sm ${categoriaColors[f.categoria] ?? ""}`}>
                          {categoriaLabels[f.categoria] ?? f.categoria}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                        <span>P.IVA: {f.partitaIva}</span>
                        {f.citta && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" /> {f.citta}
                          </span>
                        )}
                        {f.telefono && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" /> {f.telefono}
                          </span>
                        )}
                        {f.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" /> {f.email}
                          </span>
                        )}
                      </div>
                      {(f.referenteCommerciale || f.scontistica) && (
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                          {f.referenteCommerciale && <span>Ref: {f.referenteCommerciale}</span>}
                          {f.scontistica && <Badge variant="outline" className="text-[10px]">Sconto {f.scontistica}%</Badge>}
                        </div>
                      )}
                      {f.note && <p className="text-xs text-muted-foreground border-l-2 pl-2 mt-1">{f.note}</p>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(f)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:text-red-700" onClick={() => setDeleteTarget({ type: "fornitore", id: f.id, label: f.ragioneSociale })}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {fornitori.data?.length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-sm">Nessun fornitore trovato.</div>
            )}
          </div>
        </TabsContent>

        {/* ── Ordini tab ─────────────────────────────────────────────── */}
        <TabsContent value="ordini" className="space-y-4 mt-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex gap-1.5 flex-wrap">
              <Button variant={!ordineFilter ? "default" : "outline"} size="sm" onClick={() => setOrdineFilter(undefined)}>
                Tutti
              </Button>
              {["bozza", "inviato", "confermato", "in_transito", "ricevuto_parziale", "ricevuto", "contestato"].map((s) => (
                <Button key={s} variant={ordineFilter === s ? "default" : "outline"} size="sm" onClick={() => setOrdineFilter(s)}>
                  {s.replace(/_/g, " ")}
                </Button>
              ))}
            </div>
            <Button size="sm" onClick={() => setOrdineDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Nuovo ordine
            </Button>
          </div>

          <div className="grid gap-3">
            {ordini.data?.map((o: any) => {
              const Icon =
                o.stato === "ricevuto" ? CheckCircle2 : o.stato === "contestato" ? AlertTriangle : Clock;
              return (
                <Card key={o.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs text-muted-foreground">{o.codiceOrdine}</span>
                          <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-sm ${statoOrdineColors[o.stato] ?? ""}`}>
                            <Icon className="h-3 w-3 inline mr-1" />
                            {o.stato.replace(/_/g, " ")}
                          </span>
                        </div>
                        <p className="text-sm font-medium">{o.fornitoreNome}</p>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                          <span>Ordine: {o.dataOrdine}</span>
                          {o.dataConsegnaPrevista && <span>Consegna prev.: {o.dataConsegnaPrevista}</span>}
                          {o.dataConsegnaEffettiva && <span>Consegna eff.: {o.dataConsegnaEffettiva}</span>}
                        </div>
                        {o.righe?.length > 0 && (
                          <div className="mt-2 border rounded-md overflow-hidden">
                            <table className="w-full text-xs">
                              <thead className="bg-muted/50">
                                <tr>
                                  <th className="text-left px-2 py-1">Articolo</th>
                                  <th className="text-right px-2 py-1">Q.ta</th>
                                  <th className="text-right px-2 py-1">Ricevuti</th>
                                  <th className="text-right px-2 py-1">Lotto</th>
                                  <th className="text-center px-2 py-1">OK</th>
                                </tr>
                              </thead>
                              <tbody>
                                {o.righe.map((r: any) => (
                                  <tr key={r.id} className="border-t">
                                    <td className="px-2 py-1">
                                      {r.descrizione}
                                      {r.codiceArticolo && (
                                        <span className="text-muted-foreground ml-1">({r.codiceArticolo})</span>
                                      )}
                                    </td>
                                    <td className="text-right px-2 py-1">
                                      {r.quantita} {r.unitaMisura}
                                    </td>
                                    <td className="text-right px-2 py-1">{r.quantitaRicevuta}</td>
                                    <td className="text-right px-2 py-1 font-mono">{r.lotto ?? "—"}</td>
                                    <td className="text-center px-2 py-1">
                                      {r.conforme === true ? (
                                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600 inline" />
                                      ) : r.conforme === false ? (
                                        <AlertTriangle className="h-3.5 w-3.5 text-red-600 inline" />
                                      ) : (
                                        "—"
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {o.noteOrdine && <p className="text-xs text-muted-foreground mt-1">{o.noteOrdine}</p>}
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        {o.importoTotale != null && (
                          <p className="font-semibold text-sm">
                            {o.importoTotale.toLocaleString("it-IT", { style: "currency", currency: "EUR" })}
                          </p>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:text-red-700" onClick={() => setDeleteTarget({ type: "ordine", id: o.id, label: o.codiceOrdine })}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {ordini.data?.length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-sm">Nessun ordine trovato.</div>
            )}
          </div>
        </TabsContent>

        {/* ── Listini tab ────────────────────────────────────────────── */}
        <TabsContent value="listini" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setListinoDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Nuovo listino
            </Button>
          </div>
          <div className="grid gap-3">
            {listiniQuery.data?.map((l: any) => {
              const fornitoreNome = fornitori.data?.find((f: any) => f.id === l.fornitoreId)?.ragioneSociale ?? "?";
              return (
                <Card key={l.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium text-sm">{l.nome}</span>
                          <Badge variant="secondary" className="text-[10px]">{l.versione}</Badge>
                          <Badge variant="outline" className="text-[10px] uppercase">{l.tipo}</Badge>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span>{fornitoreNome}</span>
                          <span>Valido dal: {l.dataValidita}</span>
                          <span className="font-mono">{l.nomeFile}</span>
                        </div>
                        {l.note && <p className="text-xs text-muted-foreground mt-1">{l.note}</p>}
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={() => setDeleteTarget({ type: "listino", id: l.id, label: l.nome })}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {listiniQuery.data?.length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-sm">Nessun listino caricato.</div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ── Nuovo listino dialog ───────────────────────────────────── */}
      <Dialog open={listinoDialogOpen} onOpenChange={setListinoDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuovo listino</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>Fornitore *</Label>
              <Select value={listinoForm.fornitoreId} onValueChange={(v) => setListinoForm({ ...listinoForm, fornitoreId: v })}>
                <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
                <SelectContent>
                  {fornitori.data?.map((f: any) => (
                    <SelectItem key={f.id} value={f.id.toString()}>{f.ragioneSociale}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Nome listino *</Label>
                <Input value={listinoForm.nome} onChange={(e) => setListinoForm({ ...listinoForm, nome: e.target.value })} placeholder="Listino Profili 2026" />
              </div>
              <div className="space-y-1.5">
                <Label>Versione *</Label>
                <Input value={listinoForm.versione} onChange={(e) => setListinoForm({ ...listinoForm, versione: e.target.value })} placeholder="v1.0" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Data validita *</Label>
                <Input type="date" value={listinoForm.dataValidita} onChange={(e) => setListinoForm({ ...listinoForm, dataValidita: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select value={listinoForm.tipo} onValueChange={(v) => setListinoForm({ ...listinoForm, tipo: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pdf">PDF</SelectItem>
                    <SelectItem value="excel">Excel</SelectItem>
                    <SelectItem value="altro">Altro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Nome file *</Label>
              <Input value={listinoForm.nomeFile} onChange={(e) => setListinoForm({ ...listinoForm, nomeFile: e.target.value })} placeholder="listino_2026.pdf" />
            </div>
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Input value={listinoForm.note} onChange={(e) => setListinoForm({ ...listinoForm, note: e.target.value })} />
            </div>
            <Button
              onClick={() => {
                if (!listinoForm.fornitoreId || !listinoForm.nome || !listinoForm.versione || !listinoForm.dataValidita || !listinoForm.nomeFile) return;
                createListino.mutate({
                  fornitoreId: parseInt(listinoForm.fornitoreId),
                  nome: listinoForm.nome,
                  versione: listinoForm.versione,
                  dataValidita: listinoForm.dataValidita,
                  nomeFile: listinoForm.nomeFile,
                  tipo: listinoForm.tipo as any,
                  note: listinoForm.note || undefined,
                });
              }}
              disabled={createListino.isPending}
            >
              Crea listino
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit fornitore dialog ─────────────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={(o) => { setEditOpen(o); if (!o) setEditId(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Modifica fornitore</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Ragione sociale</Label>
                <Input value={editForm.ragioneSociale} onChange={(e) => setEditForm({ ...editForm, ragioneSociale: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Partita IVA</Label>
                <Input value={editForm.partitaIva} onChange={(e) => setEditForm({ ...editForm, partitaIva: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Categoria</Label>
              <Select value={editForm.categoria} onValueChange={(v) => setEditForm({ ...editForm, categoria: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(categoriaLabels).map(([k, l]) => (
                    <SelectItem key={k} value={k}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Referente commerciale</Label>
                <Input value={editForm.referenteCommerciale} onChange={(e) => setEditForm({ ...editForm, referenteCommerciale: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Sconto %</Label>
                <Input type="number" step="0.5" value={editForm.scontistica} onChange={(e) => setEditForm({ ...editForm, scontistica: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Textarea rows={2} value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} />
            </div>
            <Button
              onClick={() => editId && updateFornitore.mutate({
                id: editId,
                ragioneSociale: editForm.ragioneSociale || undefined,
                partitaIva: editForm.partitaIva || undefined,
                categoria: editForm.categoria as any,
                indirizzo: editForm.indirizzo || undefined,
                citta: editForm.citta || undefined,
                telefono: editForm.telefono || undefined,
                email: editForm.email || undefined,
                referenteCommerciale: editForm.referenteCommerciale || undefined,
                scontistica: editForm.scontistica ? parseFloat(editForm.scontistica) : undefined,
                note: editForm.note || undefined,
              })}
              disabled={updateFornitore.isPending}
            >
              Aggiorna
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Nuovo ordine dialog ──────────────────────────────────── */}
      <Dialog open={ordineDialogOpen} onOpenChange={setOrdineDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuovo ordine fornitore</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Fornitore *</Label>
                <Select value={ordineForm.fornitoreId} onValueChange={(v) => setOrdineForm({ ...ordineForm, fornitoreId: v })}>
                  <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
                  <SelectContent>
                    {fornitori.data?.map((f: any) => (
                      <SelectItem key={f.id} value={f.id.toString()}>{f.ragioneSociale}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Commessa *</Label>
                <Select value={ordineForm.commessaId} onValueChange={(v) => setOrdineForm({ ...ordineForm, commessaId: v })}>
                  <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
                  <SelectContent>
                    {commesse.data?.map((c: any) => (
                      <SelectItem key={c.id} value={c.id.toString()}>{c.codice} — {c.cliente}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Codice ordine *</Label>
                <Input placeholder="ORD-2026-..." value={ordineForm.codiceOrdine} onChange={(e) => setOrdineForm({ ...ordineForm, codiceOrdine: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Consegna prevista</Label>
                <Input type="date" value={ordineForm.dataConsegnaPrevista} onChange={(e) => setOrdineForm({ ...ordineForm, dataConsegnaPrevista: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Note ordine</Label>
                <Input value={ordineForm.noteOrdine} onChange={(e) => setOrdineForm({ ...ordineForm, noteOrdine: e.target.value })} />
              </div>
            </div>

            {/* Righe ordine */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Righe ordine</Label>
                <Button type="button" variant="outline" size="sm" onClick={addRiga}>
                  <Plus className="h-3 w-3 mr-1" /> Aggiungi riga
                </Button>
              </div>
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-2 py-1.5">Descrizione *</th>
                      <th className="text-left px-2 py-1.5">Cod. articolo</th>
                      <th className="text-right px-2 py-1.5">Q.ta</th>
                      <th className="text-left px-2 py-1.5">UM</th>
                      <th className="text-right px-2 py-1.5">Prezzo un.</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordineForm.righe.map((r, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-1 py-1">
                          <Input className="h-7 text-xs" value={r.descrizione} onChange={(e) => updateRiga(idx, "descrizione", e.target.value)} />
                        </td>
                        <td className="px-1 py-1">
                          <Input className="h-7 text-xs" value={r.codiceArticolo} onChange={(e) => updateRiga(idx, "codiceArticolo", e.target.value)} />
                        </td>
                        <td className="px-1 py-1">
                          <Input className="h-7 text-xs text-right w-16" type="number" value={r.quantita} onChange={(e) => updateRiga(idx, "quantita", e.target.value)} />
                        </td>
                        <td className="px-1 py-1">
                          <Input className="h-7 text-xs w-14" value={r.unitaMisura} onChange={(e) => updateRiga(idx, "unitaMisura", e.target.value)} />
                        </td>
                        <td className="px-1 py-1">
                          <Input className="h-7 text-xs text-right w-20" type="number" step="0.01" value={r.prezzoUnitario} onChange={(e) => updateRiga(idx, "prezzoUnitario", e.target.value)} />
                        </td>
                        <td className="px-1 py-1">
                          {ordineForm.righe.length > 1 && (
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-red-600" onClick={() => removeRiga(idx)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <Button
              onClick={handleCreateOrdine}
              disabled={!ordineForm.fornitoreId || !ordineForm.commessaId || !ordineForm.codiceOrdine || ordineForm.righe.every((r) => !r.descrizione) || createOrdine.isPending}
            >
              Crea ordine
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ───────────────────────────────────────── */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={deleteTarget?.type === "ordine" ? "Elimina ordine" : deleteTarget?.type === "listino" ? "Elimina listino" : "Elimina fornitore"}
        description={`Eliminare "${deleteTarget?.label}"? Questa azione non puo essere annullata.`}
        onConfirm={() => {
          if (!deleteTarget) return;
          if (deleteTarget.type === "ordine") deleteOrdine.mutate(deleteTarget.id);
          else if (deleteTarget.type === "listino") deleteListino.mutate(deleteTarget.id);
          else deleteFornitore.mutate(deleteTarget.id);
        }}
      />
    </div>
  );
}
