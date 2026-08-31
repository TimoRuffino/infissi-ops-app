import type { ReactNode } from "react";
import { ArrowLeft, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export type MobileFieldHeaderProps = {
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  backLabel: string;
  onBack: () => void;
  metadata?: ReactNode;
  status?: ReactNode;
  progress?: {
    value: number;
    label: string;
    detail?: ReactNode;
    complete?: boolean;
  };
  className?: string;
};

/** Header presentazionale per flussi compilati sul campo, leggibile a una mano. */
export default function MobileFieldHeader({
  eyebrow,
  title,
  description,
  backLabel,
  onBack,
  metadata,
  status,
  progress,
  className,
}: MobileFieldHeaderProps) {
  return (
    <header
      data-pattern="mobile-field-header"
      className={cn(
        "min-w-0 space-y-4 rounded-[var(--radius-panel)] border border-border-soft bg-surface p-4 shadow-[var(--shadow-raised)] sm:p-5",
        className
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="-ml-2 min-h-11 max-w-full justify-start px-2 text-text-2 sm:min-h-9"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span className="truncate">{backLabel}</span>
      </Button>

      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-accent-text">
            {eyebrow}
          </p>
          <h1 className="mt-1 text-balance font-display text-2xl font-bold leading-8 tracking-[-0.025em] text-text-1 sm:text-[1.75rem] sm:leading-9">
            {title}
          </h1>
          {description ? (
            <div className="mt-1.5 text-sm leading-6 text-text-2">
              {description}
            </div>
          ) : null}
          {metadata ? (
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-xs text-text-3">
              {metadata}
            </div>
          ) : null}
        </div>
        {status ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {status}
          </div>
        ) : null}
      </div>

      {progress ? (
        <div
          className="rounded-[var(--radius-control)] border border-border-soft bg-surface-2 p-3"
          role="status"
          aria-label={`${progress.label}: ${progress.value}%`}
        >
          <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-1">
                {progress.label}
              </p>
              {progress.detail ? (
                <div className="mt-0.5 text-xs leading-5 text-text-3">
                  {progress.detail}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5 tabular-nums text-sm font-bold text-text-1">
              {progress.value}%
              {progress.complete ? (
                <CheckCircle2
                  aria-hidden="true"
                  className="h-4 w-4 text-success"
                />
              ) : null}
            </div>
          </div>
          <Progress value={progress.value} className="h-2" />
        </div>
      ) : null}
    </header>
  );
}
