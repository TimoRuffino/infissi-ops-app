import type { ReactNode } from "react";

import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import type { DashboardModule } from "@/lib/goldenScreenContracts";

export type CapabilityDashboardSections = Partial<
  Record<DashboardModule, ReactNode>
>;

export type CapabilityDashboardProps = {
  title: ReactNode;
  description: ReactNode;
  scopeLabel: ReactNode;
  modules: readonly DashboardModule[];
  sections: CapabilityDashboardSections;
  details?: ReactNode;
};

function ModuleSlot({
  name,
  sections,
}: {
  name: DashboardModule;
  sections: CapabilityDashboardSections;
}) {
  const content = sections[name];
  if (content == null) return null;

  if (name === "tars") {
    return (
      <DataSurface
        id="dashboard-tars"
        density="compact"
        tone="focal"
        title="Tars · situazione"
        description="Briefing deterministico, senza chiamate al modello."
      >
        <div
          data-dashboard-module={name}
          className="min-w-0 [&>p]:text-on-focal/80"
        >
          {content}
        </div>
      </DataSurface>
    );
  }

  return (
    <div data-dashboard-module={name} className="min-w-0">
      {content}
    </div>
  );
}

/**
 * Composizione visuale della Dashboard. Riceve soltanto moduli gia
 * autorizzati e contenuto preparato dal page owner: non legge contesto o dati.
 */
export default function CapabilityDashboard({
  title,
  description,
  scopeLabel,
  modules,
  sections,
  details,
}: CapabilityDashboardProps) {
  const enabled = new Set(modules);
  const visibleSections = Object.fromEntries(
    Object.entries(sections).filter(([name]) =>
      enabled.has(name as DashboardModule)
    )
  ) as CapabilityDashboardSections;

  return (
    <div className="space-y-5 sm:space-y-6" data-page="capability-dashboard">
      <PageHeader
        eyebrow="Cruscotto operativo"
        title={title}
        description={description}
        metadata={
          <span className="inline-flex items-center rounded-full border border-border-soft bg-surface-2 px-2.5 py-1 font-semibold text-text-2">
            {scopeLabel}
          </span>
        }
      />

      <div className="grid min-w-0 items-start gap-4 sm:gap-5 min-[1200px]:grid-cols-12">
        <section
          aria-label="Priorità e agenda"
          className="min-w-0 space-y-4 sm:space-y-5 min-[1200px]:col-span-8"
        >
          <ModuleSlot name="priorita" sections={visibleSections} />
          <ModuleSlot name="agenda" sections={visibleSections} />
        </section>

        <aside
          aria-label="Situazione operativa"
          className="min-w-0 space-y-4 sm:space-y-5 min-[1200px]:col-span-4"
        >
          <ModuleSlot name="tars" sections={visibleSections} />
          <ModuleSlot name="commesse" sections={visibleSections} />
          <ModuleSlot name="ticket" sections={visibleSections} />
          <ModuleSlot name="economia" sections={visibleSections} />
        </aside>
      </div>

      {details ? <div className="min-w-0 space-y-5">{details}</div> : null}
    </div>
  );
}
