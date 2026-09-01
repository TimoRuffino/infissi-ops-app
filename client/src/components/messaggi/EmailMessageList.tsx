import StatePanel from "@/components/patterns/StatePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { EmailMessage } from "@/lib/messaggi";
import { cn } from "@/lib/utils";
import {
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Link2,
  Loader2,
  Megaphone,
  Paperclip,
  RefreshCw,
  Search,
  ShieldBan,
} from "lucide-react";
import type { ReactNode } from "react";

export const EMAIL_CATEGORIES = [
  "operativa",
  "nuovo_lead",
  "amministrativa",
  "fornitore",
  "da_classificare",
  "offerta_marketing",
  "spam",
] as const;

export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

export const EMAIL_CATEGORY_UI: Record<
  EmailCategory,
  { label: string; className: string }
> = {
  operativa: {
    label: "Operativa",
    className: "border-success/25 bg-success/10 text-success",
  },
  nuovo_lead: {
    label: "Nuovo lead",
    className: "border-primary/25 bg-primary/10 text-primary",
  },
  amministrativa: {
    label: "Amministrativa",
    className: "border-info/25 bg-info/10 text-info",
  },
  fornitore: {
    label: "Fornitore",
    className: "border-warning/30 bg-warning/10 text-warning-foreground",
  },
  da_classificare: {
    label: "Da classificare",
    className: "border-border-strong bg-surface-2 text-text-2",
  },
  offerta_marketing: {
    label: "Newsletter inutile",
    className: "border-warning/30 bg-warning/10 text-warning-foreground",
  },
  spam: {
    label: "Spam",
    className: "border-destructive/25 bg-destructive/10 text-destructive",
  },
};

export function EmailCategoryBadge({
  categoria,
  className,
}: {
  categoria: EmailCategory;
  className?: string;
}) {
  const meta =
    EMAIL_CATEGORY_UI[categoria] ?? EMAIL_CATEGORY_UI.da_classificare;

  return (
    <Badge
      variant="outline"
      className={cn(
        "h-5 max-w-full px-1.5 text-[11px]",
        meta.className,
        className
      )}
    >
      <span className="truncate">{meta.label}</span>
    </Badge>
  );
}

function shortDate(value: string | Date): string {
  const date = new Date(value);
  const today = new Date();
  const sameDay =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();

  return sameDay
    ? date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
}

function preview(message: EmailMessage): string {
  return (
    String(message.testo ?? "")
      .replace(/\s+/g, " ")
      .trim() || "Nessuna anteprima"
  );
}

/**
 * Riga da 71px: tre righe di testo (mittente + ora, oggetto, anteprima +
 * classificazione) e nient'altro. L'avatar con le iniziali è sparito perché
 * costava 52px di larghezza all'oggetto senza dire nulla che il mittente non
 * dicesse già; il non letto resta scritto dalla barra a sinistra, dal pallino
 * e dal peso del testo. Ogni pixel tolto qui è una email in più sullo schermo.
 */
