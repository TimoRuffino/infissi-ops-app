import { useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  HardHat,
  MapPin,
  Package,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PRIORITA_LABEL,
  PRIORITA_VARIANT,
  statoChipClass,
  statoColorVar,
} from "@/lib/stato";

export type KanbanColumnConfig = {
  id: string;
  label: string;
  short: string;
};

export type KanbanPhaseConfig = {
  id: string;
  label: string;
  description: string;
  colonne: ReadonlyArray<KanbanColumnConfig>;
};

export type KanbanProductSummary = {
  id: number;
  nome: string;
  quantita?: number;
  fornitore?: string | null;
  arrivato?: boolean;
  dataConsegna?: string | null;
};

export type KanbanItem = {
  id: number;
  codice: string;
  cliente: string;
  citta?: string | null;
  stato: string;
  priorita: string;
  updatedAt: string | Date;
  consegnaIndicativa?: number | null;
  dataConsegnaConfermata?: string | null;
  daSaldare?: boolean;
  squadraNome?: string | null;
  prodotti: KanbanProductSummary[];
};

export type KanbanDesktopBoardProps = {
  phases: ReadonlyArray<KanbanPhaseConfig>;
  columns: ReadonlyArray<KanbanColumnConfig>;
  byStato: Readonly<Record<string, KanbanItem[]>>;
  hideEmpty: boolean;
  canMove: boolean;
  movePending: boolean;
  onOpen: (commessaId: number) => void;
  onMove: (commessaId: number, nuovoStato: string) => void;
  onRequestDelivery: (commessa: KanbanItem) => void;
};

const VISIBLE_LIMIT = 5;
const STATI_POSA = new Set([
  "attesa_posa",
  "finiture_saldo",
  "interventi_regolazioni",
]);

const PRIORITA_EDGE: Record<string, string> = {
  urgente: "var(--color-danger)",
  alta: "var(--color-warning)",
  media: "var(--primary)",
  bassa: "var(--color-text-3)",
};

function daysSince(date: string | Date): number {
  return Math.floor(
    Math.abs(Date.now() - new Date(date).getTime()) / 86_400_000
  );
}

function shortDate(iso: string | null | undefined): string {
  return iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString("it-IT", {
        day: "2-digit",
        month: "2-digit",
      })
    : "—";
}

