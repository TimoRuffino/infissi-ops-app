import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  Search,
  User,
  UserPlus,
  MoreHorizontal,
  Trash2,
  ArrowRight,
  Archive,
  CalendarClock,
  Flame,
  MapPin,
  UserX,
  FilterX,
} from "lucide-react";
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import SearchSelect from "@/components/SearchSelect";
import StatoChip from "@/components/StatoChip";
import { TIPOLOGIE_PRODOTTO } from "@/lib/prodotti";
import DeleteCommessaDialog from "@/components/DeleteCommessaDialog";
import { PRIORITA_VARIANT, PRIORITA_LABEL, STATI_ORDER, statoLabel } from "@/lib/stato";

type DeleteTarget = { id: number; codice: string; stato: string } | null;

type RigaProdotto = { nome: string; quantita: string };

// "Ruffino Timothy" → "#TR": iniziali nome+cognome nell'ordine di lettura
// naturale (nome prima), così l'assegnatario sta in una colonna stretta.
function iniziali(u: { nome?: string | null; cognome?: string | null }): string {
  const n = (u.nome ?? "").trim();
  const c = (u.cognome ?? "").trim();
  const sigla = `${n.charAt(0)}${c.charAt(0)}`.toUpperCase();
  return sigla ? `#${sigla}` : "—";
}

const emptyForm = {
  clienteId: "" as string,
  prodotti: [] as RigaProdotto[],
  cliente: "",
  indirizzo: "",
  citta: "",
  telefono: "",
  email: "",
  priorita: "media" as "bassa" | "media" | "alta" | "urgente",
  note: "",
  consegnaIndicativa: "60" as "30" | "60" | "90",
  assegnatoA: "" as string,
};

const emptyClienteForm = {
  nome: "",
  cognome: "",
  tipo: "privato" as "privato" | "azienda" | "condominio" | "ente_pubblico",
  telefono: "",
  email: "",
  indirizzo: "",
  citta: "",
  assegnatoA: "" as string,
};

function ListSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="space-y-2">
        {Array.from({ length: 7 }).map((_, index) => (
          <div
            key={index}
            className="grid grid-cols-[120px_minmax(180px,1fr)_160px_120px_40px] items-center gap-4 rounded-md px-2 py-3"
          >
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-full max-w-[260px]" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-8 w-8" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CommesseList() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [filtroStato, setFiltroStato] = useState<string>("tutti");
  const [filtroPriorita, setFiltroPriorita] = useState<string>("tutte");
  const [soloNonAssegnate, setSoloNonAssegnate] = useState(false);
  const [soloConsegneDaDatare, setSoloConsegneDaDatare] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const [onlyMine, setOnlyMine] = useState(false);
  const currentUser = trpc.auth.me.useQuery(undefined, { retry: false });

  const commesse = trpc.commesse.list.useQuery({
    search: search || undefined,
    stato: filtroStato !== "tutti" ? filtroStato : undefined,
    assegnatoA: onlyMine && currentUser.data ? currentUser.data.id : undefined,
  });
  const clientiList = trpc.clienti.list.useQuery({});
  const utentiList = trpc.utenti.list.useQuery(undefined);

  const utenteById = useMemo(() => {
    const map = new Map<number, any>();
    for (const u of utentiList.data ?? []) map.set(u.id, u);
    return map;
  }, [utentiList.data]);

  const commesseFiltrate = useMemo(() => {
    const rows = commesse.data ?? [];
    return rows.filter((c: any) => {
      if (filtroPriorita !== "tutte" && c.priorita !== filtroPriorita) {
        return false;
      }
      if (soloNonAssegnate && c.assegnatoA != null) return false;
      if (
        soloConsegneDaDatare &&
        (c.stato !== "produzione" || c.dataConsegnaConfermata)
      ) {
        return false;
      }
      return true;
    });
  }, [commesse.data, filtroPriorita, soloConsegneDaDatare, soloNonAssegnate]);

  const insightCounts = useMemo(() => {
    const rows = commesse.data ?? [];
    return {
      totale: rows.length,
      urgenti: rows.filter((c: any) => c.priorita === "urgente").length,
      consegneDaConfermare: rows.filter(
        (c: any) =>
          c.stato === "produzione" &&
          !c.dataConsegnaConfermata &&
          !c.archivedAt
      ).length,
      nonAssegnate: rows.filter((c: any) => c.assegnatoA == null).length,
    };
  }, [commesse.data]);

  const hasActiveFilters =
    !!search ||
    filtroStato !== "tutti" ||
    filtroPriorita !== "tutte" ||
    soloConsegneDaDatare ||
    soloNonAssegnate ||
    onlyMine;

  const utils = trpc.useUtils();
  const createMutation = trpc.commesse.create.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      utils.clienti.invalidate();
      setDialogOpen(false);
      setForm(emptyForm);
    },
  });

  // Inline cliente creation from inside the "Nuova commessa" dialog.
  const createClienteMutation = trpc.clienti.create.useMutation({
    onSuccess: (cliente) => {
      utils.clienti.invalidate();
      // Auto-select the freshly created cliente in the commessa form + inherit
      // its fields.
      const nomeCognome = `${cliente.cognome ?? ""} ${cliente.nome ?? ""}`.trim();
      setForm((prev) => ({
        ...prev,
        clienteId: String(cliente.id),
        cliente: nomeCognome,
        indirizzo: cliente.indirizzo ?? "",
        citta: cliente.citta ?? "",
        telefono: cliente.telefono ?? "",
        email: cliente.email ?? "",
        assegnatoA: cliente.assegnatoA ? String(cliente.assegnatoA) : prev.assegnatoA,
      }));
      setClienteDialogOpen(false);
      setClienteForm(emptyClienteForm);
    },
  });

  const deleteCommessa = trpc.commesse.delete.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      setDeleteTarget(null);
    },
  });

  const archiveCommessa = trpc.commesse.archive.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      toast.success("Commessa archiviata");
    },
    onError: (e) => toast.error(e.message ?? "Archiviazione non riuscita"),
  });

  const [form, setForm] = useState(emptyForm);
  const [clienteDialogOpen, setClienteDialogOpen] = useState(false);
  const [clienteForm, setClienteForm] = useState(emptyClienteForm);

  function handleClienteSelect(clienteIdStr: string) {
    // Empty string from "Cliente non registrato" clear action.
    if (!clienteIdStr) {
      setForm({ ...form, clienteId: "", cliente: "", indirizzo: "", citta: "", telefono: "", email: "" });
      return;
    }
    const id = parseInt(clienteIdStr, 10);
    const c = clientiList.data?.find((x: any) => x.id === id);
    if (c) {
      const nomeCognome = `${c.cognome ?? ""} ${c.nome ?? ""}`.trim();
      setForm({
        ...form,
        clienteId: clienteIdStr,
        cliente: nomeCognome,
        indirizzo: c.indirizzo ?? "",
        citta: c.citta ?? "",
        telefono: c.telefono ?? "",
        email: c.email ?? "",
        // Inherit cliente owner by default so the commessa is tagged to the
        // same user that onboarded the cliente.
        assegnatoA: c.assegnatoA ? String(c.assegnatoA) : form.assegnatoA,
      });
    }
  }

  function handleCreate() {
    if (!form.cliente) return;
    createMutation.mutate({
      clienteId: form.clienteId ? parseInt(form.clienteId, 10) : undefined,
      cliente: form.cliente,
      indirizzo: form.indirizzo || undefined,
      citta: form.citta || undefined,
      telefono: form.telefono || undefined,
      email: form.email || undefined,
      priorita: form.priorita,
      note: form.note || undefined,
      consegnaIndicativa: form.consegnaIndicativa,
      assegnatoA: form.assegnatoA ? parseInt(form.assegnatoA, 10) : undefined,
      prodotti: form.prodotti
        .filter((p) => p.nome.trim())
        .map((p) => ({
          nome: p.nome.trim(),
          quantita: Math.max(1, parseInt(p.quantita, 10) || 1),
        })),
    });
  }

  function handleCreateCliente() {
    if (!clienteForm.nome || !clienteForm.cognome) return;
    createClienteMutation.mutate({
      nome: clienteForm.nome,
      cognome: clienteForm.cognome,
      tipo: clienteForm.tipo,
      telefono: clienteForm.telefono || undefined,
      email: clienteForm.email || undefined,
      indirizzo: clienteForm.indirizzo || undefined,
      citta: clienteForm.citta || undefined,
      assegnatoA: clienteForm.assegnatoA ? parseInt(clienteForm.assegnatoA, 10) : undefined,
    });
  }

  // Build options for SearchSelect
  const clienteOptions = useMemo(
    () =>
      (clientiList.data ?? []).map((c: any) => ({
        value: String(c.id),
        label: `${c.cognome ?? ""} ${c.nome ?? ""}`.trim() || "(senza nome)",
        keywords: [c.email, c.telefono, c.citta].filter(Boolean).join(" "),
        hint: c.citta ?? undefined,
      })),
    [clientiList.data]
  );
  const utenteOptions = useMemo(
    () =>
      (utentiList.data ?? []).map((u: any) => ({
        value: String(u.id),
        label: `${u.cognome ?? ""} ${u.nome ?? ""}`.trim(),
        keywords: u.email,
        hint: Array.isArray(u.ruoli) ? u.ruoli[0] : undefined,
      })),
    [utentiList.data]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-[28px] leading-[34px] font-bold tracking-[-0.02em]">
            Commesse
          </h1>
          <p className="text-text-2 text-sm mt-1">
            Stato avanzamento, priorità e prossime azioni operative
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="w-full sm:w-auto">
              <Plus className="h-4 w-4 mr-1" />
              Nuova commessa
            </Button>
          </DialogTrigger>
          <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nuova commessa</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                Il codice sara generato automaticamente (formato COM-ANNO-NUMERO).
              </div>
              <div className="space-y-2">
                <Label>Cliente *</Label>
                <div className="flex gap-1.5">
                  <div className="flex-1">
                    <SearchSelect
                      options={clienteOptions}
                      value={form.clienteId}
                      onChange={handleClienteSelect}
                      placeholder="Cerca cliente..."
                      searchPlaceholder="Nome, email, città..."
                      emptyText="Nessun cliente trovato"
                      allowClear
                      clearLabel="Cliente non registrato"
                      onCreate={() => {
                        setClienteForm({
                          ...emptyClienteForm,
                          assegnatoA: currentUser.data ? String(currentUser.data.id) : "",
                        });
                        setClienteDialogOpen(true);
                      }}
                      createLabel="+ Crea nuovo cliente"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Crea nuovo cliente"
                    onClick={() => {
                      setClienteForm({
                        ...emptyClienteForm,
                        assegnatoA: currentUser.data ? String(currentUser.data.id) : "",
                      });
                      setClienteDialogOpen(true);
                    }}
                  >
                    <UserPlus className="h-4 w-4" />
                  </Button>
                </div>
                {form.clienteId === "" && (
                  <Input
                    placeholder="Nome cliente non registrato *"
                    value={form.cliente}
                    onChange={(e) => setForm({ ...form, cliente: e.target.value })}
                    className="mt-1.5"
                  />
                )}
                {form.clienteId !== "" && (
                  <p className="text-xs text-muted-foreground mt-1">{form.cliente}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Assegnata a</Label>
                <SearchSelect
                  options={utenteOptions}
                  value={form.assegnatoA}
                  onChange={(v) => setForm({ ...form, assegnatoA: v })}
                  placeholder="Nessuno"
                  searchPlaceholder="Cerca utente..."
                  allowClear
                />
              </div>
              {/* Di cosa si tratta: righe tipologia + quantità. Finisce in
                  prodotti[] della commessa, modificabile poi dal tab Prodotti
                  della scheda, e mostrato in colonna nella lista. */}
              <div className="space-y-2">
                <Label>Prodotti</Label>
                {form.prodotti.length > 0 && (
                  <div className="space-y-2">
                    {form.prodotti.map((riga, i) => (
                      <div
                        key={i}
                        className="grid grid-cols-[minmax(0,1fr)_72px_36px] items-center gap-2"
                      >
                        <Select
                          value={riga.nome}
                          onValueChange={(v) =>
                            setForm({
                              ...form,
                              prodotti: form.prodotti.map((r, j) =>
                                j === i ? { ...r, nome: v } : r
                              ),
                            })
                          }
                        >
                          <SelectTrigger className="min-w-0" aria-label="Tipologia">
                            <SelectValue placeholder="Tipologia" />
                          </SelectTrigger>
                          <SelectContent>
                            {TIPOLOGIE_PRODOTTO.map((t) => (
                              <SelectItem key={t} value={t}>
                                {t}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          min={1}
                          className="tabular-nums"
                          value={riga.quantita}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              prodotti: form.prodotti.map((r, j) =>
                                j === i ? { ...r, quantita: e.target.value } : r
                              ),
                            })
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 text-danger shrink-0"
                          onClick={() =>
                            setForm({
                              ...form,
                              prodotti: form.prodotti.filter((_, j) => j !== i),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setForm({
                      ...form,
                      prodotti: [...form.prodotti, { nome: "", quantita: "1" }],
                    })
                  }
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Aggiungi prodotto
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Priorità</Label>
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
                <div className="space-y-2">
                  <Label>Consegna indicativa</Label>
                  <Select
                    value={form.consegnaIndicativa}
                    onValueChange={(v: any) =>
                      setForm({ ...form, consegnaIndicativa: v })
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Indirizzo</Label>
                  <Input
                    value={form.indirizzo}
                    onChange={(e) =>
                      setForm({ ...form, indirizzo: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Città</Label>
                  <Input
                    value={form.citta}
                    onChange={(e) =>
                      setForm({ ...form, citta: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Telefono</Label>
                  <Input
                    type="tel"
                    value={form.telefono}
                    onChange={(e) =>
                      setForm({ ...form, telefono: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) =>
                      setForm({ ...form, email: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Note</Label>
                <Textarea
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  rows={2}
                />
              </div>
              <Button onClick={handleCreate} disabled={!form.cliente || createMutation.isPending}>
                {createMutation.isPending ? "Creazione..." : "Crea commessa"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button
          type="button"
          className="group rounded-lg border border-border bg-card px-3 py-3 text-left shadow-xs transition-[background-color,border-color,box-shadow] hover:border-primary/35 hover:bg-surface hover:shadow-sm"
          onClick={() => {
            setFiltroPriorita("tutte");
            setFiltroStato("tutti");
            setSoloNonAssegnate(false);
            setSoloConsegneDaDatare(false);
          }}
        >
          <span className="flex items-center justify-between gap-2 text-[11px] font-semibold text-text-3">
            Tutte visibili
            <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
          </span>
          <span className="mt-1 block text-2xl font-bold tabular-nums text-text-1">
            {insightCounts.totale}
          </span>
        </button>
        <button
          type="button"
          className="group rounded-lg border border-danger/20 bg-danger-soft px-3 py-3 text-left shadow-xs transition-[background-color,border-color,box-shadow] hover:border-danger/45 hover:shadow-sm"
          onClick={() => {
            setFiltroPriorita("urgente");
            setSoloConsegneDaDatare(false);
            setSoloNonAssegnate(false);
          }}
        >
          <span className="flex items-center justify-between gap-2 text-[11px] font-semibold text-danger">
            <span className="inline-flex items-center gap-1.5">
              <Flame className="h-3.5 w-3.5" />
              Urgenze
            </span>
            <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
          </span>
          <span className="mt-1 block text-2xl font-bold tabular-nums text-danger">
            {insightCounts.urgenti}
          </span>
        </button>
        <button
          type="button"
          className="group rounded-lg border border-warning/25 bg-warning-soft px-3 py-3 text-left shadow-xs transition-[background-color,border-color,box-shadow] hover:border-warning/50 hover:shadow-sm"
          onClick={() => {
            setFiltroStato("produzione");
            setSoloConsegneDaDatare(true);
            setSoloNonAssegnate(false);
          }}
        >
          <span className="flex items-center justify-between gap-2 text-[11px] font-semibold text-warning">
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" />
              Consegne da datare
            </span>
            <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
          </span>
          <span className="mt-1 block text-2xl font-bold tabular-nums text-warning">
            {insightCounts.consegneDaConfermare}
          </span>
        </button>
        <button
          type="button"
          className="group rounded-lg border border-border bg-card px-3 py-3 text-left shadow-xs transition-[background-color,border-color,box-shadow] hover:border-primary/35 hover:bg-surface hover:shadow-sm"
          onClick={() => {
            setOnlyMine(false);
            setFiltroPriorita("tutte");
            setSoloNonAssegnate(true);
            setSoloConsegneDaDatare(false);
          }}
        >
          <span className="flex items-center justify-between gap-2 text-[11px] font-semibold text-text-3">
            <span className="inline-flex items-center gap-1.5">
              <UserX className="h-3.5 w-3.5" />
              Non assegnate
            </span>
            <span className="text-[10px] text-text-3">da vedere</span>
          </span>
          <span className="mt-1 block text-2xl font-bold tabular-nums text-text-1">
            {insightCounts.nonAssegnate}
          </span>
        </button>
      </div>

      {/* Sticky toolbar: search + stato + only-mine + counter */}
      <div className="sticky top-14 md:top-0 z-30 -mx-4 px-4 py-2.5 sm:-mx-5 sm:px-5 lg:-mx-6 lg:px-6 bg-background border-y border-border">
        <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-3" />
              <Input
                placeholder="Cerca per codice, cliente, città…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <span className="ml-auto whitespace-nowrap text-sm text-text-2 tabular-nums">
              {commesseFiltrate.length} commesse
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={filtroStato}
              onValueChange={(v) => {
                setFiltroStato(v);
                setSoloConsegneDaDatare(false);
              }}
            >
              <SelectTrigger className="w-[190px] h-9">
                <SelectValue placeholder="Stato" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tutti">Tutti gli stati</SelectItem>
                {STATI_ORDER.map((s) => (
                  <SelectItem key={s} value={s}>
                    {statoLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filtroPriorita} onValueChange={setFiltroPriorita}>
              <SelectTrigger className="w-[160px] h-9">
                <SelectValue placeholder="Priorità" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tutte">Tutte le priorità</SelectItem>
                <SelectItem value="urgente">Urgente</SelectItem>
                <SelectItem value="alta">Alta</SelectItem>
                <SelectItem value="media">Media</SelectItem>
                <SelectItem value="bassa">Bassa</SelectItem>
              </SelectContent>
            </Select>
            {currentUser.data && (
              <Button
                variant={onlyMine ? "default" : "outline"}
                size="sm"
                onClick={() => setOnlyMine(!onlyMine)}
              >
                <User className="h-3.5 w-3.5 mr-1" />
                {onlyMine ? "Solo mie" : "Tutte"}
              </Button>
            )}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setFiltroStato("tutti");
                  setFiltroPriorita("tutte");
                  setSoloConsegneDaDatare(false);
                  setSoloNonAssegnate(false);
                  setOnlyMine(false);
                }}
              >
                <FilterX className="h-3.5 w-3.5 mr-1" />
                Pulisci
              </Button>
            )}
          </div>
        </div>
      </div>

      {commesse.isLoading ? (
        <ListSkeleton />
      ) : commesseFiltrate.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface text-center py-14 text-text-2">
          <p className="text-sm">Nessuna commessa trovata</p>
          {hasActiveFilters && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                setSearch("");
                setFiltroStato("tutti");
                setFiltroPriorita("tutte");
                setSoloConsegneDaDatare(false);
                setSoloNonAssegnate(false);
                setOnlyMine(false);
              }}
            >
              <FilterX className="h-3.5 w-3.5 mr-1" />
              Rimuovi filtri
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:hidden">
            {commesseFiltrate.map((c: any) => {
              const assignee = c.assegnatoA ? utenteById.get(c.assegnatoA) : null;
              const prodotti: any[] = c.prodottiSintesi ?? [];
              const prodottiLabel = prodotti.length
                ? prodotti.map((p: any) => `${p.quantita > 1 ? `${p.quantita}x ` : ""}${p.nome}`).join(", ")
                : "Prodotti non indicati";
              const creata = c.dataApertura
                ? new Date(`${c.dataApertura}T12:00:00`).toLocaleDateString("it-IT")
                : c.createdAt
                  ? new Date(c.createdAt).toLocaleDateString("it-IT")
                  : "—";
              const consegna = c.dataConsegnaConfermata
                ? new Date(c.dataConsegnaConfermata).toLocaleDateString("it-IT")
                : c.dataConsegnaIndicativa
                  ? new Date(c.dataConsegnaIndicativa).toLocaleDateString("it-IT")
                  : c.consegnaIndicativa
                    ? `~${c.consegnaIndicativa} giorni`
                    : "—";
              return (
                <button
                  key={c.id}
                  type="button"
                  className="rounded-lg border border-border bg-card p-3 text-left shadow-xs transition-[background-color,border-color,box-shadow] hover:border-primary/35 hover:bg-surface hover:shadow-sm"
                  onClick={() => setLocation(`/commesse/${c.id}`)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="codice-mono text-text-3">{c.codice}</span>
                        <Badge variant={PRIORITA_VARIANT[c.priorita] ?? "secondary"}>
                          {PRIORITA_LABEL[c.priorita] ?? c.priorita}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-[15px] font-semibold text-text-1">
                        {c.cliente || "—"}
                      </p>
                    </div>
                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-text-3" />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <StatoChip stato={c.stato} />
                    <span className="inline-flex items-center gap-1 text-xs text-text-2">
                      <MapPin className="h-3.5 w-3.5" />
                      {c.citta || "Città non indicata"}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-xs text-text-2" title={prodottiLabel}>
                    {prodottiLabel}
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-text-2">
                    <div className="min-w-0 rounded-md bg-surface-2 px-2 py-1.5">
                      <span className="block text-[10px] font-semibold text-text-3">
                        Aperta
                      </span>
                      <span className="block truncate tabular-nums">{creata}</span>
                    </div>
                    <div className="rounded-md bg-surface-2 px-2 py-1.5">
                      <span className="block text-[10px] font-semibold text-text-3">
                        Consegna
                      </span>
                      <span className="block truncate tabular-nums" title={consegna}>{consegna}</span>
                    </div>
                    <div className="min-w-0 rounded-md bg-surface-2 px-2 py-1.5">
                      <span className="block text-[10px] font-semibold text-text-3">
                        Assegnata
                      </span>
                      <span
                        className="block truncate"
                        title={assignee ? `${assignee.cognome ?? ""} ${assignee.nome ?? ""}`.trim() : undefined}
                      >
                        {assignee
                          ? `${assignee.cognome ?? ""} ${assignee.nome ?? ""}`.trim()
                          : "Non assegnata"}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="hidden overflow-hidden rounded-xl border border-border bg-surface shadow-xs xl:block">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[14%]" />
                <col className="w-[24%]" />
                <col className="w-[15%]" />
                <col className="w-[19%]" />
                <col className="w-[15%]" />
                <col className="w-[9%]" />
                <col className="w-[4%]" />
              </colgroup>
              <thead className="bg-surface-2">
                <tr className="border-b border-border text-left [&>th]:bg-surface-2 [&>th]:shadow-[inset_0_-1px_0_var(--color-border)]">
                  <th className="eyebrow px-4 py-3 font-semibold">Commessa</th>
                  <th className="eyebrow px-4 py-3 font-semibold">Cliente e cantiere</th>
                  <th className="eyebrow px-4 py-3 font-semibold">Stato</th>
                  <th className="eyebrow px-4 py-3 font-semibold">Prodotti</th>
                  <th className="eyebrow px-4 py-3 font-semibold">Date</th>
                  <th className="eyebrow px-3 py-3 font-semibold">Assegnata</th>
                  <th className="w-11 px-1 py-3"><span className="sr-only">Azioni</span></th>
                </tr>
              </thead>
              <tbody>
                {commesseFiltrate.map((c: any) => {
                  const assignee = c.assegnatoA ? utenteById.get(c.assegnatoA) : null;
                  const prodotti: any[] = c.prodottiSintesi ?? [];
                  const prodottiLabel = prodotti.length
                    ? prodotti.map((p: any) => `${p.quantita > 1 ? `${p.quantita}x ` : ""}${p.nome}`).join(", ")
                    : "Prodotti non indicati";
                  const creata = c.dataApertura
                    ? new Date(`${c.dataApertura}T12:00:00`).toLocaleDateString("it-IT")
                    : c.createdAt
                      ? new Date(c.createdAt).toLocaleDateString("it-IT")
                      : "—";
                  const consegna = c.dataConsegnaConfermata
                    ? new Date(c.dataConsegnaConfermata).toLocaleDateString("it-IT")
                    : c.dataConsegnaIndicativa
                    ? new Date(c.dataConsegnaIndicativa).toLocaleDateString("it-IT")
                    : c.consegnaIndicativa
                    ? `~${c.consegnaIndicativa} giorni`
                    : "—";
                  return (
                    <tr
                      key={c.id}
                      className="h-16 cursor-pointer border-b border-border last:border-0 hover:bg-accent/35 transition-colors"
                      onClick={() => setLocation(`/commesse/${c.id}`)}
                    >
                      <td className="overflow-hidden px-4 py-3">
                        <span className="block truncate codice-mono text-text-2" title={c.codice}>
                          {c.codice}
                        </span>
                        <Badge
                          variant={PRIORITA_VARIANT[c.priorita] ?? "secondary"}
                          className="mt-1 text-[10px]"
                        >
                          {PRIORITA_LABEL[c.priorita] ?? c.priorita}
                        </Badge>
                      </td>
                      <td className="overflow-hidden px-4 py-3 font-medium text-text-1">
                        <span className="block truncate font-semibold" title={c.cliente || undefined}>
                          {c.cliente || "—"}
                        </span>
                        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs font-normal text-text-2">
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-text-3" aria-hidden="true" />
                          <span className="truncate" title={c.citta || undefined}>
                            {c.citta || "Città non indicata"}
                          </span>
                        </span>
                      </td>
                      <td className="overflow-hidden px-4 py-3">
                        <StatoChip stato={c.stato} />
                      </td>
                      <td className="overflow-hidden px-4 py-3 text-xs text-text-2">
                        <span className="block truncate" title={prodottiLabel}>
                          {prodottiLabel}
                        </span>
                      </td>
                      <td className="overflow-hidden px-4 py-3 text-[11px] text-text-2">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-text-3">Aperta</span>
                          <span className="truncate tabular-nums" title={creata}>{creata}</span>
                        </span>
                        <span className="mt-1 flex items-center justify-between gap-2">
                          <span className="text-text-3">Consegna</span>
                          <span className="truncate tabular-nums" title={consegna}>{consegna}</span>
                        </span>
                      </td>
                      <td className="overflow-hidden px-3 py-3">
                        {assignee ? (
                          <span
                            className="block truncate text-xs font-medium text-text-2"
                            title={`${assignee.cognome ?? ""} ${assignee.nome ?? ""}`.trim()}
                          >
                            {assignee.cognome || assignee.nome || iniziali(assignee)}
                          </span>
                        ) : (
                          <span className="text-xs text-text-3">Non assegnata</span>
                        )}
                      </td>
                      <td className="px-1 py-2" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-text-3"
                              aria-label={`Azioni per la commessa ${c.codice}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => setLocation(`/commesse/${c.id}`)}>
                              <ArrowRight className="h-4 w-4" /> Apri scheda
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => archiveCommessa.mutate(c.id)}>
                              <Archive className="h-4 w-4" /> Archivia
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-danger focus:text-danger"
                              onClick={() =>
                                setDeleteTarget({ id: c.id, codice: c.codice, stato: c.stato })
                              }
                            >
                              <Trash2 className="h-4 w-4" /> Elimina
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <DeleteCommessaDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        codice={deleteTarget?.codice ?? null}
        stato={deleteTarget?.stato ?? null}
        onConfirm={() => deleteTarget && deleteCommessa.mutate(deleteTarget.id)}
      />

      {/* Inline "Nuovo cliente" dialog — nested under Nuova commessa */}
      <Dialog open={clienteDialogOpen} onOpenChange={setClienteDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuovo cliente</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Cognome *</Label>
                <Input
                  value={clienteForm.cognome}
                  onChange={(e) => setClienteForm({ ...clienteForm, cognome: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Nome *</Label>
                <Input
                  value={clienteForm.nome}
                  onChange={(e) => setClienteForm({ ...clienteForm, nome: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select
                value={clienteForm.tipo}
                onValueChange={(v: any) => setClienteForm({ ...clienteForm, tipo: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="privato">Privato</SelectItem>
                  <SelectItem value="azienda">Azienda</SelectItem>
                  <SelectItem value="condominio">Condominio</SelectItem>
                  <SelectItem value="ente_pubblico">Ente pubblico</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Telefono</Label>
                <Input
                  type="tel"
                  value={clienteForm.telefono}
                  onChange={(e) => setClienteForm({ ...clienteForm, telefono: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={clienteForm.email}
                  onChange={(e) => setClienteForm({ ...clienteForm, email: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Indirizzo</Label>
                <Input
                  value={clienteForm.indirizzo}
                  onChange={(e) => setClienteForm({ ...clienteForm, indirizzo: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Città</Label>
                <Input
                  value={clienteForm.citta}
                  onChange={(e) => setClienteForm({ ...clienteForm, citta: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Assegnato a</Label>
              <SearchSelect
                options={utenteOptions}
                value={clienteForm.assegnatoA}
                onChange={(v) => setClienteForm({ ...clienteForm, assegnatoA: v })}
                placeholder="Nessuno"
                searchPlaceholder="Cerca utente..."
                allowClear
              />
            </div>
            <Button
              onClick={handleCreateCliente}
              disabled={
                !clienteForm.nome || !clienteForm.cognome || createClienteMutation.isPending
              }
            >
              {createClienteMutation.isPending ? "Creazione..." : "Crea e seleziona"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