function MessageRow({
  message,
  selected,
  checked,
  onOpen,
  onCheckedChange,
}: {
  message: EmailMessage;
  selected: boolean;
  checked: boolean;
  onOpen: () => void;
  onCheckedChange: (checked: boolean) => void;
}) {
  const unread = message.stato === "nuova";
  const attachments = message.allegati?.length ?? 0;

  return (
    <div
      className={cn(
        "relative flex min-h-[70px] w-full min-w-0 items-start border-b border-border-soft transition-colors duration-fast",
        selected
          ? "bg-accent"
          : unread
            ? "bg-primary-soft/35 hover:bg-primary-soft/55"
            : "bg-surface hover:bg-surface-2"
      )}
    >
      {(selected || unread) && (
        <span
          className={cn(
            "absolute inset-y-0 left-0 w-[3px]",
            selected ? "bg-primary" : "bg-accent-brand"
          )}
          aria-hidden="true"
        />
      )}
      <label
        htmlFor={`email-select-${message.id}`}
        className="ml-0.5 grid size-11 shrink-0 cursor-pointer place-items-center"
      >
        <span className="sr-only">
          Seleziona email {message.oggetto || "senza oggetto"}
        </span>
        <Checkbox
          id={`email-select-${message.id}`}
          checked={checked}
          onCheckedChange={value => onCheckedChange(value === true)}
          className="size-5"
          aria-label={`Seleziona email ${message.oggetto || "senza oggetto"}`}
        />
      </label>
      <button
        type="button"
        onClick={onOpen}
        aria-current={selected ? "true" : undefined}
        className="flex min-w-0 flex-1 flex-col py-1.5 pr-3 text-left focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {unread && (
            <span
              className="size-1.5 shrink-0 rounded-full bg-accent-brand"
              aria-hidden="true"
            />
          )}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px] leading-5",
              unread ? "font-bold text-text-1" : "font-semibold text-text-2"
            )}
          >
            {message.mittenteNome ?? message.mittente}
          </span>
          {attachments > 0 && (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 text-[11px] leading-5 tabular-nums text-text-3"
              title={`${attachments} allegati`}
            >
              <Paperclip className="size-3" aria-hidden="true" />
              {attachments}
              <span className="sr-only">allegati</span>
            </span>
          )}
          {message.commessaId != null && (
            <Link2
              className="size-3.5 shrink-0 text-success"
              aria-label="Collegata"
            />
          )}
          {message.stato === "gestita" && (
            <CheckCheck
              className="size-3.5 shrink-0 text-success"
              aria-label="Gestita"
            />
          )}
          <time
            className={cn(
              "shrink-0 text-[11px] leading-5 tabular-nums",
              unread ? "font-bold text-accent-text" : "text-text-3"
            )}
          >
            {shortDate(message.receivedAt)}
          </time>
        </span>
        <span
          className={cn(
            "block w-full truncate text-[15px] leading-5 text-text-1",
            unread ? "font-bold" : "font-semibold"
          )}
        >
          {message.oggetto || "(senza oggetto)"}
        </span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-text-3">
            {preview(message)}
          </span>
          <EmailCategoryBadge
            categoria={message.categoria ?? "da_classificare"}
            className="h-[18px] rounded-[6px]"
          />
        </span>
      </button>
    </div>
  );
}

/**
 * Una sola fascia invece di due: ricerca, filtri, conteggio, selezione
 * multipla e azioni di massa vivono nella stessa riga da 57px. Con la
 * selezione attiva la fascia cambia mestiere e mostra le azioni: la ricerca
 * azzererebbe comunque la selezione, quindi non si perde nulla.
 */
