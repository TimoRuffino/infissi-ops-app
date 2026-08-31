import type { ReactNode } from "react";
import { ArrowLeft, Command, Menu } from "lucide-react";

import { Button } from "@/components/ui/button";

export type MobileTopBarProps = {
  title: string;
  backTarget?: string | null;
  onNavigate: (path: string) => void;
  onOpenNavigation: () => void;
  onOpenCommand: () => void;
  notificationTrigger: ReactNode;
  profileTrigger?: ReactNode;
};

export default function MobileTopBar({
  title,
  backTarget,
  onNavigate,
  onOpenNavigation,
  onOpenCommand,
  notificationTrigger,
  profileTrigger,
}: MobileTopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--context-border)] bg-[var(--context-surface)] pt-[env(safe-area-inset-top)] md:hidden">
      <div className="flex min-h-14 min-w-0 items-center gap-1 px-2">
        <Button
          type="button"
          variant="quiet"
          size="icon-lg"
          className="h-11 w-11 shrink-0"
          onClick={() =>
            backTarget ? onNavigate(backTarget) : onOpenNavigation()
          }
          aria-label={
            backTarget ? "Torna alla pagina precedente" : "Apri navigazione"
          }
        >
          {backTarget ? (
            <ArrowLeft aria-hidden="true" />
          ) : (
            <Menu aria-hidden="true" />
          )}
        </Button>

        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-text-3">
            Ruffino Flow
          </p>
          <h1 className="truncate text-[15px] font-semibold leading-5 text-text-1">
            {title}
          </h1>
        </div>

        <Button
          type="button"
          variant="quiet"
          size="icon-lg"
          className="h-11 w-11 shrink-0"
          onClick={onOpenCommand}
          aria-label="Cerca e apri comandi"
        >
          <Command aria-hidden="true" />
        </Button>
        {notificationTrigger}
        {profileTrigger}
      </div>
    </header>
  );
}
