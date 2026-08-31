import { useAuth } from "@/_core/hooks/useAuth";
import CaselleEmailCard from "@/components/CaselleEmailCard";
import ConfirmDialog from "@/components/ConfirmDialog";
import EmailMessageList, {
  EMAIL_CATEGORIES,
  EMAIL_CATEGORY_UI,
  type EmailCategory,
} from "@/components/messaggi/EmailMessageList";
import EmailMessageReader from "@/components/messaggi/EmailMessageReader";
import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import StatePanel from "@/components/patterns/StatePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EMAIL_COMPACT_QUERY, emailPaneVisibility } from "@/lib/emailLayout";
import {
  EMAIL_VIEWS,
  emailBulkExclusionCopy,
  parseEmailMessageId,
  parseEmailView,
  type EmailMessage,
  type EmailView,
} from "@/lib/messaggi";
import { personName } from "@/lib/name";
import { isDirezione } from "@/lib/roles";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  CheckCheck,
  Inbox,
  Link2,
  Loader2,
  Paperclip,
  RefreshCw,
  Settings2,
  ShieldBan,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
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

const VIEW_ICONS: Record<EmailView, typeof Inbox> = {
  da_gestire: Inbox,
  lead: Sparkles,
  allegati: Paperclip,
  collegate: Link2,
  gestite: CheckCheck,
  escluse: ShieldBan,
};

const EMPTY_TITLES: Record<EmailView, string> = {
  da_gestire: "Coda operativa vuota",
  lead: "Nessun nuovo lead",
  allegati: "Nessuna email con allegati",
  collegate: "Nessuna email collegata",
  gestite: "Nessuna email gestita",
  escluse: "Nessuna email esclusa",
};

const EMPTY_MESSAGES: Record<EmailView, string> = {
  da_gestire: "Tutto gestito: qui restano solo le email ancora da lavorare.",
  lead: "Non ci sono nuovi lead con questi filtri.",
  allegati: "Nessuna email con allegati con questi filtri.",
  collegate: "Nessuna email collegata a cliente o commessa con questi filtri.",
  gestite: "Non ci sono email gestite con questi filtri.",
  escluse: "Non ci sono email escluse con questi filtri.",
};

/** Un conteggio esiste solo quando il server lo ha davvero mandato. */
function countLabel(value: number | null): string {
  return value == null ? "—" : String(value);
}

function readEmailSelection(search: string): {
  id: number | null;
  invalid: boolean;
} {
  const raw = new URLSearchParams(search).get("messaggio");
  const id = parseEmailMessageId(search);
  return { id, invalid: raw != null && id == null };
}

