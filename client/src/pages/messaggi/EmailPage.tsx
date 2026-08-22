import { useAuth } from "@/_core/hooks/useAuth";
import CaselleEmailCard from "@/components/CaselleEmailCard";
import EmailMessageList, {
  EMAIL_CATEGORIES,
  EMAIL_CATEGORY_UI,
  type EmailCategory,
} from "@/components/messaggi/EmailMessageList";
import EmailMessageReader from "@/components/messaggi/EmailMessageReader";
import TarsAvatar from "@/components/TarsAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EMAIL_VIEWS,
  parseEmailMessageId,
  parseEmailView,
  type EmailMessage,
  type TarsProposal,
  type EmailView,
} from "@/lib/messaggi";
import { isDirezione } from "@/lib/roles";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  AlertTriangle,
  CheckCheck,
  Inbox,
  Loader2,
  Mail,
  Paperclip,
  RefreshCw,
  Search,
  Settings2,
  ShieldBan,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

const PAGE_SIZE = 50;

const VIEW_LABELS: Record<EmailView, string> = {
  da_gestire: "Da gestire",
  lead: "Nuovi lead",
  allegati: "Allegati",
  collegate: "Collegate",
  gestite: "Gestite",
  escluse: "Escluse",
};

const EMPTY_MESSAGES: Record<EmailView, string> = {
  da_gestire: "Tutto gestito. La coda operativa e vuota.",
  lead: "Non ci sono nuovi lead con questi filtri.",
  allegati: "Nessuna email con allegati con questi filtri.",
  collegate: "Nessuna email collegata con questi filtri.",
  gestite: "Non ci sono email gestite con questi filtri.",
  escluse: "Non ci sono email escluse con questi filtri.",
};

function waitLabel(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60_000)
  );
  if (minutes < 1) return "meno di un minuto";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "ora" : "ore"}`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "giorno" : "giorni"}`;
}

