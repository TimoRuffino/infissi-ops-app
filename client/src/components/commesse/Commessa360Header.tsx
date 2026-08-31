import type { ElementType, ReactNode } from "react";
import { ArrowLeft, Archive } from "lucide-react";

import StatoChip from "@/components/StatoChip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PRIORITA_LABEL, PRIORITA_VARIANT } from "@/lib/stato";

export type Commessa360HeaderMeta = {
  icon: ElementType<{ className?: string }>;
  label: string;
};

export type Commessa360HeaderProps = {
  codice: string;
  cliente: string;
  stato: string;
  priorita?: string;
  meta: Commessa360HeaderMeta[];
  primaryAction: ReactNode | null;
  secondaryActions?: ReactNode;
  onBack: () => void;
  archived?: boolean;
  archivedNotice?: ReactNode;
  statusRail?: ReactNode;
  contactActions?: ReactNode;
  note?: ReactNode;
  alerts?: ReactNode;
};

/**
 * Testata presentazionale del fascicolo commessa. Stato, azioni e metadati
 * arrivano dal page owner gia filtrati e autorizzati.
 */
export default function Commessa360Header({
  codice,
  cliente,
  stato,
  priorita,
  meta,
  primaryAction,
  secondaryActions,
  onBack,
  archived = false,
  archivedNotice,
  statusRail,
  contactActions,
  note,
  alerts,
}: Commessa360HeaderProps) {
  const prioritaInEvidenza = priorita === "urgente" || priorita === "alta";

  return (
    <header
      data-page-region="commessa-identita"
      className="min-w-0 space-y-3 sm:space-y-4"
    >
      <nav aria-label="Percorso commessa">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="-ml-2 text-text-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Commesse
        </Button>
      </nav>

      {archivedNotice}

      <div className="min-w-0 rounded-[var(--radius-panel)] border border-border-soft bg-surface p-4 shadow-[var(--shadow-raised)] sm:p-5">
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-2">
              <span className="codice-mono text-text-2">{codice}</span>
              <StatoChip stato={stato} />
              {prioritaInEvidenza ? (
                <Badge
                  variant={
                    PRIORITA_VARIANT[
                      priorita as keyof typeof PRIORITA_VARIANT
                    ] ?? "secondary"
                  }
                >
                  {PRIORITA_LABEL[priorita as keyof typeof PRIORITA_LABEL] ??
                    priorita}
                </Badge>
              ) : null}
              {archived ? (
                <Badge variant="secondary" className="gap-1">
                  <Archive className="h-3 w-3" />
                  Archiviata
                </Badge>
              ) : null}
            </div>

            <h1 className="min-w-0 text-balance font-display text-2xl font-bold leading-8 tracking-[-0.025em] text-text-1 sm:text-[1.75rem] sm:leading-9">
              {cliente}
            </h1>

            {meta.length > 0 ? (
              <ul className="mt-3 flex min-w-0 flex-wrap gap-x-4 gap-y-2 text-sm text-text-2">
                {meta.map((item, index) => (
                  <li
                    key={`${item.label}-${index}`}
                    className="flex min-w-0 items-center gap-1.5"
                  >
                    <item.icon className="h-3.5 w-3.5 shrink-0 text-text-3" />
                    <span className="min-w-0 break-words">{item.label}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {contactActions ? (
              <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
                {contactActions}
              </div>
            ) : null}
          </div>

          {primaryAction || secondaryActions ? (
            <div
              aria-label="Azioni commessa"
              className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 sm:max-w-[28rem] sm:justify-end"
            >
              {secondaryActions}
              {primaryAction ? (
                <div className="max-sm:order-first max-sm:w-full max-sm:[&>button]:w-full">
                  {primaryAction}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {statusRail ? (
          <div data-page-region="commessa-stato" className="mt-4">
            {statusRail}
          </div>
        ) : null}

        {note ? (
          <div className="mt-3 border-l-2 border-border-strong pl-3 text-sm text-text-2">
            {note}
          </div>
        ) : null}
      </div>

      {alerts ? (
        <div data-page-region="commessa-azioni" className="space-y-3">
          {alerts}
        </div>
      ) : null}
    </header>
  );
}
