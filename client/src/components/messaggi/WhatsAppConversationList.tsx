import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { WhatsAppConversation } from "@/lib/messaggi";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Link2,
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
  return (
    <section
      aria-label="Elenco conversazioni WhatsApp"
      className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-card"
    >
      <div className="shrink-0 border-b border-border-soft p-3">
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex min-h-[88px] gap-3 border-b border-border-soft px-3 py-3">
              <Skeleton className="size-10 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-3/5" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))
        ) : error ? (
          <div className="grid min-h-64 place-items-center px-5 py-10 text-center">
            <div>
              <AlertCircle className="mx-auto size-6 text-destructive" />
              <p className="mt-3 text-sm font-semibold">Conversazioni non disponibili</p>
              <p className="mt-1 text-xs leading-5 text-text-3">{error}</p>
              <Button size="sm" variant="outline" className="mt-4" onClick={onRetry}>
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Riprova
              </Button>
            </div>
          </div>
        ) : conversations.length === 0 ? (
          <div className="grid min-h-64 place-items-center px-5 py-10 text-center">
            <div>
              <div className="mx-auto grid size-11 place-items-center rounded-md bg-surface-2 text-text-3">
                <Inbox className="size-5" aria-hidden="true" />
              </div>
              <p className="mt-3 max-w-xs text-sm leading-6 text-text-3">
                Nessuna conversazione corrisponde alla ricerca.
              </p>
            </div>
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
                  "flex min-h-[88px] w-full min-w-0 items-start gap-3 border-b border-border-soft px-3 py-3 text-left transition-colors duration-fast focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  selected ? "bg-accent/70" : "bg-card hover:bg-muted/65"
                )}
              >
                <div className="grid size-10 shrink-0 place-items-center rounded-md bg-success/10 text-xs font-bold text-success">
                  {initials(conversation)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">
                      {conversation.nomeProfilo ?? conversation.controparte}
                    </span>
                    <time className="shrink-0 text-[11px] tabular-nums text-text-3">
                      {shortDate(conversation.ultimoMessaggioAt)}
                    </time>
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs leading-5 text-text-2">
                    {conversation.direzioneUltimoMessaggio === "out" ? "Tu: " : ""}
                    {conversation.ultimoMessaggio || "Media o allegato"}
                  </p>
                  <div className="mt-1 flex min-h-5 items-center gap-2 text-[11px] text-text-3">
                    <MessageCircle className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{conversation.controparte}</span>
                    {conversation.clienteId != null && (
                      <Link2 className="ml-auto size-3.5 shrink-0 text-success" aria-label="Cliente collegato" />
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

      {(hasPreviousPage || hasNextPage) && (
        <div className="flex h-12 shrink-0 items-center justify-between border-t border-border-soft px-3">
          <Button size="icon" variant="ghost" className="size-11" disabled={!hasPreviousPage || fetching} onClick={onPreviousPage} aria-label="Pagina precedente" title="Pagina precedente">
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-xs tabular-nums text-text-3">Pagina {page + 1}</span>
          <Button size="icon" variant="ghost" className="size-11" disabled={!hasNextPage || fetching} onClick={onNextPage} aria-label="Pagina successiva" title="Pagina successiva">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </section>
  );
}
