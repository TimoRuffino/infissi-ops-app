import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const STICKY_ACTION_BAR_PLACEMENTS = ["responsive", "sticky"] as const;

export type StickyActionBarPlacement =
  (typeof STICKY_ACTION_BAR_PLACEMENTS)[number];

export type StickyActionBarProps = {
  status?: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  destructive?: ReactNode;
  placement?: StickyActionBarPlacement;
  busy?: boolean;
  dirty?: boolean;
};

/** Barra in flusso: rende persistenti azioni gia autorizzate, non salva da sola. */
export default function StickyActionBar({
  status,
  primary,
  secondary,
  destructive,
  placement = "responsive",
  busy = false,
  dirty = false,
}: StickyActionBarProps) {
  return (
    <div
      data-pattern="sticky-action-bar"
      data-placement={placement}
      data-dirty={dirty || undefined}
      role="toolbar"
      aria-label="Azioni pagina"
      aria-busy={busy || undefined}
      className={cn(
        "z-30 flex min-w-0 flex-col gap-3 rounded-[var(--radius-panel)] border border-border-soft bg-surface-raised/95 p-3 shadow-[var(--shadow-floating)] backdrop-blur-md sm:flex-row sm:items-center",
        placement === "responsive" &&
          "sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] md:bottom-3 min-[1200px]:static min-[1200px]:rounded-none min-[1200px]:border-x-0 min-[1200px]:border-b-0 min-[1200px]:bg-transparent min-[1200px]:px-0 min-[1200px]:pb-0 min-[1200px]:shadow-none min-[1200px]:backdrop-blur-none",
        placement === "sticky" &&
          "sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] md:bottom-3"
      )}
    >
      {status ? (
        <div
          aria-live="polite"
          className="min-w-0 flex-1 text-xs leading-5 text-text-2"
        >
          {status}
        </div>
      ) : (
        <span className="hidden flex-1 sm:block" aria-hidden="true" />
      )}

      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {destructive ? (
          <div className="mr-auto sm:mr-0">{destructive}</div>
        ) : null}
        {secondary}
        {primary}
      </div>
    </div>
  );
}
