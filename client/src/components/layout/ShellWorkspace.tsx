import type { ReactNode } from "react";

export type ShellWorkspaceProps = {
  navigation: ReactNode;
  contextBar: ReactNode;
  children: ReactNode;
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
}: ShellWorkspaceProps) {
  return (
    <div
      data-modular-control-shell="desktop"
      className="min-h-dvh min-w-0 bg-[var(--shell-workspace)] min-[1200px]:min-h-[calc(100dvh-32px)]"
    >
      <a
        href="#contenuto-principale"
        className="sr-only z-50 rounded-[var(--radius-control)] bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-5 focus:top-5"
      >
        Vai al contenuto principale
      </a>
      <div className="grid min-h-[inherit] min-w-0 grid-cols-1 min-[1200px]:grid-cols-[auto_minmax(0,1fr)]">
        <div className="hidden min-h-0 border-r border-[var(--shell-border)] min-[1200px]:block">
          {navigation}
        </div>
        <div className="flex min-h-0 min-w-0 flex-col bg-[var(--shell-canvas)]">
          {contextBar}
          <main
            id="contenuto-principale"
            className="min-h-0 min-w-0 flex-1 overflow-x-clip px-3 pb-[calc(4.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:pb-[calc(5.25rem+env(safe-area-inset-bottom))] sm:pt-5 md:pb-5 min-[1200px]:px-6 min-[1200px]:py-6"
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