function replaceEmailQuery(view: EmailView, messageId: number | null) {
  const params = new URLSearchParams(window.location.search);
  params.set("view", view);
  if (messageId == null) params.delete("messaggio");
  else params.set("messaggio", String(messageId));
  const query = params.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}`
  );
}

function useBelowLg(): boolean {
  const query = "(max-width: 1023px)";
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return matches;
}

export default function EmailPage() {
  const { user } = useAuth();
  const mobile = useBelowLg();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<EmailView>(() =>
    parseEmailView(window.location.search)
  );
  const [mailboxId, setMailboxId] = useState<number | null>(null);
  const [assigneeId, setAssigneeId] = useState<number | null>(null);
  const [category, setCategory] = useState<EmailCategory | null>(null);
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(() =>
    parseEmailMessageId(window.location.search)
  );
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [mailboxesOpen, setMailboxesOpen] = useState(false);
  const deferredSearch = useDeferredValue(search.trim());

  useEffect(() => {
    const onPopState = () => {
      setView(parseEmailView(window.location.search));
      setSelectedId(parseEmailMessageId(window.location.search));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const stats = trpc.mail.email.stats.useQuery();
  const queue = trpc.mail.comunicazioni.statoTars.useQuery(undefined, {
    refetchInterval: query =>
      (query.state.data?.inAttesa ?? 0) > 0 ? 15_000 : 60_000,
  });
  const mailboxOptions = trpc.mail.caselle.opzioni.useQuery();
  const jobs = trpc.commesse.list.useQuery();
  const users = trpc.utenti.list.useQuery();
  const filterRules = trpc.mail.comunicazioni.regoleFiltro.list.useQuery(
    undefined,
    {
      enabled: isDirezione(user),
    }
  );

  const queryCategory =
    view === "lead" ? "nuovo_lead" : (category ?? undefined);
  const rows = trpc.mail.email.list.useQuery({
    search: deferredSearch || undefined,
    casellaId: mailboxId ?? undefined,
    categoria: queryCategory,
    soloDaGestire: view === "da_gestire" ? true : undefined,
    stato: view === "gestite" ? "gestita" : undefined,
    soloEscluse: view === "escluse" ? true : undefined,
    soloConAllegati: view === "allegati" ? true : undefined,
    soloCollegate: view === "collegate" ? true : undefined,
    assegnatoA: assigneeId ?? undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
  const pendingProposals = trpc.tars.proposte.list.useQuery(
    { stato: "pendente" },
    { retry: false }
  );

  const relevantAssigneeIds = useMemo(
    () =>
      new Set(
        (jobs.data ?? [])
          .map(job => job.assegnatoA)
          .filter((id): id is number => id != null)
      ),
    [jobs.data]
  );
  const assigneeOptions = useMemo(
    () =>
      (users.data ?? [])
        .filter(person => person.attivo && relevantAssigneeIds.has(person.id))
        .sort((a, b) =>
          `${a.cognome} ${a.nome}`.localeCompare(`${b.cognome} ${b.nome}`)
        ),
    [relevantAssigneeIds, users.data]
  );
  const proposalsByMessage = useMemo(() => {
    const map = new Map<number, TarsProposal[]>();
    for (const proposal of pendingProposals.data ?? []) {
      const id = proposal.payload?.comunicazioneId;
      if (id == null) continue;
      map.set(id, [...(map.get(id) ?? []), proposal]);
    }
    return map;
  }, [pendingProposals.data]);

  const rawMessages = rows.data ?? [];
  const messages = rawMessages;

  useEffect(() => {
    setSelectedIds(new Set());
  }, [assigneeId, category, deferredSearch, mailboxId, page, view]);

  const sync = trpc.mail.caselle.sync.useMutation({
    onSuccess: results => {
      const imported = results.reduce(
        (sum, result) => sum + result.importate,
        0
      );
      const failed = results.find(result => result.errore);
      if (failed?.errore) toast.error(failed.errore);
      else
        toast.success(
          imported > 0 ? `${imported} nuove email` : "Nessuna novita"
        );
      void utils.mail.email.invalidate();
      void utils.mail.comunicazioni.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const markAllRead = trpc.mail.email.segnaTutteViste.useMutation({
    onSuccess: result => {
      if (result.aggiornate > 0)
        toast.success(`${result.aggiornate} segnate come viste`);
      void utils.mail.email.invalidate();
      void utils.mail.comunicazioni.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const bulkUpdate = trpc.mail.comunicazioni.bulkAggiorna.useMutation({
    onSuccess: result => {
      toast.success(`${result.aggiornate} email aggiornate`);
      setSelectedIds(new Set());
      void utils.mail.email.invalidate();
      void utils.mail.comunicazioni.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const removeRule = trpc.mail.comunicazioni.regoleFiltro.delete.useMutation({
    onSuccess: () => {
      toast.success("Regola rimossa");
      void filterRules.refetch();
    },
    onError: error => toast.error(error.message),
  });

  const changeView = (nextView: EmailView) => {
    setView(nextView);
    setPage(0);
    replaceEmailQuery(nextView, selectedId);
  };
  const openMessage = (message: EmailMessage) => {
    setSelectedId(message.id);
    replaceEmailQuery(view, message.id);
  };
  const closeMessage = () => {
    setSelectedId(null);
    replaceEmailQuery(view, null);
  };
  const resetPage = () => setPage(0);
  const selectedBatch = Array.from(selectedIds);
  const runBulk = (
    update: { stato: "gestita" } | { categoria: "spam" | "offerta_marketing" }
  ) => {
    if (selectedBatch.length === 0) return;
    bulkUpdate.mutate({ ids: selectedBatch, ...update });
  };

  const showList = !mobile || selectedId == null;
  const showReader = selectedId != null;
  const selectionRemoved =
    selectedId != null &&
    !rows.isLoading &&
    !messages.some(message => message.id === selectedId);
  const toManage = stats.data
    ? Math.max(0, stats.data.totali - stats.data.gestite)
    : null;
  const viewCounts: Record<EmailView, number | null> = {
    da_gestire: toManage,
    lead: stats.data?.nuoviLead ?? null,
    allegati: stats.data?.conAllegati ?? null,
    collegate: stats.data?.collegate ?? null,
    gestite: stats.data?.gestite ?? null,
    escluse: stats.data?.escluse ?? null,
  };
  const queueBlocked = [
    "disattivato",
    "chiave_mancante",
    "budget_esaurito",
    "pausa_errore",
  ].includes(queue.data?.stato ?? "");
  const queueTitle =
    queue.data?.stato === "in_elaborazione"
      ? "Tars sta analizzando la coda"
      : queue.data?.stato === "pausa_errore"
        ? "Tars riprovera automaticamente"
        : queue.data?.stato === "disattivato"
          ? "Tars e disattivato"
          : queue.data?.stato === "chiave_mancante"
            ? "Chiave AI non configurata"
            : queue.data?.stato === "budget_esaurito"
              ? "Budget Tars esaurito"
              : "Analisi Tars programmata";
  const oldestWait = waitLabel(queue.data?.piuVecchiaAt);

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-h-[620px] min-w-0 flex-col gap-3 overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground shadow-xs">
            <Mail className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight sm:text-2xl">
              Email
            </h1>
            <p className="truncate text-sm text-text-2">
              Posta operativa, documenti e richieste
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {stats.data && stats.data.nuove > 0 && view !== "escluse" && (
            <Button
              size="sm"
              variant="ghost"
              className="hidden sm:inline-flex"
              disabled={markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              <CheckCheck className="size-3.5" />
              Tutte viste
            </Button>
          )}
          <Button
            size="icon"
            variant="outline"
            className="size-11 sm:h-9 sm:w-auto sm:px-3"
            disabled={sync.isPending}
            onClick={() => sync.mutate({})}
            aria-label="Aggiorna email"
            title="Aggiorna email"
          >
            {sync.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            <span className="hidden sm:inline">
              {sync.isPending ? "Aggiornamento" : "Aggiorna"}
            </span>
          </Button>
          {isDirezione(user) && (
            <Button
              size="icon"
              variant="outline"
              className="size-11 sm:h-9 sm:w-auto sm:px-3"
              onClick={() => setMailboxesOpen(true)}
              aria-label="Gestisci caselle"
              title="Gestisci caselle"
            >
              <Settings2 className="size-4" />
              <span className="hidden sm:inline">Caselle</span>
            </Button>
          )}
        </div>
      </header>

      <section
        aria-label="Metriche email"
        className="grid shrink-0 grid-cols-2 divide-x divide-y divide-border-soft overflow-hidden rounded-md border border-border-soft bg-card sm:grid-cols-4 sm:divide-y-0"
      >
        {[
          { label: "Da gestire", value: toManage, icon: Inbox },
          {
            label: "Nuovi lead",
            value: stats.data?.nuoviLead ?? null,
            icon: Sparkles,
          },
          {
            label: "Con allegati",
            value: stats.data?.conAllegati ?? null,
            icon: Paperclip,
          },
          {
            label: "Collegate",
            value: stats.data?.collegate ?? null,
            icon: UserRound,
          },
        ].map(metric => (
          <div
            key={metric.label}
            className="flex min-w-0 items-center gap-2 px-3 py-2.5"
          >
            <metric.icon className="size-4 shrink-0 text-text-3" />
            <div className="min-w-0">
              <div className="truncate text-[11px] font-semibold uppercase text-text-3">
                {metric.label}
              </div>
              <div className="text-lg font-bold tabular-nums leading-5">
                {stats.isLoading || stats.isError || metric.value == null
                  ? "-"
                  : metric.value}
              </div>
            </div>
          </div>
        ))}
      </section>

      {stats.isError && (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <AlertCircle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            Statistiche email non disponibili.
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-10 shrink-0"
            onClick={() => stats.refetch()}
          >
            Riprova
          </Button>
        </div>
      )}

      {(queue.data?.inAttesa ?? 0) > 0 && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "flex shrink-0 items-center gap-3 rounded-md border px-3 py-2.5",
            queueBlocked
              ? "border-warning/35 bg-warning/10"
              : "border-primary/20 bg-primary-soft/45"
          )}
        >
          {queueBlocked ? (
            <AlertTriangle className="size-5 shrink-0 text-warning-foreground" />
          ) : (
            <TarsAvatar
              size="md"
              className={cn(
                queue.data?.stato === "in_elaborazione" &&
                  "motion-safe:animate-pulse"
              )}
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold">{queueTitle}</div>
            <p className="text-xs leading-5 text-text-2">
              {queue.data!.inAttesa}{" "}
              {queue.data!.inAttesa === 1
                ? "email in attesa"
                : "email in attesa"}
              {oldestWait ? ` - la piu vecchia da ${oldestWait}` : ""}
            </p>
          </div>
          {queueBlocked && isDirezione(user) && (
            <Button
              asChild
              size="sm"
              variant="outline"
              className="hidden sm:inline-flex"
            >
              <Link href="/integrazioni">Controlla Tars</Link>
            </Button>
          )}
        </div>
      )}

      {showList && (
        <div className="shrink-0 space-y-2">
          {mobile ? (
            <Select
              value={view}
              onValueChange={value => changeView(value as EmailView)}
            >
              <SelectTrigger className="min-h-11 w-full" aria-label="Vista email">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMAIL_VIEWS.map(item => (
                  <SelectItem key={item} value={item}>
                    {VIEW_LABELS[item]}
                    {viewCounts[item] != null ? ` - ${viewCounts[item]}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Tabs
              value={view}
              onValueChange={value => changeView(value as EmailView)}
            >
              <TabsList className="grid h-auto w-full grid-cols-6 gap-1 p-1">
                {EMAIL_VIEWS.map(item => (
                  <TabsTrigger
                    key={item}
                    className="min-h-9 min-w-0 gap-1.5 px-2"
                    value={item}
                  >
                    <span className="truncate">{VIEW_LABELS[item]}</span>
                    {viewCounts[item] != null && (
                      <span className="shrink-0 text-[11px] tabular-nums opacity-70">
                        {viewCounts[item]}
                      </span>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(12rem,1fr)_repeat(3,minmax(9rem,auto))]">
            <div className="relative min-w-0">
              <label htmlFor="email-search" className="sr-only">
                Cerca nelle email
              </label>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3" />
              <Input
                id="email-search"
                className="h-11 pl-9 sm:h-10"
                placeholder="Cerca testo, cliente o commessa"
                value={search}
                onChange={event => {
                  setSearch(event.target.value);
                  resetPage();
                }}
              />
            </div>
            <Select
              value={mailboxId == null ? "tutte" : String(mailboxId)}
              onValueChange={value => {
                setMailboxId(value === "tutte" ? null : Number(value));
                resetPage();
              }}
            >
              <SelectTrigger className="min-h-11 w-full sm:min-h-10" aria-label="Casella email">
                <SelectValue placeholder="Casella" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tutte">Tutte le caselle</SelectItem>
                {(mailboxOptions.data ?? []).map(mailbox => (
                  <SelectItem key={mailbox.id} value={String(mailbox.id)}>
                    {mailbox.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={assigneeId == null ? "tutti" : String(assigneeId)}
              onValueChange={value => {
                setAssigneeId(value === "tutti" ? null : Number(value));
                resetPage();
              }}
            >
              <SelectTrigger className="min-h-11 w-full sm:min-h-10" aria-label="Assegnatario">
                <UserRound className="size-3.5" />
                <SelectValue placeholder="Assegnatario" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tutti">Tutti gli assegnatari</SelectItem>
                {assigneeOptions.map(person => (
                  <SelectItem key={person.id} value={String(person.id)}>
                    {person.nome} {person.cognome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={category ?? "tutte"}
              onValueChange={value => {
                setCategory(
                  value === "tutte" ? null : (value as EmailCategory)
                );
                resetPage();
              }}
              disabled={view === "lead"}
            >
              <SelectTrigger className="min-h-11 w-full sm:min-h-10" aria-label="Categoria">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tutte">Tutte le categorie</SelectItem>
                {EMAIL_CATEGORIES.map(item => (
                  <SelectItem key={item} value={item}>
                    {EMAIL_CATEGORY_UI[item].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {stats.data && stats.data.nuove > 0 && view !== "escluse" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-11 w-full sm:hidden"
              disabled={markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              <CheckCheck className="size-3.5" />
              Segna tutte come viste
            </Button>
          )}
        </div>
      )}

      <div className="grid min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border border-border bg-card shadow-xs lg:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.6fr)]">
        {showList && (
          <EmailMessageList
            messages={messages}
            selectedId={selectedId}
            proposalsByMessage={proposalsByMessage}
            viewLabel={VIEW_LABELS[view]}
            loading={rows.isLoading}
            fetching={rows.isFetching}
            error={rows.error?.message ?? null}
            emptyMessage={
              search
                ? "Nessuna email corrisponde alla ricerca e ai filtri."
                : EMPTY_MESSAGES[view]
            }
            page={page}
            hasPreviousPage={page > 0}
            hasNextPage={rawMessages.length === PAGE_SIZE}
            onOpen={openMessage}
            selectedIds={selectedIds}
            bulkPending={bulkUpdate.isPending}
            onToggleSelected={(id, checked) =>
              setSelectedIds(current => {
                const next = new Set(current);
                if (checked) next.add(id);
                else next.delete(id);
                return next;
              })
            }
            onToggleAll={checked =>
              setSelectedIds(
                checked
                  ? new Set(messages.map(message => message.id))
                  : new Set()
              )
            }
            onBulkClose={() => runBulk({ stato: "gestita" })}
            onBulkSpam={() => runBulk({ categoria: "spam" })}
            onBulkNewsletter={() => runBulk({ categoria: "offerta_marketing" })}
            onRetry={() => rows.refetch()}
            onPreviousPage={() => setPage(current => Math.max(0, current - 1))}
            onNextPage={() => setPage(current => current + 1)}
          />
        )}
        {showReader ? (
          <div
            className={cn(
              "min-h-0 min-w-0 border-border-soft lg:border-l",
              mobile && "w-full"
            )}
          >
            <EmailMessageReader
              key={selectedId}
              messageId={selectedId}
              proposals={proposalsByMessage.get(selectedId) ?? []}
              mobile={mobile}
              selectionRemoved={selectionRemoved}
              canManageRules={isDirezione(user)}
              onBack={closeMessage}
            />
          </div>
        ) : (
          !mobile && (
            <div className="hidden min-w-0 place-items-center bg-surface-2/35 text-sm text-text-3 lg:grid">
              <div className="space-y-3 text-center">
                <div className="mx-auto grid size-12 place-items-center rounded-md bg-accent/70 text-accent-text">
                  <Mail className="size-5" />
                </div>
                <p className="font-medium">Apri un'email</p>
              </div>
            </div>
          )
        )}
      </div>

      <Dialog open={mailboxesOpen} onOpenChange={setMailboxesOpen}>
        <DialogContent className="max-h-[85dvh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Caselle e filtri</DialogTitle>
          </DialogHeader>
          <CaselleEmailCard />
          <section className="border-t border-border-soft pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">Mittenti esclusi</h3>
                <p className="mt-0.5 text-xs text-text-3">
                  Le regole si applicano ai prossimi messaggi in arrivo.
                </p>
              </div>
              <Badge variant="secondary">{filterRules.data?.length ?? 0}</Badge>
            </div>
            <div className="mt-3 divide-y divide-border-soft rounded-md border border-border-soft">
              {(filterRules.data ?? []).map(rule => (
                <div
                  key={rule.id}
                  className="flex min-w-0 items-center gap-3 px-3 py-2.5"
                >
                  <ShieldBan className="size-4 shrink-0 text-destructive" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {rule.mittente}
                    </div>
                    <div className="text-xs text-text-3">
                      {rule.categoria === "spam" ? "Spam" : "Offerte"}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-10 shrink-0"
                    disabled={removeRule.isPending}
                    onClick={() => removeRule.mutate({ id: rule.id })}
                    aria-label={`Rimuovi regola per ${rule.mittente}`}
                    title="Rimuovi regola"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
              {!filterRules.isLoading &&
                (filterRules.data?.length ?? 0) === 0 && (
                  <div className="px-3 py-5 text-center text-sm text-text-3">
                    Nessun mittente escluso in modo permanente.
                  </div>
                )}
            </div>
          </section>
        </DialogContent>
      </Dialog>
    </div>
  );
}
