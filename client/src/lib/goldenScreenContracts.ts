export type DashboardModule =
  | "priorita"
  | "agenda"
  | "commesse"
  | "ticket"
  | "economia"
  | "tars";

export type KanbanPresentation = "desktop-board" | "mobile-phase-list";

export const KANBAN_COLUMN_STATES = [
  "preventivo",
  "misure_esecutive",
  "aggiornamento_contratto",
  "fatture_pagamento",
  "da_ordinare",
  "produzione",
  "ordini_ultimazione",
  "attesa_posa",
  "finiture_saldo",
  "interventi_regolazioni",
] as const;

export type KanbanColumnState = (typeof KANBAN_COLUMN_STATES)[number];

export type TarsAvailability =
  | { kind: "disabled" }
  | { kind: "loading" }
  | { kind: "available"; provider: string }
  | { kind: "unavailable"; reason: string | null };

export type TarsAvailabilityInput = {
  enabled: boolean;
  pending: boolean;
  provider: string | null;
  unavailableReason: string | null;
};

const MOBILE_SECTION_PRIORITY: Readonly<Record<string, number>> = {
  identita: 0,
  stato: 1,
  azioni: 2,
  timeline: 10,
  documenti: 11,
  operativita: 12,
  economia: 20,
  comunicazioni: 21,
  tars: 22,
  dettagli: 23,
};

export function selectDashboardModules(
  capabilities: ReadonlySet<string>
): DashboardModule[] {
  const modules: DashboardModule[] = ["priorita", "agenda"];

  if (capabilities.has("commessa.read")) modules.push("commesse");
  modules.push("ticket");
  if (capabilities.has("economia.read")) modules.push("economia");
  if (capabilities.has("tars.use")) modules.push("tars");

  return modules;
}

export function kanbanPresentation(width: number): KanbanPresentation {
  return width >= 1200 ? "desktop-board" : "mobile-phase-list";
}

export function classifyTarsAvailability(
  input: TarsAvailabilityInput
): TarsAvailability {
  if (!input.enabled) return { kind: "disabled" };
  if (input.pending) return { kind: "loading" };
  if (input.unavailableReason) {
    return { kind: "unavailable", reason: input.unavailableReason };
  }
  if (!input.provider) return { kind: "unavailable", reason: null };
  return { kind: "available", provider: input.provider };
}

export function mobilePrioritySections<T extends string>(
  sections: readonly T[]
): T[] {
  return sections
    .map((section, index) => ({ section, index }))
    .sort((left, right) => {
      const leftPriority =
        MOBILE_SECTION_PRIORITY[left.section] ?? Number.MAX_SAFE_INTEGER;
      const rightPriority =
        MOBILE_SECTION_PRIORITY[right.section] ?? Number.MAX_SAFE_INTEGER;
      return leftPriority - rightPriority || left.index - right.index;
    })
    .map(({ section }) => section);
}
