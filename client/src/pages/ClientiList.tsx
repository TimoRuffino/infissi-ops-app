import { useMemo, useState } from "react";
import {
  Archive,
  ArrowRight,
  Building2,
  Contact,
  FilterX,
  Home,
  Landmark,
  MapPin,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  Trash2,
  User,
  UserCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import ConfirmDialog from "@/components/ConfirmDialog";
import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import type { StatePanelProps } from "@/components/patterns/StatePanel";
import SearchSelect from "@/components/SearchSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ProvinciaSelect from "@/components/clienti/ProvinciaSelect";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useOperationalContext } from "@/contexts/OperationalContext";
import { personName } from "@/lib/name";
import { customerPermissions } from "@/lib/operationalRoutes";
import { trpc } from "@/lib/trpc";

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

// Filtri di tipo: `short` tiene la riga leggibile anche a 390 px.
const TIPI = [
  { id: undefined, label: "Tutti i tipi", short: "Tutti" },
  { id: "privato", label: "Privato", short: "Privati" },
  { id: "azienda", label: "Azienda", short: "Aziende" },
  { id: "condominio", label: "Condominio", short: "Condomìni" },
  { id: "ente_pubblico", label: "Ente pubblico", short: "Enti" },
] as const;

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
  provincia: "",
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
  const [deleteTarget, setDeleteTarget] = useState<{
    id: number;
    label: string;
  } | null>(null);

  // Il provider della slice 01 è l'unico owner di `permessi.mie`: finché il
  // contesto non è `ready` la matrice resta fail-closed e nessuna CTA compare.
  const { capabilities, status: operationalStatus } = useOperationalContext();
  const permissions = customerPermissions(
    operationalStatus === "ready" ? capabilities : null
  );

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
    onError: e => toast.error(e.message ?? "Creazione non riuscita"),
  });

  // Il pulsante principale del dialog: cliente e prima commessa in una sola
  // mutation sede-scoped. Il server verifica entrambe le capability prima di
  // scrivere; qui si apre subito la commessa, che è dove si continua a lavorare.
  const createClienteConCommessa = trpc.clienti.createConCommessa.useMutation({
    onSuccess: ({ commessa }) => {
      utils.clienti.invalidate();
      utils.commesse.invalidate();
      setDialogOpen(false);
      setForm(emptyForm);
      toast.success(`Cliente e commessa ${commessa.codice} creati`);
      setLocation(`/commesse/${commessa.id}`);
    },
    onError: e => toast.error(e.message ?? "Creazione non riuscita"),
  });

  const deleteCliente = trpc.clienti.delete.useMutation({
    onSuccess: () => {
      utils.clienti.invalidate();
      setDeleteTarget(null);
      toast.success("Cliente eliminato");
    },
    onError: e => toast.error(e.message ?? "Eliminazione non riuscita"),
  });

  const archiveCliente = trpc.clienti.archive.useMutation({
    onSuccess: () => {
      utils.clienti.invalidate();
      utils.commesse.invalidate();
      toast.success("Cliente archiviato (con le sue commesse)");
    },
    onError: e => toast.error(e.message ?? "Archiviazione non riuscita"),
  });

  const [form, setForm] = useState(emptyForm);

  // Un solo payload per «Crea solo il cliente» e «Crea cliente e commessa»:
  // le due mutation differiscono solo per la commessa che il server aggiunge.
  function payloadCliente() {
    // If "stesso della residenza" toggled, copy residenza → lavoro so
    // commessa fallback always has a value to use.
    const lavoroSame = form.lavoroStessoResidenza;
    return {
      nome: form.tipo === "privato" ? form.nome : " ",
      cognome: form.cognome,
      tipo: form.tipo as any,
      codiceFiscale: form.codiceFiscale || undefined,
      partitaIva: form.partitaIva || undefined,
      indirizzo: form.indirizzo || undefined,
      citta: form.citta || undefined,
      provincia: form.provincia || undefined,
      cap: form.cap || undefined,
      indirizzoLavoro:
        (lavoroSame ? form.indirizzo : form.indirizzoLavoro) || undefined,
      cittaLavoro: (lavoroSame ? form.citta : form.cittaLavoro) || undefined,
      capLavoro: (lavoroSame ? form.cap : form.capLavoro) || undefined,
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
      // `clienti.create` non ha un gate `cliente.assign`: se il campo
      // mancasse, il router assegnerebbe il cliente a chi lo crea. Senza
      // capability inviamo lo stesso `null` di prima, così il cliente nasce
      // non assegnato come sempre.
      assegnatoA: permissions.canAssignCustomer ? form.assegnatoA : null,
    };
  }

  const formIncompleto =
    (form.tipo === "privato" && !form.nome) ||
    !form.cognome ||
    (form.detrazione && !form.tipoDetrazione);
  const creazioneInCorso =
    createCliente.isPending || createClienteConCommessa.isPending;
  const creazioneErrore = createClienteConCommessa.error ?? createCliente.error;

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

  function azzeraFiltri() {
    setSearch("");
    setTipoFilter(undefined);
    setTagFilter("tutti");
    setOnlyMine(false);
    setFiltroAssegnato("");
  }

  const utenteOptions = useMemo(
    () =>
      (utentiList.data ?? []).map((u: any) => ({
        value: String(u.id),
        label: personName(u, u.email ?? `Utente ${u.id}`),
        keywords: [u.email, u.ruolo, u.ruoli?.join(" ")]
          .filter(Boolean)
          .join(" "),
        hint: u.ruolo ?? u.ruoli?.[0],
      })),
    [utentiList.data]
  );

  const nuovoClienteButton = (
    <Button
      type="button"
      className="min-h-11 w-full sm:w-auto"
      onClick={() => setDialogOpen(true)}
    >
      <Plus className="h-4 w-4" aria-hidden="true" /> Nuovo cliente
    </Button>
  );

  // Quattro stati distinti: caricamento, errore con retry, sede senza clienti
  // e lista filtrata vuota. Una lista vuota non è mai "tutto a posto".
  const statoSuperficie: StatePanelProps | undefined = clienti.isPending
    ? {
        kind: "loading",
        title: "Carico l'anagrafica",
        description: "Recupero i clienti della sede attiva.",
        rows: 5,
      }
    : clienti.isError
      ? {
          kind: "error",
          title: "Clienti non caricati",
          description:
            "Non è stato possibile leggere l'anagrafica della sede. Nessun dato è stato modificato.",
          action: (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => clienti.refetch()}
            >
              Riprova
            </Button>
          ),
        }
      : insightCounts.totale === 0
        ? {
            kind: "empty",
            title: hasActiveFilters
              ? "Nessun cliente corrisponde alla ricerca"
              : "Nessun cliente in questa sede",
            description: hasActiveFilters
              ? "Cambia ricerca, tipo o assegnatario per vedere gli altri clienti della sede."
              : permissions.canCreateCustomer
                ? "Registra il primo cliente per collegargli commesse, appuntamenti e ticket."
                : "Quando verrà registrato un cliente lo troverai qui.",
            action: hasActiveFilters ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={azzeraFiltri}
              >
                <FilterX className="h-4 w-4" aria-hidden="true" /> Azzera i
                filtri
              </Button>
            ) : permissions.canCreateCustomer ? (
              nuovoClienteButton
            ) : undefined,
          }
        : clientiFiltrati.length === 0
          ? {
              kind: "empty",
              title: "Nessun cliente corrisponde ai filtri correnti",
              description:
                "Il filtro sui segnali nasconde gli altri clienti letti dalla sede.",
              action: (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={azzeraFiltri}
                >
                  <FilterX className="h-4 w-4" aria-hidden="true" /> Azzera i
                  filtri
                </Button>
              ),
            }
          : undefined;

  // Una riga espone il menu solo se resta almeno un'azione autorizzata.
  const hasRowActions =
    permissions.canArchiveCustomer || permissions.canDeleteCustomer;

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      <PageHeader
        variant="workbench"
        eyebrow="Anagrafica"
        title={
          <span className="inline-flex items-center gap-2">
            <Contact className="h-6 w-6 text-primary" aria-hidden="true" />
            Clienti
          </span>
        }
        description="Chi seguiamo, con che riferimenti fiscali e con quali segnali commerciali aperti."
        busy={clienti.isFetching}
        metadata={
          <>
            {/* Un conteggio che non conosciamo non si mostra come zero. */}
            {clienti.isPending ? (
              <span>Conteggio clienti in caricamento…</span>
            ) : clienti.isError ? (
              <span>Conteggio clienti non disponibile</span>
            ) : (
              <>
                <span>
                  <strong className="tabular-nums text-text-1">
                    {insightCounts.totale}
                  </strong>{" "}
                  {insightCounts.totale === 1
                    ? "cliente visibile"
                    : "clienti visibili"}
                </span>
                <span>
                  <strong className="tabular-nums text-text-1">
                    {insightCounts.detrazioni}
                  </strong>{" "}
                  con detrazione
                </span>
                <span>
                  <strong className="tabular-nums text-text-1">
                    {insightCounts.finanziamenti}
                  </strong>{" "}
                  interessati al finanziamento
                </span>
                <span>
                  <strong className="tabular-nums text-text-1">
                    {insightCounts.nonAssegnati}
                  </strong>{" "}
                  senza assegnatario
                </span>
              </>
            )}
            {clienti.isFetching && !clienti.isPending ? (
              <span role="status">Aggiornamento in corso…</span>
            ) : null}
          </>
        }
        primaryAction={
          permissions.canCreateCustomer ? nuovoClienteButton : undefined
        }
      />

      <div className="min-w-0 space-y-4">
        <div className="sticky top-0 z-20 border-b border-border-soft bg-surface px-1 py-3">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
              <div className="relative min-w-0 flex-1 lg:max-w-sm">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
                  aria-hidden="true"
                />
                <Input
                  aria-label="Cerca clienti"
                  placeholder="Cerca per nome, telefono, email, indirizzo…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="min-h-11 pl-9"
                />
              </div>

              <div
                role="group"
                aria-label="Tipo cliente"
                className="flex min-w-0 flex-wrap items-center gap-1 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-1"
              >
                {TIPI.map(t => {
                  const attivo = tipoFilter === t.id;
                  return (
                    <Button
                      key={t.label}
                      type="button"
                      variant={attivo ? "default" : "ghost"}
                      size="sm"
                      aria-pressed={attivo}
                      aria-label={t.label}
                      className="min-h-11 min-w-0 flex-1 px-2 sm:px-2.5 lg:flex-none"
                      onClick={() => setTipoFilter(t.id)}
                    >
                      <span className="hidden sm:inline">{t.label}</span>
                      <span className="sm:hidden">{t.short}</span>
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Select
                value={tagFilter}
                onValueChange={(v: any) => setTagFilter(v)}
              >
                <SelectTrigger
                  aria-label="Filtro segnali"
                  className="min-h-11 w-full sm:w-48"
                >
                  <SelectValue placeholder="Segnali" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tutti">Tutti i segnali</SelectItem>
                  <SelectItem value="detrazione">Detrazione</SelectItem>
                  <SelectItem value="finanziamento">Finanziamento</SelectItem>
                  <SelectItem value="non_assegnati">Non assegnati</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filtroAssegnato || "tutti"}
                onValueChange={v => {
                  setFiltroAssegnato(v === "tutti" ? "" : v);
                  setOnlyMine(false);
                }}
              >
                <SelectTrigger
                  aria-label="Filtro assegnatario"
                  className="min-h-11 w-full sm:w-52"
                >
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

              <Button
                type="button"
                variant={onlyMine && !filtroAssegnato ? "default" : "outline"}
                size="sm"
                aria-pressed={onlyMine && !filtroAssegnato}
                className="min-h-11"
                onClick={() => {
                  setFiltroAssegnato("");
                  setOnlyMine(v => !v);
                }}
              >
                <UserCircle className="h-4 w-4" aria-hidden="true" />
                Solo i miei
              </Button>

              {hasActiveFilters ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-11"
                  onClick={azzeraFiltri}
                >
                  <FilterX className="h-4 w-4" aria-hidden="true" /> Pulisci
                </Button>
              ) : null}

              <span className="ml-auto whitespace-nowrap text-sm tabular-nums text-text-2">
                {clientiFiltrati.length} in elenco
              </span>
            </div>
          </div>
        </div>

        <section className="min-w-0" aria-label="Elenco clienti">
          <DataSurface
            density="compact"
            tone="sunken"
            state={statoSuperficie}
            toolbar={
              utentiList.isError ? (
                <p
                  role="status"
                  className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-2"
                >
                  Utenti non caricati: il nome dell'assegnatario non è mostrato.
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11"
                    onClick={() => utentiList.refetch()}
                  >
                    Riprova
                  </Button>
                </p>
              ) : null
            }
          >
            {/* Desktop: tabella densa, una riga per cliente. */}
            <div className="hidden min-w-0 lg:block">
              <Table className="table-fixed">
                <colgroup>
                  <col className="w-[28%]" />
                  <col className="w-[22%]" />
                  <col className="w-[20%]" />
                  <col className="w-[9%]" />
                  <col className="w-[17%]" />
                  <col className="w-[4%]" />
                </colgroup>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Contatti</TableHead>
                    <TableHead>Segnali</TableHead>
                    <TableHead className="text-right">Commesse</TableHead>
                    <TableHead>Assegnato a</TableHead>
                    <TableHead>
                      <span className="sr-only">Azioni</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clientiFiltrati.map((c: any) => {
                    const TipoIcon = tipoIcons[c.tipo] ?? User;
                    const nome = personName(c, `Cliente ${c.id}`);
                    const assignee =
                      c.assegnatoA != null
                        ? utenteById.get(c.assegnatoA)
                        : null;
                    const assegnatario = assignee
                      ? personName(assignee, `Utente ${c.assegnatoA}`)
                      : "Non assegnato";
                    return (
                      <TableRow
                        key={c.id}
                        className="cursor-pointer"
                        onClick={() => setLocation(`/clienti/${c.id}`)}
                      >
                        <TableCell className="overflow-hidden">
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] bg-surface-2 text-text-2"
                            >
                              <TipoIcon className="h-4 w-4" />
                            </span>
                            {/* Il nome è il target da tastiera della riga:
                                il click sul <tr> resta solo una comodità. */}
                            <button
                              type="button"
                              className="min-w-0 rounded-[var(--radius-control)] text-left"
                              onClick={e => {
                                e.stopPropagation();
                                setLocation(`/clienti/${c.id}`);
                              }}
                            >
                              <span
                                className="block truncate font-semibold text-text-1"
                                title={nome}
                              >
                                {nome}
                              </span>
                              <span className="block truncate text-[11px] text-text-3">
                                {tipoLabels[c.tipo] ?? c.tipo}
                              </span>
                            </button>
                          </div>
                        </TableCell>
                        <TableCell className="overflow-hidden text-xs text-text-2">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <MapPin
                              className="h-3.5 w-3.5 shrink-0 text-text-3"
                              aria-hidden="true"
                            />
                            <span
                              className="truncate"
                              title={c.citta || undefined}
                            >
                              {c.citta || "Città non indicata"}
                            </span>
                          </span>
                          <span className="flex min-w-0 items-center gap-1.5 tabular-nums">
                            <Phone
                              className="h-3.5 w-3.5 shrink-0 text-text-3"
                              aria-hidden="true"
                            />
                            <span
                              className="truncate"
                              title={c.telefono || undefined}
                            >
                              {c.telefono || "Telefono non indicato"}
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="overflow-hidden">
                          <div className="flex flex-wrap items-center gap-1">
                            {c.detrazione ? (
                              <Badge variant="info" className="capitalize">
                                {c.tipoDetrazione || "Detrazione"}
                              </Badge>
                            ) : null}
                            {c.interesseFinanziamento ? (
                              <Badge variant="secondary">Finanziamento</Badge>
                            ) : null}
                            {c.praticaEdilizia &&
                            c.praticaEdilizia !== "nessuna" ? (
                              <Badge variant="secondary">
                                {praticaEdiliziaLabels[c.praticaEdilizia] ??
                                  c.praticaEdilizia}
                              </Badge>
                            ) : null}
                            {!c.detrazione &&
                            !c.interesseFinanziamento &&
                            (!c.praticaEdilizia ||
                              c.praticaEdilizia === "nessuna") ? (
                              <span className="text-text-3">—</span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums text-text-1">
                          {c.commesseIds?.length ?? 0}
                        </TableCell>
                        <TableCell className="overflow-hidden text-text-2">
                          <span className="block truncate" title={assegnatario}>
                            {assegnatario}
                          </span>
                        </TableCell>
                        <TableCell
                          className="text-right"
                          onClick={e => e.stopPropagation()}
                        >
                          {hasRowActions ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="min-h-11 min-w-11 text-text-3"
                                  aria-label={`Azioni per ${nome}`}
                                  title={`Azioni per ${nome}`}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem
                                  onClick={() =>
                                    setLocation(`/clienti/${c.id}`)
                                  }
                                >
                                  <ArrowRight className="h-4 w-4" /> Apri scheda
                                </DropdownMenuItem>
                                {permissions.canArchiveCustomer ? (
                                  <DropdownMenuItem
                                    onClick={() => archiveCliente.mutate(c.id)}
                                  >
                                    <Archive className="h-4 w-4" /> Archivia
                                  </DropdownMenuItem>
                                ) : null}
                                {permissions.canDeleteCustomer ? (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="text-danger focus:text-danger"
                                      onClick={() =>
                                        setDeleteTarget({
                                          id: c.id,
                                          label: nome,
                                        })
                                      }
                                    >
                                      <Trash2 className="h-4 w-4" /> Elimina
                                    </DropdownMenuItem>
                                  </>
                                ) : null}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <ArrowRight
                              className="ml-auto h-4 w-4 text-text-3"
                              aria-hidden="true"
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Sotto lg: una card per cliente, tutta la riga è il target. */}
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:hidden">
              {clientiFiltrati.map((c: any) => {
                const TipoIcon = tipoIcons[c.tipo] ?? User;
                const nome = personName(c, `Cliente ${c.id}`);
                const assignee =
                  c.assegnatoA != null ? utenteById.get(c.assegnatoA) : null;
                return (
                  <div
                    key={c.id}
                    className="min-w-0 rounded-[var(--radius-panel)] border border-border-soft bg-surface"
                  >
                    <button
                      type="button"
                      className="flex min-h-12 w-full min-w-0 items-start justify-between gap-3 p-3 text-left"
                      onClick={() => setLocation(`/clienti/${c.id}`)}
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <TipoIcon
                            className="h-4 w-4 text-text-3"
                            aria-hidden="true"
                          />
                          <Badge variant="outline" className="text-[10px]">
                            {tipoLabels[c.tipo] ?? c.tipo}
                          </Badge>
                          {c.detrazione ? (
                            <Badge variant="info">Detrazione</Badge>
                          ) : null}
                          {c.interesseFinanziamento ? (
                            <Badge variant="secondary">Finanziamento</Badge>
                          ) : null}
                        </span>
                        <span className="mt-1 block truncate text-[15px] font-semibold text-text-1">
                          {nome}
                        </span>
                      </span>
                      <ArrowRight
                        className="mt-1 h-4 w-4 shrink-0 text-text-3"
                        aria-hidden="true"
                      />
                    </button>
                    <dl className="grid gap-1.5 px-3 pb-3 text-xs text-text-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <dt className="sr-only">Telefono</dt>
                        <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                        <dd className="min-w-0 truncate">
                          {c.telefono || "Telefono non indicato"}
                        </dd>
                      </div>
                      <div className="flex min-w-0 items-center gap-1.5">
                        <dt className="sr-only">Città</dt>
                        <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                        <dd className="min-w-0 truncate">
                          {c.citta || "Città non indicata"}
                        </dd>
                      </div>
                      <div className="flex min-w-0 items-center gap-1.5">
                        <dt className="sr-only">Assegnato a</dt>
                        <UserCircle
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                        <dd className="min-w-0 truncate">
                          {assignee
                            ? personName(assignee, `Utente ${c.assegnatoA}`)
                            : "Non assegnato"}
                        </dd>
                      </div>
                      <div className="flex min-w-0 items-center gap-1.5">
                        <dt className="sr-only">Commesse collegate</dt>
                        <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <dd className="min-w-0 truncate tabular-nums">
                          {c.commesseIds?.length ?? 0} commesse
                        </dd>
                      </div>
                    </dl>
                    {hasRowActions ? (
                      <div className="flex flex-wrap gap-2 border-t border-border-soft px-3 py-2">
                        {permissions.canArchiveCustomer ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="min-h-12"
                            onClick={() => archiveCliente.mutate(c.id)}
                          >
                            <Archive className="h-4 w-4" aria-hidden="true" />
                            Archivia
                          </Button>
                        ) : null}
                        {permissions.canDeleteCustomer ? (
                          <Button
                            type="button"
                            variant="dangerGhost"
                            size="sm"
                            className="min-h-12"
                            onClick={() =>
                              setDeleteTarget({ id: c.id, label: nome })
                            }
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                            Elimina
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </DataSurface>
        </section>
      </div>

      {/* Creazione: montata solo con `cliente.create`, come il router. */}
      {permissions.canCreateCustomer ? (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nuovo cliente</DialogTitle>
              <DialogDescription className="sr-only">
                Inserisci i dati anagrafici e commerciali del nuovo cliente.
              </DialogDescription>
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Cognome *</Label>
                    <Input
                      value={form.cognome}
                      onChange={e =>
                        setForm({ ...form, cognome: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Nome *</Label>
                    <Input
                      value={form.nome}
                      onChange={e => setForm({ ...form, nome: e.target.value })}
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
                    onChange={e =>
                      setForm({ ...form, cognome: e.target.value })
                    }
                  />
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Codice fiscale</Label>
                  <Input
                    value={form.codiceFiscale}
                    onChange={e =>
                      setForm({ ...form, codiceFiscale: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Partita IVA</Label>
                  <Input
                    value={form.partitaIva}
                    onChange={e =>
                      setForm({ ...form, partitaIva: e.target.value })
                    }
                  />
                </div>
              </div>
              {/* Residenza — for fatture / admin */}
              <div className="space-y-3 rounded-[var(--radius-control)] border border-border-soft p-3">
                <div className="eyebrow text-text-3">
                  {form.tipo === "privato"
                    ? "Indirizzo di residenza (fatturazione)"
                    : "Sede legale (fatturazione)"}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Indirizzo</Label>
                    <Input
                      value={form.indirizzo}
                      onChange={e =>
                        setForm({ ...form, indirizzo: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>CAP</Label>
                    <Input
                      value={form.cap}
                      onChange={e => setForm({ ...form, cap: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Città</Label>
                  <Input
                    value={form.citta}
                    onChange={e => setForm({ ...form, citta: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Provincia</Label>
                  <ProvinciaSelect
                    value={form.provincia}
                    onChange={provincia => setForm({ ...form, provincia })}
                  />
                </div>
              </div>
              {/* Lavoro — what commessa uses by default */}
              <div className="space-y-3 rounded-[var(--radius-control)] border border-border-soft p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="eyebrow text-text-3">
                    Indirizzo dove va effettuato il lavoro
                  </div>
                  <label className="flex shrink-0 items-center gap-2 text-xs">
                    <Switch
                      checked={form.lavoroStessoResidenza}
                      onCheckedChange={v =>
                        setForm({ ...form, lavoroStessoResidenza: v })
                      }
                    />
                    <span className="text-text-2">
                      {form.tipo === "privato"
                        ? "Stesso della residenza"
                        : "Stessa della sede legale"}
                    </span>
                  </label>
                </div>
                {!form.lavoroStessoResidenza && (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label>Indirizzo lavoro</Label>
                        <Input
                          value={form.indirizzoLavoro}
                          onChange={e =>
                            setForm({
                              ...form,
                              indirizzoLavoro: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>CAP</Label>
                        <Input
                          value={form.capLavoro}
                          onChange={e =>
                            setForm({ ...form, capLavoro: e.target.value })
                          }
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Città lavoro</Label>
                      <Input
                        value={form.cittaLavoro}
                        onChange={e =>
                          setForm({ ...form, cittaLavoro: e.target.value })
                        }
                      />
                    </div>
                  </>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Telefono</Label>
                  <Input
                    type="tel"
                    value={form.telefono}
                    onChange={e =>
                      setForm({ ...form, telefono: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-3 rounded-[var(--radius-control)] border border-border-soft p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">
                      Detrazione fiscale
                    </div>
                    <div className="text-xs text-text-2">
                      Il cliente vuole usufruirne?
                    </div>
                  </div>
                  <Switch
                    checked={form.detrazione}
                    onCheckedChange={v =>
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
                      <SelectTrigger aria-label="Tipo di detrazione">
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
              <div className="flex items-center justify-between rounded-[var(--radius-control)] border border-border-soft p-3">
                <div>
                  <div className="text-sm font-medium">
                    Interesse finanziamento
                  </div>
                  <div className="text-xs text-text-2">Si / No</div>
                </div>
                <Switch
                  checked={form.interesseFinanziamento}
                  onCheckedChange={v =>
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
                  <SelectTrigger aria-label="Pratica edilizia">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nessuna">
                      Nessuna pratica edilizia
                    </SelectItem>
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
                  onChange={e => setForm({ ...form, note: e.target.value })}
                />
              </div>
              {/* L'assegnatario è selezionabile solo con `cliente.assign`:
                  senza capability il campo non compare e non viene inviato. */}
              {permissions.canAssignCustomer ? (
                <div className="space-y-1.5">
                  <Label>Assegnato a</Label>
                  <SearchSelect
                    options={utenteOptions}
                    value={
                      form.assegnatoA != null ? String(form.assegnatoA) : ""
                    }
                    onChange={v =>
                      setForm({ ...form, assegnatoA: v ? parseInt(v) : null })
                    }
                    placeholder="Seleziona utente (default: me)"
                    searchPlaceholder="Cerca utente..."
                    allowClear
                    clearLabel="— Non assegnato —"
                  />
                </div>
              ) : null}
              {creazioneErrore ? (
                <p
                  role="alert"
                  className="rounded-[var(--radius-control)] border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
                >
                  {creazioneErrore.message}
                </p>
              ) : null}
              {/* Con `commessa.create` il percorso principale crea anche la
                  prima commessa; senza, resta il solo cliente di sempre. */}
              {permissions.canCreateCommessa ? (
                <div className="grid gap-2">
                  <Button
                    type="button"
                    className="min-h-11"
                    onClick={() =>
                      createClienteConCommessa.mutate(payloadCliente())
                    }
                    disabled={formIncompleto || creazioneInCorso}
                  >
                    {createClienteConCommessa.isPending
                      ? "Creazione…"
                      : "Crea cliente e commessa"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11"
                    onClick={() => createCliente.mutate(payloadCliente())}
                    disabled={formIncompleto || creazioneInCorso}
                  >
                    Crea solo il cliente
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  className="min-h-11"
                  onClick={() => createCliente.mutate(payloadCliente())}
                  disabled={formIncompleto || creazioneInCorso}
                >
                  Crea cliente
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={o => !o && setDeleteTarget(null)}
        title="Eliminare il cliente?"
        description={`Stai per eliminare "${deleteTarget?.label ?? ""}". L'operazione è definitiva e non può essere annullata. Le commesse collegate restano, ma perdono il riferimento al cliente.`}
        confirmLabel="Elimina"
        busy={deleteCliente.isPending}
        onConfirm={() => deleteTarget && deleteCliente.mutate(deleteTarget.id)}
      />
    </div>
  );
}
