import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export const CONTEXT_INSPECTOR_DESKTOP_MODES = ["inline", "overlay"] as const;
export const CONTEXT_INSPECTOR_WIDTHS = ["narrow", "standard", "wide"] as const;

export type ContextInspectorDesktopMode =
  (typeof CONTEXT_INSPECTOR_DESKTOP_MODES)[number];
export type ContextInspectorWidth = (typeof CONTEXT_INSPECTOR_WIDTHS)[number];

export type ContextInspectorProps = {
  title: string;
  description?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  desktopMode: ContextInspectorDesktopMode;
  width?: ContextInspectorWidth;
  actions?: ReactNode;
  children: ReactNode;
};

type ViewportRegime = "mobile" | "compact" | "desktop";

function currentViewportRegime(): ViewportRegime {
  if (typeof window === "undefined") return "compact";
  if (window.innerWidth < 768) return "mobile";
  if (window.innerWidth < 1200) return "compact";
  return "desktop";
}

function useViewportRegime() {
  const [regime, setRegime] = useState<ViewportRegime>(currentViewportRegime);

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 767px)");
    const desktop = window.matchMedia("(min-width: 1200px)");
    const update = () => setRegime(currentViewportRegime());
    mobile.addEventListener("change", update);
    desktop.addEventListener("change", update);
    update();
    return () => {
      mobile.removeEventListener("change", update);
      desktop.removeEventListener("change", update);
    };
  }, []);

  return regime;
}

const inlineWidthClasses: Record<ContextInspectorWidth, string> = {
  narrow: "w-72",
  standard: "w-80",
  wide: "w-[26rem]",
};

const overlayWidthClasses: Record<ContextInspectorWidth, string> = {
  narrow: "sm:w-80 sm:max-w-80",
  standard: "sm:w-96 sm:max-w-96",
  wide: "sm:w-[32rem] sm:max-w-[32rem]",
};

/** Inspector responsive senza storage, fetch o memoria cross-sede. */
export default function ContextInspector({
  title,
  description,
  open,
  onOpenChange,
  desktopMode,
  width = "standard",
  actions,
  children,
}: ContextInspectorProps) {
  const regime = useViewportRegime();
  const desktop = regime === "desktop";
  const mobile = regime === "mobile";

  if (desktop && desktopMode === "inline") {
    if (!open) return null;
    return (
      <aside
        data-pattern="context-inspector"
        data-mode="inline"
        aria-label={title}
        className={cn(
          "flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden rounded-[var(--radius-panel)] border border-[var(--inspector-border)] bg-[var(--inspector-surface)] shadow-[var(--shadow-raised)]",
          inlineWidthClasses[width]
        )}
      >
        <header className="flex min-w-0 items-start justify-between gap-3 border-b border-border-soft p-4">
          <div className="min-w-0">
            <h2 className="text-sm font-bold leading-5">{title}</h2>
            {description ? (
              <p className="mt-1 text-xs leading-5 text-text-2">
                {description}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="quiet"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Chiudi
          </Button>
        </header>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
          {children}
        </div>
        {actions ? (
          <footer className="flex flex-wrap justify-end gap-2 border-t border-border-soft p-4">
            {actions}
          </footer>
        ) : null}
      </aside>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={mobile ? "bottom" : "right"}
        data-pattern="context-inspector"
        data-mode="overlay"
        className={cn(
          overlayWidthClasses[width],
          mobile && "max-h-[92dvh] pb-[env(safe-area-inset-bottom)]"
        )}
      >
        <SheetHeader className="border-b border-border-soft pr-14">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className={description ? undefined : "sr-only"}>
            {description ?? "Dettagli contestuali della selezione corrente."}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-4">
          {children}
        </div>
        {actions ? (
          <SheetFooter className="border-t border-border-soft">
            <div className="flex flex-wrap justify-end gap-2">{actions}</div>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
