import { AlertTriangle, CheckCircle2, Clock3, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { EvidenceList } from "./EvidenceList";

const STATUS_LABEL: Record<string, string> = {
  draft: "Pronto",
  running: "In corso",
  waiting_user: "Serve una risposta",
  waiting_approval: "Da approvare",
  waiting_technical: "Da riprendere",
  verifying: "Verifica",
  completed: "Completato",
  partially_completed: "Completato in parte",
  failed: "Non completato",
  canceled: "Annullato",
};

function titleFor(plan: any) {
  return String(plan.intent ?? plan.workflowId)
    .replace(/_/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}

export function PlanProgress({
  plan,
  className,
}: {
  plan: any;
  className?: string;
}) {
  const percent = plan.totalSteps
    ? Math.round((plan.completedSteps / plan.totalSteps) * 100)
    : 0;
  const terminal = ["completed", "partially_completed"].includes(plan.status);
  const blocked = ["failed", "waiting_technical"].includes(plan.status);
  const Icon = terminal
    ? CheckCircle2
    : blocked
      ? AlertTriangle
      : plan.status === "running"
        ? Loader2
        : Clock3;
  return (
    <div
      className={cn("min-w-0 space-y-2 py-3", className)}
      data-plan-id={plan.id}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            terminal
              ? "text-success"
              : blocked
                ? "text-warning"
                : "text-primary",
            plan.status === "running" && "animate-spin"
          )}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold">{titleFor(plan)}</p>
            <span className="text-xs font-medium text-muted-foreground">
              {STATUS_LABEL[plan.status] ?? plan.status}
            </span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
            aria-label={`${percent}% completato`}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">
              {plan.currentStep
                ? plan.currentStep.replace(/-/g, " ")
                : "Verifica conclusa"}
            </span>
            <span className="shrink-0 tabular-nums">
              {plan.completedSteps}/{plan.totalSteps}
            </span>
          </div>
        </div>
      </div>
      <EvidenceList items={plan.evidence ?? []} compact />
    </div>
  );
}
