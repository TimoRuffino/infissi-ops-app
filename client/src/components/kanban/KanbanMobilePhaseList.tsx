import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  HardHat,
  MapPin,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PRIORITA_LABEL, PRIORITA_VARIANT, statoChipClass } from "@/lib/stato";
import type {
  KanbanColumnConfig,
  KanbanDesktopBoardProps,
  KanbanItem,
  KanbanPhaseConfig,
} from "./KanbanDesktopBoard";

export type KanbanMobilePhaseListProps = {
  phases: ReadonlyArray<KanbanPhaseConfig>;
  columns: ReadonlyArray<KanbanColumnConfig>;
  byStato: Readonly<Record<string, KanbanItem[]>>;
  hideEmpty: boolean;
  canMove: boolean;
  movePending: boolean;
  onOpen: (commessaId: number) => void;
  onMove: (commessaId: number, nuovoStato: string) => void;
  onRequestDelivery: KanbanDesktopBoardProps["onRequestDelivery"];
};

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
  });
}

function MobileCard({
  item,
  columns,
  onOpen,
  onMove,
  onRequestDelivery,
  canMove,
  movePending,
}: {
  item: KanbanItem;
  columns: ReadonlyArray<KanbanColumnConfig>;
  onOpen: KanbanMobilePhaseListProps["onOpen"];
  onMove: KanbanMobilePhaseListProps["onMove"];
  onRequestDelivery: KanbanMobilePhaseListProps["onRequestDelivery"];
  canMove: boolean;
  movePending: boolean;
}) {
  const needsDelivery =
    item.stato === "produzione" && !item.dataConsegnaConfermata;

  return (
    <article
      className={`min-w-0 rounded-[var(--radius-control)] border bg-surface p-3 shadow-[var(--shadow-raised)] ${
        needsDelivery ? "border-warning/60" : "border-border-soft"
      }`}
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
          <Badge variant={PRIORITA_VARIANT[item.priorita] ?? "secondary"}>
            {item.priorita === "urgente" ? (
              <AlertTriangle className="h-3 w-3" />
            ) : null}
            {PRIORITA_LABEL[item.priorita] ?? item.priorita}
          </Badge>
        </div>
        <p className="mt-1.5 text-[15px] font-semibold leading-5 text-text-1">
          {item.cliente}
        </p>
        <div className="mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-text-2">
          {item.citta ? (
            <span className="flex min-w-0 items-center gap-1">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{item.citta}</span>
            </span>
          ) : null}
          {item.dataConsegnaConfermata ? (
            <span className="flex items-center gap-1 text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {shortDate(item.dataConsegnaConfermata)}
            </span>
          ) : item.consegnaIndicativa ? (
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />+{item.consegnaIndicativa}gg
            </span>
          ) : null}
          {item.squadraNome ? (
            <span className="flex min-w-0 items-center gap-1 text-info">
              <HardHat className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{item.squadraNome}</span>
            </span>
          ) : null}
          {item.daSaldare ? (
            <span className="font-semibold text-danger">Da saldare</span>
          ) : null}
        </div>
      </button>

      {needsDelivery ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-3 h-9 w-full border-warning/60 text-warning hover:bg-warning-soft"
          onClick={() => onRequestDelivery(item)}
        >
          <Clock className="h-3.5 w-3.5" />
          Aggiorna data consegna
        </Button>
      ) : null}

      {canMove ? (
        <div className="mt-3 border-t border-border-soft pt-3">
          <label
            htmlFor={`move-commessa-${item.id}`}
            className="mb-1.5 block text-xs font-semibold text-text-2"
          >
            Sposta in…
          </label>
          <div className="relative">
            <select
              id={`move-commessa-${item.id}`}
              value={item.stato}
              disabled={movePending}
              onChange={event => {
                if (event.target.value !== item.stato) {
                  onMove(item.id, event.target.value);
                }
              }}
              className="h-11 w-full appearance-none rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 pr-10 text-sm font-medium text-text-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {columns.map(column => (
                <option key={column.id} value={column.id}>
                  {column.label}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
            />
          </div>
        </div>
      ) : null}
    </article>
  );
}

export default function KanbanMobilePhaseList({
  phases,
  columns,
  byStato,
  hideEmpty,
  canMove,
  movePending,
  onOpen,
  onMove,
  onRequestDelivery,
}: KanbanMobilePhaseListProps) {
  return (
    <div className="space-y-3" data-kanban-presentation="mobile-phase-list">
      {phases.map(phase => {
        const phaseCount = phase.colonne.reduce(
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
        const visibleColumns = hideEmpty
          ? phase.colonne.filter(column => byStato[column.id]?.length > 0)
          : phase.colonne;
        if (visibleColumns.length === 0) return null;

        return (
          <details
            key={phase.id}
            open
            className="group min-w-0 overflow-hidden rounded-[var(--radius-panel)] border border-border-soft bg-surface shadow-[var(--shadow-raised)]"
          >
            <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 px-3 py-2.5 outline-none marker:hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-bold text-text-1">{phase.label}</h2>
                <p className="truncate text-xs text-text-2">
                  {phase.description}
                </p>
              </div>
              {urgent > 0 ? (
                <Badge className="bg-danger-soft text-danger">
                  <AlertTriangle className="h-3 w-3" />
                  {urgent}
                </Badge>
              ) : null}
              <Badge variant="secondary">{phaseCount}</Badge>
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
            </summary>

            <div className="space-y-3 border-t border-border-soft bg-surface-2 p-2.5">
              {visibleColumns.map(column => {
                const items = byStato[column.id] ?? [];
                return (
                  <section
                    key={column.id}
                    aria-labelledby={`mobile-kanban-column-${column.id}`}
                    className="min-w-0"
                  >
                    <div
                      className={`mb-2 flex min-w-0 items-center gap-2 rounded-md px-2.5 py-2 ${statoChipClass(
                        column.id
                      )}`}
                    >
                      <h3
                        id={`mobile-kanban-column-${column.id}`}
                        className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide"
                      >
                        {column.label}
                      </h3>
                      <Badge variant="secondary">{items.length}</Badge>
                    </div>
                    <div className="space-y-2">
                      {items.map(item => (
                        <MobileCard
                          key={item.id}
                          item={item}
                          columns={columns}
                          onOpen={onOpen}
                          onMove={onMove}
                          onRequestDelivery={onRequestDelivery}
                          canMove={canMove}
                          movePending={movePending}
                        />
                      ))}
                      {items.length === 0 ? (
                        <p className="rounded-md border border-dashed border-border-soft bg-surface px-3 py-4 text-center text-xs text-text-3">
                          Nessuna commessa
                        </p>
                      ) : null}
                    </div>
                  </section>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}
