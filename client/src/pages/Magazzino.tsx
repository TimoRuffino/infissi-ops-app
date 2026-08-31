import { useMemo, useState } from "react";
import {
  ExternalLink,
  MapPin,
  Package,
  Plus,
  Search,
  StickyNote,
  Timer,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";

import ConfirmDialog from "@/components/ConfirmDialog";
import ConsegneAgenda, {
  ConsegnaStatoChip,
  etichettaCommessa,
  etichettaConsegna,
  type ConsegnaItem,
} from "@/components/magazzino/ConsegneAgenda";
import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import type { StatePanelProps } from "@/components/patterns/StatePanel";
import SearchSelect from "@/components/SearchSelect";
import StatoChip from "@/components/StatoChip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { toDateStr } from "@/lib/calendario";
import {
  deliveryState,
  deliveryStateCopy,
  type DeliveryState,
} from "@/lib/operationalRoutes";
import { STATI_ORDER } from "@/lib/stato";
import { trpc } from "@/lib/trpc";

// Le commesse compaiono a magazzino dallo stato "produzione" in poi. Questo
// filtro decide solo COSA OFFRIRE come destinazione di un nuovo prodotto: non
// è una regola autorevole. L'eleggibilità reale resta di `magazzino.create`,
// che risponde PRECONDITION_FAILED e il cui messaggio mostriamo com'è.
const PRODUZIONE_IDX = STATI_ORDER.indexOf("produzione");
function isEligible(c: any): boolean {
  const idx = STATI_ORDER.indexOf(c.stato);
  return idx >= PRODUZIONE_IDX && c.stato !== "archiviata" && !c.archivedAt;
}

// Company supplier list — fixed dropdown so names stay consistent (and the
// per-supplier lead-time stats mean something).
const FORNITORI = [
  "Wnd",
  "Oknoplast",
  "Alias",
  "Pail",
  "Primed",
  "HenryGlass",
  "Palmieri",
  "Errecci",
  "Fivizzanese",
  "Oskura",
  "Korus",
  "Punto del Serramento",
  "Kopern",
  "Citea",
  "Cerrato",
  "Brianzatende",
  "Seraplastic",
  "St Scale",
  "Sharknet",
];

// `short` evita che quattro etichette lunghe sfondino la riga a 390 px.
const FILTRI = [
  { id: "tutte", label: "Tutte", short: "Tutte" },
  { id: "arrivo", label: "In arrivo", short: "Arrivo" },
  { id: "ritardo", label: "In ritardo", short: "Ritardo" },
  { id: "arrivati", label: "Arrivati", short: "Arrivati" },
] as const;

type FiltroConsegna = (typeof FILTRI)[number]["id"];

// Ordinamento visuale: usa solo stato e date già ricevuti dal server, mai un
// criterio nuovo. L'ordinamento del router (`dataConsegna`, poi id) resta.
const ORDINE_STATO: Record<DeliveryState, number> = {
  late: 0,
  due: 1,
  pending: 2,
  unscheduled: 3,
  received: 4,
};

const emptyForm = {
  nome: "",
  quantita: "1",
  fornitore: "",
  numeroOrdine: "",
  dataOrdine: toDateStr(new Date()),
  dataConsegna: "",
  note: "",
};

// Days between order and delivery date (lead time).
function leadDays(p: any): number | null {
  if (!p.dataOrdine || !p.dataConsegna) return null;
  const ms =
    new Date(p.dataConsegna + "T12:00:00").getTime() -
    new Date(p.dataOrdine + "T12:00:00").getTime();
  const d = Math.round(ms / 86400000);
  return d >= 0 ? d : null;
}

type RigaConsegna = {
  prodotto: any;
  commessa: any | null;
  stato: DeliveryState;
};

export default function Magazzino() {
  const [, setLocation] = useLocation();
  const commesse = trpc.commesse.list.useQuery({});
  const prodotti = trpc.magazzino.list.useQuery({});
  const utils = trpc.useUtils();

  const [search, setSearch] = useState("");
  // Riga cliccata → dialog di dettaglio della sua commessa.
  const [detailFor, setDetailFor] = useState<number | null>(null);
  // Scelta della commessa a cui aggiungere una consegna.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filtro, setFiltro] = useState<FiltroConsegna>("tutte");
  // Filtro fornitore: mostra le consegne di quel fornitore.
  const [fornFiltro, setFornFiltro] = useState<string>("tutti");
  // Form di inserimento per commessa (uno alla volta mantiene lo stato semplice).
  const [formFor, setFormFor] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: number;
    nome: string;
  } | null>(null);

  const create = trpc.magazzino.create.useMutation({
    onSuccess: () => {
      utils.magazzino.invalidate();
      setForm(emptyForm);
      toast.success("Prodotto aggiunto al magazzino");
    },
    // Il messaggio del server è l'unica verità sull'eleggibilità: niente
    // regola client mascherata da certezza, e il form resta aperto.
    onError: e => toast.error(e.message ?? "Aggiunta non riuscita"),
  });
  const update = trpc.magazzino.update.useMutation({
    onSuccess: () => utils.magazzino.invalidate(),
    onError: e => {
      toast.error(e.message ?? "Salvataggio non riuscito");
      // Refetch discreto: la riga non deve restare sullo stato tentato.
      utils.magazzino.invalidate();
    },
  });
  const remove = trpc.magazzino.remove.useMutation({
    onSuccess: () => {
      utils.magazzino.invalidate();
      setDeleteTarget(null);
    },
    onError: e => toast.error(e.message ?? "Rimozione non riuscita"),
  });

  const commessaById = useMemo(() => {
    const m = new Map<number, any>();
    for (const c of commesse.data ?? []) m.set(c.id, c);
    return m;
  }, [commesse.data]);

  const byCommessa = useMemo(() => {
    const map = new Map<number, any[]>();
    for (const p of prodotti.data ?? []) {
      if (!map.has(p.commessaId)) map.set(p.commessaId, []);
      map.get(p.commessaId)!.push(p);
    }
    return map;
  }, [prodotti.data]);

  const today = toDateStr(new Date());

  // La coda: una riga per consegna, filtrata e ordinata solo con dati già letti.
  const righe = useMemo<RigaConsegna[]>(() => {
    const q = search.trim().toLowerCase();
    return (prodotti.data ?? [])
      .map((p: any) => ({
        prodotto: p,
        commessa: commessaById.get(p.commessaId) ?? null,
        stato: deliveryState({
          arrivato: p.arrivato,
          dataConsegna: p.dataConsegna,
          today,
        }),
      }))
      .filter(r => {
        if (fornFiltro !== "tutti" && r.prodotto.fornitore !== fornFiltro) {
          return false;
        }
        if (filtro === "ritardo" && r.stato !== "late") return false;
        if (filtro === "arrivo" && r.prodotto.arrivato) return false;
        if (filtro === "arrivati" && !r.prodotto.arrivato) return false;
        if (q) {
          const hay = [
            r.prodotto.nome,
            r.prodotto.fornitore,
            r.prodotto.numeroOrdine,
            r.commessa?.codice,
            r.commessa?.cliente,
            r.commessa?.citta,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (ORDINE_STATO[a.stato] !== ORDINE_STATO[b.stato]) {
          return ORDINE_STATO[a.stato] - ORDINE_STATO[b.stato];
        }
        const da = a.prodotto.dataConsegna ?? "9999-12-31";
        const db = b.prodotto.dataConsegna ?? "9999-12-31";
        if (da !== db) return String(da).localeCompare(String(db));
        return a.prodotto.id - b.prodotto.id;
      });
  }, [prodotti.data, commessaById, search, filtro, fornFiltro, today]);

  const agendaItems = useMemo<ConsegnaItem[]>(
    () =>
      righe.map(r => ({
        id: r.prodotto.id,
        nome: r.prodotto.nome,
        quantita: r.prodotto.quantita,
        fornitore: r.prodotto.fornitore,
        dataConsegna: r.prodotto.dataConsegna,
        arrivato: r.prodotto.arrivato,
        commessa: r.commessa
          ? {
              id: r.commessa.id,
              codice: r.commessa.codice,
              cliente: r.commessa.cliente,
            }
          : null,
      })),
    [righe]
  );

  // Commesse che possiamo proporre come destinazione: offerta, non permesso.
  const eligibili = useMemo(
    () =>
      (commesse.data ?? [])
        .filter(isEligible)
        .sort((a: any, b: any) =>
          String(a.codice ?? "").localeCompare(String(b.codice ?? ""))
        ),
    [commesse.data]
  );

  const totProdotti = prodotti.data?.length ?? 0;
  const totArrivati = (prodotti.data ?? []).filter((p: any) => p.arrivato)
    .length;
  const inArrivo = totProdotti - totArrivati;
  const inRitardo = (prodotti.data ?? []).filter(
    (p: any) =>
      deliveryState({
        arrivato: p.arrivato,
        dataConsegna: p.dataConsegna,
        today,
      }) === "late"
  ).length;
  // Average lead time over arrived products that carry both dates.
  const leadMedio = useMemo(() => {
    const days = (prodotti.data ?? [])
      .filter((p: any) => p.arrivato)
      .map(leadDays)
      .filter((d: number | null): d is number => d != null);
    if (days.length === 0) return null;
    return Math.round(
      days.reduce((s: number, d: number) => s + d, 0) / days.length
    );
  }, [prodotti.data]);

  // Una sola mutation in volo per volta: l'id evita di bloccare tutte le righe.
  const consegnaInCorso =
    update.isPending && update.variables
      ? ((update.variables as { id: number }).id ?? null)
      : null;

  function segnaArrivato(id: number, arrivato: boolean) {
    update.mutate(
      { id, arrivato },
      {
        // Il successo si annuncia solo quando il server ha risposto.
        onSuccess: () =>
          toast.success(
            arrivato ? "Consegna segnata come ricevuta." : "Consegna riaperta."
          ),
      }
    );
  }

  function apriDettaglio(commessaId: number) {
    setDetailFor(commessaId);
    setFormFor(null);
    setForm(emptyForm);
    create.reset();
  }

  function chiudiDettaglio() {
    setDetailFor(null);
    setFormFor(null);
    setForm(emptyForm);
    create.reset();
  }

  function submitForm(commessaId: number) {
    if (!form.nome.trim()) return;
    create.mutate({
      commessaId,
      nome: form.nome.trim(),
      quantita: Math.max(1, parseInt(form.quantita) || 1),
      fornitore: form.fornitore || undefined,
      numeroOrdine: form.numeroOrdine.trim() || undefined,
      dataOrdine: form.dataOrdine || undefined,
      dataConsegna: form.dataConsegna || undefined,
      note: form.note.trim() || undefined,
    });
  }

  const filtriAttivi =
    search.trim() !== "" || filtro !== "tutte" || fornFiltro !== "tutti";

  // Quattro stati distinti: caricamento, errore con retry, sede senza prodotti
  // e coda filtrata vuota. Una coda vuota non è mai "tutto a posto".
  const statoSuperficie: StatePanelProps | undefined = prodotti.isPending
    ? {
        kind: "loading",
        title: "Carico le consegne",
        description: "Recupero i prodotti a magazzino della sede.",
        rows: 4,
      }
    : prodotti.isError
      ? {
          kind: "error",
          title: "Consegne non caricate",
          description:
            "Non è stato possibile leggere i prodotti a magazzino. Nessun dato è stato modificato.",
          action: (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => prodotti.refetch()}
            >
              Riprova
            </Button>
          ),
        }
      : totProdotti === 0
        ? {
            kind: "empty",
            title: "Nessun prodotto a magazzino in questa sede",
            description:
              "I prodotti si aggiungono a una commessa dallo stato Produzione in poi.",
            action:
              eligibili.length > 0 ? (
                <Button
                  type="button"
                  className="min-h-11"
                  onClick={() => setPickerOpen(true)}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" /> Aggiungi
                  consegna
                </Button>
              ) : undefined,
          }
        : righe.length === 0
          ? {
              kind: "empty",
              title: "Nessuna consegna corrisponde ai filtri correnti",
              description:
                "Cambia ricerca, fornitore o stato per vedere le altre consegne della sede.",
              action: filtriAttivi ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => {
                    setSearch("");
                    setFiltro("tutte");
                    setFornFiltro("tutti");
                  }}
                >
                  Azzera i filtri
                </Button>
              ) : undefined,
            }
          : undefined;

  const commessaDettaglio =
    detailFor != null ? (commessaById.get(detailFor) ?? null) : null;
  const righeDettaglio =
    detailFor != null ? (byCommessa.get(detailFor) ?? []) : [];

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
      <PageHeader
        variant="workbench"
        eyebrow="Operatività"
        title={
          <span className="inline-flex items-center gap-2">
            <Package className="h-6 w-6 text-primary" aria-hidden="true" />
            Magazzino
          </span>
        }
        description="Coda delle consegne per commessa, dallo stato Produzione in poi. Ogni riga dice quando arriva e cosa manca."
        busy={prodotti.isFetching}
        metadata={
          <>
            {/* Un conteggio che non conosciamo non si mostra come zero. */}
            {prodotti.isPending ? (
              <span>Conteggio consegne in caricamento…</span>
            ) : prodotti.isError ? (
              <span>Conteggio consegne non disponibile</span>
            ) : (
              <>
                <span>
                  <strong className="tabular-nums text-text-1">
                    {totProdotti}
                  </strong>{" "}
                  consegne registrate
                </span>
                <span>
                  <strong className="tabular-nums text-text-1">
                    {inArrivo}
                  </strong>{" "}
                  ancora da ricevere
                </span>
                <span>
                  <strong className="tabular-nums text-text-1">
                    {inRitardo}
                  </strong>{" "}
                  in ritardo
                </span>
                {leadMedio != null ? (
                  <span>
                    Lead time medio{" "}
                    <strong className="tabular-nums text-text-1">
                      {leadMedio} gg
                    </strong>
                  </span>
                ) : null}
              </>
            )}
            {prodotti.isFetching && !prodotti.isPending ? (
              <span role="status">Aggiornamento in corso…</span>
            ) : null}
          </>
        }
        primaryAction={
          <Button
            type="button"
            className="min-h-11"
            onClick={() => setPickerOpen(true)}
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Aggiungi consegna
          </Button>
        }
      />

      <div className="min-w-0 space-y-4">
        <div className="sticky top-0 z-20 border-b border-border-soft bg-surface/95 px-1 py-3 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
          <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1 lg:max-w-sm">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
                aria-hidden="true"
              />
              <Input
                aria-label="Cerca consegne"
                placeholder="Cerca prodotto, codice, cliente, città…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="min-h-11 pl-9"
              />
            </div>

            <Select value={fornFiltro} onValueChange={setFornFiltro}>
              <SelectTrigger
                aria-label="Filtro fornitore"
                className="min-h-11 w-full lg:w-52"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tutti">Tutti i fornitori</SelectItem>
                {FORNITORI.map(f => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div
              role="group"
              aria-label="Stato consegna"
              className="flex min-w-0 items-center gap-1 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-1"
            >
              {FILTRI.map(f => {
                const attivo = filtro === f.id;
                return (
                  <Button
                    key={f.id}
                    type="button"
                    variant={attivo ? "default" : "ghost"}
                    size="sm"
                    aria-pressed={attivo}
                    aria-label={f.label}
                    className="min-h-11 min-w-0 flex-1 px-2 sm:px-2.5 lg:flex-none"
                    onClick={() => setFiltro(f.id)}
                  >
                    <span className="hidden sm:inline">{f.label}</span>
                    <span className="sm:hidden">{f.short}</span>
                  </Button>
                );
              })}
            </div>
          </div>
        </div>

        <section className="min-w-0" aria-label="Coda consegne">
          <DataSurface
            density="compact"
            tone="sunken"
            state={statoSuperficie}
            toolbar={
              commesse.isError ? (
                <p
                  role="status"
                  className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-2"
                >
                  Commesse non caricate: codice e cliente delle consegne non
                  sono mostrati.
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11"
                    onClick={() => commesse.refetch()}
                  >
                    Riprova
                  </Button>
                </p>
              ) : null
            }
          >
            {/* Desktop: tabella densa. La riga apre il dettaglio commessa. */}
            <div className="hidden min-w-0 lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Consegna</TableHead>
                    <TableHead className="text-right">Q.tà</TableHead>
                    <TableHead>Fornitore</TableHead>
                    <TableHead>Commessa</TableHead>
                    <TableHead>Consegna prevista</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead>
                      <span className="sr-only">Azioni</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {righe.map(r => (
                    <TableRow key={r.prodotto.id}>
                      <TableCell className="max-w-[20rem] whitespace-normal">
                        <span className="block font-medium text-text-1">
                          {r.prodotto.nome}
                        </span>
                        {r.prodotto.numeroOrdine ? (
                          <span className="codice-mono block text-xs text-text-3">
                            Ordine {r.prodotto.numeroOrdine}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.prodotto.quantita}
                      </TableCell>
                      <TableCell className="text-text-2">
                        {r.prodotto.fornitore || "—"}
                      </TableCell>
                      <TableCell className="max-w-[16rem]">
                        {r.commessa ? (
                          <>
                            <Button
                              type="button"
                              variant="link"
                              className="h-auto min-h-11 max-w-full justify-start px-0"
                              onClick={() => apriDettaglio(r.commessa.id)}
                            >
                              <span className="min-w-0 truncate">
                                {etichettaCommessa(r.commessa)}
                              </span>
                            </Button>
                            {r.commessa.codice ? (
                              <span className="codice-mono block text-xs text-text-3">
                                {r.commessa.codice}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-text-3">
                            {etichettaCommessa(null)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums text-text-2">
                        {r.prodotto.dataConsegna
                          ? etichettaConsegna(r.prodotto.dataConsegna)
                          : deliveryStateCopy("unscheduled")}
                      </TableCell>
                      <TableCell>
                        <ConsegnaStatoChip stato={r.stato} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-h-11"
                          disabled={consegnaInCorso === r.prodotto.id}
                          onClick={() =>
                            segnaArrivato(r.prodotto.id, !r.prodotto.arrivato)
                          }
                        >
                          {r.prodotto.arrivato
                            ? "Riapri consegna"
                            : "Segna ricevuto"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Sotto lg: agenda, una consegna per card. */}
            <div className="lg:hidden">
              <ConsegneAgenda
                items={agendaItems}
                today={today}
                pendingId={consegnaInCorso}
                onOpenCommessa={apriDettaglio}
                onToggleArrivato={segnaArrivato}
              />
            </div>
          </DataSurface>
        </section>
      </div>

      {/* Scelta commessa per una nuova consegna: offerta, non permesso. */}
      <Dialog
        open={pickerOpen}
        onOpenChange={open => {
          setPickerOpen(open);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Aggiungi consegna</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-text-2">
              Scegli la commessa a cui aggiungere il prodotto. Restano
              disponibili le commesse dallo stato Produzione in poi.
            </p>
            {commesse.isPending ? (
              <p className="text-sm text-text-3">Carico le commesse…</p>
            ) : commesse.isError ? (
              <p role="alert" className="text-sm text-danger">
                Commesse non caricate. Riprova dalla coda consegne.
              </p>
            ) : eligibili.length === 0 ? (
              <p className="text-sm text-text-3">
                Nessuna commessa dallo stato Produzione in poi.
              </p>
            ) : (
              <SearchSelect
                options={eligibili.map((c: any) => ({
                  value: String(c.id),
                  label: `${c.codice ?? `#${c.id}`} — ${c.cliente ?? ""}`.trim(),
                  keywords: [c.codice, c.cliente, c.citta]
                    .filter(Boolean)
                    .join(" "),
                }))}
                value={null}
                onChange={value => {
                  const id = parseInt(value);
                  if (!id) return;
                  setPickerOpen(false);
                  apriDettaglio(id);
                  setFormFor(id);
                }}
                placeholder="Seleziona commessa…"
                searchPlaceholder="Cerca codice o cliente…"
                className="min-h-11"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Dettaglio commessa: modifica solo attraverso `magazzino.update`. */}
      <Dialog
        open={detailFor != null}
        onOpenChange={open => {
          if (!open) chiudiDettaglio();
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2.5 pr-6">
              {commessaDettaglio ? (
                <>
                  <span className="codice-mono text-[11px] text-text-3">
                    {commessaDettaglio.codice}
                  </span>
                  <span className="text-base font-bold">
                    {commessaDettaglio.cliente}
                  </span>
                  <StatoChip stato={commessaDettaglio.stato} />
                  {commessaDettaglio.citta ? (
                    <span className="inline-flex items-center gap-0.5 text-xs font-normal text-text-3">
                      <MapPin className="h-3 w-3" aria-hidden="true" />
                      {commessaDettaglio.citta}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-base font-bold">Consegne commessa</span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {commessaDettaglio ? (
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                onClick={() =>
                  setLocation(`/commesse/${commessaDettaglio.id}`)
                }
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                Apri commessa
              </Button>
            ) : (
              <p className="text-sm text-text-3">
                Dati della commessa non disponibili: le consegne restano
                modificabili.
              </p>
            )}

            {righeDettaglio.length > 0 ? (
              <div className="space-y-2">
                {righeDettaglio.map((p: any) => (
                  <ProdottoRow
                    key={p.id}
                    p={p}
                    today={today}
                    onUpdate={patch => update.mutate({ id: p.id, ...patch })}
                    onDelete={() =>
                      setDeleteTarget({ id: p.id, nome: p.nome })
                    }
                    pending={consegnaInCorso === p.id}
                  />
                ))}
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-text-3">
                Nessun prodotto a magazzino per questa commessa.
              </p>
            )}

            {create.error ? (
              <p
                role="alert"
                className="rounded-[var(--radius-control)] border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
              >
                {create.error.message}
              </p>
            ) : null}

            {commessaDettaglio && !isEligible(commessaDettaglio) ? (
              <p className="text-sm text-text-3">
                I prodotti a magazzino si aggiungono solo dallo stato Produzione
                in poi.
              </p>
            ) : detailFor != null && formFor === detailFor ? (
              <div className="space-y-3 rounded-[var(--radius-panel)] border border-border-soft bg-surface-2 p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[180px] flex-[2] space-y-1">
                    <Label className="text-xs" htmlFor="consegna-nome">
                      Prodotto *
                    </Label>
                    <Input
                      id="consegna-nome"
                      autoFocus
                      placeholder="Es. Finestra PVC 120×140"
                      value={form.nome}
                      onChange={e => setForm({ ...form, nome: e.target.value })}
                      className="min-h-11"
                    />
                  </div>
                  <div className="w-24 space-y-1">
                    <Label className="text-xs" htmlFor="consegna-quantita">
                      Q.tà
                    </Label>
                    <Input
                      id="consegna-quantita"
                      type="number"
                      min={1}
                      value={form.quantita}
                      onChange={e =>
                        setForm({ ...form, quantita: e.target.value })
                      }
                      className="min-h-11"
                    />
                  </div>
                  <div className="w-44 space-y-1">
                    <Label className="text-xs">Fornitore</Label>
                    <Select
                      value={form.fornitore}
                      onValueChange={v => setForm({ ...form, fornitore: v })}
                    >
                      <SelectTrigger
                        aria-label="Fornitore"
                        className="min-h-11"
                      >
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {FORNITORI.map(f => (
                          <SelectItem key={f} value={f}>
                            {f}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-32 space-y-1">
                    <Label className="text-xs" htmlFor="consegna-ordine">
                      N° ordine
                    </Label>
                    <Input
                      id="consegna-ordine"
                      placeholder="Es. 0045"
                      value={form.numeroOrdine}
                      onChange={e =>
                        setForm({ ...form, numeroOrdine: e.target.value })
                      }
                      className="min-h-11 font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs" htmlFor="consegna-data-ordine">
                      Ordinato il
                    </Label>
                    <Input
                      id="consegna-data-ordine"
                      type="date"
                      value={form.dataOrdine}
                      onChange={e =>
                        setForm({ ...form, dataOrdine: e.target.value })
                      }
                      className="min-h-11"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs" htmlFor="consegna-data-prevista">
                      Consegna prevista
                    </Label>
                    <Input
                      id="consegna-data-prevista"
                      type="date"
                      value={form.dataConsegna}
                      onChange={e =>
                        setForm({ ...form, dataConsegna: e.target.value })
                      }
                      className="min-h-11"
                    />
                  </div>
                  <div className="min-w-[160px] flex-1 space-y-1">
                    <Label className="text-xs" htmlFor="consegna-note">
                      Note
                    </Label>
                    <Input
                      id="consegna-note"
                      value={form.note}
                      onChange={e => setForm({ ...form, note: e.target.value })}
                      className="min-h-11"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      className="min-h-11"
                      onClick={() => submitForm(detailFor)}
                      disabled={!form.nome.trim() || create.isPending}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      Aggiungi
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-11"
                      onClick={() => {
                        setFormFor(null);
                        setForm(emptyForm);
                        create.reset();
                      }}
                    >
                      Annulla
                    </Button>
                  </div>
                </div>
              </div>
            ) : detailFor != null ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => {
                  setFormFor(detailFor);
                  setForm(emptyForm);
                  create.reset();
                }}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Aggiungi prodotto
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o: boolean) => !o && setDeleteTarget(null)}
        title="Elimina prodotto"
        description={`Rimuovere "${deleteTarget?.nome}" dal magazzino della commessa?`}
        confirmLabel="Rimuovi prodotto"
        busy={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
      />
    </div>
  );
}

// ── Product row ──────────────────────────────────────────────────────────────
// Riga del dettaglio commessa: campi etichettati, tutti modificabili inline
// attraverso `magazzino.update`. Nessun'altra mutation è coinvolta.
function ProdottoRow({
  p,
  today,
  onUpdate,
  onDelete,
  pending,
}: {
  p: any;
  today: string;
  onUpdate: (patch: any) => void;
  onDelete: () => void;
  pending: boolean;
}) {
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [qtaDraft, setQtaDraft] = useState<string | null>(null);
  const [ordineDraft, setOrdineDraft] = useState<string | null>(null);

  const stato = deliveryState({
    arrivato: p.arrivato,
    dataConsegna: p.dataConsegna,
    today,
  });
  const lead = leadDays(p);

  const field = (label: string, node: React.ReactNode, cls = "") => (
    <div className={`space-y-0.5 ${cls}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-3">
        {label}
      </p>
      {node}
    </div>
  );

  return (
    <div className="min-w-0 space-y-2.5 rounded-[var(--radius-panel)] border border-border-soft bg-surface p-3">
      <div className="flex min-w-0 flex-wrap items-start gap-4">
        <div className="min-w-[160px] flex-1">
          <p className="text-sm font-semibold leading-tight text-text-1">
            {p.nome}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <ConsegnaStatoChip stato={stato} />
            {lead != null && (
              <span
                className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-text-2"
                title="Giorni dall'ordine alla consegna"
              >
                <Timer className="h-3 w-3" aria-hidden="true" />
                {lead} gg
              </span>
            )}
          </div>
        </div>

        {field(
          "Q.tà",
          <Input
            aria-label="Quantità"
            inputMode="numeric"
            value={qtaDraft ?? String(p.quantita)}
            onChange={e => setQtaDraft(e.target.value)}
            onBlur={() => {
              if (qtaDraft == null) return;
              const n = parseInt(qtaDraft);
              if (!isNaN(n) && n >= 1 && n !== p.quantita)
                onUpdate({ quantita: n });
              setQtaDraft(null);
            }}
            className="h-9 w-16 text-center tabular-nums"
          />
        )}

        {field(
          "Fornitore",
          <Select
            value={p.fornitore ?? ""}
            onValueChange={v => onUpdate({ fornitore: v || null })}
          >
            <SelectTrigger aria-label="Fornitore" className="h-9 w-40">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {/* keep legacy free-text values selectable */}
              {p.fornitore && !FORNITORI.includes(p.fornitore) && (
                <SelectItem value={p.fornitore}>{p.fornitore}</SelectItem>
              )}
              {FORNITORI.map(f => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {field(
          "N° ordine",
          <Input
            aria-label="Numero ordine"
            placeholder="—"
            value={ordineDraft ?? (p.numeroOrdine ?? "")}
            onChange={e => setOrdineDraft(e.target.value)}
            onBlur={() => {
              if (ordineDraft == null) return;
              if (ordineDraft.trim() !== (p.numeroOrdine ?? ""))
                onUpdate({ numeroOrdine: ordineDraft.trim() || null });
              setOrdineDraft(null);
            }}
            className="h-9 w-24 font-mono text-xs"
          />
        )}

        {field(
          "Ordinato il",
          <Input
            aria-label="Data ordine"
            type="date"
            value={p.dataOrdine ?? ""}
            onChange={e => onUpdate({ dataOrdine: e.target.value || null })}
            className="h-9 w-[135px] text-xs"
          />
        )}

        {field(
          "Consegna",
          <Input
            aria-label="Data di consegna prevista"
            type="date"
            value={p.dataConsegna ?? ""}
            onChange={e => onUpdate({ dataConsegna: e.target.value || null })}
            className={`h-9 w-[135px] text-xs ${
              stato === "late" ? "border-danger/50 text-danger" : ""
            }`}
          />
        )}

        {field(
          "Arrivato",
          <div className="flex h-9 items-center">
            <Switch
              aria-label="Consegna ricevuta"
              checked={p.arrivato}
              onCheckedChange={v => onUpdate({ arrivato: v })}
              disabled={pending}
            />
          </div>
        )}

        <div className="ml-auto self-center">
          <Button
            type="button"
            variant="dangerGhost"
            size="icon"
            className="min-h-11 min-w-11"
            aria-label="Elimina prodotto"
            title="Elimina prodotto"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Nota modificabile */}
      <div className="flex min-w-0 items-start gap-1.5">
        <StickyNote
          className="mt-[9px] h-3.5 w-3.5 shrink-0 text-warning"
          aria-hidden="true"
        />
        <Input
          aria-label="Nota consegna"
          placeholder="Aggiungi nota…"
          value={noteDraft ?? (p.note ?? "")}
          onChange={e => setNoteDraft(e.target.value)}
          onBlur={() => {
            if (noteDraft == null) return;
            if (noteDraft.trim() !== (p.note ?? ""))
              onUpdate({ note: noteDraft.trim() || null });
            setNoteDraft(null);
          }}
          className="h-9 border-transparent bg-transparent px-1.5 text-xs shadow-none hover:border-border focus-visible:border-border"
        />
      </div>
    </div>
  );
}
