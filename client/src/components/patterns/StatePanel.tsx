import type { ReactNode } from "react";
import {
  CircleAlert,
  CloudOff,
  Inbox,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const STATE_PANEL_KINDS = [
  "loading",
  "empty",
  "error",
  "permission",
  "unavailable",
  "stale",
] as const;

export type StatePanelKind = (typeof STATE_PANEL_KINDS)[number];

type StatePanelBase = {
  title: string;
  description: string;
  compact?: boolean;
};

export type StatePanelProps =
  | (StatePanelBase & {
      kind: "loading";
      rows?: number;
      action?: never;
    })
  | (StatePanelBase & {
      kind: "empty" | "permission" | "unavailable";
      action?: ReactNode;
    })
  | (StatePanelBase & {
      kind: "error" | "stale";
      action: ReactNode;
    });

const statePresentation = {
  loading: {
    icon: LoaderCircle,
    iconClass: "bg-surface-2 text-text-2",
  },
  empty: {
    icon: Inbox,
    iconClass: "bg-surface-2 text-text-2",
  },
  error: {
    icon: CircleAlert,
    iconClass: "bg-danger-soft text-danger",
  },
  permission: {
    icon: ShieldAlert,
    iconClass: "bg-warning-soft text-warning",
  },
  unavailable: {
    icon: CloudOff,
    iconClass: "bg-info-soft text-info",
  },
  stale: {
    icon: RefreshCw,
    iconClass: "bg-warning-soft text-warning",
  },
} satisfies Record<
  StatePanelKind,
  { icon: typeof CircleAlert; iconClass: string }
>;

/** Stato esplicito, mai usato per mascherare permission o errori come empty. */
export default function StatePanel(props: StatePanelProps) {
  const presentation = statePresentation[props.kind];
  const Icon = presentation.icon;
  const urgent = props.kind === "error" || props.kind === "permission";
  const action = "action" in props ? props.action : undefined;

  return (
    <section
      data-pattern="state-panel"
      data-state={props.kind}
      role={urgent ? "alert" : "status"}
      aria-live={urgent ? "assertive" : "polite"}
      aria-busy={props.kind === "loading" || undefined}
      className={cn(
        "flex min-w-0 flex-col items-start rounded-[var(--radius-panel)] border border-border-soft bg-surface text-text-1",
        props.compact ? "gap-3 p-4" : "gap-4 p-5 sm:p-6"
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-[var(--radius-control)]",
            presentation.iconClass
          )}
        >
          <Icon
            className={cn(
              "size-5",
              props.kind === "loading" && "motion-safe:animate-spin"
            )}
          />
        </span>
        <div className="min-w-0 pt-0.5">
          <h2 className="text-sm font-bold leading-5">{props.title}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-text-2">
            {props.description}
          </p>
        </div>
      </div>

      {props.kind === "loading" ? (
        <div
          aria-hidden="true"
          className="grid w-full gap-2"
          data-loading-silhouette="rows"
        >
          {Array.from({
            length: Math.max(1, Math.min(props.rows ?? 3, 6)),
          }).map((_, index) => (
            <Skeleton key={index} shape="row" className="w-full" />
          ))}
        </div>
      ) : null}

      {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
    </section>
  );
}
