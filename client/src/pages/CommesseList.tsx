import { useMemo, useState } from "react";
import {
  Archive,
  ArrowRight,
  CalendarClock,
  ClipboardList,
  FilterX,
  MapPin,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  UserCircle,
  UserPlus,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import DeleteCommessaDialog from "@/components/DeleteCommessaDialog";
import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import type { StatePanelProps } from "@/components/patterns/StatePanel";
import SearchSelect from "@/components/SearchSelect";
import StatoChip from "@/components/StatoChip";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { formatEuroSimbolo, parseEuroPositivo } from "@/lib/euro";
import { personName } from "@/lib/name";
import {
  commesseListPermissions,
  customerPermissions,
} from "@/lib/operationalRoutes";
import { TIPOLOGIE_PRODOTTO } from "@/lib/prodotti";
import {
  PRIORITA_LABEL,
  PRIORITA_VARIANT,
  STATI_ORDER,
  statoLabel,
} from "@/lib/stato";
import { trpc } from "@/lib/trpc";

type DeleteTarget = { id: number; codice: string; stato: string } | null;

type RigaProdotto = { nome: string; quantita: string };

const emptyForm = {
  clienteId: "" as string,
  prodotti: [] as RigaProdotto[],
  cliente: "",
  indirizzo: "",
  citta: "",
  telefono: "",
  email: "",
  priorita: "media" as "bassa" | "media" | "alta" | "urgente",
  // Il pattuito è economico: il campo esiste solo con `economia.read` e non
  // entra mai nel payload senza di essa (vedi `canCreateWithAmount`).
  importoTotale: "",
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

/** Data leggibile da una data ISO o da un timestamp, senza inventare valori. */
function dataBreve(iso: string | Date | null | undefined): string | null {
  if (!iso) return null;
  const testo = typeof iso === "string" ? iso : iso.toISOString();
  const quando = new Date(testo.length === 10 ? `${testo}T12:00:00` : testo);
  return Number.isNaN(quando.getTime())
    ? null
    : quando.toLocaleDateString("it-IT");
}

function prodottiLabel(c: any): string {
  const prodotti: any[] = c.prodottiSintesi ?? [];
  if (!prodotti.length) return "Prodotti non indicati";
  return prodotti
    .map((p: any) => `${p.quantita > 1 ? `${p.quantita}x ` : ""}${p.nome}`)
    .join(", ");
}

function consegnaLabel(c: any): string {
  return (
    dataBreve(c.dataConsegnaConfermata) ??
    dataBreve(c.dataConsegnaIndicativa) ??
    (c.consegnaIndicativa ? `~${c.consegnaIndicativa} giorni` : "Da definire")
  );
}

export default function CommesseList() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [filtroStato, setFiltroStato] = useState<string>("tutti");
  const [filtroPriorita, setFiltroPriorita] = useState<string>("tutte");
  const [soloNonAssegnate, setSoloNonAssegnate] = useState(false);
  const [soloConsegneDaDatare, setSoloConsegneDaDatare] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [clienteDialogOpen, setClienteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [form, setForm] = useState(emptyForm);
  const [clienteForm, setClienteForm] = useState(emptyClienteForm);

  // Il provider della slice 01 è l'unico owner di `permessi.mie`: finché il
  // contesto non è `ready` la matrice resta fail-closed e nessuna CTA compare.
  const { capabilities, status: operationalStatus } = useOperationalContext();
  const effettive = operationalStatus === "ready" ? capabilities : null;
  const permissions = commesseListPermissions(effettive);
  const permessiCliente = customerPermissions(effettive);
  // Il registro cifre della lista è quello del router: senza `pagamento.read`
  // `importoTotale` e `importoIncassato` non arrivano nemmeno nel payload.
  const vedeCifre = effettive?.has("pagamento.read") ?? false;

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

  // Conteggi operativi: nessuno di questi legge una cifra economica.
  const insightCounts = useMemo(() => {
    const rows = commesse.data ?? [];
    return {
      totale: rows.length,
      urgenti: rows.filter((c: any) => c.priorita === "urgente").length,
      consegneDaConfermare: rows.filter(
        (c: any) =>
          c.stato === "produzione" && !c.dataConsegnaConfermata && !c.archivedAt
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

  function azzeraFiltri() {
    setSearch("");
    setFiltroStato("tutti");
    setFiltroPriorita("tutte");
    setSoloConsegneDaDatare(false);
    setSoloNonAssegnate(false);
    setOnlyMine(false);
  }

  const utils = trpc.useUtils();
  const createMutation = trpc.commesse.create.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      utils.clienti.invalidate();
      setDialogOpen(false);
      setForm(emptyForm);
    },
    onError: e => toast.error(e.message ?? "Creazione non riuscita"),
  });

  // Creazione cliente inline dalla nuova commessa: capability sua, non della
  // commessa.
  const createClienteMutation = trpc.clienti.create.useMutation({
    onSuccess: cliente => {
      utils.clienti.invalidate();
      setForm(prev => ({
        ...prev,
        clienteId: String(cliente.id),
        cliente: personName(cliente),
        indirizzo: cliente.indirizzo ?? "",
        citta: cliente.citta ?? "",
        telefono: cliente.telefono ?? "",
        email: cliente.email ?? "",
        assegnatoA: cliente.assegnatoA
          ? String(cliente.assegnatoA)
          : prev.assegnatoA,
      }));
      setClienteDialogOpen(false);
      setClienteForm(emptyClienteForm);
    },
    onError: e => toast.error(e.message ?? "Creazione cliente non riuscita"),
  });

  const deleteCommessa = trpc.commesse.delete.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      setDeleteTarget(null);
      toast.success("Commessa eliminata");
    },
    onError: e => toast.error(e.message ?? "Eliminazione non riuscita"),
  });

  // Archivio/ripristino restano il percorso reversibile che il router concede
  // a ogni utente della sede: nessuna capability inventata qui.
  const archiveCommessa = trpc.commesse.archive.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      toast.success("Commessa archiviata");
    },
    onError: e => toast.error(e.message ?? "Archiviazione non riuscita"),
  });

  function handleClienteSelect(clienteIdStr: string) {
    if (!clienteIdStr) {
      setForm({
        ...form,
        clienteId: "",
        cliente: "",
        indirizzo: "",
        citta: "",
        telefono: "",
        email: "",
      });
      return;
    }
    const id = parseInt(clienteIdStr, 10);
    const c = clientiList.data?.find((x: any) => x.id === id);
    if (!c) return;
    setForm({
      ...form,
      clienteId: clienteIdStr,
      cliente: personName(c),
      indirizzo: c.indirizzo ?? "",
      citta: c.citta ?? "",
      telefono: c.telefono ?? "",
      email: c.email ?? "",
      // Il proprietario del cliente resta il default della commessa.
      assegnatoA: c.assegnatoA ? String(c.assegnatoA) : form.assegnatoA,
    });
  }

  // L'importo pattuito è l'unico campo economico del form: senza
  // `economia.read` non esiste, e la chiave non entra nel payload — mai uno 0
  // al suo posto, che il router leggerebbe come importo dichiarato.
  const importoInserito = form.importoTotale.trim();
  const importoValido = importoInserito
    ? parseEuroPositivo(importoInserito)
    : null;
  const importoNonLeggibile =
    permissions.canCreateWithAmount &&
    importoInserito.length > 0 &&
    importoValido == null;

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
        .filter(p => p.nome.trim())
        .map(p => ({
          nome: p.nome.trim(),
          quantita: Math.max(1, parseInt(p.quantita, 10) || 1),
        })),
      ...(permissions.canCreateWithAmount && importoValido != null
        ? { importoTotale: importoValido }
        : {}),
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
      assegnatoA: clienteForm.assegnatoA
        ? parseInt(clienteForm.assegnatoA, 10)
        : undefined,
    });
  }

  const clienteOptions = useMemo(
    () =>
      (clientiList.data ?? []).map((c: any) => ({
        value: String(c.id),
        label: personName(c, "(senza nome)"),
        keywords: [c.email, c.telefono, c.citta].filter(Boolean).join(" "),
        hint: c.citta ?? undefined,
      })),
    [clientiList.data]
  );
  const utenteOptions = useMemo(
    () =>
      (utentiList.data ?? []).map((u: any) => ({
        value: String(u.id),
        label: personName(u, u.email ?? `Utente ${u.id}`),
        keywords: u.email,
        hint: Array.isArray(u.ruoli) ? u.ruoli[0] : undefined,
      })),
    [utentiList.data]
  );

  const nuovaCommessaButton = (
    <Button
      type="button"
      className="min-h-11 w-full sm:w-auto"
      onClick={() => setDialogOpen(true)}
    >
      <Plus className="h-4 w-4" aria-hidden="true" /> Nuova commessa
    </Button>
  );

  // Quattro stati distinti: caricamento, errore con riprova, sede senza
  // commesse e filtro che non lascia passare nulla.
  const statoSuperficie: StatePanelProps | undefined = commesse.isPending
    ? {
        kind: "loading",
        title: "Carico le commesse",
        description: "Recupero i fascicoli della sede attiva.",
        rows: 6,
      }
    : commesse.isError
      ? {
          kind: "error",
          title: "Commesse non caricate",
          description:
            "Non è stato possibile leggere le commesse della sede. Nessun dato è stato modificato.",
          action: (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => commesse.refetch()}
            >
              Riprova
            </Button>
          ),
        }
      : insightCounts.totale === 0
        ? {
            kind: "empty",
            title: hasActiveFilters
              ? "Nessuna commessa corrisponde alla ricerca"
              : "Nessuna commessa in questa sede",
            description: hasActiveFilters
              ? "Cambia ricerca, stato o assegnatario per vedere le altre commesse della sede."
              : permissions.canCreate
                ? "Apri la prima commessa per collegarle prodotti, consegne e interventi."
                : "Quando verrà aperta una commessa la troverai qui.",
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
            ) : permissions.canCreate ? (
              nuovaCommessaButton
            ) : undefined,
          }
        : commesseFiltrate.length === 0
          ? {
              kind: "empty",
              title: "Nessuna commessa corrisponde ai filtri correnti",
              description:
                "I filtri su priorità, consegne o assegnatario nascondono le altre commesse lette dalla sede.",
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

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      <PageHeader
        variant="workbench"
        eyebrow="Operazioni"
        title={
          <span className="inline-flex items-center gap-2">
            <ClipboardList
              className="h-6 w-6 text-primary"
              aria-hidden="true"
            />
            Commesse
          </span>
        }
        description="Stato di avanzamento, priorità e prossime azioni operative della sede attiva."
        busy={commesse.isFetching}
        metadata={
          <>
            {/* Un conteggio che non conosciamo non si mostra come zero. */}
            {commesse.isPending ? (
              <span>Conteggio commesse in caricamento…</span>
            ) : commesse.isError ? (
              <span>Conteggio commesse non disponibile</span>
            ) : (
              <>
                <span>
                  <strong className="tabular-nums text-text-1">
                    {insightCounts.totale}
                  </strong>{" "}
                  {insightCounts.totale === 1
                    ? "commessa visibile"
                    : "commesse visibili"}
                </span>
                <span>
                  <strong className="tabular-nums text-text-1">
                    {insightCounts.urgenti}
                  </strong>{" "}
                  urgenti
                </span>
                <span>
                  <strong className="tabular-nums text-text-1">
                    {insightCounts.consegneDaConfermare}
                  </strong>{" "}
                  con consegna da datare
                </span>
                <span>
                  <strong className="tabular-nums text-text-1">
                    {insightCounts.nonAssegnate}
                  </strong>{" "}
                  senza assegnatario
                </span>
              </>
            )}
            {commesse.isFetching && !commesse.isPending ? (
              <span role="status">Aggiornamento in corso…</span>
            ) : null}
          </>
        }
        primaryAction={permissions.canCreate ? nuovaCommessaButton : undefined}
      />

      <div className="min-w-0 space-y-4">
        <div className="sticky top-0 z-20 border-b border-border-soft bg-surface px-1 py-3">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="relative min-w-0 flex-1 lg:max-w-sm">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
                aria-hidden="true"
              />
              <Input
                aria-label="Cerca commesse"
                placeholder="Cerca per codice, cliente, città…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="min-h-11 pl-9"
              />
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Select value={filtroStato} onValueChange={setFiltroStato}>
                <SelectTrigger
                  aria-label="Filtro stato"
                  className="min-h-11 w-full sm:w-52"
                >
                  <SelectValue placeholder="Stato" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tutti">Tutti gli stati</SelectItem>
                  {STATI_ORDER.map(s => (
                    <SelectItem key={s} value={s}>
                      {statoLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filtroPriorita} onValueChange={setFiltroPriorita}>
                <SelectTrigger
                  aria-label="Filtro priorità"
                  className="min-h-11 w-full sm:w-48"
                >
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

              <Button
                type="button"
                variant={soloConsegneDaDatare ? "default" : "outline"}
                size="sm"
                aria-pressed={soloConsegneDaDatare}
                className="min-h-11"
                onClick={() => setSoloConsegneDaDatare(v => !v)}
              >
                <CalendarClock className="h-4 w-4" aria-hidden="true" />
                Consegne da datare
              </Button>

              <Button
                type="button"
                variant={soloNonAssegnate ? "default" : "outline"}
                size="sm"
                aria-pressed={soloNonAssegnate}
                className="min-h-11"
                onClick={() => {
                  setSoloNonAssegnate(v => !v);
                  setOnlyMine(false);
                }}
              >
                <UserX className="h-4 w-4" aria-hidden="true" />
                Non assegnate
              </Button>

              {currentUser.data ? (
                <Button
                  type="button"
                  variant={onlyMine ? "default" : "outline"}
                  size="sm"
                  aria-pressed={onlyMine}
                  className="min-h-11"
                  onClick={() => {
                    setOnlyMine(v => !v);
                    setSoloNonAssegnate(false);
                  }}
                >
                  <UserCircle className="h-4 w-4" aria-hidden="true" />
                  Solo le mie
                </Button>
              ) : null}

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
                {commesseFiltrate.length} in elenco
              </span>
            </div>
          </div>
        </div>

        <section className="min-w-0" aria-label="Elenco commesse">
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
            {/* Desktop: tabella densa, una riga per commessa. */}
            <div className="hidden min-w-0 lg:block">
              <Table className="table-fixed">
                {/* Le larghezze sommano sempre a 100%: con la colonna
                    economica in meno lo spazio torna a prodotti e date. */}
                <colgroup>
                  <col className={vedeCifre ? "w-[12%]" : "w-[13%]"} />
                  <col className={vedeCifre ? "w-[20%]" : "w-[23%]"} />
                  <col className={vedeCifre ? "w-[12%]" : "w-[13%]"} />
                  <col className={vedeCifre ? "w-[15%]" : "w-[19%]"} />
                  {vedeCifre ? <col className="w-[11%]" /> : null}
                  <col className={vedeCifre ? "w-[13%]" : "w-[15%]"} />
                  <col className="w-[12%]" />
                  <col className="w-[5%]" />
                </colgroup>
                <TableHeader>
                  <TableRow>
                    <TableHead>Commessa</TableHead>
                    <TableHead>Cliente e cantiere</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead>Prodotti</TableHead>
                    {/* La colonna economica esiste solo per chi ha
                        `pagamento.read`: senza, il router non manda la cifra
                        e la lista non la ricostruisce. */}
                    {vedeCifre ? (
                      <TableHead className="text-right">Pattuito</TableHead>
                    ) : null}
                    <TableHead>Date</TableHead>
                    <TableHead>Assegnata a</TableHead>
                    <TableHead>
                      <span className="sr-only">Azioni</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {commesseFiltrate.map((c: any) => {
                    const assignee =
                      c.assegnatoA != null
                        ? utenteById.get(c.assegnatoA)
                        : null;
                    const assegnataA = assignee
                      ? personName(assignee, `Utente ${c.assegnatoA}`)
                      : "Non assegnata";
                    const prodotti = prodottiLabel(c);
                    const aperta =
                      dataBreve(c.dataApertura) ??
                      dataBreve(c.createdAt) ??
                      "—";
                    const consegna = consegnaLabel(c);
                    return (
                      <TableRow
                        key={c.id}
                        className="cursor-pointer"
                        onClick={() => setLocation(`/commesse/${c.id}`)}
                      >
                        <TableCell className="overflow-hidden">
                          {/* Il codice è il target da tastiera della riga:
                              il click sul <tr> resta solo una comodità. */}
                          <button
                            type="button"
                            className="min-w-0 rounded-[var(--radius-control)] text-left"
                            onClick={e => {
                              e.stopPropagation();
                              setLocation(`/commesse/${c.id}`);
                            }}
                          >
                            <span
                              className="block truncate codice-mono text-text-2"
                              title={c.codice}
                            >
                              {c.codice}
                            </span>
                          </button>
                          <Badge
                            variant={
                              PRIORITA_VARIANT[c.priorita] ?? "secondary"
                            }
                            className="mt-1 text-[10px]"
                          >
                            {PRIORITA_LABEL[c.priorita] ?? c.priorita}
                          </Badge>
                        </TableCell>
                        <TableCell className="overflow-hidden text-text-1">
                          <span
                            className="block truncate font-semibold"
                            title={c.cliente || undefined}
                          >
                            {c.cliente || "—"}
                          </span>
                          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs font-normal text-text-2">
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
                        </TableCell>
                        <TableCell className="overflow-hidden">
                          <StatoChip stato={c.stato} />
                        </TableCell>
                        <TableCell className="overflow-hidden text-xs text-text-2">
                          <span className="block truncate" title={prodotti}>
                            {prodotti}
                          </span>
                        </TableCell>
                        {vedeCifre ? (
                          <TableCell className="overflow-hidden text-right tabular-nums text-text-1">
                            {c.importoTotale != null ? (
                              formatEuroSimbolo(c.importoTotale)
                            ) : (
                              <span className="text-text-3">Non pattuito</span>
                            )}
                          </TableCell>
                        ) : null}
                        <TableCell className="overflow-hidden text-[11px] text-text-2">
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-text-3">Aperta</span>
                            <span
                              className="truncate tabular-nums"
                              title={aperta}
                            >
                              {aperta}
                            </span>
                          </span>
                          <span className="mt-1 flex items-center justify-between gap-2">
                            <span className="text-text-3">Consegna</span>
                            <span
                              className="truncate tabular-nums"
                              title={consegna}
                            >
                              {consegna}
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="overflow-hidden text-text-2">
                          <span className="block truncate" title={assegnataA}>
                            {assegnataA}
                          </span>
                        </TableCell>
                        <TableCell
                          className="text-right"
                          onClick={e => e.stopPropagation()}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="min-h-11 min-w-11 text-text-3"
                                aria-label={`Azioni per la commessa ${c.codice}`}
                                title={`Azioni per la commessa ${c.codice}`}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem
                                onClick={() => setLocation(`/commesse/${c.id}`)}
                              >
                                <ArrowRight className="h-4 w-4" /> Apri scheda
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => archiveCommessa.mutate(c.id)}
                              >
                                <Archive className="h-4 w-4" /> Archivia
                              </DropdownMenuItem>
                              {permissions.canDelete ? (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-danger focus:text-danger"
                                    onClick={() =>
                                      setDeleteTarget({
                                        id: c.id,
                                        codice: c.codice,
                                        stato: c.stato,
                                      })
                                    }
                                  >
                                    <Trash2 className="h-4 w-4" /> Elimina
                                  </DropdownMenuItem>
                                </>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Sotto lg: una card per commessa, tutta la riga è il target. */}
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:hidden">
              {commesseFiltrate.map((c: any) => {
                const assignee =
                  c.assegnatoA != null ? utenteById.get(c.assegnatoA) : null;
                const prodotti = prodottiLabel(c);
                const aperta =
                  dataBreve(c.dataApertura) ?? dataBreve(c.createdAt) ?? "—";
                const consegna = consegnaLabel(c);
                return (
                  <div
                    key={c.id}
                    className="min-w-0 rounded-[var(--radius-panel)] border border-border-soft bg-surface"
                  >
                    <button
                      type="button"
                      className="flex min-h-12 w-full min-w-0 items-start justify-between gap-3 p-3 text-left"
                      onClick={() => setLocation(`/commesse/${c.id}`)}
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="codice-mono text-text-3">
                            {c.codice}
                          </span>
                          <Badge
                            variant={
                              PRIORITA_VARIANT[c.priorita] ?? "secondary"
                            }
                          >
                            {PRIORITA_LABEL[c.priorita] ?? c.priorita}
                          </Badge>
                        </span>
                        <span className="mt-1 block truncate text-[15px] font-semibold text-text-1">
                          {c.cliente || "—"}
                        </span>
                      </span>
                      <ArrowRight
                        className="mt-1 h-4 w-4 shrink-0 text-text-3"
                        aria-hidden="true"
                      />
                    </button>
                    <div className="px-3">
                      <StatoChip stato={c.stato} />
                    </div>
                    <dl className="grid gap-1.5 px-3 pb-3 pt-2 text-xs text-text-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <dt className="sr-only">Città</dt>
                        <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                        <dd className="min-w-0 truncate">
                          {c.citta || "Città non indicata"}
                        </dd>
                      </div>
                      <div className="flex min-w-0 items-center gap-1.5">
                        <dt className="sr-only">Prodotti</dt>
                        <ClipboardList
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                        <dd className="min-w-0 truncate" title={prodotti}>
                          {prodotti}
                        </dd>
                      </div>
                      <div className="flex min-w-0 items-center gap-1.5">
                        <dt className="sr-only">Consegna</dt>
                        <CalendarClock
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                        <dd className="min-w-0 truncate tabular-nums">
                          Aperta {aperta} · consegna {consegna}
                        </dd>
                      </div>
                      <div className="flex min-w-0 items-center gap-1.5">
                        <dt className="sr-only">Assegnata a</dt>
                        <UserCircle
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        />
                        <dd className="min-w-0 truncate">
                          {assignee
                            ? personName(assignee, `Utente ${c.assegnatoA}`)
                            : "Non assegnata"}
                        </dd>
                      </div>
                      {/* Nessuna cifra senza `pagamento.read`: il payload non
                          la contiene e la card non la deriva. */}
                      {vedeCifre && c.importoTotale != null ? (
                        <div className="flex min-w-0 items-center justify-between gap-1.5">
                          <dt className="text-text-3">Pattuito</dt>
                          <dd className="tabular-nums font-semibold text-text-1">
                            {formatEuroSimbolo(c.importoTotale)}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                    <div className="flex flex-wrap gap-2 border-t border-border-soft px-3 py-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-12"
                        onClick={() => archiveCommessa.mutate(c.id)}
                      >
                        <Archive className="h-4 w-4" aria-hidden="true" />
                        Archivia
                      </Button>
                      {permissions.canDelete ? (
                        <Button
                          type="button"
                          variant="dangerGhost"
                          size="sm"
                          className="min-h-12"
                          onClick={() =>
                            setDeleteTarget({
                              id: c.id,
                              codice: c.codice,
                              stato: c.stato,
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                          Elimina
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </DataSurface>
        </section>
      </div>

      {/* Creazione: montata solo con `commessa.create`, come il router. */}
      {permissions.canCreate ? (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nuova commessa</DialogTitle>
              <DialogDescription className="sr-only">
                Collega un cliente e inserisci i dati iniziali della nuova
                commessa.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <p className="rounded-[var(--radius-control)] border border-border-soft bg-surface-2 px-3 py-2 text-xs text-text-2">
                Il codice viene generato dal server nel formato COM-ANNO-NUMERO.
              </p>

              <div className="space-y-1.5">
                <Label>Cliente *</Label>
                <div className="flex min-w-0 gap-1.5">
                  <div className="min-w-0 flex-1">
                    <SearchSelect
                      options={clienteOptions}
                      value={form.clienteId}
                      onChange={handleClienteSelect}
                      placeholder="Cerca cliente..."
                      searchPlaceholder="Nome, email, città..."
                      emptyText="Nessun cliente trovato"
                      allowClear
                      clearLabel="Cliente non registrato"
                      onCreate={
                        permessiCliente.canCreateCustomer
                          ? () => {
                              setClienteForm({
                                ...emptyClienteForm,
                                assegnatoA: currentUser.data
                                  ? String(currentUser.data.id)
                                  : "",
                              });
                              setClienteDialogOpen(true);
                            }
                          : undefined
                      }
                      createLabel="+ Crea nuovo cliente"
                    />
                  </div>
                  {/* La creazione cliente ha la sua capability: senza
                      `cliente.create` la scorciatoia non compare. */}
                  {permessiCliente.canCreateCustomer ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="min-h-11 min-w-11"
                      aria-label="Crea nuovo cliente"
                      title="Crea nuovo cliente"
                      onClick={() => {
                        setClienteForm({
                          ...emptyClienteForm,
                          assegnatoA: currentUser.data
                            ? String(currentUser.data.id)
                            : "",
                        });
                        setClienteDialogOpen(true);
                      }}
                    >
                      <UserPlus className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
                {form.clienteId === "" ? (
                  <Input
                    placeholder="Nome cliente non registrato *"
                    value={form.cliente}
                    onChange={e =>
                      setForm({ ...form, cliente: e.target.value })
                    }
                    className="min-h-11"
                  />
                ) : (
                  <p className="text-xs text-text-2">{form.cliente}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Assegnata a</Label>
                <SearchSelect
                  options={utenteOptions}
                  value={form.assegnatoA}
                  onChange={v => setForm({ ...form, assegnatoA: v })}
                  placeholder="Nessuno"
                  searchPlaceholder="Cerca utente..."
                  allowClear
                />
              </div>

              {/* Tipologie e quantità: finiscono in prodotti[] della commessa. */}
              <div className="space-y-2">
                <Label>Prodotti</Label>
                {form.prodotti.length > 0 ? (
                  <div className="space-y-2">
                    {form.prodotti.map((riga, i) => (
                      <div
                        key={i}
                        className="grid min-w-0 grid-cols-[minmax(0,1fr)_72px_44px] items-center gap-2"
                      >
                        <Select
                          value={riga.nome}
                          onValueChange={v =>
                            setForm({
                              ...form,
                              prodotti: form.prodotti.map((r, j) =>
                                j === i ? { ...r, nome: v } : r
                              ),
                            })
                          }
                        >
                          <SelectTrigger
                            className="min-h-11 min-w-0"
                            aria-label={`Tipologia riga ${i + 1}`}
                          >
                            <SelectValue placeholder="Tipologia" />
                          </SelectTrigger>
                          <SelectContent>
                            {TIPOLOGIE_PRODOTTO.map(t => (
                              <SelectItem key={t} value={t}>
                                {t}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          min={1}
                          aria-label={`Quantità riga ${i + 1}`}
                          className="min-h-11 tabular-nums"
                          value={riga.quantita}
                          onChange={e =>
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
                          variant="dangerGhost"
                          size="icon"
                          className="min-h-11 min-w-11 shrink-0"
                          aria-label={`Rimuovi la riga ${i + 1}`}
                          title={`Rimuovi la riga ${i + 1}`}
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
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  onClick={() =>
                    setForm({
                      ...form,
                      prodotti: [...form.prodotti, { nome: "", quantita: "1" }],
                    })
                  }
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Aggiungi prodotto
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Priorità</Label>
                  <Select
                    value={form.priorita}
                    onValueChange={(v: any) =>
                      setForm({ ...form, priorita: v })
                    }
                  >
                    <SelectTrigger aria-label="Priorità" className="min-h-11">
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
                    value={form.consegnaIndicativa}
                    onValueChange={(v: any) =>
                      setForm({ ...form, consegnaIndicativa: v })
                    }
                  >
                    <SelectTrigger
                      aria-label="Consegna indicativa"
                      className="min-h-11"
                    >
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

              {/* Il pattuito è un dato economico: il campo esiste solo con
                  `economia.read`, esattamente come il gate del router su
                  `commesse.create.economia`. */}
              {permissions.canCreateWithAmount ? (
                <div className="space-y-1.5">
                  <Label htmlFor="commessa-importo">Importo pattuito</Label>
                  <Input
                    id="commessa-importo"
                    inputMode="decimal"
                    placeholder="Es. 12.500,00"
                    value={form.importoTotale}
                    onChange={e =>
                      setForm({ ...form, importoTotale: e.target.value })
                    }
                    className="min-h-11 tabular-nums"
                    aria-invalid={importoNonLeggibile || undefined}
                  />
                  <p className="text-xs text-text-2">
                    Facoltativo: lasciandolo vuoto la commessa nasce senza
                    pattuito e l'importo si registra dalla scheda.
                  </p>
                  {importoNonLeggibile ? (
                    <p role="alert" className="text-xs text-danger">
                      Importo non leggibile: usa cifre come 12.500,00.
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Indirizzo</Label>
                  <Input
                    value={form.indirizzo}
                    onChange={e =>
                      setForm({ ...form, indirizzo: e.target.value })
                    }
                    className="min-h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Città</Label>
                  <Input
                    value={form.citta}
                    onChange={e => setForm({ ...form, citta: e.target.value })}
                    className="min-h-11"
                  />
                </div>
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
                    className="min-h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    className="min-h-11"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Note</Label>
                <Textarea
                  value={form.note}
                  onChange={e => setForm({ ...form, note: e.target.value })}
                  rows={2}
                />
              </div>

              {createMutation.error ? (
                <p
                  role="alert"
                  className="rounded-[var(--radius-control)] border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
                >
                  {createMutation.error.message}
                </p>
              ) : null}

              <Button
                type="button"
                className="min-h-11"
                onClick={handleCreate}
                disabled={
                  !form.cliente ||
                  importoNonLeggibile ||
                  createMutation.isPending
                }
              >
                {createMutation.isPending ? "Creazione…" : "Crea commessa"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      <DeleteCommessaDialog
        open={!!deleteTarget}
        onOpenChange={o => !o && setDeleteTarget(null)}
        codice={deleteTarget?.codice ?? null}
        stato={deleteTarget?.stato ?? null}
        onConfirm={() => deleteTarget && deleteCommessa.mutate(deleteTarget.id)}
      />

      {/* "Nuovo cliente" inline: capability cliente, non commessa. */}
      {permessiCliente.canCreateCustomer ? (
        <Dialog open={clienteDialogOpen} onOpenChange={setClienteDialogOpen}>
          <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Nuovo cliente</DialogTitle>
              <DialogDescription className="sr-only">
                Crea un cliente senza uscire dalla nuova commessa.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Cognome *</Label>
                  <Input
                    value={clienteForm.cognome}
                    onChange={e =>
                      setClienteForm({
                        ...clienteForm,
                        cognome: e.target.value,
                      })
                    }
                    className="min-h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Nome *</Label>
                  <Input
                    value={clienteForm.nome}
                    onChange={e =>
                      setClienteForm({ ...clienteForm, nome: e.target.value })
                    }
                    className="min-h-11"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select
                  value={clienteForm.tipo}
                  onValueChange={(v: any) =>
                    setClienteForm({ ...clienteForm, tipo: v })
                  }
                >
                  <SelectTrigger
                    aria-label="Tipo di cliente"
                    className="min-h-11"
                  >
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Telefono</Label>
                  <Input
                    type="tel"
                    value={clienteForm.telefono}
                    onChange={e =>
                      setClienteForm({
                        ...clienteForm,
                        telefono: e.target.value,
                      })
                    }
                    className="min-h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={clienteForm.email}
                    onChange={e =>
                      setClienteForm({ ...clienteForm, email: e.target.value })
                    }
                    className="min-h-11"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Indirizzo</Label>
                  <Input
                    value={clienteForm.indirizzo}
                    onChange={e =>
                      setClienteForm({
                        ...clienteForm,
                        indirizzo: e.target.value,
                      })
                    }
                    className="min-h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Città</Label>
                  <Input
                    value={clienteForm.citta}
                    onChange={e =>
                      setClienteForm({ ...clienteForm, citta: e.target.value })
                    }
                    className="min-h-11"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Assegnato a</Label>
                <SearchSelect
                  options={utenteOptions}
                  value={clienteForm.assegnatoA}
                  onChange={v =>
                    setClienteForm({ ...clienteForm, assegnatoA: v })
                  }
                  placeholder="Nessuno"
                  searchPlaceholder="Cerca utente..."
                  allowClear
                />
              </div>
              {createClienteMutation.error ? (
                <p
                  role="alert"
                  className="rounded-[var(--radius-control)] border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
                >
                  {createClienteMutation.error.message}
                </p>
              ) : null}
              <Button
                type="button"
                className="min-h-11"
                onClick={handleCreateCliente}
                disabled={
                  !clienteForm.nome ||
                  !clienteForm.cognome ||
                  createClienteMutation.isPending
                }
              >
                {createClienteMutation.isPending
                  ? "Creazione…"
                  : "Crea e seleziona"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
