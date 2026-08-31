import { Loader2 } from "lucide-react";

import type { OperationalStatus } from "@/contexts/OperationalContext";
import { Skeleton } from "./ui/skeleton";

export function ContextTransitionScreen({
  status,
  error,
}: {
  status: OperationalStatus;
  error?: Error | null;
}) {
  if (error) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background p-4">
        <section
          className="w-full max-w-md rounded-[var(--radius-panel)] border border-border-soft bg-surface p-6 text-center shadow-sm"
          role="alert"
        >
          <h1 className="text-lg font-semibold text-text-1">
            Contesto operativo non disponibile
          </h1>
          <p className="mt-2 text-sm text-text-2">
            Non mostriamo dati finché sede e permessi non sono stati verificati.
          </p>
          <button
            type="button"
            className="mt-5 h-10 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-semibold text-primary-foreground focus-visible:ring-[3px] focus-visible:ring-ring/45"
            onClick={() => window.location.reload()}
          >
            Riprova
          </button>
        </section>
      </div>
    );
  }

  return (
    <div
      className="grid min-h-dvh place-items-center bg-background p-4"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 rounded-[var(--radius-panel)] border border-border-soft bg-surface px-5 py-4 text-sm font-medium text-text-1 shadow-xs">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        {status === "switching"
          ? "Verifica della nuova sede…"
          : "Preparazione del contesto operativo…"}
      </div>
    </div>
  );
}

export function DashboardLayoutSkeleton({
  modularControl = false,
}: {
  modularControl?: boolean;
}) {
  if (modularControl) {
    return (
      <div
        className="min-h-dvh bg-[var(--shell-workspace)] min-[1200px]:min-h-[calc(100dvh-32px)]"
        role="status"
        aria-label="Preparazione interfaccia"
      >
        <div className="grid min-h-[inherit] grid-cols-1 min-[1200px]:grid-cols-[240px_minmax(0,1fr)]">
          <div className="hidden border-r border-border-soft bg-sidebar p-3 min-[1200px]:block">
            <div className="flex h-12 items-center gap-3 px-2">
              <Skeleton className="h-8 w-8 rounded-[var(--radius-control)]" />
              <Skeleton className="h-4 w-28" />
            </div>
            <Skeleton className="mt-4 h-14 w-full rounded-[var(--radius-control)]" />
            <div className="mt-6 space-y-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-10 w-full rounded-[var(--radius-control)]" />
              <Skeleton className="h-10 w-full rounded-[var(--radius-control)]" />
              <Skeleton className="h-10 w-full rounded-[var(--radius-control)]" />
            </div>
          </div>

          <div className="min-w-0 bg-[var(--shell-canvas)]">
            <div className="flex h-[72px] items-center gap-3 border-b border-border-soft bg-surface px-4 min-[1200px]:px-5">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="ml-auto hidden h-10 w-48 rounded-[var(--radius-control)] md:block" />
              <Skeleton className="h-10 w-10 rounded-[var(--radius-control)]" />
              <Skeleton className="h-10 w-28 rounded-[var(--radius-control)]" />
            </div>
            <div className="space-y-4 p-4 sm:p-5 min-[1200px]:p-6">
              <Skeleton className="h-8 w-56 rounded-[var(--radius-control)]" />
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Skeleton className="h-28 rounded-[var(--radius-panel)]" />
                <Skeleton className="h-28 rounded-[var(--radius-panel)]" />
                <Skeleton className="h-28 rounded-[var(--radius-panel)]" />
              </div>
              <Skeleton className="h-64 rounded-[var(--radius-panel)]" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <div className="hidden w-[280px] space-y-6 border-r border-border-soft bg-surface p-4 md:block">
        <div className="flex items-center gap-3 px-2">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="space-y-2 px-2">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      </div>

      <div className="flex-1 space-y-4 p-4 sm:p-5 lg:p-6">
        <Skeleton className="h-12 w-48 rounded-lg" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}
