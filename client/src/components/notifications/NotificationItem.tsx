import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  BriefcaseBusiness,
  Check,
  CheckCheck,
  CircleAlert,
  UserRoundCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export type NotificationItemData = {
  id: string;
  canonicalKey: string;
  type: string;
  priority: "critical" | "high" | "normal" | "low";
  title: string;
  body: string;
  link: string;
  groupKey: string | null;
  status: "unread" | "seen" | "read" | "acted" | "resolved" | "expired";
  createdAt: Date | string;
  entityRefs: Array<{ type: string; id: string }>;
  legacy: boolean;
};

const priorityMeta = {
  critical: { label: "Critica", icon: CircleAlert, tone: "text-danger bg-danger-soft" },
  high: { label: "Alta", icon: AlertTriangle, tone: "text-warning bg-warning-soft" },
  normal: { label: "Normale", icon: Bell, tone: "text-info bg-info-soft" },
  low: { label: "Bassa", icon: Check, tone: "text-success bg-success-soft" },
} as const;

const typeIcons: Record<string, typeof Bell> = {
  assignment: UserRoundCheck,
  ticket: BriefcaseBusiness,
};

export function NotificationItem({
  item,
  compact = false,
  onOpen,
  onRead,
  onResolve,
}: {
  item: NotificationItemData;
  compact?: boolean;
  onOpen: () => void;
  onRead?: () => void;
  onResolve?: () => void;
}) {
  const priority = priorityMeta[item.priority];
  const Icon = typeIcons[item.type] ?? priority.icon;
  const unread = item.status === "unread" || item.status === "seen";
  const date = new Date(item.createdAt);

  return (
    <article className={`notification-row-enter group border-b last:border-b-0 ${unread ? "bg-primary/[0.035]" : "bg-card"}`}>
      <div className={`flex min-w-0 items-start gap-3 ${compact ? "px-3 py-3" : "px-4 py-4"}`}>
        <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg ${priority.tone}`} aria-hidden="true">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <button className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onOpen}>
              <span className="block truncate text-sm font-semibold text-foreground">{item.title}</span>
              <span className={`mt-1 block text-xs leading-5 text-muted-foreground ${compact ? "line-clamp-2" : "line-clamp-3"}`}>{item.body}</span>
            </button>
            {unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Da leggere" />}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[11px] font-medium text-muted-foreground">{priority.label}</span>
            <time className="text-[11px] text-muted-foreground" dateTime={date.toISOString()}>
              {date.toLocaleDateString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            </time>
            {!compact && (
              <div className="ml-auto flex items-center gap-1">
                {unread && onRead && (
                  <Button variant="ghost" size="sm" onClick={onRead}>
                    <Check className="h-4 w-4" /> Letta
                  </Button>
                )}
                {onResolve && item.status !== "resolved" && (
                  <Button variant="ghost" size="sm" onClick={onResolve}>
                    <CheckCheck className="h-4 w-4" /> Risolvi
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={onOpen}>
                  Apri <ArrowUpRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
