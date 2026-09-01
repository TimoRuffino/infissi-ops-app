import StatePanel from "@/components/patterns/StatePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  restoredScrollTop,
  initialThreadScrollTop,
  type WhatsAppConversation,
  type WhatsAppThread,
} from "@/lib/messaggi";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ChevronUp,
  Eye,
  FileText,
  Loader2,
  PanelRight,
  Paperclip,
  Pencil,
  Save,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

function timestamp(value: Date | string): string {
  return new Date(value).toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function clock(value: Date | string): string {
  return new Date(value).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dayKey(value: Date | string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Una conversazione lunga si legge per giornate. Il separatore toglie la data
 * da ogni bolla e lascia l'ora: meno rumore, stesso dato.
 */
function dayLabel(value: Date | string): string {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(date) === dayKey(today)) return "Oggi";
  if (dayKey(date) === dayKey(yesterday)) return "Ieri";
  return date.toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function fileSize(value: number): string {
  if (value <= 0) return "Dimensione non disponibile";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function WhatsAppThread({
  conversation,
  mobile,
  onBack,
  onOpenContext,
  onMessageIdsChange,
}: {
  conversation: WhatsAppConversation;
  mobile: boolean;
  onBack: () => void;
  onOpenContext: () => void;
  onMessageIdsChange: (conversationKey: string, ids: number[]) => void;
}) {
  const utils = trpc.useUtils();
  const viewportRef = useRef<HTMLDivElement>(null);
  const pendingScrollRestore = useRef<{ top: number; height: number } | null>(
    null
  );
  const initiallyScrolledKey = useRef<string | null>(null);
  const [before, setBefore] = useState<{ receivedAt: Date; id: number } | null>(
    null
  );
  const [nextBefore, setNextBefore] = useState<{
    receivedAt: Date;
    id: number;
  } | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [olderMessages, setOlderMessages] = useState<
    WhatsAppThread["messaggi"]
  >([]);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(conversation.aliasOperatore ?? "");
  const current = trpc.mail.whatsapp.thread.useQuery({
    casellaId: conversation.casellaId,
    controparte: conversation.controparte,
    limit: 50,
  });
  const older = trpc.mail.whatsapp.thread.useQuery(
    before
      ? {
          casellaId: conversation.casellaId,
          controparte: conversation.controparte,
          before,
          limit: 50,
        }
      : {
          casellaId: conversation.casellaId,
          controparte: conversation.controparte,
          limit: 50,
        },
    { enabled: before != null }
  );
  const rename = trpc.mail.whatsapp.rinominaConversazione.useMutation({
    onSuccess: () => {
      toast.success(
        name.trim()
          ? "Nome conversazione aggiornato"
          : "Nome conversazione rimosso"
      );
      setEditingName(false);
      void utils.mail.whatsapp.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    setBefore(null);
    setNextBefore(null);
    setHasOlder(false);
    setOlderMessages([]);
    pendingScrollRestore.current = null;
    setEditingName(false);
    setName(conversation.aliasOperatore ?? "");
  }, [conversation.key]);

  useEffect(() => {
    if (!current.data || olderMessages.length > 0) return;
    setNextBefore(current.data.nextBefore);
    setHasOlder(current.data.hasMore);
  }, [current.data, olderMessages.length]);

  useEffect(() => {
    if (!older.data || !before) return;
    setOlderMessages(messages => [...older.data.messaggi, ...messages]);
    setNextBefore(older.data.nextBefore);
    setHasOlder(older.data.hasMore);
    setBefore(null);
  }, [older.data]);

  const messages = useMemo(
    () => [...olderMessages, ...(current.data?.messaggi ?? [])],
    [current.data?.messaggi, olderMessages]
  );
  const messageIdsKey = messages.map(message => message.id).join(",");

  useEffect(() => {
    onMessageIdsChange(
      conversation.key,
      messages.map(message => message.id)
    );
  }, [conversation.key, messageIdsKey, onMessageIdsChange]);

  useLayoutEffect(() => {
    const snapshot = pendingScrollRestore.current;
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (snapshot) {
      viewport.scrollTop = restoredScrollTop(
        snapshot.top,
        snapshot.height,
        viewport.scrollHeight
      );
      pendingScrollRestore.current = null;
      return;
    }
    if (current.data && initiallyScrolledKey.current !== conversation.key) {
      viewport.scrollTop = initialThreadScrollTop(viewport.scrollHeight);
      initiallyScrolledKey.current = conversation.key;
    }
  }, [conversation.key, current.data, olderMessages.length]);
  const loadOlder = () => {
    if (!hasOlder || !nextBefore || older.isFetching) return;
    const viewport = viewportRef.current;
    pendingScrollRestore.current = viewport
      ? { top: viewport.scrollTop, height: viewport.scrollHeight }
      : null;
    setBefore(nextBefore);
  };

  if (current.isLoading) {
    return (
      <section className="flex min-h-0 min-w-0 flex-col bg-surface lg:border-l lg:border-border-soft">
        <div className="flex items-center gap-3 border-b border-border-soft px-4 py-3">
          <Skeleton className="size-10 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <div className="space-y-3 p-4 sm:p-5">
          <Skeleton className="ml-auto h-16 w-3/5" />
          <Skeleton className="h-16 w-3/5" />
        </div>
      </section>
    );
  }

  if (current.isError || !current.data) {
    return (
      <section className="min-h-0 min-w-0 overflow-y-auto bg-surface p-4 lg:border-l lg:border-border-soft">
        <StatePanel
          kind="error"
          title="Conversazione non disponibile"
          description={
            current.error?.message ??
            "La cronologia non è stata caricata. Riprova."
          }
          action={
            <>
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => current.refetch()}
              >
                Riprova
              </Button>
              {mobile && (
                <Button variant="outline" className="min-h-11" onClick={onBack}>
                  <ArrowLeft className="size-4" />
                  Torna all'elenco
                </Button>
              )}
            </>
          }
        />
      </section>
    );
  }

  let renderedDay: string | null = null;

  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-surface lg:border-l lg:border-border-soft">
      <header className="flex shrink-0 items-center gap-2 border-b border-border-soft px-3 py-2.5 sm:px-5">
        {mobile && (
          <Button
            size="icon"
            variant="ghost"
            className="size-11 shrink-0"
            onClick={onBack}
            aria-label="Torna all'elenco"
            title="Torna all'elenco"
          >
            <ArrowLeft className="size-5" />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          {editingName ? (
            <div className="flex min-w-0 items-center gap-2">
              <label className="sr-only" htmlFor="nome-conversazione">
                Nome conversazione
              </label>
              <Input
                id="nome-conversazione"
                value={name}
                onChange={event => setName(event.target.value)}
                className="h-11"
                maxLength={100}
                autoFocus
              />
              <Button
                size="icon"
                className="size-11"
                disabled={rename.isPending}
                onClick={() =>
                  rename.mutate({
                    casellaId: conversation.casellaId,
                    controparte: conversation.controparte,
                    nome: name,
                  })
                }
                aria-label="Salva nome conversazione"
                title="Salva nome"
              >
                <Save className="size-4" />
              </Button>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold leading-6">
                  {conversation.nomeProfilo ?? conversation.controparte}
                </h2>
                <p className="truncate text-[13px] leading-5 text-text-3">
                  {conversation.controparte}
                </p>
              </div>
              {/* Sempre, anche con un cliente collegato: l'alias è
                  l'etichetta dell'operatore e ora vince sul nome CRM, che
                  resta comunque scritto nel pannello Contesto. */}
              <Button
                size="icon"
                variant="ghost"
                className="size-11 shrink-0"
                onClick={() => setEditingName(true)}
                aria-label="Rinomina conversazione"
                title="Rinomina conversazione"
              >
                <Pencil className="size-4" />
              </Button>
            </div>
          )}
        </div>
        {/* Sopra i 1280px il badge sta accanto al titolo di pagina: qui serve
            solo quando il workspace è compresso e il lettore riempie tutto. */}
        <Badge
          variant="outline"
          className="h-8 shrink-0 gap-1.5 border-info/25 bg-info-soft px-2 text-xs text-info xl:hidden"
        >
          <Eye className="size-3.5" aria-hidden="true" />
          Sola lettura
        </Badge>
        <Button
          size="icon"
          variant="ghost"
          className="size-11 shrink-0 xl:hidden"
          onClick={onOpenContext}
          aria-label="Apri contesto conversazione"
          title="Contesto"
        >
          <PanelRight className="size-5" />
        </Button>
      </header>

      <div
        ref={viewportRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5 lg:px-6"
      >
        {(hasOlder || olderMessages.length > 0) && (
          <div className="mb-4 flex justify-center">
            <Button
              variant="outline"
              className="min-h-11"
              disabled={!hasOlder || older.isFetching}
              onClick={loadOlder}
            >
              {older.isFetching ? (
                <Loader2 className="size-3.5 motion-safe:animate-spin" />
              ) : (
                <ChevronUp className="size-3.5" />
              )}
              Carica precedenti
            </Button>
          </div>
        )}
        {messages.length === 0 && (
          <StatePanel
            kind="empty"
            compact
            title="Nessun messaggio importato"
            description="La conversazione esiste ma non ha ancora messaggi sincronizzati nel CRM."
          />
        )}
        <div className="space-y-3">
          {messages.map(message => {
            const day = dayKey(message.receivedAt);
            const openDay = day !== renderedDay;
            renderedDay = day;
            const outgoing = message.direzione === "out";

            return (
              <Fragment key={message.id}>
                {openDay && (
                  <div className="flex justify-center pt-1">
                    <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-text-2">
                      {dayLabel(message.receivedAt)}
                    </span>
                  </div>
                )}
                <article
                  className={cn(
                    "flex",
                    outgoing ? "justify-end" : "justify-start"
                  )}
                >
                  {/* La bolla non va mai a tutta larghezza: su desktop la
                      misura di riga si ferma prima che il testo diventi una
                      striscia da rileggere due volte. */}
                  <div
                    className={cn(
                      "max-w-[86%] rounded-[var(--radius-control)] border px-3.5 py-2.5 shadow-xs sm:max-w-[min(78%,38rem)]",
                      outgoing
                        ? "border-primary/20 bg-primary-soft text-text-1"
                        : "border-border-soft bg-surface-2 text-text-1"
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words text-base leading-[1.6] [overflow-wrap:anywhere]">
                      {message.testo || message.oggetto || "Media o allegato"}
                    </p>
                    {message.allegati.length > 0 && (
                      <div className="mt-2.5 space-y-1.5 border-t border-border-soft pt-2.5">
                        {message.allegati.map((attachment, index) => (
                          <div
                            key={`${attachment.nome}-${index}`}
                            className="flex min-h-11 w-full min-w-0 items-center gap-2 px-1 text-left text-[13px] text-text-2"
                          >
                            {attachment.mediaId ? (
                              <Paperclip className="size-4 shrink-0" />
                            ) : (
                              <FileText className="size-4 shrink-0" />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-semibold text-text-1">
                                {attachment.nome}
                              </span>
                              <span className="block truncate text-xs text-text-3">
                                {attachment.mimeType || "Tipo non disponibile"}{" "}
                                · {fileSize(attachment.size)}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <time
                      className="mt-1.5 block text-right text-[11px] tabular-nums text-text-3"
                      title={timestamp(message.receivedAt)}
                    >
                      {clock(message.receivedAt)}
                    </time>
                  </div>
                </article>
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* Nessuna casella di invio: WhatsApp resta un archivio consultabile.
          Scriverlo evita che qualcuno cerchi il campo che non esiste. */}
      <p className="shrink-0 border-t border-border-soft px-3 py-2 text-[13px] leading-5 text-text-3 sm:px-5">
        Sola lettura: le risposte partono dal telefono aziendale, il CRM
        conserva la cronologia.
      </p>
    </section>
  );
}
