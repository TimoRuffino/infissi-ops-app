import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Activity,
  ArrowRight,
  Bot,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  ExternalLink,
  History,
  Inbox,
  Lightbulb,
  Loader2,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { isDirezione } from "@/lib/roles";
import { parseTarsTab, type TarsTab } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TarsAvatar from "@/components/TarsAvatar";
import { TarsChatPanel } from "@/components/TarsChat";
import { toast } from "sonner";
import { ElencoProposte, RegistroEsecuzioni } from "./TarsInbox";
import { ActionCenter } from "@/components/ActionCenter";

function relativeDate(value: Date | string | null | undefined): string {
  if (!value) return "Mai";
  const date = new Date(value);
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 2) return "Adesso";
  if (minutes < 60) return `${minutes} min fa`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h fa`;
  return date.toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
}

function evidenceHref(evidence: { type: string; id: string }): string | null {
  switch (evidence.type) {
    case "email":
      return `/messaggi/email?messaggio=${encodeURIComponent(evidence.id)}`;
    case "whatsapp":
      return "/messaggi/whatsapp";
    case "commessa":
      return `/commesse/${encodeURIComponent(evidence.id)}`;
    case "cliente":
      return `/clienti/${encodeURIComponent(evidence.id)}`;
    case "fattura_fic":
      return "/economia";
    default:
      return null;
  }
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Activity;
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="min-w-0 px-3 py-3 sm:px-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 flex min-w-0 items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums text-foreground">{value}</span>
        <span className="truncate text-[11px] text-muted-foreground">{detail}</span>
      </div>
    </div>
  );
}

function CommandCenterLoading() {
  return (
    <div className="space-y-3" aria-label="Caricamento priorità Tars" role="status">
      <div className="h-28 animate-pulse rounded-lg bg-muted" />
      {[1, 2, 3].map(item => (
        <div key={item} className="h-28 animate-pulse rounded-lg border bg-card" />
      ))}
    </div>
  );
}

function TodayView({
  snapshot,
  onOpenProposals,
  direction,
}: {
  snapshot: any;
  onOpenProposals: (proposalId?: number | null) => void;
  direction: boolean;
}) {
  if (snapshot.status === "disabled") {
    return (
      <div className="space-y-4">
        <ActionCenter direction={direction} />
        <div className="flex min-h-32 items-center gap-3 rounded-lg border border-dashed px-5">
          <Bot className="h-8 w-8 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="font-semibold">Analisi Tars disattivata</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Le priorità certe restano attive. La direzione può riattivare l'analisi AI dalle integrazioni.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ActionCenter direction={direction} />

      <section className="overflow-hidden rounded-lg border bg-[image:var(--gradient-soft)] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-primary">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Brief di oggi
            </div>
            <h2 className="mt-1 text-lg font-semibold text-foreground sm:text-xl">
              {snapshot.brief.title}
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {snapshot.brief.summary}
            </p>
          </div>
          {snapshot.status === "degraded" && (
            <Badge variant="outline" className="w-fit gap-1 border-warning/40 text-warning-foreground">
              <TriangleAlert className="h-3 w-3" aria-hidden="true" />
              Controllo necessario
            </Badge>
          )}
        </div>
        {snapshot.brief.highlights.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {snapshot.brief.highlights.map((highlight: string) => (
              <span key={highlight} className="rounded-md border bg-background/80 px-2 py-1 text-xs text-foreground">
                {highlight}
              </span>
            ))}
          </div>
        )}
      </section>

      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Priorità</h2>
          <p className="text-xs text-muted-foreground">Ordinate per urgenza, impatto e confidenza</p>
        </div>
        {snapshot.priorities.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onOpenProposals()}>
            Tutte le proposte
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      {snapshot.priorities.length === 0 ? (
        <div className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed px-4 text-center">
          <CheckCircle2 className="h-8 w-8 text-success" aria-hidden="true" />
          <p className="mt-3 font-medium">Nessuna priorità aperta</p>
          <p className="mt-1 text-sm text-muted-foreground">Le decisioni sono allineate.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {snapshot.priorities.map((priority: any, index: number) => (
            <article
              key={priority.id}
              className="group rounded-lg border bg-card p-3.5 transition-colors duration-200 hover:border-primary/35 sm:p-4"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-sm font-semibold text-primary">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold leading-snug text-foreground">{priority.title}</h3>
                      <p className="mt-1 text-sm text-foreground/85">{priority.conclusion}</p>
                    </div>
                    <Badge variant="outline" className="shrink-0 capitalize">
                      {priority.confidence}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{priority.reason}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {priority.evidence.map((evidence: any) => {
                      const href = evidenceHref(evidence);
                      return href ? (
                        <Link
                          key={`${evidence.type}:${evidence.id}`}
                          href={href}
                          className="inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2 text-xs text-muted-foreground transition-colors hover:border-primary/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {evidence.label}
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </Link>
                      ) : (
                        <span key={`${evidence.type}:${evidence.id}`} className="inline-flex min-h-8 items-center rounded-md border px-2 text-xs text-muted-foreground">
                          {evidence.label}
                        </span>
                      );
                    })}
                    <Button className="ml-auto" size="sm" onClick={() => onOpenProposals(priority.proposalId)}>
                      Valuta
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TarsCommandCenter() {
  const { user } = useAuth();
  const direzione = isDirezione(user);
  const utils = trpc.useUtils();
  const snapshot = trpc.tars.commandCenter.get.useQuery({ limit: 12 }, { retry: 1 });
  const config = trpc.tars.config.get.useQuery(undefined, { retry: false });
  const [tab, setTab] = useState<TarsTab>(() => parseTarsTab(window.location.search, direzione));
  const [focusedProposalId, setFocusedProposalId] = useState<number | null>(null);

  const audit = trpc.tars.auditProcessi.esegui.useMutation({
    onSuccess: result => {
      toast.success(
        result.proposte.length > 0
          ? `${result.proposte.length} miglioramenti pronti da valutare`
          : "Analisi completata senza nuovi miglioramenti"
      );
      utils.tars.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    const onPopState = () => setTab(parseTarsTab(window.location.search, direzione));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [direzione]);

  const changeTab = (value: string) => {
    const next = parseTarsTab(`?tab=${value}`, direzione);
    setTab(next);
    window.history.replaceState(window.history.state, "", `/tars?tab=${next}`);
  };

  const openProposal = (proposalId?: number | null) => {
    setFocusedProposalId(proposalId ?? null);
    changeTab("proposte");
    if (proposalId != null) {
      window.setTimeout(() => {
        document
          .getElementById(`tars-proposta-${proposalId}`)
          ?.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "auto"
              : "smooth",
            block: "start",
          });
      }, 80);
    }
  };

  const data = snapshot.data;
  const statusLabel =
    data?.status === "disabled"
      ? "Spento"
      : data?.status === "degraded"
        ? "Da controllare"
        : "Operativo";

  return (
    <div className="min-w-0 space-y-4 pb-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <TarsAvatar size="lg" className="h-11 w-11 shrink-0" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold leading-tight">Tars</h1>
              <Badge variant="outline" className="gap-1.5">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    data?.status === "ready" ? "bg-success" : data?.status === "degraded" ? "bg-warning" : "bg-muted-foreground"
                  )}
                  aria-hidden="true"
                />
                {statusLabel}
              </Badge>
            </div>
            <p className="truncate text-sm text-muted-foreground">
              Cabina operativa · aggiornata {relativeDate(data?.generatedAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => snapshot.refetch()}
            disabled={snapshot.isFetching}
          >
            <RefreshCw className={cn("h-4 w-4", snapshot.isFetching && "animate-spin")} aria-hidden="true" />
            Aggiorna
          </Button>
          {direzione && (
            <Button
              size="sm"
              disabled={!config.data?.attivo || !config.data?.auditProcessiAttivo || audit.isPending}
              onClick={() => audit.mutate()}
            >
              {audit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BrainCircuit className="h-4 w-4" />}
              Analizza processi
            </Button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 overflow-hidden rounded-lg border bg-card lg:grid-cols-4 lg:divide-x">
        <Metric icon={Inbox} label="Da decidere" value={data?.metrics.pending ?? 0} detail="proposte aperte" />
        <Metric icon={ShieldCheck} label="Doppioni evitati" value={data?.metrics.duplicateAvoided ?? 0} detail="ultimi 30 giorni" />
        <Metric icon={Sparkles} label="Cache prompt" value={`${data?.metrics.cacheReadPercent ?? 0}%`} detail={`${data?.metrics.toolCacheHits ?? 0} letture riusate`} />
        <Metric icon={Clock3} label="Ultima analisi" value={relativeDate(data?.metrics.lastRunAt)} detail={data?.metrics.failedRuns ? `${data.metrics.failedRuns} errori recenti` : "nessun errore recente"} />
      </div>

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList className={cn("grid h-auto w-full", direzione ? "grid-cols-5" : "grid-cols-4", "sm:w-fit")}>
          <TabsTrigger value="oggi" className="min-h-10 min-w-0 gap-1 px-2 text-xs sm:px-3 sm:text-sm">
            <Sparkles className="hidden h-3.5 w-3.5 sm:block" />
            Oggi
          </TabsTrigger>
          <TabsTrigger value="proposte" className="min-h-10 min-w-0 gap-1 px-2 text-xs sm:px-3 sm:text-sm">
            <Inbox className="hidden h-3.5 w-3.5 sm:block" />
            Proposte
          </TabsTrigger>
          <TabsTrigger value="analisi" className="min-h-10 min-w-0 gap-1 px-2 text-xs sm:px-3 sm:text-sm">
            <Lightbulb className="hidden h-3.5 w-3.5 sm:block" />
            Analisi
          </TabsTrigger>
          <TabsTrigger value="chat" className="min-h-10 min-w-0 gap-1 px-2 text-xs sm:px-3 sm:text-sm">
            <MessageCircle className="hidden h-3.5 w-3.5 sm:block" />
            Chat
          </TabsTrigger>
          {direzione && (
            <TabsTrigger value="registro" className="min-h-10 min-w-0 gap-1 px-2 text-xs sm:px-3 sm:text-sm">
              <History className="hidden h-3.5 w-3.5 sm:block" />
              Registro
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="oggi" className="mt-4">
          {snapshot.isLoading ? (
            <CommandCenterLoading />
          ) : snapshot.isError ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-5 text-center">
              <TriangleAlert className="h-7 w-7 text-destructive" aria-hidden="true" />
              <div>
                <p className="font-semibold">Tars non riesce a preparare il brief</p>
                <p className="mt-1 text-sm text-muted-foreground">{snapshot.error.message}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => snapshot.refetch()}>Riprova</Button>
            </div>
          ) : (
            <TodayView snapshot={data} onOpenProposals={openProposal} direction={direzione} />
          )}
        </TabsContent>

        <TabsContent value="proposte" className="mt-4 space-y-5">
          <ElencoProposte stato="pendente" focusId={focusedProposalId} />
          <details className="rounded-lg border px-4 py-3">
            <summary className="cursor-pointer select-none text-sm font-medium">Decisioni recenti</summary>
            <div className="mt-3"><ElencoProposte /></div>
          </details>
        </TabsContent>

        <TabsContent value="analisi" className="mt-4">
          <ElencoProposte stato="pendente" tipo="miglioramento_processo" />
        </TabsContent>

        <TabsContent value="chat" className="mt-4">
          <div className="flex h-[calc(100dvh-24rem)] min-h-[420px] flex-col overflow-hidden rounded-lg border bg-card sm:h-[calc(100dvh-21rem)]">
            <TarsChatPanel className="flex-1" />
          </div>
        </TabsContent>

        {direzione && (
          <TabsContent value="registro" className="mt-4">
            <RegistroEsecuzioni />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
