import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ArrowUpRight,
  Bot,
  CalendarClock,
  Check,
  CircleAlert,
  Clock3,
  Loader2,
  MoreHorizontal,
  Pause,
  Sparkles,
  UserCheck,
  Users,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

const activeStatuses = ["da_valutare", "in_carico", "rinviata", "in_attesa"] as const;

const priorityStyle: Record<string, string> = {
  critica: "border-l-danger bg-danger-soft/35",
  alta: "border-l-warning bg-warning-soft/25",
  normale: "border-l-info bg-card",
};

const priorityLabel: Record<string, string> = {
  critica: "Critica",
  alta: "Alta",
  normale: "Normale",
};

const statusLabel: Record<string, string> = {
  da_valutare: "Da valutare",
  in_carico: "In carico",
  rinviata: "Rinviata",
  in_attesa: "In attesa",
  risolta: "Risolta",
};

function dateLabel(value: Date | string | null): string {
  if (!value) return "Senza scadenza";
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Oggi";
  return date.toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
}

function ActionRow({
  item,
  assigneeName,
  onWait,
}: {
  item: any;
  assigneeName: string | null;
  onWait: (item: any) => void;
}) {
  const utils = trpc.useUtils();
  const refresh = () => {
    utils.notifiche.summary.invalidate();
    utils.notifiche.cases.invalidate();
    utils.notifiche.brief.invalidate();
  };
  const onError = (error: { message: string }) => toast.error(error.message);
  const take = trpc.notifiche.cases.take.useMutation({ onSuccess: refresh, onError });
  const snooze = trpc.notifiche.cases.snooze.useMutation({ onSuccess: refresh, onError });
  const resolve = trpc.notifiche.cases.resolve.useMutation({ onSuccess: refresh, onError });
  const pending = take.isPending || snooze.isPending || resolve.isPending;

  const snoozeDays = (days: number) => {
    const until = new Date();
    until.setDate(until.getDate() + days);
    until.setHours(8, 0, 0, 0);
    snooze.mutate({ id: item.id, expectedFingerprint: item.signalFingerprint, until });
  };

  return (
    <article className={cn("border-b border-l-4 px-3 py-3.5 last:border-b-0 sm:px-4", priorityStyle[item.priority])}>
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="bg-background/75 text-[10px] uppercase">
              {priorityLabel[item.priority] ?? item.priority}
            </Badge>
            <span className="text-xs text-muted-foreground">{statusLabel[item.status] ?? item.status}</span>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
              {dateLabel(item.dueAt)}
            </span>
          </div>
          <h3 className="mt-1.5 text-sm font-semibold leading-snug sm:text-base">{item.title}</h3>
          <p className="mt-1 text-sm text-foreground/85">{item.nextAction.label}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{item.signals.length} {item.signals.length === 1 ? "evidenza" : "evidenze"}</span>
            {assigneeName && <span>Responsabile: {assigneeName}</span>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-end lg:self-start">
          {item.status === "da_valutare" && (
            <Button size="sm" onClick={() => take.mutate({ id: item.id, expectedFingerprint: item.signalFingerprint })} disabled={pending}>
              <UserCheck className="h-4 w-4" /> Prendi in carico
            </Button>
          )}
          {item.status !== "da_valutare" && (
            <Button asChild variant="outline" size="sm">
              <Link href={item.link}>Apri <ArrowUpRight className="h-4 w-4" /></Link>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Altre azioni" disabled={pending}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => snoozeDays(1)}>
                <CalendarClock /> Rinvia a domani
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => snoozeDays(3)}>
                <CalendarClock /> Rinvia di 3 giorni
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onWait(item)}>
                <Pause /> Metti in attesa
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => resolve.mutate({ id: item.id, expectedFingerprint: item.signalFingerprint })}>
                <Check /> Segna risolta
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </article>
  );
}

