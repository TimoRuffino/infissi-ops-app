import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const PAGE_HEADER_VARIANTS = [
  "standard",
  "record",
  "workbench",
  "compact",
] as const;

export type PageHeaderVariant = (typeof PAGE_HEADER_VARIANTS)[number];

export type PageHeaderProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: ReactNode;
  metadata?: ReactNode;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
  variant?: PageHeaderVariant;
  sticky?: boolean;
  busy?: boolean;
  warning?: ReactNode;
};

const variantClasses: Record<PageHeaderVariant, string> = {
  standard: "gap-4",
  record:
    "gap-4 rounded-[var(--radius-panel)] border border-border-soft bg-surface px-4 py-4 shadow-[var(--shadow-raised)] sm:px-5",
  workbench: "gap-4 border-b border-border-soft pb-4 sm:pb-5",
  compact: "gap-3",
};

/**
 * Header compositivo per pagine operative. Non legge dati, capability o route:
 * i consumer forniscono copy e controlli gia autorizzati.
 */
export default function PageHeader({
  eyebrow,
  title,
  description,
  breadcrumbs,
  metadata,
  primaryAction,
  secondaryActions,
  variant = "standard",
  sticky = false,
  busy = false,
  warning,
}: PageHeaderProps) {
  const hasActions = Boolean(primaryAction || secondaryActions);

  return (
    <header
      data-pattern="page-header"
      data-variant={variant}
      aria-busy={busy || undefined}
      className={cn(
        "flex min-w-0 flex-col text-text-1",
        variantClasses[variant],
        sticky &&
          "sticky top-0 z-20 -mx-3 border-b border-border-soft bg-[var(--shell-canvas)]/95 px-3 py-3 backdrop-blur-md sm:-mx-5 sm:px-5 min-[1200px]:-mx-6 min-[1200px]:px-6"
      )}
    >
      {breadcrumbs ? (
        <nav aria-label="Percorso" className="min-w-0 text-xs text-text-3">
          {breadcrumbs}
        </nav>
      ) : null}

      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          {eyebrow ? (
            <div className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-accent-text">
              {eyebrow}
            </div>
          ) : null}
          <h1
            className={cn(
              "min-w-0 text-balance font-display font-bold tracking-[-0.025em]",
              variant === "compact"
                ? "text-xl leading-7"
                : "text-2xl leading-8 sm:text-[1.75rem] sm:leading-9"
            )}
          >
            {title}
          </h1>
          {description ? (
            <div className="mt-1.5 max-w-3xl text-sm leading-6 text-text-2">
              {description}
            </div>
          ) : null}
          {metadata ? (
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-3">
              {metadata}
            </div>
          ) : null}
        </div>

        {hasActions ? (
          <div
            aria-label="Azioni pagina"
            className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 sm:justify-end"
          >
            {secondaryActions}
            {primaryAction}
          </div>
        ) : null}
      </div>

      {warning ? (
        <div
          role="status"
          className="rounded-[var(--radius-control)] border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning"
        >
          {warning}
        </div>
      ) : null}
    </header>
  );
}
