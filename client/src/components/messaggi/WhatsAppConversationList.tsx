import StatePanel from "@/components/patterns/StatePanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { WhatsAppConversation } from "@/lib/messaggi";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  Link2,
  Loader2,
  MessageCircle,
  RefreshCw,
  Search,
} from "lucide-react";

function shortDate(value: Date | string): string {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
}

function initials(conversation: WhatsAppConversation): string {
  const words = (conversation.nomeProfilo ?? conversation.controparte)
    .split(/\s+/)
    .filter(Boolean);
  return `${words[0]?.[0] ?? "?"}${words[1]?.[0] ?? ""}`.toUpperCase();
}

export default function WhatsAppConversationList({
  conversations,
  selectedKey,
  search,
  loading,
  fetching,
  error,
  page,
  hasPreviousPage,
  hasNextPage,
  onSearchChange,
  onOpen,
  onRetry,
  onPreviousPage,
  onNextPage,
}: {
  conversations: WhatsAppConversation[];
  selectedKey: string | null;
  search: string;
  loading: boolean;
  fetching: boolean;
  error: string | null;
  page: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  onSearchChange: (value: string) => void;
  onOpen: (conversation: WhatsAppConversation) => void;
  onRetry: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
}) {
  const countLabel =
    loading || error ? null : `${conversations.length} in pagina`;

  return (
    <section
      aria-label="Elenco conversazioni WhatsApp"
      className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface"
    >
      <div className="shrink-0 border-b border-border-soft px-3 py-2.5">
        <label className="relative block">
          <span className="sr-only">Cerca conversazioni</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={event => onSearchChange(event.target.value)}
            placeholder="Cerca contatto, numero o commessa"
            className="h-11 pl-9"
          />
        </label>
        <div className="mt-2 flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs font-bold uppercase tracking-[0.12em] text-text-3">
            Conversazioni
          </span>
          {fetching && !loading ? (
            <span
              className="inline-flex shrink-0 items-center gap-1.5 text-xs text-text-3"
              role="status"
            >
              <Loader2 className="size-3.5 motion-safe:animate-spin" />
              Aggiornamento
            </span>
          ) : countLabel ? (
            <span className="shrink-0 text-xs tabular-nums text-text-3">
              {countLabel}
            </span>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="flex min-h-[88px] gap-3 border-b border-border-soft px-3 py-3"
            >
              <Skeleton className="size-10 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))
        ) : error ? (
          <div className="p-3">
            <StatePanel
              kind="error"
              compact
              title="Conversazioni non disponibili"
              description={error}
              action={
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={onRetry}
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Riprova
                </Button>
              }
            />
          </div>
        ) : conversations.length === 0 ? (
          <div className="p-3">
            <StatePanel
              kind="empty"
              compact
              title={search ? "Nessun risultato" : "Nessuna conversazione"}
              description={
                search
                  ? "Nessuna conversazione corrisponde alla ricerca."
                  : "Qui compaiono le conversazioni WhatsApp importate per questa sede."
              }
            />
          </div>
        ) : (
          conversations.map(conversation => {
            const selected = conversation.key === selectedKey;
            return (
              <button
                key={conversation.key}
                type="button"
                onClick={() => onOpen(conversation)}
                aria-current={selected ? "true" : undefined}
                className={cn(
                  "relative flex min-h-[92px] w-full min-w-0 items-start gap-3 border-b border-border-soft px-3 py-3 text-left transition-colors duration-fast focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  selected ? "bg-accent" : "bg-surface hover:bg-surface-2"
                )}
              >
                {selected && (
                  <span
                    className="absolute inset-y-0 left-0 w-[3px] bg-primary"
                    aria-hidden="true"
                  />
                )}
                <div className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-control)] bg-success-soft text-xs font-bold text-success">
                  {initials(conversation)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[15px] font-bold leading-6 text-text-1">
                      {conversation.nomeProfilo ?? conversation.controparte}
                    </span>
                    <time className="shrink-0 text-xs tabular-nums text-text-3">
                      {shortDate(conversation.ultimoMessaggioAt)}
                    </time>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-text-2">
                    {conversation.direzioneUltimoMessaggio === "out"
                      ? "Tu: "
                      : ""}
                    {conversation.ultimoMessaggio || "Media o allegato"}
                  </p>
                  <div className="mt-1.5 flex min-h-5 items-center gap-2 text-[11px] text-text-3">
                    <MessageCircle
                      className="size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="truncate">{conversation.controparte}</span>
                    {conversation.clienteId != null && (
                      <Link2
                        className="ml-auto size-3.5 shrink-0 text-success"
                        aria-label="Cliente collegato"
                      />
                    )}
                    {conversation.nonLetti > 0 && (
                      <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-primary-foreground">
                        {conversation.nonLetti}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {!loading && !error && (hasPreviousPage || hasNextPage) && (
        <div className="flex shrink-0 items-center justify-between border-t border-border-soft px-3 py-1.5">
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
