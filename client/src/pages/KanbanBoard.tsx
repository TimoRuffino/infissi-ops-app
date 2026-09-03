import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import KanbanDesktopBoard, {
  type KanbanItem,
} from "@/components/kanban/KanbanDesktopBoard";
import KanbanMobilePhaseList from "@/components/kanban/KanbanMobilePhaseList";
import PageHeader from "@/components/patterns/PageHeader";
import { useOperationalContext } from "@/contexts/OperationalContext";
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
import {
  AlertTriangle,
  Search,
  Filter,
  Eye,
  EyeOff,
  LayoutGrid,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import ConfirmDialog from "@/components/ConfirmDialog";
import { titoloGateBloccato } from "@/lib/limitiView";
import {
  KANBAN_COLUMN_STATES,
  kanbanPresentation,
  type KanbanColumnState,
} from "@/lib/goldenScreenContracts";

type ColonnaConfig = {
  id: KanbanColumnState;
  label: string;
  short: string;
};

type FaseConfig = {
  id: string;
  label: string;
  description: string;
  colonne: ReadonlyArray<ColonnaConfig>;
};

// I colori delle colonne vengono dalle famiglie di stato in lib/stato
// (statoChipClass / statoColorVar): un'unica fonte per Board, chip, rail e
// grafici — mai pastelli locali che dicono cose diverse dal resto del CRM.
const FASI: ReadonlyArray<FaseConfig> = [
  {
    id: "vendita",
    label: "Vendita",
    description: "Dal preventivo alla conferma",
    colonne: [
      { id: "preventivo", label: "Preventivo", short: "Preventivo" },
      { id: "misure_esecutive", label: "Misure Esecutive", short: "Misure" },
      {
        id: "aggiornamento_contratto",
        label: "Aggiornamento Contratto",
        short: "Agg. Contratto",
      },
    ],
  },
  {
    id: "ordine",
    label: "Ordine & Produzione",
    description: "Fatturazione, ordine, costruzione",
    colonne: [
      {
        id: "fatture_pagamento",
        label: "Fatture / Pagamento",
        short: "Fatture",
      },
      { id: "da_ordinare", label: "Da Ordinare", short: "Da Ordinare" },
      { id: "produzione", label: "Produzione", short: "Produzione" },
    ],
  },
  {
    id: "consegna",
    label: "Consegna & Posa",
    description: "Secondo acconto, attesa, posa",
    colonne: [
      {
        id: "ordini_ultimazione",
        label: "Richiesta Secondo Acconto",
        short: "2° Acconto",
      },
      { id: "attesa_posa", label: "Attesa Posa", short: "Attesa Posa" },
    ],
  },
  {
    id: "chiusura",
    label: "Chiusura",
    description: "Saldo e interventi finali",
    colonne: [
      { id: "finiture_saldo", label: "Finiture / Saldo", short: "Finiture" },
      {
        id: "interventi_regolazioni",
        label: "Interventi / Regolaz.",
        short: "Interventi",
      },
    ],
  },
];

// Flat list derived from FASI — preserves stato order for prev/next navigation
const COLONNE_FLAT: ReadonlyArray<ColonnaConfig> = KANBAN_COLUMN_STATES.map(
  stato =>
    FASI.flatMap(fase => fase.colonne).find(colonna => colonna.id === stato)!
);

const prioritaOrder: Record<string, number> = {
  urgente: 0,
  alta: 1,
  media: 2,
  bassa: 3,
};

export default function KanbanBoard() {
  const [, setLocation] = useLocation();
  const { capabilities } = useOperationalContext();
  const canMove =
    (capabilities?.has("commessa.update_operational") ?? false) &&
    (capabilities?.has("commessa.change_state") ?? false);
  const commesse = trpc.commesse.list.useQuery({});
  // Warehouse products per commessa — shown on the card so posa can be
  // planned around real material arrivals.
  const magazzino = trpc.magazzino.list.useQuery({});
  const squadre = trpc.squadre.list.useQuery();
  const squadreById = useMemo(() => {
    const m = new Map<number, any>();
    for (const s of squadre.data ?? []) m.set(s.id, s);
    return m;
  }, [squadre.data]);
  const utils = trpc.useUtils();

  const prodottiByCommessa = useMemo(() => {
    const map = new Map<number, any[]>();
    for (const p of magazzino.data ?? []) {
      if (!map.has(p.commessaId)) map.set(p.commessaId, []);
      map.get(p.commessaId)!.push(p);
    }
    return map;
  }, [magazzino.data]);

  const [consegnaTarget, setConsegnaTarget] = useState<{
    id: number;
    codice: string;
  } | null>(null);
  const [consegnaDate, setConsegnaDate] = useState("");
  const [consegnaError, setConsegnaError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filtroPriorita, setFiltroPriorita] = useState<string>("tutte");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [faseFiltro, setFaseFiltro] = useState<string>("tutte");
  const [moveError, setMoveError] = useState<string | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1200 : window.innerWidth
  );

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1200px)");
    const syncViewport = () => setViewportWidth(desktop.matches ? 1200 : 1199);
    syncViewport();
    desktop.addEventListener("change", syncViewport);
    return () => desktop.removeEventListener("change", syncViewport);
  }, []);
  // "Procedi comunque" confirmation for file-gate bypass. Fires when the
  // server rejects a forward transition with a `DOC_GATE_BLOCKED:` prefixed
  // error — the operator can confirm to retry with `force: true`, or cancel
  // and upload the file first.
  const [forceMoveTarget, setForceMoveTarget] = useState<{
    commessaId: number;
    newStato: string;
    message: string;
  } | null>(null);

  const DOC_GATE_PREFIX = "DOC_GATE_BLOCKED:";

  const updateCommessa = trpc.commesse.update.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      setMoveError(null);
      setForceMoveTarget(null);
    },
    onError: (err, variables) => {
      const msg = err.message ?? "";
      if (msg.startsWith(DOC_GATE_PREFIX) && variables?.stato) {
        // Surface the confirm dialog instead of a generic error — the
        // operator can decide to proceed without the file.
        setForceMoveTarget({
          commessaId: variables.id,
          newStato: variables.stato as string,
          message: msg.slice(DOC_GATE_PREFIX.length).trim(),
        });
        setMoveError(null);
      } else {
        setMoveError(msg || "Errore spostamento");
      }
    },
  });

  const confermaDataConsegna = trpc.commesse.confermaDataConsegna.useMutation({
    onSuccess: () => {
      utils.commesse.invalidate();
      setConsegnaTarget(null);
      setConsegnaDate("");
      setConsegnaError(null);
    },
    onError: error =>
      setConsegnaError(error.message || "Aggiornamento consegna non riuscito"),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (commesse.data ?? []).filter((c: any) => {
      if (filtroPriorita !== "tutte" && c.priorita !== filtroPriorita)
        return false;
      if (q) {
        const hay =
          `${c.codice ?? ""} ${c.cliente ?? ""} ${c.citta ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [commesse.data, search, filtroPriorita]);

  const byStato = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const col of COLONNE_FLAT) map[col.id] = [];
    for (const c of filtered) {
      if (map[c.stato]) map[c.stato].push(c);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => {
        const pa = prioritaOrder[a.priorita] ?? 9;
        const pb = prioritaOrder[b.priorita] ?? 9;
        if (pa !== pb) return pa - pb;
        return (
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
      });
    }
    return map;
  }, [filtered]);

  const boardByStato = useMemo(() => {
    const shaped: Record<string, KanbanItem[]> = {};
    for (const column of COLONNE_FLAT) {
      shaped[column.id] = (byStato[column.id] ?? []).map((commessa: any) => ({
        ...commessa,
        daSaldare: Boolean(commessa.daSaldare),
        squadraNome: squadreById.get(commessa.squadraId)?.nome ?? null,
        prodotti: (prodottiByCommessa.get(commessa.id) ?? []).map(
          (prodotto: any) => ({
            id: prodotto.id,
            nome: prodotto.nome,
            quantita: prodotto.quantita,
            fornitore: prodotto.fornitore,
            arrivato: prodotto.arrivato,
            dataConsegna: prodotto.dataConsegna,
          })
        ),
      }));
    }
    return shaped;
  }, [byStato, prodottiByCommessa, squadreById]);

  const totals = useMemo(() => {
    const list = commesse.data ?? [];
    const active = list.filter((c: any) => c.stato !== "archiviata");
    const urgenti = active.filter((c: any) => c.priorita === "urgente").length;
    const alte = active.filter((c: any) => c.priorita === "alta").length;
    const inProduzione = active.filter(
      (c: any) => c.stato === "produzione" && !c.dataConsegnaConfermata
    ).length;
    return { total: active.length, urgenti, alte, inProduzione };
  }, [commesse.data]);

  function handleMove(commessaId: number, newStato: string) {
    setMoveError(null);
    updateCommessa.mutate({ id: commessaId, stato: newStato as any });
  }

  const fasiVisibili = FASI.filter(
    f => faseFiltro === "tutte" || faseFiltro === f.id
  );
  const presentation = kanbanPresentation(viewportWidth);

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        variant="workbench"
        eyebrow="Flusso operativo"
        title={
          <span className="inline-flex items-center gap-2">
            <LayoutGrid className="h-6 w-6 text-primary" />
            Board commesse
          </span>
        }
        description="Avanza il lavoro per fasi usando gli stessi stati canonici della commessa."
        busy={commesse.isPending}
        metadata={
          <div className="flex min-w-0 flex-wrap gap-2">
            <span className="rounded-full border border-border-soft bg-surface px-2.5 py-1">
              <strong className="tabular-nums text-text-1">
                {totals.total}
              </strong>{" "}
              attive
            </span>
            <span className="rounded-full border border-danger/30 bg-danger-soft px-2.5 py-1 text-danger">
              <strong className="tabular-nums">{totals.urgenti}</strong> urgenti
            </span>
            <span className="rounded-full border border-warning/30 bg-warning-soft px-2.5 py-1 text-warning">
              <strong className="tabular-nums">{totals.alte}</strong> alte
            </span>
            <span className="rounded-full border border-warning/30 bg-warning-soft px-2.5 py-1 text-warning">
              <strong className="tabular-nums">{totals.inProduzione}</strong>{" "}
              consegne da confermare
            </span>
          </div>
        }
      />

      <section
        aria-label="Strumenti Board"
        className="sticky top-0 z-10 min-w-0 space-y-3 rounded-[var(--radius-panel)] border border-border-soft bg-[var(--shell-canvas)] p-3 shadow-[var(--shadow-raised)]"
      >
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
            <Input
              aria-label="Cerca nel Board"
              placeholder="Cerca codice, cliente, città..."
              value={search}
              onChange={event => setSearch(event.target.value)}
              className="h-10 pl-9"
            />
          </div>
          <Select value={filtroPriorita} onValueChange={setFiltroPriorita}>
            <SelectTrigger
              className="h-10 w-full sm:w-[180px]"
              aria-label="Filtra per priorità"
            >
              <Filter className="mr-1.5 h-3.5 w-3.5" />
              <SelectValue />
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
            variant="outline"
            size="sm"
            onClick={() => setHideEmpty(value => !value)}
            className="h-10 justify-center"
          >
            {hideEmpty ? (
              <Eye className="h-3.5 w-3.5" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )}
            {hideEmpty ? "Mostra vuote" : "Nascondi vuote"}
          </Button>
        </div>

        <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5">
          <Button
            variant={faseFiltro === "tutte" ? "default" : "outline"}
            size="sm"
            className="h-8 shrink-0 text-xs"
            onClick={() => setFaseFiltro("tutte")}
          >
            Tutte le fasi
          </Button>
          {FASI.map(phase => {
            const count = phase.colonne.reduce(
              (total, column) => total + (byStato[column.id]?.length ?? 0),
              0
            );
            return (
              <Button
                key={phase.id}
                variant={faseFiltro === phase.id ? "default" : "outline"}
                size="sm"
                className="h-8 shrink-0 text-xs"
                onClick={() => setFaseFiltro(phase.id)}
              >
                {phase.label}
                <Badge
                  variant="secondary"
                  className="ml-1.5 h-4 px-1.5 text-[10px]"
                >
                  {count}
                </Badge>
              </Button>
            );
          })}
        </div>
      </section>

      {moveError ? (
        <Card
          role="alert"
          aria-live="polite"
          className="border-danger/40 bg-danger-soft"
        >
          <CardContent className="flex items-center gap-2 p-3 text-sm text-danger">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {moveError}
          </CardContent>
        </Card>
      ) : null}

      {presentation === "desktop-board" ? (
        <KanbanDesktopBoard
          phases={fasiVisibili}
          columns={COLONNE_FLAT}
          byStato={boardByStato}
          hideEmpty={hideEmpty}
          canMove={canMove}
          movePending={updateCommessa.isPending}
          onOpen={commessaId => setLocation(`/commesse/${commessaId}`)}
          onMove={handleMove}
          onRequestDelivery={item => {
            setConsegnaTarget({ id: item.id, codice: item.codice });
            setConsegnaDate("");
            setConsegnaError(null);
          }}
        />
      ) : (
        <KanbanMobilePhaseList
          phases={fasiVisibili}
          columns={COLONNE_FLAT}
          byStato={boardByStato}
          hideEmpty={hideEmpty}
          canMove={canMove}
          movePending={updateCommessa.isPending}
          onOpen={commessaId => setLocation(`/commesse/${commessaId}`)}
          onMove={handleMove}
          onRequestDelivery={item => {
            setConsegnaTarget({ id: item.id, codice: item.codice });
            setConsegnaDate("");
            setConsegnaError(null);
          }}
        />
      )}

      <Dialog
        open={!!consegnaTarget}
        onOpenChange={open => {
          if (!open) {
            setConsegnaTarget(null);
            setConsegnaError(null);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Aggiorna data consegna — {consegnaTarget?.codice}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <p className="text-sm text-muted-foreground">
              Inserisci la data di consegna prevista confermata dal produttore.
              Sarà visibile sulla commessa nel board.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="kanban-delivery-date">Data consegna</Label>
              <Input
                id="kanban-delivery-date"
                type="date"
                value={consegnaDate}
                onChange={e => setConsegnaDate(e.target.value)}
              />
            </div>
            {consegnaError ? (
              <p role="alert" className="text-sm text-danger">
                {consegnaError}
              </p>
            ) : null}
            <Button
              onClick={() =>
                consegnaTarget &&
                confermaDataConsegna.mutate({
                  id: consegnaTarget.id,
                  dataConsegna: consegnaDate,
                })
              }
              disabled={!consegnaDate || confermaDataConsegna.isPending}
            >
              Conferma data
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* "Procedi comunque" dialog — surfaces the server's DOC_GATE_BLOCKED
          message and retries the move with `force: true` on confirm. */}
      <ConfirmDialog
        open={!!forceMoveTarget}
        onOpenChange={open => !open && setForceMoveTarget(null)}
        title={titoloGateBloccato(forceMoveTarget?.message)}
        description={forceMoveTarget?.message ?? ""}
        destructive={false}
        confirmLabel="Procedi comunque"
        busy={updateCommessa.isPending}
        onConfirm={() => {
          if (!forceMoveTarget) return;
          updateCommessa.mutate({
            id: forceMoveTarget.commessaId,
            stato: forceMoveTarget.newStato as any,
            force: true,
          });
        }}
      />
    </div>
  );
}
