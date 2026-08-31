import {
  Calendar as CalIcon,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Plus,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { addDays, startOfWeek } from "@/lib/calendario";

export type PlanningView = "day" | "week" | "month";

export type PlanningToolbarProps = {
  view: PlanningView;
  cursor: Date;
  /** Già risolto dal contenitore: `intervento.plan`. */
  canCreate: boolean;
  onChangeView: (view: PlanningView) => void;
  onPrevious: () => void;
  onToday: () => void;
  onNext: () => void;
  onCreate: () => void;
};

const VISTE: ReadonlyArray<{
  id: PlanningView;
  label: string;
  short: string;
  icon: LucideIcon;
}> = [
  { id: "month", label: "Mese", short: "Mese", icon: CalendarRange },
  { id: "week", label: "Settimana", short: "Sett.", icon: CalendarDays },
  { id: "day", label: "Giorno", short: "Giorno", icon: CalIcon },
];

function etichettaPeriodo(view: PlanningView, cursor: Date): string {
  if (view === "day") {
    return cursor.toLocaleDateString("it-IT", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  if (view === "week") {
    const inizio = startOfWeek(cursor);
    const fine = addDays(inizio, 6);
    if (inizio.getMonth() === fine.getMonth()) {
      return `${inizio.getDate()} – ${fine.getDate()} ${inizio.toLocaleDateString(
        "it-IT",
        { month: "long", year: "numeric" }
      )}`;
    }
    return `${inizio.toLocaleDateString("it-IT", {
      day: "numeric",
      month: "short",
    })} – ${fine.toLocaleDateString("it-IT", {
      day: "numeric",
      month: "short",
      year: "numeric",
    })}`;
  }
  return cursor.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
}

/**
 * Barra di controllo del calendario: vista, periodo e creazione.
 *
 * Non legge tRPC né capability: riceve `canCreate` già autorizzato dal
 * contenitore e si limita a emettere callback sullo stato `view`/`cursor`.
 */
export default function PlanningToolbar({
  view,
  cursor,
  canCreate,
  onChangeView,
  onPrevious,
  onToday,
  onNext,
  onCreate,
}: PlanningToolbarProps) {
  const periodo = etichettaPeriodo(view, cursor);

  return (
    <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div
        role="group"
        aria-label="Vista calendario"
        className="flex min-w-0 items-center gap-1 rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-1"
      >
        {VISTE.map(vista => {
          const Icona = vista.icon;
          const attiva = view === vista.id;
          return (
            <Button
              key={vista.id}
              type="button"
              variant={attiva ? "default" : "ghost"}
              size="sm"
              aria-pressed={attiva}
              className="min-h-11 min-w-0 flex-1 px-3 lg:flex-none"
              onClick={() => onChangeView(vista.id)}
            >
              <Icona className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{vista.label}</span>
              <span className="sm:hidden">{vista.short}</span>
            </Button>
          );
        })}
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11 shrink-0"
          aria-label="Periodo precedente"
          title="Periodo precedente"
          onClick={onPrevious}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <p
          aria-live="polite"
          className="min-w-0 flex-1 truncate text-center font-semibold capitalize text-text-1 lg:min-w-[13rem] lg:flex-none"
        >
          {periodo}
        </p>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11 shrink-0"
          aria-label="Periodo successivo"
          title="Periodo successivo"
          onClick={onNext}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 shrink-0"
          onClick={onToday}
        >
          Oggi
        </Button>
      </div>

      {canCreate ? (
        <Button
          type="button"
          className="min-h-12 w-full lg:min-h-11 lg:w-auto"
          onClick={onCreate}
        >
          <Plus className="h-4 w-4" />
          Nuovo appuntamento
        </Button>
      ) : null}
    </div>
  );
}
