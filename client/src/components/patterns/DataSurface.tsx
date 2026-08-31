import { useId, type ElementType, type ReactNode } from "react";

import StatePanel, {
  type StatePanelProps,
} from "@/components/patterns/StatePanel";
import { cn } from "@/lib/utils";

export const DATA_SURFACE_DENSITIES = ["comfortable", "compact"] as const;
export const DATA_SURFACE_TONES = ["default", "sunken", "focal"] as const;

export type DataSurfaceDensity = (typeof DATA_SURFACE_DENSITIES)[number];
export type DataSurfaceTone = (typeof DATA_SURFACE_TONES)[number];

export type DataSurfaceProps = {
  density: DataSurfaceDensity;
  tone: DataSurfaceTone;
  as?: ElementType;
  title?: ReactNode;
  description?: ReactNode;
  toolbar?: ReactNode;
  footer?: ReactNode;
  state?: StatePanelProps;
  children?: ReactNode;
  id?: string;
};

const toneClasses: Record<DataSurfaceTone, string> = {
  default:
    "border-border-soft bg-surface text-text-1 shadow-[var(--shadow-raised)]",
  sunken: "border-transparent bg-surface-2 text-text-1",
  focal:
    "border-transparent bg-focal [background-image:var(--gradient-focal)] text-on-focal shadow-[var(--shadow-floating)]",
};

const densityClasses: Record<DataSurfaceDensity, string> = {
  comfortable: "gap-4 p-4 sm:p-5",
  compact: "gap-3 p-3 sm:p-4",
};

/**
 * Superficie finita per gruppi di dati. `focal` e l'unico consumer condiviso
 * del gradiente approvato e va usato una sola volta nel viewport.
 */
export default function DataSurface({
  density,
  tone,
  as: Component = "section",
  title,
  description,
  toolbar,
  footer,
  state,
  children,
  id,
}: DataSurfaceProps) {
  const generatedId = useId();
  const titleId = title ? `${id ?? generatedId}-title` : undefined;

  return (
    <Component
      id={id}
      data-pattern="data-surface"
      data-density={density}
      data-tone={tone}
      aria-labelledby={titleId}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-panel)] border",
        densityClasses[density],
        toneClasses[tone]
      )}
    >
      {title || description || toolbar ? (
        <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            {title ? (
              <h2 id={titleId} className="text-base font-bold leading-6">
                {title}
              </h2>
            ) : null}
            {description ? (
              <div
                className={cn(
                  "mt-1 text-sm leading-5",
                  tone === "focal" ? "text-on-focal/75" : "text-text-2"
                )}
              >
                {description}
              </div>
            ) : null}
          </div>
          {toolbar ? (
            <div
              aria-label="Strumenti sezione"
              className="flex shrink-0 flex-wrap items-center gap-2"
            >
              {toolbar}
            </div>
          ) : null}
        </header>
      ) : null}

      {state ? (
        <StatePanel {...state} compact={density === "compact"} />
      ) : (
        children
      )}

      {footer ? (
        <footer
          className={cn(
            "border-t pt-3 text-sm",
            tone === "focal"
              ? "border-on-focal/20 text-on-focal/75"
              : "border-border-soft text-text-2"
          )}
        >
          {footer}
        </footer>
      ) : null}
    </Component>
  );
}
