// Bottom navigation mobile (shell v2) — cinque destinazioni role-aware,
// posizioni stabili, pollice-friendly. Le voci rispettano le stesse regole
// di visibilità della sidebar (lib/navigation): il server resta l'autorità.
//
// La quinta voce apre il menu completo (la sidebar mobile come sheet):
// niente hamburger irraggiungibile in alto quando si lavora a una mano.
import { useSidebar } from "@/components/ui/sidebar";
import {
  isPathActive,
  type NavigationAccess,
  navigationDestinations,
} from "@/lib/navigation";
import { hasRuolo } from "@/lib/roles";
import type { LucideIcon } from "lucide-react";
import {
  BrainCircuit,
  CalendarDays,
  Kanban,
  LayoutDashboard,
  Menu,
  MessagesSquare,
} from "lucide-react";
import { useLocation } from "wouter";

type Voce = { icon: LucideIcon; label: string; path: string };

export default function BottomNav({ access }: { access: NavigationAccess }) {
  const [location, setLocation] = useLocation();
  const { toggleSidebar, openMobile } = useSidebar();
  const visiblePaths = new Set(
    navigationDestinations(access).map(destination => destination.path)
  );

  // Chi vive in cantiere apre l'agenda, chi vive in ufficio apre il Board.
  const campo =
    hasRuolo(access.user, "squadra_posa") ||
    hasRuolo(access.user, "tecnico_rilievi");
  const operationalDestination =
    campo || !visiblePaths.has("/kanban")
      ? { icon: CalendarDays, label: "Agenda", path: "/planning" }
      : { icon: Kanban, label: "Board", path: "/kanban" };
  const voci: Voce[] = [
    { icon: LayoutDashboard, label: "Oggi", path: "/" },
    operationalDestination,
    { icon: MessagesSquare, label: "Messaggi", path: "/messaggi/email" },
  ];
  if (visiblePaths.has("/tars")) {
    voci.push({ icon: BrainCircuit, label: "Tars", path: "/tars" });
  }

  return (
    <nav
      aria-label="Navigazione principale"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border-soft bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="flex items-stretch">
        {voci.map(v => {
          const attiva = isPathActive(location, v.path);
          return (
            <button
              key={v.path}
              onClick={() => setLocation(v.path)}
              aria-current={attiva ? "page" : undefined}
              className={`relative flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium transition-colors ${
                attiva ? "font-semibold text-text-1" : "text-text-3"
              }`}
            >
              {attiva && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-brand"
                />
              )}
              <v.icon className="h-5 w-5" aria-hidden="true" />
              <span className="max-w-full truncate">{v.label}</span>
            </button>
          );
        })}
        <button
          onClick={toggleSidebar}
          aria-expanded={openMobile}
          aria-label="Apri il menu completo"
          className="flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium text-text-3 transition-colors"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
          <span>Altro</span>
        </button>
      </div>
    </nav>
  );
}
