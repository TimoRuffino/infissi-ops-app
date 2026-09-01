import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type ShellWorkspaceProps = {
  navigation: ReactNode;
  contextBar: ReactNode;
  children: ReactNode;
  /** La route occupa esattamente l'area di lavoro invece di allungarla. */
  fillsWorkspace?: boolean;
};

/**
 * Geometry-only owner for Modular Control. The browser root supplies the cold
 * outer chrome; this component keeps navigation and route content inside one
 * clipped, min-width-safe operational workspace.
 */
export default function ShellWorkspace({
  navigation,
  contextBar,
  children,
  fillsWorkspace = false,
}: ShellWorkspaceProps) {
  return (
    <div
      data-modular-control-shell="desktop"
      className="min-h-dvh min-w-0 bg-[var(--shell-workspace)] min-[1200px]:h-full min-[1200px]:min-h-0 min-[1200px]:overflow-hidden"
    >
      <a
        href="#contenuto-principale"
        className="sr-only z-50 rounded-[var(--radius-control)] bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-5 focus:top-5"
      >
        Vai al contenuto principale
      </a>
      <div className="grid min-h-[inherit] min-w-0 grid-cols-1 min-[1200px]:h-full min-[1200px]:min-h-0 min-[1200px]:grid-cols-[auto_minmax(0,1fr)]">
        <div className="hidden min-h-0 border-r border-[var(--shell-border)] min-[1200px]:block min-[1200px]:h-full">
          {navigation}
        </div>
        <div className="flex min-h-0 min-w-0 flex-col bg-[var(--shell-canvas)] min-[1200px]:h-full">
          {contextBar}
          {/* Il padding verticale desktop vive nel contenuto, non nel main:
              così una toolbar `sticky top-0` aderisce al bordo reale dell'area
              scorrevole e nessuna riga resta visibile sopra di essa. */}
          <main
            id="contenuto-principale"
            className="min-h-0 min-w-0 flex-1 overflow-x-clip px-3 sm:px-5 min-[1200px]:overflow-y-auto min-[1200px]:px-6"
          >
            <div
              className={cn(
                "flex min-h-0 min-w-0 flex-col pb-[calc(4.75rem+env(safe-area-inset-bottom))] pt-3 sm:pb-[calc(5.25rem+env(safe-area-inset-bottom))] sm:pt-5 md:pb-5 min-[1200px]:py-6",
                // Altezza definita solo dove serve: cosi `flex-1` distribuisce
                // lo spazio disponibile e i riquadri scorrono al proprio
                // interno. Le altre route restano libere di allungarsi.
                fillsWorkspace
                  ? "min-[1200px]:h-full"
                  : "min-[1200px]:min-h-full"
              )}
            >
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