function WorkCard({
  item,
  previous,
  next,
  onOpen,
  onMove,
  onRequestDelivery,
  canMove,
  movePending,
}: {
  item: KanbanItem;
  previous: KanbanColumnConfig | null;
  next: KanbanColumnConfig | null;
  onOpen: KanbanDesktopBoardProps["onOpen"];
  onMove: KanbanDesktopBoardProps["onMove"];
  onRequestDelivery: KanbanDesktopBoardProps["onRequestDelivery"];
  canMove: boolean;
  movePending: boolean;
}) {
  const fermo = daysSince(item.updatedAt);
  const needsDelivery =
    item.stato === "produzione" && !item.dataConsegnaConfermata;

  return (
    <article
      className={`min-w-0 rounded-[var(--radius-control)] border border-border-soft bg-surface p-2.5 shadow-[var(--shadow-raised)] ${
        needsDelivery ? "ring-2 ring-warning/50" : ""
      }`}
      style={{
        borderLeftColor:
          PRIORITA_EDGE[item.priorita] ?? "var(--color-border-strong)",
        borderLeftWidth: 3,
      }}
    >
      <button
        type="button"
        onClick={() => onOpen(item.id)}
        className="block w-full rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`Apri ${item.codice}, ${item.cliente}`}
      >
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="codice-mono min-w-0 truncate text-text-3">
            {item.codice}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {fermo >= 5 ? (
              <span
                title={`Nessun aggiornamento da ${fermo} giorni`}
                className={`inline-flex items-center gap-0.5 rounded px-1 py-px text-[9px] font-bold ${
                  fermo >= 10
                    ? "bg-danger-soft text-danger"
                    : "bg-warning-soft text-warning"
                }`}
              >
                <Clock className="h-2.5 w-2.5" />
                {fermo}gg
              </span>
            ) : null}
            <Badge variant={PRIORITA_VARIANT[item.priorita] ?? "secondary"}>
              {item.priorita === "urgente" ? (
                <AlertTriangle className="h-2.5 w-2.5" />
              ) : null}
              {PRIORITA_LABEL[item.priorita] ?? item.priorita}
            </Badge>
          </span>
        </div>

        <p className="mt-1.5 truncate text-sm font-semibold leading-tight text-text-1">
          {item.cliente}
        </p>
        {item.citta ? (
          <p className="mt-1 flex min-w-0 items-center gap-1 truncate text-[11px] text-text-2">
            <MapPin className="h-3 w-3 shrink-0" />
            {item.citta}
          </p>
        ) : null}
      </button>

      <div className="mt-1.5 space-y-1.5">
        {item.dataConsegnaConfermata ? (
          <div className="flex items-center gap-1 rounded bg-success-soft px-1.5 py-0.5 text-[11px] font-medium text-success">
            <CheckCircle2 className="h-3 w-3 shrink-0" />
            Consegna: {shortDate(item.dataConsegnaConfermata)}
          </div>
        ) : item.consegnaIndicativa ? (
          <div className="flex items-center gap-1 text-[11px] text-text-2">
            <Calendar className="h-3 w-3 shrink-0" />
            Indicativa: +{item.consegnaIndicativa}gg
          </div>
        ) : null}

        {STATI_POSA.has(item.stato) ? (
          <div
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${
              item.squadraNome
                ? "bg-info-soft text-info"
                : "bg-warning-soft text-warning"
            }`}
          >
            <HardHat className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {item.squadraNome ?? "Squadra da assegnare"}
            </span>
          </div>
        ) : null}

        {item.daSaldare && STATI_POSA.has(item.stato) ? (
          <div className="rounded bg-danger-soft px-1.5 py-0.5 text-[11px] font-semibold text-danger">
            Da saldare
          </div>
        ) : null}

        {item.prodotti.length > 0 ? (
          <div className="space-y-0.5 rounded border border-border-soft bg-surface-2 px-1.5 py-1">
            {item.prodotti.slice(0, 2).map(product => {
              const today = new Date().toISOString().split("T")[0];
              const late =
                !product.arrivato &&
                product.dataConsegna &&
                product.dataConsegna < today;
              return (
                <div
                  key={product.id}
                  title={`${product.nome} ×${product.quantita ?? 1}${
                    product.fornitore ? ` — ${product.fornitore}` : ""
                  }`}
                  className={`flex min-w-0 items-center gap-1 text-[10px] leading-tight ${
                    product.arrivato
                      ? "text-success"
                      : late
                        ? "font-semibold text-danger"
                        : "text-text-2"
                  }`}
                >
                  <Package className="h-2.5 w-2.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {product.nome}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {product.arrivato ? "✓" : shortDate(product.dataConsegna)}
                  </span>
                </div>
              );
            })}
            {item.prodotti.length > 2 ? (
              <div className="pl-3.5 text-[9px] text-text-3">
                +{item.prodotti.length - 2} altri prodotti
              </div>
            ) : null}
          </div>
        ) : null}

        {needsDelivery ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-full border-warning/60 text-[11px] text-warning hover:bg-warning-soft"
            onClick={() => onRequestDelivery(item)}
          >
            <Clock className="h-3 w-3" />
            Aggiorna consegna
          </Button>
        ) : null}

        {canMove ? (
          <div className="grid grid-cols-2 gap-1.5 border-t border-border-soft pt-2">
            {previous ? (
              <button
                type="button"
                onClick={() => onMove(item.id, previous.id)}
                disabled={movePending}
                title={`Torna a ${previous.label}`}
                className="group inline-flex h-10 flex-col items-center justify-center rounded-md border border-border-strong bg-secondary px-1.5 py-1 text-secondary-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wide">
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Indietro
                </span>
                <span className="block w-full truncate text-[9px] font-normal text-text-3">
                  {previous.short}
                </span>
              </button>
            ) : (
              <span aria-hidden="true" />
            )}
            {next ? (
              <button
                type="button"
                onClick={() => onMove(item.id, next.id)}
                disabled={movePending}
                title={`Avanza a ${next.label}`}
                className="group inline-flex h-10 flex-col items-center justify-center rounded-md border border-success bg-success px-1.5 py-1 text-on-success outline-none transition-colors hover:bg-success/90 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wide">
                  Avanza
                  <ChevronRight className="h-3.5 w-3.5" />
                </span>
                <span className="block w-full truncate text-[9px] font-normal opacity-90">
                  {next.short}
                </span>
              </button>
            ) : (
              <span aria-hidden="true" />
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default function KanbanDesktopBoard({
  phases,
  columns: flatColumns,
  byStato,
  hideEmpty,
  canMove,
  movePending,
  onOpen,
  onMove,
  onRequestDelivery,
}: KanbanDesktopBoardProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
    <div className="space-y-4" data-kanban-presentation="desktop-board">
      {phases.map(phase => {
        const columns = hideEmpty
          ? phase.colonne.filter(column => byStato[column.id]?.length > 0)
          : phase.colonne;
        if (columns.length === 0) return null;

        const count = phase.colonne.reduce(
          (total, column) => total + (byStato[column.id]?.length ?? 0),
          0
        );
        const urgent = phase.colonne.reduce(
          (total, column) =>
            total +
            (byStato[column.id]?.filter(item => item.priorita === "urgente")
              .length ?? 0),
          0
        );
        const isCollapsed = collapsed[phase.id];

        return (
          <section
            key={phase.id}
            aria-labelledby={`kanban-phase-${phase.id}`}
            className="min-w-0 overflow-hidden rounded-[var(--radius-panel)] border border-border-soft bg-surface shadow-[var(--shadow-raised)]"
          >
            <button
              type="button"
              onClick={() =>
                setCollapsed(current => ({
                  ...current,
                  [phase.id]: !current[phase.id],
                }))
              }
              className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              aria-expanded={!isCollapsed}
              aria-controls={`kanban-phase-content-${phase.id}`}
            >
              <div className="min-w-0 flex-1">
                <h2
                  id={`kanban-phase-${phase.id}`}
                  className="text-sm font-bold uppercase tracking-[0.08em] text-text-1"
                >
                  {phase.label}
                </h2>
                <p className="mt-0.5 truncate text-xs text-text-2">
                  {phase.description}
                </p>
              </div>
              {urgent > 0 ? (
                <Badge className="bg-danger-soft text-danger">
                  <AlertTriangle className="h-3 w-3" />
                  {urgent}
                </Badge>
              ) : null}
              <Badge variant="secondary">{count}</Badge>
              {isCollapsed ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </button>

            {!isCollapsed ? (
              <div
                id={`kanban-phase-content-${phase.id}`}
                className="overflow-x-auto border-t border-border-soft p-3"
              >
                <div
                  className="grid min-w-full gap-3"
                  style={{
                    gridTemplateColumns: `repeat(${columns.length}, minmax(17rem, 1fr))`,
                    width: `max(100%, ${columns.length * 17.75}rem)`,
                  }}
                >
                  {columns.map(column => {
                    const items = byStato[column.id] ?? [];
                    const columnIndex = flatColumns.findIndex(
                      candidate => candidate.id === column.id
                    );
                    const previous =
                      columnIndex > 0 ? flatColumns[columnIndex - 1] : null;
                    const next =
                      columnIndex < flatColumns.length - 1
                        ? flatColumns[columnIndex + 1]
                        : null;
                    const visible = expanded[column.id]
                      ? items
                      : items.slice(0, VISIBLE_LIMIT);
                    const urgentCount = items.filter(
                      item => item.priorita === "urgente"
                    ).length;

                    return (
                      <section
                        key={column.id}
                        aria-labelledby={`kanban-column-${column.id}`}
                        className="flex min-w-0 flex-col"
                      >
                        <div
                          className={`flex items-center gap-2 rounded-t-[var(--radius-control)] border border-b-0 border-border-soft px-3 py-2 ${statoChipClass(
                            column.id
                          )}`}
                        >
                          <span
                            aria-hidden="true"
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{
                              backgroundColor: statoColorVar(column.id),
                            }}
                          />
                          <h3
                            id={`kanban-column-${column.id}`}
                            className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide"
                          >
                            {column.label}
                          </h3>
                          {urgentCount > 0 ? (
                            <Badge className="shrink-0 bg-danger-soft text-danger">
                              <AlertTriangle className="h-2.5 w-2.5" />
                              {urgentCount}
                            </Badge>
                          ) : null}
                          <Badge variant="secondary" className="shrink-0">
                            {items.length}
                          </Badge>
                        </div>

                        <div className="min-h-32 flex-1 space-y-2 rounded-b-[var(--radius-control)] border border-border-soft bg-surface-2 p-2">
                          {visible.map(item => (
                            <WorkCard
                              key={item.id}
                              item={item}
                              previous={previous}
                              next={next}
                              onOpen={onOpen}
                              onMove={onMove}
                              onRequestDelivery={onRequestDelivery}
                              canMove={canMove}
                              movePending={movePending}
                            />
                          ))}
                          {items.length > VISIBLE_LIMIT ? (
                            <button
                              type="button"
                              onClick={() =>
                                setExpanded(current => ({
                                  ...current,
                                  [column.id]: !current[column.id],
                                }))
                              }
                              className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border-strong bg-surface py-2 text-[11px] font-semibold text-accent-text outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {expanded[column.id] ? (
                                <>
                                  <ChevronUp className="h-3.5 w-3.5" />
                                  Mostra meno
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="h-3.5 w-3.5" />
                                  Mostra altre {items.length - VISIBLE_LIMIT}
                                </>
                              )}
                            </button>
                          ) : null}
                          {items.length === 0 ? (
                            <p className="py-6 text-center text-[11px] text-text-3">
                              Nessuna commessa in questa fase
                            </p>
                          ) : null}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
