import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  Contact,
  Plus,
  Search,
  Building2,
  User,
  Landmark,
  Home,
  UserCircle,
  MoreHorizontal,
  ArrowRight,
  CreditCard,
  FilterX,
  MapPin,
  Percent,
  Phone,
  UserX,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import SearchSelect from "@/components/SearchSelect";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Trash2, Archive } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/ConfirmDialog";
import { personName } from "@/lib/name";

const tipoIcons: Record<string, any> = {
  privato: User,
  azienda: Building2,
  condominio: Home,
  ente_pubblico: Landmark,
};

const tipoLabels: Record<string, string> = {
  privato: "Privato",
  azienda: "Azienda",
  condominio: "Condominio",
  ente_pubblico: "Ente pubblico",
};

const praticaEdiliziaLabels: Record<string, string> = {
  nessuna: "Nessuna pratica edilizia",
  cil: "CIL",
  cila: "CILA",
  scia: "SCIA",
};

const emptyForm = {
  nome: "",
  cognome: "",
  tipo: "privato" as const,
  codiceFiscale: "",
  partitaIva: "",
  // Residenza — for fatture / admin
  indirizzo: "",
  citta: "",
  cap: "",
  // Indirizzo lavoro — what commessa uses
  indirizzoLavoro: "",
  cittaLavoro: "",
  capLavoro: "",
  lavoroStessoResidenza: true,
  telefono: "",
  email: "",
  detrazione: false,
  tipoDetrazione: "" as "" | "ecobonus" | "ristrutturazione",
  interesseFinanziamento: false,
  praticaEdilizia: "nessuna" as "nessuna" | "cil" | "cila" | "scia",
  note: "",
  assegnatoA: null as number | null,
};

function ListSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="space-y-2">
        {Array.from({ length: 7 }).map((_, index) => (
          <div
            key={index}
            className="grid grid-cols-[minmax(180px,1fr)_160px_120px_80px_40px] items-center gap-4 rounded-md px-2 py-3"
          >
            <Skeleton className="h-4 w-full max-w-[260px]" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-12" />
            <Skeleton className="h-8 w-8" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ClientiList() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState<string | undefined>(undefined);
  const [tagFilter, setTagFilter] = useState<
    "tutti" | "detrazione" | "finanziamento" | "non_assegnati"
  >("tutti");
  const [onlyMine, setOnlyMine] = useState(false);
  // Filter by the user a cliente is assigned to ("" = tutti).
  const [filtroAssegnato, setFiltroAssegnato] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);

  const currentUser = trpc.auth.me.useQuery();
  const utentiList = trpc.utenti.list.useQuery(undefined);

  // Assignee filter wins; otherwise "solo mie" applies.
  const assegnatoAFilter = filtroAssegnato
    ? parseInt(filtroAssegnato, 10)
    : onlyMine
    ? (currentUser.data?.id as number | undefined)
    : undefined;

  const clienti = trpc.clienti.list.useQuery({
    search: search || undefined,
    tipo: tipoFilter,
    assegnatoA: assegnatoAFilter,
  });
  const utils = trpc.useUtils();

  const createCliente = trpc.clienti.create.useMutation({
    onSuccess: () => {
      utils.clienti.invalidate();
      setDialogOpen(false);
      setForm(emptyForm);
    },
  });

  const deleteCliente = trpc.clienti.delete.useMutation({
    onSuccess: () => {
      utils.clienti.invalidate();
      setDeleteTarget(null);
      toast.success("Cliente eliminato");
    },
    onError: (e) => toast.error(e.message ?? "Eliminazione non riuscita"),
  });

  const archiveCliente = trpc.clienti.archive.useMutation({
    onSuccess: () => {
      utils.clienti.invalidate();
      utils.commesse.invalidate();
      toast.success("Cliente archiviato (con le sue commesse)");
    },
    onError: (e) => toast.error(e.message ?? "Archiviazione non riuscita"),
  });

  const [form, setForm] = useState(emptyForm);

  const utenteById = useMemo(() => {
    const map = new Map<number, any>();
    for (const u of utentiList.data ?? []) map.set(u.id, u);
    return map;
  }, [utentiList.data]);

  const clientiFiltrati = useMemo(() => {
    const rows = clienti.data ?? [];
    return rows.filter((c: any) => {
      if (tagFilter === "detrazione") return !!c.detrazione;
      if (tagFilter === "finanziamento") return !!c.interesseFinanziamento;
      if (tagFilter === "non_assegnati") return c.assegnatoA == null;
      return true;
    });
  }, [clienti.data, tagFilter]);

  const insightCounts = useMemo(() => {
    const rows = clienti.data ?? [];
    return {
      totale: rows.length,
      detrazioni: rows.filter((c: any) => !!c.detrazione).length,
      finanziamenti: rows.filter((c: any) => !!c.interesseFinanziamento).length,
      nonAssegnati: rows.filter((c: any) => c.assegnatoA == null).length,
    };
  }, [clienti.data]);

  const hasActiveFilters =
    !!search ||
    !!tipoFilter ||
    onlyMine ||
    !!filtroAssegnato ||
    tagFilter !== "tutti";

  const utenteOptions = useMemo(
    () =>
      (utentiList.data ?? []).map((u: any) => ({
        value: String(u.id),
        label: u.nome ?? u.email ?? `Utente ${u.id}`,
        keywords: [u.email, u.ruolo, u.ruoli?.join(" ")].filter(Boolean).join(" "),
        hint: u.ruolo ?? u.ruoli?.[0],
      })),
    [utentiList.data]
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-[28px] leading-[34px] font-bold tracking-[-0.02em] flex items-center gap-2">
            <Contact className="h-6 w-6 text-primary" />
            Clienti
          </h1>
          <p className="text-text-2 text-sm mt-1">
            Anagrafica, riferimenti fiscali e segnali commerciali
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="w-full sm:w-auto">
              <Plus className="h-4 w-4 mr-1" />
              Nuovo cliente
            </Button>
          </DialogTrigger>
          <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nuovo cliente</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select
                  value={form.tipo}
                  onValueChange={(v: any) => setForm({ ...form, tipo: v })}
                >
                  <SelectTrigger aria-label="Tipo di cliente">
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
              {form.tipo === "privato" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Cognome *</Label>
                    <Input
                      value={form.cognome}
                      onChange={(e) =>
                        setForm({ ...form, cognome: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Nome *</Label>
                    <Input
                      value={form.nome}
                      onChange={(e) => setForm({ ...form, nome: e.target.value })}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>Ragione sociale *</Label>
                  <Input
                    placeholder={
                      form.tipo === "condominio"
                        ? "Es. Condominio Colline del Sole"
                        : "Es. Rossi Costruzioni S.r.l."
                    }
                    value={form.cognome}
                    onChange={(e) =>
                      setForm({ ...form, cognome: e.target.value })
                    }
                  />
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Codice fiscale</Label>
                  <Input
                    value={form.codiceFiscale}
                    onChange={(e) =>
                      setForm({ ...form, codiceFiscale: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Partita IVA</Label>
                  <Input
                    value={form.partitaIva}
                    onChange={(e) =>
                      setForm({ ...form, partitaIva: e.target.value })
                    }
                  />
                </div>
              </div>
              {/* Residenza — for fatture / admin */}
              <div className="rounded-md border p-3 space-y-3">
                <div className="text-xs font-semibold uppercase text-muted-foreground">
                  {form.tipo === "privato"
                    ? "Indirizzo di residenza (fatturazione)"
                    : "Sede legale (fatturazione)"}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Indirizzo</Label>
                    <Input
                      value={form.indirizzo}
                      onChange={(e) =>
                        setForm({ ...form, indirizzo: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>CAP</Label>
                    <Input
                      value={form.cap}
                      onChange={(e) => setForm({ ...form, cap: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Città</Label>
                  <Input
                    value={form.citta}
                    onChange={(e) =>
                      setForm({ ...form, citta: e.target.value })
                    }
                  />
                </div>
              </div>
              {/* Lavoro — what commessa uses by default */}
              <div className="rounded-md border p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    Indirizzo dove va effettuato il lavoro
                  </div>
                  <label className="flex shrink-0 items-center gap-2 text-xs">
                    <Switch
                      checked={form.lavoroStessoResidenza}
                      onCheckedChange={(v) =>
                        setForm({ ...form, lavoroStessoResidenza: v })
                      }
                    />
                    <span className="text-muted-foreground">
                      {form.tipo === "privato" ? "Stesso della residenza" : "Stessa della sede legale"}
                    </span>
                  </label>
                </div>
                {!form.lavoroStessoResidenza && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label>Indirizzo lavoro</Label>
                        <Input
                          value={form.indirizzoLavoro}
                          onChange={(e) =>
                            setForm({ ...form, indirizzoLavoro: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>CAP</Label>
                        <Input
                          value={form.capLavoro}
                          onChange={(e) =>
                            setForm({ ...form, capLavoro: e.target.value })
                          }
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Città lavoro</Label>
                      <Input
                        value={form.cittaLavoro}
                        onChange={(e) =>
                          setForm({ ...form, cittaLavoro: e.target.value })
                        }
                      />
                    </div>
                  </>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Telefono</Label>
                  <Input
                    type="tel"
                    value={form.telefono}
                    onChange={(e) =>
                      setForm({ ...form, telefono: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
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
              <div className="rounded-md border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Detrazione fiscale</div>
                    <div className="text-xs text-muted-foreground">
                      Il cliente vuole usufruirne?
                    </div>
                  </div>
                  <Switch
                    checked={form.detrazione}
                    onCheckedChange={(v) =>
                      setForm({
                        ...form,
                        detrazione: v,
                        tipoDetrazione: v ? form.tipoDetrazione : "",
                      })
                    }
                  />
                </div>
                {form.detrazione && (
                  <div className="space-y-1.5">
                    <Label>Quale detrazione</Label>
                    <Select
                      value={form.tipoDetrazione}
                      onValueChange={(v: any) =>
                        setForm({ ...form, tipoDetrazione: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Seleziona detrazione..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ecobonus">Ecobonus</SelectItem>
                        <SelectItem value="ristrutturazione">
                          Ristrutturazione
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">Interesse finanziamento</div>
                  <div className="text-xs text-muted-foreground">Si / No</div>
                </div>
                <Switch
                  checked={form.interesseFinanziamento}
                  onCheckedChange={(v) =>
                    setForm({ ...form, interesseFinanziamento: v })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Pratica edilizia</Label>
                <Select
                  value={form.praticaEdilizia}
                  onValueChange={(v: any) =>
                    setForm({ ...form, praticaEdilizia: v })
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
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Assegnato a</Label>
                <SearchSelect
                  options={utenteOptions}
                  value={form.assegnatoA != null ? String(form.assegnatoA) : ""}
                  onChange={(v) =>
                    setForm({ ...form, assegnatoA: v ? parseInt(v) : null })
                  }
                  placeholder="Seleziona utente (default: me)"
                  searchPlaceholder="Cerca utente..."
                  allowClear
                  clearLabel="— Non assegnato —"
                />
              </div>
              <Button
                onClick={() => {
                  // If "stesso della residenza" toggled, copy residenza →
                  // lavoro so commessa fallback always has a value to use.
                  const lavoroSame = form.lavoroStessoResidenza;
                  createCliente.mutate({
                    nome: form.tipo === "privato" ? form.nome : " ",
                    cognome: form.cognome,
                    tipo: form.tipo as any,
                    codiceFiscale: form.codiceFiscale || undefined,
                    partitaIva: form.partitaIva || undefined,
                    indirizzo: form.indirizzo || undefined,
                    citta: form.citta || undefined,
                    cap: form.cap || undefined,
                    indirizzoLavoro:
                      (lavoroSame ? form.indirizzo : form.indirizzoLavoro) ||
                      undefined,
                    cittaLavoro:
                      (lavoroSame ? form.citta : form.cittaLavoro) || undefined,
                    capLavoro:
                      (lavoroSame ? form.cap : form.capLavoro) || undefined,
                    telefono: form.telefono || undefined,
                    email: form.email || undefined,
                    detrazione: form.detrazione,
                    tipoDetrazione:
                      form.detrazione && form.tipoDetrazione
                        ? (form.tipoDetrazione as "ecobonus" | "ristrutturazione")
                        : null,
                    interesseFinanziamento: form.interesseFinanziamento,
                    praticaEdilizia: form.praticaEdilizia,
                    note: form.note || undefined,
                    assegnatoA: form.assegnatoA,
                  });
                }}
                disabled={
                  (form.tipo === "privato" && !form.nome) ||
                  !form.cognome ||
                  (form.detrazione && !form.tipoDetrazione) ||
                  createCliente.isPending
                }
              >
                Crea cliente
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
            setTipoFilter(undefined);
            setTagFilter("tutti");
          }}
        >
          <span className="flex items-center justify-between gap-2 text-[11px] font-semibold text-text-3">
            Visibili
            <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
          </span>
          <span className="mt-1 block text-2xl font-bold tabular-nums text-text-1">
            {insightCounts.totale}
          </span>
        </button>
        <button
          type="button"
          className="group rounded-lg border border-warning/25 bg-warning-soft px-3 py-3 text-left shadow-xs transition-[background-color,border-color,box-shadow] hover:border-warning/50 hover:shadow-sm"
          onClick={() => {
            setTipoFilter(undefined);
            setTagFilter("finanziamento");
          }}
        >
          <span className="flex items-center justify-between gap-2 text-[11px] font-semibold text-warning">
            <span className="inline-flex items-center gap-1.5">
              <CreditCard className="h-3.5 w-3.5" />
              Finanziamenti
            </span>
            <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
          </span>
          <span className="mt-1 block text-2xl font-bold tabular-nums text-warning">
            {insightCounts.finanziamenti}
          </span>
        </button>
        <button
          type="button"
          className="group rounded-lg border border-info/20 bg-info-soft px-3 py-3 text-left shadow-xs transition-[background-color,border-color,box-shadow] hover:border-info/45 hover:shadow-sm"
          onClick={() => setTagFilter("detrazione")}
        >
          <span className="flex items-center justify-between gap-2 text-[11px] font-semibold text-info">
            <span className="inline-flex items-center gap-1.5">
              <Percent className="h-3.5 w-3.5" />
              Detrazioni
            </span>
            <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
          </span>
          <span className="mt-1 block text-2xl font-bold tabular-nums text-info">
            {insightCounts.detrazioni}
          </span>
        </button>
        <button
          type="button"
          className="group rounded-lg border border-border bg-card px-3 py-3 text-left shadow-xs transition-[background-color,border-color,box-shadow] hover:border-primary/35 hover:bg-surface hover:shadow-sm"
          onClick={() => setTagFilter("non_assegnati")}
        >
          <span className="flex items-center justify-between gap-2 text-[11px] font-semibold text-text-3">
            <span className="inline-flex items-center gap-1.5">
              <UserX className="h-3.5 w-3.5" />
              Non assegnati
            </span>
            <span className="text-[10px] text-text-3">da presidiare</span>
          </span>
          <span className="mt-1 block text-2xl font-bold tabular-nums text-text-1">
            {insightCounts.nonAssegnati}
          </span>
        </button>
      </div>

      {/* Sticky toolbar: search + tipo chips + only-mine + counter */}
      <div className="sticky top-14 md:top-0 z-30 -mx-4 px-4 py-2.5 sm:-mx-5 sm:px-5 lg:-mx-6 lg:px-6 bg-background/94 border-y border-border/80 backdrop-blur">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-full flex-1 sm:min-w-[240px] xl:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-3" />
              <Input
                placeholder="Cerca per nome, città, email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <Button
              variant={!tipoFilter ? "default" : "outline"}
              size="sm"
              onClick={() => setTipoFilter(undefined)}
            >
              Tutti
            </Button>
            {Object.entries(tipoLabels).map(([key, label]) => (
              <Button
                key={key}
                variant={tipoFilter === key ? "default" : "outline"}
                size="sm"
                onClick={() => setTipoFilter(key)}
              >
                {label}
              </Button>
            ))}
            <span className="ml-auto whitespace-nowrap text-sm text-text-2 tabular-nums">
              {clientiFiltrati.length} clienti
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={tagFilter} onValueChange={(v: any) => setTagFilter(v)}>
              <SelectTrigger className="w-[170px] h-9">
                <SelectValue placeholder="Segnali" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tutti">Tutti i segnali</SelectItem>
                <SelectItem value="detrazione">Detrazione</SelectItem>
                <SelectItem value="finanziamento">Finanziamento</SelectItem>
                <SelectItem value="non_assegnati">Non assegnati</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant={onlyMine && !filtroAssegnato ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setFiltroAssegnato("");
                setOnlyMine((v) => !v);
              }}
              title="Filtra solo i clienti assegnati a me"
            >
              <UserCircle className="h-3.5 w-3.5 mr-1" />
              {onlyMine && !filtroAssegnato ? "Solo mie" : "Tutte"}
            </Button>
            <Select
              value={filtroAssegnato || "tutti"}
              onValueChange={(v) => {
                setFiltroAssegnato(v === "tutti" ? "" : v);
                setOnlyMine(false);
              }}
            >
              <SelectTrigger className="w-[190px] h-9">
                <SelectValue placeholder="Assegnato a" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tutti">Tutti gli assegnatari</SelectItem>
                {(utentiList.data ?? []).map((u: any) => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {personName(u, u.email ?? `Utente ${u.id}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setTipoFilter(undefined);
                  setTagFilter("tutti");
                  setOnlyMine(false);
                  setFiltroAssegnato("");
                }}
              >
                <FilterX className="h-3.5 w-3.5 mr-1" />
                Pulisci
              </Button>
            )}
          </div>
        </div>
      </div>

      {clienti.isLoading ? (
        <ListSkeleton />
      ) : clientiFiltrati.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface text-center py-14 text-text-2 text-sm">
          <p>Nessun cliente trovato.</p>
          {hasActiveFilters && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                setSearch("");
                setTipoFilter(undefined);
                setTagFilter("tutti");
                setOnlyMine(false);
                setFiltroAssegnato("");
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
            {clientiFiltrati.map((c: any) => {
              const TipoIcon = tipoIcons[c.tipo] ?? User;
              const displayName = `${c.cognome ?? ""} ${c.nome ?? ""}`.trim();
              const assignee =
                c.assegnatoA != null ? utenteById.get(c.assegnatoA) : null;
              return (
                <button
                  key={c.id}
                  type="button"
                  className="rounded-lg border border-border bg-card p-3 text-left shadow-xs transition-[background-color,border-color,box-shadow] hover:border-primary/35 hover:bg-surface hover:shadow-sm"
                  onClick={() => setLocation(`/clienti/${c.id}`)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <TipoIcon className="h-4 w-4 text-text-3" />
                        <Badge variant="outline" className="text-[10px]">
                          {tipoLabels[c.tipo] ?? c.tipo}
                        </Badge>
                        {c.detrazione && <Badge variant="info">Detrazione</Badge>}
                        {c.interesseFinanziamento && (
                          <Badge variant="secondary">Finanziamento</Badge>
                        )}
                      </div>
                      <p className="mt-1 truncate text-[15px] font-semibold text-text-1">
                        {displayName || "—"}
                      </p>
                    </div>
                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-text-3" />
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-text-2">
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3.5 w-3.5" />
                      {c.telefono || "Telefono non indicato"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5" />
                      {c.citta || "Città non indicata"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <UserCircle className="h-3.5 w-3.5" />
                      {assignee
                        ? `${assignee.cognome ?? ""} ${assignee.nome ?? ""}`.trim()
                        : "Non assegnato"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Building2 className="h-3.5 w-3.5" />
                      {c.commesseIds?.length ?? 0} commesse
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="hidden overflow-hidden rounded-xl border border-border bg-surface shadow-xs xl:block">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[28%]" />
                <col className="w-[22%]" />
                <col className="w-[22%]" />
                <col className="w-[9%]" />
                <col className="w-[15%]" />
                <col className="w-[4%]" />
              </colgroup>
              <thead className="bg-surface-2">
                <tr className="border-b border-border text-left [&>th]:bg-surface-2 [&>th]:shadow-[inset_0_-1px_0_var(--color-border)]">
                  <th className="eyebrow px-4 py-3 font-semibold">Cliente</th>
                  <th className="eyebrow px-4 py-3 font-semibold">Contatti</th>
                  <th className="eyebrow px-4 py-3 font-semibold">Segnali</th>
                  <th className="eyebrow px-2 py-3 text-center font-semibold">Commesse</th>
                  <th className="eyebrow px-4 py-3 font-semibold">Assegnato</th>
                  <th className="w-11 px-1 py-3"><span className="sr-only">Azioni</span></th>
                </tr>
              </thead>
              <tbody>
                {clientiFiltrati.map((c: any) => {
                  const TipoIcon = tipoIcons[c.tipo] ?? User;
                  const displayName = `${c.cognome ?? ""} ${c.nome ?? ""}`.trim();
                  const assignee =
                    c.assegnatoA != null ? utenteById.get(c.assegnatoA) : null;
                  return (
                    <tr
                      key={c.id}
                      className="h-16 cursor-pointer border-b border-border last:border-0 hover:bg-accent/35 transition-colors"
                      onClick={() => setLocation(`/clienti/${c.id}`)}
                    >
                      <td className="overflow-hidden px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-text-2">
                            <TipoIcon className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <div className="min-w-0">
                            <span
                              className="block truncate font-semibold text-text-1"
                              title={displayName || undefined}
                            >
                              {displayName || "—"}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-text-3">
                              {tipoLabels[c.tipo] ?? c.tipo}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="overflow-hidden px-4 py-3">
                        <div className="min-w-0 space-y-1 text-xs text-text-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <MapPin className="h-3.5 w-3.5 shrink-0 text-text-3" aria-hidden="true" />
                            <span className="truncate" title={c.citta || undefined}>
                              {c.citta || "Città non indicata"}
                            </span>
                          </span>
                          <span className="flex min-w-0 items-center gap-1.5 tabular-nums">
                            <Phone className="h-3.5 w-3.5 shrink-0 text-text-3" aria-hidden="true" />
                            <span className="truncate" title={c.telefono || undefined}>
                              {c.telefono || "Telefono non indicato"}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className="overflow-hidden px-4 py-3">
                        <div className="flex max-h-12 items-center gap-1 overflow-hidden flex-wrap">
                          {c.detrazione && (
                            <Badge variant="info" className="capitalize">
                              {c.tipoDetrazione || "Detrazione"}
                            </Badge>
                          )}
                          {c.interesseFinanziamento && (
                            <Badge variant="secondary">Finanziamento</Badge>
                          )}
                          {c.praticaEdilizia && c.praticaEdilizia !== "nessuna" && (
                            <Badge variant="secondary" className="uppercase">
                              {c.praticaEdilizia}
                            </Badge>
                          )}
                          {!c.detrazione &&
                            !c.interesseFinanziamento &&
                            (!c.praticaEdilizia || c.praticaEdilizia === "nessuna") && (
                              <span className="text-text-3">—</span>
                            )}
                        </div>
                      </td>
                      <td className="px-2 py-3 text-center tabular-nums font-semibold text-text-1">
                        {c.commesseIds?.length ?? 0}
                      </td>
                      <td className="overflow-hidden px-4 py-3 text-text-2">
                        <span
                          className="block truncate"
                          title={assignee ? `${assignee.cognome ?? ""} ${assignee.nome ?? ""}`.trim() : undefined}
                        >
                          {assignee ? `${assignee.cognome ?? ""} ${assignee.nome ?? ""}`.trim() : "Non assegnato"}
                        </span>
                      </td>
                      <td className="px-1 py-2" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-text-3"
                              aria-label={`Azioni per ${displayName || `cliente ${c.id}`}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => setLocation(`/clienti/${c.id}`)}>
                              <ArrowRight className="h-4 w-4" /> Apri scheda
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => archiveCliente.mutate(c.id)}>
                              <Archive className="h-4 w-4" /> Archivia
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-danger focus:text-danger"
                              onClick={() =>
                                setDeleteTarget({
                                  id: c.id,
                                  label: displayName || c.email || `Cliente ${c.id}`,
                                })
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

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Eliminare il cliente?"
        description={`Stai per eliminare "${deleteTarget?.label ?? ""}". L'operazione è definitiva e non può essere annullata. Le commesse collegate restano, ma perdono il riferimento al cliente.`}
        confirmLabel="Elimina"
        onConfirm={() => deleteTarget && deleteCliente.mutate(deleteTarget.id)}
      />
    </div>
  );
}