function ListToolbar({
  viewLabel,
  search,
  filtersControl,
  count,
  fetching,
  selectable,
  selectedCount,
  allSelected,
  disabled,
  onSearchChange,
  onToggleAll,
  onClose,
  onSpam,
  onNewsletter,
}: {
  viewLabel: string;
  search: string;
  filtersControl?: ReactNode;
  count: number | null;
  fetching: boolean;
  selectable: boolean;
  selectedCount: number;
  allSelected: boolean;
  disabled: boolean;
  onSearchChange: (value: string) => void;
  onToggleAll: (checked: boolean) => void;
  onClose: () => void;
  onSpam: () => void;
  onNewsletter: () => void;
}) {
  return (
    <div className="flex min-h-14 shrink-0 items-center gap-1.5 border-b border-border-soft bg-surface px-2 py-1.5">
      {selectable ? (
        <label className="grid size-11 shrink-0 cursor-pointer place-items-center">
          <span className="sr-only">Seleziona tutte le email della pagina</span>
          <Checkbox
            checked={allSelected}
            onCheckedChange={value => onToggleAll(value === true)}
            className="size-5"
            aria-label="Seleziona tutte le email della pagina"
          />
        </label>
      ) : (
        <span className="w-1.5 shrink-0" aria-hidden="true" />
      )}

      {selectedCount > 0 ? (
        <>
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-text-1">
            {selectedCount} selezionate
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="size-11"
            disabled={disabled}
            onClick={onClose}
            aria-label="Chiudi email selezionate"
            title="Chiudi"
          >
            <CheckCheck className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-11"
            disabled={disabled}
            onClick={onNewsletter}
            aria-label="Segna le email selezionate come newsletter"
            title="Newsletter"
          >
            <Megaphone className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="dangerGhost"
            className="size-11"
            disabled={disabled}
            onClick={onSpam}
            aria-label="Segna le email selezionate come spam"
            title="Spam"
          >
            <ShieldBan className="size-4" />
          </Button>
        </>
      ) : (
        <>
          <label htmlFor="email-search" className="sr-only">
            Cerca nella coda {viewLabel}
          </label>
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3"
              aria-hidden="true"
            />
            <Input
              id="email-search"
              className="h-11 pl-9"
              placeholder={`Cerca in ${viewLabel}`}
              value={search}
              onChange={event => onSearchChange(event.target.value)}
            />
          </div>
          {fetching ? (
            <span
              className="grid size-6 shrink-0 place-items-center text-text-3"
              role="status"
            >
              <Loader2 className="size-4 motion-safe:animate-spin" />
              <span className="sr-only">Aggiornamento elenco in corso</span>
            </span>
          ) : count != null ? (
            <span
              className="shrink-0 px-0.5 text-xs tabular-nums text-text-3"
              title={`${count} email in questa pagina`}
            >
              {count}
              <span className="sr-only"> email in questa pagina</span>
            </span>
          ) : null}
          {filtersControl}
        </>
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div
      aria-label="Caricamento messaggi"
      className="divide-y divide-border-soft"
    >
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="flex min-h-[70px] gap-3 px-3 py-2">
          <Skeleton className="size-5 shrink-0 rounded-sm" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex justify-between gap-3">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-8" />
            </div>
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function EmailMessageList({
  messages,
  selectedId,
  viewLabel,
  search,
  filtersControl,
  loading,
  fetching,
  error,
  emptyTitle,
  emptyMessage,
  page,
  hasPreviousPage,
  hasNextPage,
  onSearchChange,
  onOpen,
  selectedIds,
  bulkPending,
  onToggleSelected,
  onToggleAll,
  onBulkClose,
  onBulkSpam,
  onBulkNewsletter,
  onRetry,
  onPreviousPage,
  onNextPage,
}: {
  messages: EmailMessage[];
  selectedId: number | null;
  viewLabel: string;
  search: string;
  /** Controllo unico dei filtri, accanto alla ricerca. */
  filtersControl?: ReactNode;
  loading: boolean;
  fetching: boolean;
  error: string | null;
  emptyTitle: string;
  emptyMessage: string;
  page: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  onSearchChange: (value: string) => void;
  onOpen: (message: EmailMessage) => void;
  selectedIds: Set<number>;
  bulkPending: boolean;
  onToggleSelected: (id: number, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onBulkClose: () => void;
  onBulkSpam: () => void;
  onBulkNewsletter: () => void;
  onRetry: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
}) {
  // Il conteggio è onesto: mentre la coda carica o è in errore non esiste
  // ancora un numero da mostrare, e "0" sarebbe una bugia.
  const count = loading || error ? null : messages.length;
  const selectable = !loading && !error && messages.length > 0;

  return (
    <section
      aria-label="Elenco email"
      className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface"
    >
      <ListToolbar
        viewLabel={viewLabel}
        search={search}
        filtersControl={filtersControl}
        count={count}
        fetching={fetching && !loading}
        selectable={selectable}
        selectedCount={selectedIds.size}
        allSelected={
          selectable && messages.every(message => selectedIds.has(message.id))
        }
        disabled={bulkPending}
        onSearchChange={onSearchChange}
        onToggleAll={onToggleAll}
        onClose={onBulkClose}
        onSpam={onBulkSpam}
        onNewsletter={onBulkNewsletter}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <ListSkeleton />
        ) : error ? (
          <div className="p-3">
            <StatePanel
              kind="error"
              compact
              title="Impossibile caricare le email"
              description={error}
              action={
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={onRetry}
                >
                  <RefreshCw className="size-4" />
                  Riprova
                </Button>
              }
            />
          </div>
        ) : messages.length === 0 ? (
          <div className="p-3">
            <StatePanel
              kind="empty"
              compact
              title={emptyTitle}
              description={emptyMessage}
            />
          </div>
        ) : (
          messages.map(message => (
            <MessageRow
              key={message.id}
              message={message}
              selected={message.id === selectedId}
              checked={selectedIds.has(message.id)}
              onOpen={() => onOpen(message)}
              onCheckedChange={checked => onToggleSelected(message.id, checked)}
            />
          ))
        )}
      </div>

      {!loading && !error && (hasPreviousPage || hasNextPage) && (
        <div className="flex min-h-11 shrink-0 items-center justify-between border-t border-border-soft px-2">
          <Button
            size="icon"
            variant="ghost"
            className="size-11"
            disabled={!hasPreviousPage || fetching}
            onClick={onPreviousPage}
            aria-label="Pagina precedente"
            title="Pagina precedente"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-xs tabular-nums text-text-3">
            Pagina {page + 1}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="size-11"
            disabled={!hasNextPage || fetching}
            onClick={onNextPage}
            aria-label="Pagina successiva"
            title="Pagina successiva"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </section>
  );
}
