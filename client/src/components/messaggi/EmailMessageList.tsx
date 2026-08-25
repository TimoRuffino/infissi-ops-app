import TarsAvatar from "@/components/TarsAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import type { EmailMessage, TarsProposal } from "@/lib/messaggi";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Link2,
  Loader2,
  Mail,
  Megaphone,
  Paperclip,
  RefreshCw,
  ShieldBan,
} from "lucide-react";

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
  fonte,
  analizzata,
}: {
  categoria: EmailCategory;
  fonte?: string | null;
  analizzata?: boolean;
}) {
  const meta =
    EMAIL_CATEGORY_UI[categoria] ?? EMAIL_CATEGORY_UI.da_classificare;
  const inAttesa = categoria === "da_classificare" && analizzata === false;
  const dubbioTars = categoria === "da_classificare" && fonte === "tars";

  return (
    <Badge
      variant="outline"
      className={cn("h-5 max-w-full px-1.5 text-[10px]", meta.className)}
    >
      <span className="truncate">
        {inAttesa
          ? "In attesa di Tars"
          : dubbioTars
            ? "Dubbio Tars"
            : meta.label}
      </span>
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

function initials(message: EmailMessage): string {
  const name = (message.mittenteNome ?? message.mittente ?? "?").trim();
  const parts = name.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function preview(message: EmailMessage): string {
  return (
    String(message.testo ?? "")
      .replace(/\s+/g, " ")
      .trim() || "Nessuna anteprima"
  );
}

function MessageRow({
  message,
  selected,
  checked,
  hasTarsProposal,
  onOpen,
  onCheckedChange,
}: {
  message: EmailMessage;
  selected: boolean;
  checked: boolean;
  hasTarsProposal: boolean;
  onOpen: () => void;
  onCheckedChange: (checked: boolean) => void;
}) {
  const unread = message.stato === "nuova";

  return (
    <div
      className={cn(
        "relative flex min-h-[120px] w-full min-w-0 items-start border-b border-border-soft transition-colors duration-fast",
        selected
          ? "bg-accent/70"
          : unread
            ? "bg-primary-soft/35 hover:bg-primary-soft/55"
            : "bg-card hover:bg-muted/65"
      )}
    >
      {unread && (
        <span
          className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-accent-brand"
          aria-hidden="true"
        />
      )}
      <label
        htmlFor={`email-select-${message.id}`}
        className="ml-1 mt-2 grid size-10 shrink-0 cursor-pointer place-items-center"
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
        className="flex min-w-0 flex-1 items-start gap-3 px-1 py-3 pr-3 text-left focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <div
          className={cn(
            "mt-0.5 grid size-10 shrink-0 place-items-center rounded-md text-xs font-bold",
            unread
              ? "bg-primary text-primary-foreground shadow-xs"
              : "bg-surface-2 text-text-2"
          )}
        >
          {initials(message)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Mail
              className="size-3.5 shrink-0 text-text-3"
              aria-hidden="true"
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                unread
                  ? "font-bold text-foreground"
                  : "font-semibold text-text-2"
              )}
            >
              {message.mittenteNome ?? message.mittente}
            </span>
            <time
              className={cn(
                "shrink-0 text-[11px] tabular-nums",
                unread ? "font-bold text-accent-text" : "text-text-3"
              )}
            >
              {shortDate(message.receivedAt)}
            </time>
          </div>
          <div
            className={cn(
              "mt-0.5 truncate text-sm",
              unread ? "font-semibold text-foreground" : "text-text-2"
            )}
          >
            {message.oggetto || "(senza oggetto)"}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-text-3">
            {preview(message)}
          </p>
          <div className="mt-1 flex min-h-5 min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-text-3">
            <EmailCategoryBadge
              categoria={message.categoria ?? "da_classificare"}
              fonte={message.classificazioneFonte}
              analizzata={message.tarsAnalizzata}
            />
            {(message.allegati?.length ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 rounded-sm bg-surface-2 px-1.5 py-0.5">
                <Paperclip className="size-3" />
                Allegati {message.allegati.length}
              </span>
            )}
            {message.commessaId != null && (
              <span className="inline-flex items-center gap-1 rounded-sm bg-success/10 px-1.5 py-0.5 text-success">
                <Link2 className="size-3" />
                Collegata
              </span>
            )}
            {hasTarsProposal && (
              <span className="inline-flex items-center gap-1 rounded-sm bg-primary-soft px-1.5 py-0.5 text-primary">
                <TarsAvatar size="sm" className="size-4" />
                Tars
              </span>
            )}
            {message.stato === "gestita" && (
              <CheckCheck
                className="ml-auto size-3.5 text-success"
                aria-label="Gestita"
              />
            )}
          </div>
        </div>
      </button>
    </div>
  );
}

function BulkToolbar({
  selectedCount,
  allSelected,
  disabled,
  onToggleAll,
  onClose,
  onSpam,
  onNewsletter,
}: {
  selectedCount: number;
  allSelected: boolean;
  disabled: boolean;
  onToggleAll: (checked: boolean) => void;
  onClose: () => void;
  onSpam: () => void;
  onNewsletter: () => void;
}) {
  return (
    <div className="flex min-h-12 shrink-0 items-center gap-1 border-b border-border-soft bg-surface-2/70 px-2">
      <label className="grid size-10 shrink-0 cursor-pointer place-items-center">
        <span className="sr-only">Seleziona tutte le email della pagina</span>
        <Checkbox
          checked={allSelected}
          onCheckedChange={value => onToggleAll(value === true)}
          className="size-5"
          aria-label="Seleziona tutte le email della pagina"
        />
      </label>
      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-text-2">
        {selectedCount > 0 ? `${selectedCount} selezionate` : "Seleziona"}
      </span>
      {selectedCount > 0 && (
        <>
          <Button
            size="icon"
            variant="ghost"
            className="size-10"
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
            className="size-10"
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
            className="size-10"
            disabled={disabled}
            onClick={onSpam}
            aria-label="Segna le email selezionate come spam"
            title="Spam"
          >
            <ShieldBan className="size-4" />
          </Button>
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
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex min-h-[104px] gap-3 px-3 py-3">
          <Skeleton className="size-10 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex justify-between gap-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-10" />
            </div>
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-5 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function EmailMessageList({
  messages,
  selectedId,
  proposalsByMessage,
  viewLabel,
  loading,
  fetching,
  error,
  emptyMessage,
  page,
  hasPreviousPage,
  hasNextPage,
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
  proposalsByMessage: Map<number, TarsProposal[]>;
  viewLabel: string;
  loading: boolean;
  fetching: boolean;
  error: string | null;
  emptyMessage: string;
  page: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
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
  return (
    <section
      aria-label="Elenco email"
      className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-card"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-soft px-3">
        <span className="min-w-0 flex-1 truncate text-xs font-bold uppercase text-text-3">
          {viewLabel}
        </span>
        {fetching && !loading && (
          <span
            className="inline-flex items-center gap-1.5 text-xs text-text-3"
            role="status"
          >
            <Loader2 className="size-3.5 animate-spin" />
            Aggiornamento
          </span>
        )}
        {!fetching && (
          <span className="text-xs tabular-nums text-text-3">
            {messages.length}
          </span>
        )}
      </div>

      {!loading && !error && messages.length > 0 && (
        <BulkToolbar
          selectedCount={selectedIds.size}
          allSelected={messages.every(message => selectedIds.has(message.id))}
          disabled={bulkPending}
          onToggleAll={onToggleAll}
          onClose={onBulkClose}
          onSpam={onBulkSpam}
          onNewsletter={onBulkNewsletter}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <ListSkeleton />
        ) : error ? (
          <div className="grid min-h-64 place-items-center px-5 py-10 text-center">
            <div>
              <AlertCircle className="mx-auto size-6 text-destructive" />
              <p className="mt-3 text-sm font-semibold">
                Impossibile caricare le email
              </p>
              <p className="mt-1 text-xs leading-5 text-text-3">{error}</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-4"
                onClick={onRetry}
              >
                <RefreshCw className="size-3.5" />
                Riprova
              </Button>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="grid min-h-64 place-items-center px-5 py-10 text-center">
            <div>
              <div className="mx-auto grid size-11 place-items-center rounded-md bg-surface-2 text-text-3">
                <Inbox className="size-5" />
              </div>
              <p className="mt-3 max-w-xs text-sm leading-6 text-text-3">
                {emptyMessage}
              </p>
            </div>
          </div>
        ) : (
          messages.map(message => (
            <MessageRow
              key={message.id}
              message={message}
              selected={message.id === selectedId}
              checked={selectedIds.has(message.id)}
              hasTarsProposal={proposalsByMessage.has(message.id)}
              onOpen={() => onOpen(message)}
              onCheckedChange={checked => onToggleSelected(message.id, checked)}
            />
          ))
        )}
      </div>

      {!loading && !error && (hasPreviousPage || hasNextPage) && (
        <div className="flex h-12 shrink-0 items-center justify-between border-t border-border-soft px-3">
          <Button
            size="icon"
            variant="ghost"
            className="size-10"
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
            className="size-10"
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
