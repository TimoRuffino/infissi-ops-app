import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { Building2, Command, ListChecks, Menu, Search } from "lucide-react";

import NotificheDropdown from "@/components/NotificheDropdown";
import { Button } from "@/components/ui/button";
import { useOperationalContext } from "@/contexts/OperationalContext";
import type { RouteContractEntry } from "@/lib/routeContract";
import { routePresentation } from "@/lib/shellPresentation";
import UserMenu from "./UserMenu";

export type ContextBarProps = {
  currentRoute: RouteContractEntry;
  onOpenCommand: () => void;
  onOpenNavigation: () => void;
  actions?: ReactNode;
};

export default function ContextBar({
  currentRoute,
  onOpenCommand,
  onOpenNavigation,
  actions,
}: ContextBarProps) {
  const { activeSede } = useOperationalContext();
  const [, setLocation] = useLocation();
  const presentation = routePresentation(currentRoute);
  const isMac =
    typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

  return (
    <header className="sticky top-0 z-30 flex min-h-16 min-w-0 items-center gap-2 border-b border-[var(--context-border)] bg-[var(--context-surface)] px-3 sm:gap-3 sm:px-4 min-[1200px]:min-h-[72px] min-[1200px]:px-5">
      <Button
        type="button"
        variant="quiet"
        size="icon-lg"
        className="h-11 w-11 min-[1200px]:hidden"
        onClick={onOpenNavigation}
        aria-label="Apri navigazione"
      >
        <Menu aria-hidden="true" />
      </Button>

      <div className="min-w-0 flex-1">
        <div className="hidden items-center gap-1.5 text-[11px] font-medium text-text-3 min-[1200px]:flex">
          <span>Ruffino Flow</span>
          <span aria-hidden="true">/</span>
          <span className="truncate">{presentation.section}</span>
        </div>
        <h1 className="truncate text-base font-semibold leading-6 text-text-1 sm:text-lg">
          {presentation.title}
        </h1>
      </div>

      {actions ? (
        <div className="hidden shrink-0 items-center gap-2 xl:flex">
          {actions}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onOpenCommand}
        className="hidden h-10 min-w-40 items-center gap-2 rounded-[var(--radius-control)] border border-border-strong bg-surface-2 px-3 text-sm text-text-3 shadow-xs transition-colors hover:border-primary/45 hover:bg-accent hover:text-text-1 focus-visible:ring-[var(--focus-width)] focus-visible:ring-[var(--focus-color)] min-[1200px]:flex xl:min-w-52"
        aria-label={`Cerca e apri comandi (${isMac ? "Comando K" : "Control K"})`}
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">
          Cerca o vai a…
        </span>
        <kbd className="hidden rounded-md border border-border-soft bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-text-3 xl:inline-flex">
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>
      <Button
        type="button"
        variant="quiet"
        size="icon-lg"
        className="h-11 w-11 min-[1200px]:hidden"
        onClick={onOpenCommand}
        aria-label="Cerca e apri comandi"
      >
        <Command aria-hidden="true" />
      </Button>

      {activeSede ? (
        <div
          className="hidden max-w-44 items-center gap-2 rounded-[var(--radius-control)] border border-border-soft bg-surface px-2.5 py-2 text-xs text-text-2 2xl:flex"
          title={`Sede attiva: ${activeSede.nome}`}
        >
          <Building2
            className="h-4 w-4 shrink-0 text-accent-text"
            aria-hidden="true"
          />
          <span className="truncate font-medium">{activeSede.nome}</span>
        </div>
      ) : null}

      <Button
        type="button"
        variant="quiet"
        size="icon-lg"
        className="hidden h-11 w-11 lg:inline-flex min-[1200px]:h-10 min-[1200px]:w-10"
        onClick={() => setLocation("/notifiche")}
        aria-label="Apri Centro azioni"
        title="Centro azioni"
      >
        <ListChecks aria-hidden="true" />
      </Button>
      <NotificheDropdown />
      <UserMenu />
    </header>
  );
}
