import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { Building2, Command, ListChecks, Menu, Search } from "lucide-react";

import NotificheDropdown from "@/components/NotificheDropdown";
import { Button } from "@/components/ui/button";
import { useOperationalContext } from "@/contexts/OperationalContext";
import type { RouteContractEntry } from "@/lib/routeContract";
import UserMenu from "./UserMenu";

export type ContextBarProps = {
  currentRoute: RouteContractEntry;
  onOpenCommand: () => void;
  onOpenNavigation: () => void;
  actions?: ReactNode;
};

type RoutePresentation = { section: string; title: string };

const ROUTE_PRESENTATION: Record<string, RoutePresentation> = {
  "/": { section: "Oggi", title: "Dashboard" },
  "/clienti": { section: "Clienti", title: "Elenco clienti" },
  "/clienti/:id": { section: "Clienti", title: "Dettaglio cliente" },
  "/kanban": { section: "Commesse", title: "Board operativo" },
  "/magazzino": { section: "Ordini e cantiere", title: "Magazzino" },
  "/pagamenti": { section: "Economia", title: "Pagamenti" },
  "/economia": { section: "Economia", title: "Contabilità" },
  "/marginalita": { section: "Economia", title: "Marginalità" },
  "/commesse": { section: "Commesse", title: "Elenco commesse" },
  "/commesse/:id": { section: "Commesse", title: "Commessa 360" },
  "/commesse/:commessaId/aperture/:aperturaId/rilievo": {
    section: "Commesse",
    title: "Rilievo apertura",
  },
  "/verbale/:interventoId": {
    section: "Cantiere",
    title: "Verbale di chiusura",
  },
  "/planning": { section: "Cantiere", title: "Planning" },
  "/ticket": { section: "Post-vendita", title: "Ticket" },
  "/garanzie": { section: "Post-vendita", title: "Garanzie" },
  "/squadre": { section: "Cantiere", title: "Squadre di posa" },
  "/fornitori": { section: "Ordini", title: "Fornitori e ordini" },
  "/preventivatori": { section: "Commesse", title: "Preventivatori" },
  "/preventivatori/fivizzanese/persiane": {
    section: "Preventivatori",
    title: "Fivizzanese · Persiane",
  },
  "/preventivatori/punto-del-serramento/persiane": {
    section: "Preventivatori",
    title: "Punto del Serramento · Persiane",
  },
  "/reclami": { section: "Post-vendita", title: "Reclami e rifacimenti" },
  "/archivio": { section: "Commesse", title: "Archivio" },
  "/utenti": { section: "Amministrazione", title: "Utenti" },
  "/sedi": { section: "Amministrazione", title: "Sedi" },
  "/messaggi/email": { section: "Comunicazioni", title: "Email" },
  "/messaggi/whatsapp": { section: "Comunicazioni", title: "WhatsApp" },
  "/chat": { section: "Comunicazioni", title: "Chat aziendale" },
  "/notifiche": { section: "Oggi", title: "Centro azioni" },
  "/conoscenza": { section: "Amministrazione", title: "Conoscenza" },
  "/integrazioni": { section: "Amministrazione", title: "Impostazioni" },
  "/tars": { section: "Tars", title: "Centro decisionale" },
  "/404": { section: "Navigazione", title: "Pagina non trovata" },
  "*": { section: "Navigazione", title: "Pagina non trovata" },
};

export function routePresentation(
  route: RouteContractEntry
): RoutePresentation {
  return (
    ROUTE_PRESENTATION[route.path] ?? {
      section: "Ruffino Flow",
      title: route.target,
    }
  );
}

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
    <header className="sticky top-0 z-30 flex min-h-[72px] min-w-0 items-center gap-2 border-b border-[var(--context-border)] bg-[var(--context-surface)] px-3 sm:gap-3 sm:px-4 min-[1200px]:px-5">
      <Button
        type="button"
        variant="quiet"
        size="icon-lg"
        className="min-[1200px]:hidden"
        onClick={onOpenNavigation}
        aria-label="Apri navigazione"
      >
        <Menu aria-hidden="true" />
      </Button>

      <div className="min-w-0 flex-1">
        <div className="hidden items-center gap-1.5 text-[11px] font-medium text-text-3 sm:flex">
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
        className="hidden h-10 min-w-40 items-center gap-2 rounded-[var(--radius-control)] border border-border-strong bg-surface-2 px-3 text-sm text-text-3 shadow-xs transition-colors hover:border-primary/45 hover:bg-accent hover:text-text-1 focus-visible:ring-[var(--focus-width)] focus-visible:ring-[var(--focus-color)] md:flex xl:min-w-52"
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
        className="md:hidden"
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
        className="hidden lg:inline-flex"
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
