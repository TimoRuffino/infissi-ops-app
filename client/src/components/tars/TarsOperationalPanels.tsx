import type { ReactNode } from "react";
import { BrainCircuit, CloudOff, ShieldCheck } from "lucide-react";

import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import StatePanel from "@/components/patterns/StatePanel";
import { Badge } from "@/components/ui/badge";
import type { TarsAvailability } from "@/lib/goldenScreenContracts";

export type TarsOperationalPanelsProps = {
  availability: TarsAvailability;
  briefing: ReactNode;
  status: ReactNode;
  turns: ReactNode;
  actions: ReactNode;
  composer: ReactNode;
  historyToolbar?: ReactNode;
  costs?: ReactNode;
};

function AvailabilityMeta({
  availability,
}: {
  availability: TarsAvailability;
}) {
  if (availability.kind === "available") {
    return (
      <Badge
        variant="outline"
        className="border-success/30 bg-success-soft text-success"
      >
        <ShieldCheck className="h-3 w-3" />
        Provider: {availability.provider}
      </Badge>
    );
  }
  if (availability.kind === "unavailable") {
    return (
      <Badge
        variant="outline"
        className="border-warning/30 bg-warning-soft text-warning"
      >
        <CloudOff className="h-3 w-3" />
        Provider non disponibile
      </Badge>
    );
  }
  return null;
}

function AvailabilityState({
  availability,
}: {
  availability: TarsAvailability;
}) {
  if (availability.kind === "disabled") {
    return (
      <StatePanel
        kind="unavailable"
        title="Tars è disattivato"
        description="Il kill switch è attivo. Il CRM continua a funzionare normalmente e nessuna richiesta Tars viene avviata."
      />
    );
  }
  if (availability.kind === "loading") {
    return (
      <StatePanel
        kind="loading"
        title="Verifico la disponibilità di Tars"
        description="Sto leggendo flag e stato operativo senza inviare richieste al modello."
        rows={2}
      />
    );
  }
  if (availability.kind === "unavailable") {
    return (
      <StatePanel
        kind="unavailable"
        title="Provider Tars non disponibile"
        description={
          availability.reason ??
          "Il CRM resta operativo. Puoi consultare briefing e cronologia e riprovare più tardi."
        }
      />
    );
  }
  return null;
}

/**
 * Cabina operativa presentazionale. Riceve query state, turni e azioni gia
 * preparati dal page owner e non esegue lavoro applicativo autonomamente.
 */
export default function TarsOperationalPanels({
  availability,
  briefing,
  status,
  turns,
  actions,
  composer,
  historyToolbar,
  costs,
}: TarsOperationalPanelsProps) {
  const terminal = availability.kind !== "available";

  return (
    <div
      data-page="tars-operational"
      data-availability={availability.kind}
      className="min-w-0 space-y-4 sm:space-y-5"
    >
      <PageHeader
        variant="workbench"
        eyebrow="Intelligenza operativa"
        title={
          <span className="inline-flex items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand text-on-brand">
              <BrainCircuit className="h-5 w-5" />
            </span>
            Tars
          </span>
        }
        description="Legge i dati del CRM, dichiara fonti e omissioni e lascia ogni proposta materiale in attesa di approvazione umana."
        metadata={<AvailabilityMeta availability={availability} />}
      />

      <AvailabilityState availability={availability} />

      {!terminal ? (
        <>
          <DataSurface
            id="tars-briefing"
            density="compact"
            tone="focal"
            title="Situazione operativa"
            description="Briefing deterministico: non consuma token e non avvia il modello."
          >
            <div className="min-w-0 text-on-focal [&_.text-text-1]:!text-on-focal [&_.text-text-2]:!text-on-focal/85 [&_.text-text-3]:!text-on-focal/70 [&>div]:!border-on-focal/20 [&>div]:!bg-transparent">
              {briefing || (
                <p className="text-sm text-on-focal/75">
                  Nessun elemento operativo da mettere in evidenza.
                </p>
              )}
            </div>
          </DataSurface>

          <div className="grid min-w-0 items-start gap-4 sm:gap-5 min-[1200px]:grid-cols-12">
            <div className="order-last min-w-0 space-y-4 sm:space-y-5 min-[1200px]:order-first min-[1200px]:col-span-8">
              {actions ? (
                <DataSurface
                  id="tars-actions"
                  density="compact"
                  tone="default"
                  title="Evidenze, omissioni e azioni"
                  description="Gli effetti proposti restano inerti finché una persona autorizzata non li approva."
                >
                  {actions}
                </DataSurface>
              ) : null}

              <DataSurface
                id="tars-history"
                density="compact"
                tone="default"
                title="Cronologia operativa"
                description="Testo dei turni e stato degradato così come restituiti dal server."
                toolbar={historyToolbar}
              >
                {turns}
              </DataSurface>

              {composer ? (
                <section
                  aria-label="Componi richiesta Tars"
                  className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 rounded-[var(--radius-panel)] border border-border-soft bg-surface/95 p-3 shadow-[var(--shadow-floating)] backdrop-blur-md min-[768px]:bottom-4"
                >
                  {composer}
                </section>
              ) : null}
            </div>

            <aside
              aria-label="Stato di Tars"
              className="order-first min-w-0 space-y-4 sm:space-y-5 min-[1200px]:order-last min-[1200px]:sticky min-[1200px]:top-5 min-[1200px]:col-span-4"
            >
              {status}
              {costs}
            </aside>
          </div>
        </>
      ) : null}
    </div>
  );
}
