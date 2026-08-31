import {
  isPathActive,
  mobileDestinations,
  type NavigationAccess,
} from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

export type BottomNavProps = {
  access: NavigationAccess;
  currentPath: string;
  drawerOpen: boolean;
  onOpenDrawer: () => void;
};

/**
 * Mobile-only, capability-aware dock. The first four positions are derived
 * from the shared navigation model; the final `Altro` control always opens
 * the complete accessible navigation.
 */
export default function BottomNav({
  access,
  currentPath,
  drawerOpen,
  onOpenDrawer,
}: BottomNavProps) {
  const [, setLocation] = useLocation();
  const destinations = mobileDestinations(access);

  return (
    <nav
      aria-label="Navigazione rapida"
      data-mobile-bottom-nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border-soft bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_28px_color-mix(in_srgb,var(--shell-chrome)_18%,transparent)] backdrop-blur-md md:hidden"
    >
      <div className="mx-auto flex min-h-14 max-w-lg items-stretch px-1">
        {destinations.map(destination => {
          if (destination.kind === "drawer") {
            return (
              <button
                key={destination.kind}
                type="button"
                onClick={onOpenDrawer}
                aria-expanded={drawerOpen}
                aria-label="Apri tutta la navigazione"
                className="flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-control)] px-1 py-1.5 text-[10px] font-semibold text-text-3 transition-colors active:bg-surface-2 focus-visible:ring-[var(--focus-width)] focus-visible:ring-[var(--focus-color)]"
              >
                <destination.icon className="h-5 w-5" aria-hidden="true" />
                <span className="max-w-full truncate">{destination.label}</span>
              </button>
            );
          }

          const active = isPathActive(currentPath, destination.path);
          return (
            <button
              key={destination.path}
              type="button"
              onClick={() => setLocation(destination.path)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-control)] px-1 py-1.5 text-[10px] font-semibold transition-colors active:bg-surface-2 focus-visible:ring-[var(--focus-width)] focus-visible:ring-[var(--focus-color)]",
                active ? "text-accent-text" : "text-text-3"
              )}
            >
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-[22%] top-0 h-0.5 rounded-full bg-primary"
                />
              ) : null}
              <span
                className={cn(
                  "grid h-7 w-9 place-items-center rounded-full",
                  active && "bg-brand-soft"
                )}
              >
                <destination.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="max-w-full truncate">{destination.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