/** Query state canonico: `?view=<EmailView>&messaggio=<intero positivo>`. */
function replaceEmailQuery(view: EmailView, messageId: number | null) {
  const params = new URLSearchParams();
  params.set("view", view);
  if (messageId != null) params.set("messaggio", String(messageId));
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}?${params.toString()}`
  );
}

function useCompactEmailLayout(): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia(EMAIL_COMPACT_QUERY).matches
  );

  useEffect(() => {
    const media = window.matchMedia(EMAIL_COMPACT_QUERY);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return matches;
}

export default function EmailPage() {
  const { user } = useAuth();
  const compact = useCompactEmailLayout();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<EmailView>(() =>
    parseEmailView(window.location.search)
  );
  const [mailboxId, setMailboxId] = useState<number | null>(null);
  const [assigneeId, setAssigneeId] = useState<number | null>(null);
  const [category, setCategory] = useState<EmailCategory | null>(null);
  const [page, setPage] = useState(0);
  const [selection, setSelection] = useState(() =>
    readEmailSelection(window.location.search)
  );
  const [focusMode, setFocusMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [mailboxesOpen, setMailboxesOpen] = useState(false);
  const [bulkExclusion, setBulkExclusion] = useState<
    "spam" | "offerta_marketing" | null
  >(null);
  const deferredSearch = useDeferredValue(search.trim());
  const selectedId = selection.id;

  useEffect(() => {
    const onPopState = () => {
      setView(parseEmailView(window.location.search));
      setSelection(readEmailSelection(window.location.search));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (compact) setFocusMode(false);
  }, [compact]);

  // Un `messaggio` non valido non apre nulla: l'URL torna canonico e il
  // problema resta scritto in testa alla pagina, non nascosto.
  useEffect(() => {
    if (selection.invalid) replaceEmailQuery(view, null);
  }, [selection.invalid, view]);

  const stats = trpc.mail.email.stats.useQuery();
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
        .sort((a, b) => personName(a).localeCompare(personName(b))),
    [relevantAssigneeIds, users.data]
  );
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
    setSelection({ id: message.id, invalid: false });
    replaceEmailQuery(view, message.id);
  };
  const closeMessage = () => {
    setSelection({ id: null, invalid: false });
    setFocusMode(false);
    replaceEmailQuery(view, null);
  };
  const resetPage = () => setPage(0);
  const selectedBatch = Array.from(selectedIds);
  const bulkExclusionCopy = bulkExclusion
    ? emailBulkExclusionCopy(bulkExclusion, selectedBatch.length)
    : null;
  const runBulk = (
    update: { stato: "gestita" } | { categoria: "spam" | "offerta_marketing" }
  ) => {
    if (selectedBatch.length === 0) return;
    bulkUpdate.mutate({ ids: selectedBatch, ...update });
  };

  const { showList, showReader, canFocus } = emailPaneVisibility({
    compact,
    selectedId,
    focus: focusMode,
  });
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
  const queueSummary = stats.isLoading
    ? "Conteggi coda in aggiornamento"
    : toManage == null
      ? "Conteggi coda non disponibili"
      : `${toManage} da gestire`;

  const warnings: ReactNode[] = [];
  if (selection.invalid)
    warnings.push(
      <p key="link">
        Il link conteneva un identificativo email non valido: sei tornato
        all'elenco della coda.
      </p>
    );
  if (stats.isError)
    warnings.push(
      <p key="stats" className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          Statistiche email non disponibili: i contatori delle code restano
          vuoti.
        </span>
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => stats.refetch()}
        >
          <RefreshCw className="size-4" />
          Riprova
        </Button>
      </p>
    );

  // Gli stessi controlli servono nel rail (>=1280px) e nella barra compatta
  // sotto la soglia: una sola definizione, due contenitori.
  const filterControls = (
    <>
      <Select
        value={mailboxId == null ? "tutte" : String(mailboxId)}
        onValueChange={value => {
          setMailboxId(value === "tutte" ? null : Number(value));
          resetPage();
        }}
      >
        <SelectTrigger className="min-h-11 w-full" aria-label="Casella email">
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
        <SelectTrigger className="min-h-11 w-full" aria-label="Assegnatario">
          <UserRound className="size-3.5" />
          <SelectValue placeholder="Assegnatario" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="tutti">Tutti gli assegnatari</SelectItem>
          {assigneeOptions.map(person => (
            <SelectItem key={person.id} value={String(person.id)}>
              {personName(person, `Utente #${person.id}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={category ?? "tutte"}
        onValueChange={value => {
          setCategory(value === "tutte" ? null : (value as EmailCategory));
          resetPage();
        }}
        disabled={view === "lead"}
      >
        <SelectTrigger className="min-h-11 w-full" aria-label="Categoria">
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
    </>
  );

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-[1200px]:h-auto min-[1200px]:min-h-0 min-[1200px]:flex-1 min-h-[620px] min-w-0 flex-col gap-3 overflow-hidden">
      <PageHeader
        variant="workbench"
        eyebrow="Posta operativa"
        title="Email"
        description="Coda unica di richieste, documenti e lead in arrivo dalle caselle della sede."
        busy={rows.isFetching}
        metadata={
          <>
            <span className="inline-flex items-center gap-1.5">
              <Inbox className="size-3.5" aria-hidden="true" />
              {queueSummary}
            </span>
            <span>Vista corrente: {VIEW_LABELS[view]}</span>
          </>
        }
        warning={
          warnings.length > 0 ? (
            <div className="space-y-2">{warnings}</div>
          ) : undefined
        }
        secondaryActions={
          <>
            {stats.data && stats.data.nuove > 0 && view !== "escluse" && (
              <Button
                variant="outline"
                className="min-h-11"
                disabled={markAllRead.isPending}
                onClick={() => markAllRead.mutate()}
              >
                <CheckCheck className="size-4" />
                Tutte viste
              </Button>
            )}
            {isDirezione(user) && (
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => setMailboxesOpen(true)}
              >
                <Settings2 className="size-4" />
                Caselle
              </Button>
            )}
          </>
        }
        primaryAction={
          <Button
            className="min-h-11"
            disabled={sync.isPending}
            onClick={() => sync.mutate({})}
          >
            {sync.isPending ? (
              <Loader2 className="size-4 motion-safe:animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {sync.isPending ? "Aggiornamento" : "Aggiorna"}
          </Button>
        }
      />

      {showList && (
        <div className="shrink-0 xl:hidden">
          <DataSurface density="compact" tone="sunken">
            <div className="space-y-2">
              {compact ? (
                <Select
                  value={view}
                  onValueChange={value => changeView(value as EmailView)}
                >
                  <SelectTrigger
                    className="min-h-11 w-full"
                    aria-label="Vista email"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EMAIL_VIEWS.map(item => (
                      <SelectItem key={item} value={item}>
                        {VIEW_LABELS[item]} · {countLabel(viewCounts[item])}
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
                        className="min-h-11 min-w-0 gap-1.5 px-2"
                        value={item}
                      >
                        <span className="truncate">{VIEW_LABELS[item]}</span>
                        <span className="shrink-0 text-[11px] tabular-nums opacity-70">
                          {countLabel(viewCounts[item])}
                        </span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              )}
              <div className="grid min-w-0 gap-2 sm:grid-cols-3">
                {filterControls}
              </div>
            </div>
          </DataSurface>
        </div>
      )}

      <section
        aria-label="Workspace Email"
        className={cn(
          "grid min-h-0 min-w-0 flex-1 overflow-hidden rounded-[var(--radius-panel)] border border-border-soft bg-surface",
          showList
            ? "lg:grid-cols-[minmax(19rem,0.9fr)_minmax(0,1.65fr)] xl:grid-cols-[15rem_minmax(19rem,0.9fr)_minmax(0,1.65fr)]"
            : "xl:grid-cols-[15rem_minmax(0,1fr)]"
        )}
      >
        <nav
          aria-label="Code e filtri email"
          className="hidden min-h-0 min-w-0 flex-col gap-4 overflow-y-auto border-r border-border-soft bg-surface-2 p-3 xl:flex"
        >
          <div className="min-w-0">
            <h2 className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-text-3">
              Code
            </h2>
            <ul className="mt-2 space-y-1">
              {EMAIL_VIEWS.map(item => {
                const Icon = VIEW_ICONS[item];
                const active = item === view;
                return (
                  <li key={item}>
                    <button
                      type="button"
                      onClick={() => changeView(item)}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "flex min-h-11 w-full min-w-0 items-center gap-2 rounded-[var(--radius-control)] px-2.5 text-left text-sm font-semibold transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "bg-surface text-text-1 shadow-[var(--shadow-raised)]"
                          : "text-text-2 hover:bg-surface"
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">
                        {VIEW_LABELS[item]}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-text-3">
                        {countLabel(viewCounts[item])}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="min-w-0 space-y-2 border-t border-border-soft pt-3">
            <h2 className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-text-3">
              Filtri
            </h2>
            {filterControls}
          </div>
        </nav>

        {showList && (
          <EmailMessageList
            messages={messages}
            selectedId={selectedId}
            viewLabel={VIEW_LABELS[view]}
            search={search}
            loading={rows.isLoading}
            fetching={rows.isFetching}
            error={rows.error?.message ?? null}
            emptyTitle={search ? "Nessun risultato" : EMPTY_TITLES[view]}
            emptyMessage={
              search
                ? "Nessuna email corrisponde alla ricerca e ai filtri correnti."
                : EMPTY_MESSAGES[view]
            }
            page={page}
            hasPreviousPage={page > 0}
            hasNextPage={rawMessages.length === PAGE_SIZE}
            onSearchChange={value => {
              setSearch(value);
              resetPage();
            }}
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
            onBulkSpam={() => setBulkExclusion("spam")}
            onBulkNewsletter={() => setBulkExclusion("offerta_marketing")}
            onRetry={() => rows.refetch()}
            onPreviousPage={() => setPage(current => Math.max(0, current - 1))}
            onNextPage={() => setPage(current => current + 1)}
          />
        )}

        {showReader && selectedId != null ? (
          <div
            className={cn(
              "min-h-0 min-w-0",
              showList && "border-border-soft lg:border-l"
            )}
          >
            <EmailMessageReader
              key={selectedId}
              messageId={selectedId}
              mobile={compact}
              focus={focusMode}
              canFocus={canFocus}
              onToggleFocus={() => setFocusMode(value => !value)}
              selectionRemoved={selectionRemoved}
              canManageRules={isDirezione(user)}
              onBack={closeMessage}
            />
          </div>
        ) : (
          <div
            className={cn(
              "hidden min-h-0 min-w-0 overflow-y-auto p-4 lg:block",
              showList && "border-border-soft lg:border-l"
            )}
          >
            <StatePanel
              kind="empty"
              title="Nessuna email aperta"
              description="Scegli un messaggio dall'elenco: qui trovi testo, allegati e le azioni per classificarlo e collegarlo."
            />
          </div>
        )}
      </section>

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
            <div className="mt-3 divide-y divide-border-soft rounded-[var(--radius-control)] border border-border-soft">
              {(filterRules.data ?? []).map(rule => (
                <div
                  key={rule.id}
                  className="flex min-w-0 items-center gap-3 px-3 py-2.5"
                >
                  <ShieldBan className="size-4 shrink-0 text-danger" />
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
                    variant="dangerGhost"
                    className="size-11 shrink-0"
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
      <ConfirmDialog
        open={bulkExclusion != null}
        onOpenChange={open => {
          if (!open) setBulkExclusion(null);
        }}
        title={bulkExclusionCopy?.title ?? "Confermare esclusione?"}
        description={bulkExclusionCopy?.description ?? ""}
        confirmLabel={bulkExclusionCopy?.confirmLabel ?? "Conferma"}
        onConfirm={() => {
          if (bulkExclusion) runBulk({ categoria: bulkExclusion });
          setBulkExclusion(null);
        }}
      />
    </div>
  );
}