export function ActionCenter({ direction }: { direction: boolean }) {
  const [scope, setScope] = useState<"mine" | "site">("mine");
  const [waitCase, setWaitCase] = useState<any | null>(null);
  const [counterpart, setCounterpart] = useState("");
  const [reason, setReason] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const utils = trpc.useUtils();
  const cases = trpc.notifiche.cases.list.useQuery({
    scope,
    statuses: [...activeStatuses],
    limit: 100,
  });
  const users = trpc.utenti.list.useQuery(undefined);
  const brief = trpc.notifiche.brief.useQuery();
  const waitFor = trpc.notifiche.cases.waitFor.useMutation({
    onSuccess: () => {
      setWaitCase(null);
      setCounterpart("");
      setReason("");
      setReviewDate("");
      utils.notifiche.invalidate();
      toast.success("Caso messo in attesa");
    },
    onError: error => toast.error(error.message),
  });
  const items = cases.data?.items ?? [];
  const userNames = useMemo(
    () => new Map(
      (users.data ?? []).map((user: any) => [
        user.id,
        user.nome || user.name || user.email || `Utente ${user.id}`,
      ])
    ),
    [users.data]
  );
  const counts = useMemo(() => ({
    critical: items.filter((item: any) => item.priority === "critica").length,
    high: items.filter((item: any) => item.priority === "alta").length,
  }), [items]);

  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-col gap-3 border-b bg-[image:var(--gradient-soft)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-primary">
              <CircleAlert className="h-3.5 w-3.5" /> Centro Azioni
            </div>
            <h2 className="mt-1 text-lg font-semibold">
              {items.length === 0 ? "Nessuna azione urgente" : `${items.length} azioni da governare`}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {counts.critical} critiche, {counts.high} alte
            </p>
          </div>
          {direction && (
            <div className="inline-flex self-start rounded-md border bg-background p-1" aria-label="Ambito azioni">
              <Button variant={scope === "mine" ? "secondary" : "ghost"} size="sm" onClick={() => setScope("mine")}>
                <UserCheck className="h-4 w-4" /> Le mie
              </Button>
              <Button variant={scope === "site" ? "secondary" : "ghost"} size="sm" onClick={() => setScope("site")}>
                <Users className="h-4 w-4" /> Tutta la sede
              </Button>
            </div>
          )}
        </div>

        {cases.isLoading ? (
          <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparazione priorità
          </div>
        ) : cases.isError ? (
          <div className="px-4 py-8 text-center text-sm text-destructive">{cases.error.message}</div>
        ) : items.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center px-4 text-center">
            <Check className="h-7 w-7 text-success" />
            <p className="mt-2 font-medium">Coda sotto controllo</p>
            <p className="mt-1 text-sm text-muted-foreground">I segnali informativi restano nel brief, senza riempire la campanella.</p>
          </div>
        ) : (
          <div>
            {items.map((item: any) => (
              <ActionRow
                key={item.id}
                item={item}
                assigneeName={item.assigneeUserId == null ? null : userNames.get(item.assigneeUserId) ?? null}
                onWait={setWaitCase}
              />
            ))}
          </div>
        )}
      </section>

      {(brief.data?.repeatedSnoozeCaseIds.length ?? 0) > 0 && (
        <p className="px-1 text-xs text-muted-foreground">
          {brief.data!.repeatedSnoozeCaseIds.length} casi rinviati più volte richiedono una decisione stabile.
        </p>
      )}

      <Dialog open={waitCase != null} onOpenChange={open => !open && setWaitCase(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Metti il caso in attesa</DialogTitle>
            <DialogDescription>Indica cosa stai aspettando e quando il CRM deve riportarlo in evidenza.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="action-counterpart">In attesa di</Label>
              <Input id="action-counterpart" value={counterpart} onChange={event => setCounterpart(event.target.value)} placeholder="Cliente, fornitore, tecnico..." />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="action-reason">Motivo</Label>
              <Textarea id="action-reason" value={reason} onChange={event => setReason(event.target.value)} placeholder="Cosa deve accadere prima di riprendere il caso" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="action-review">Ricontrolla il</Label>
              <Input id="action-review" type="date" value={reviewDate} onChange={event => setReviewDate(event.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaitCase(null)}>Annulla</Button>
            <Button
              disabled={!counterpart.trim() || reason.trim().length < 3 || !reviewDate || waitFor.isPending}
              onClick={() => waitFor.mutate({
                id: waitCase.id,
                expectedFingerprint: waitCase.signalFingerprint,
                counterpart,
                reason,
                until: new Date(`${reviewDate}T09:00:00`),
              })}
            >
              {waitFor.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Conferma attesa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
