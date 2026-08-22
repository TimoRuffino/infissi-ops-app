import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { WhatsAppConversation, WhatsAppThread } from "@/lib/messaggi";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  ArrowLeft,
  ChevronUp,
  FileText,
  Loader2,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Save,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

function timestamp(value: Date | string): string {
  return new Date(value).toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function WhatsAppThread({
  conversation,
  mobile,
  onBack,
  onOpenContext,
}: {
  conversation: WhatsAppConversation;
  mobile: boolean;
  onBack: () => void;
  onOpenContext: () => void;
}) {
  const utils = trpc.useUtils();
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousHeight = useRef<number | null>(null);
  const [before, setBefore] = useState<{ receivedAt: Date; id: number } | null>(null);
  const [nextBefore, setNextBefore] = useState<{ receivedAt: Date; id: number } | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [olderMessages, setOlderMessages] = useState<WhatsAppThread["messaggi"]>([]);
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
      : { casellaId: conversation.casellaId, controparte: conversation.controparte, limit: 50 },
    { enabled: before != null }
  );
  const rename = trpc.mail.whatsapp.rinominaConversazione.useMutation({
    onSuccess: () => {
      toast.success(name.trim() ? "Nome conversazione aggiornato" : "Nome conversazione rimosso");
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
    const viewport = viewportRef.current;
    if (viewport && previousHeight.current != null) {
      viewport.scrollTop += viewport.scrollHeight - previousHeight.current;
    }
    setBefore(null);
  }, [older.data]);

  const messages = [...olderMessages, ...(current.data?.messaggi ?? [])];
  const loadOlder = () => {
    if (!hasOlder || !nextBefore || older.isFetching) return;
    previousHeight.current = viewportRef.current?.scrollHeight ?? null;
    setBefore(nextBefore);
  };

  if (current.isLoading) {
    return (
      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
        <div className="flex items-center gap-3 border-b border-border-soft px-4 py-3">
          <Skeleton className="size-10 rounded-md" />
          <div className="flex-1 space-y-2"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-24" /></div>
        </div>
        <div className="space-y-3 p-4"><Skeleton className="ml-auto h-16 w-3/5" /><Skeleton className="h-16 w-3/5" /></div>
      </section>
    );
  }

  if (current.isError || !current.data) {
    return (
      <section className="grid min-h-0 min-w-0 flex-1 place-items-center bg-card px-5 text-center">
        <div>
          <AlertCircle className="mx-auto size-6 text-destructive" />
          <p className="mt-3 text-sm font-semibold">Conversazione non disponibile</p>
          <p className="mt-1 text-xs leading-5 text-text-3">{current.error?.message}</p>
          <div className="mt-4 flex justify-center gap-2">
            {mobile && <Button size="sm" variant="outline" onClick={onBack}><ArrowLeft className="size-3.5" />Elenco</Button>}
            <Button size="sm" variant="outline" onClick={() => current.refetch()}>Riprova</Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
      <header className="flex shrink-0 items-center gap-2 border-b border-border-soft px-3 py-3 sm:px-4">
        {mobile && (
          <Button size="icon" variant="ghost" className="size-11" onClick={onBack} aria-label="Torna all'elenco" title="Torna all'elenco">
            <ArrowLeft className="size-5" />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          {editingName ? (
            <div className="flex min-w-0 items-center gap-2">
              <label className="sr-only" htmlFor="nome-conversazione">Nome conversazione</label>
              <Input id="nome-conversazione" value={name} onChange={event => setName(event.target.value)} className="h-10" maxLength={100} autoFocus />
              <Button size="icon" className="size-11" disabled={rename.isPending} onClick={() => rename.mutate({ casellaId: conversation.casellaId, controparte: conversation.controparte, nome: name })} aria-label="Salva nome conversazione" title="Salva nome"><Save className="size-4" /></Button>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-bold">{conversation.nomeProfilo ?? conversation.controparte}</h2>
                <p className="truncate text-xs text-text-3">{conversation.controparte}</p>
              </div>
              {conversation.clienteId == null && (
                <Button size="icon" variant="ghost" className="size-11 shrink-0" onClick={() => setEditingName(true)} aria-label="Rinomina conversazione" title="Rinomina conversazione"><Pencil className="size-4" /></Button>
              )}
            </div>
          )}
        </div>
        <Button size="icon" variant="ghost" className="size-11 shrink-0 lg:hidden" onClick={onOpenContext} aria-label="Apri contesto conversazione" title="Contesto"><MoreHorizontal className="size-5" /></Button>
      </header>

      <div ref={viewportRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4">
        {(hasOlder || olderMessages.length > 0) && (
          <div className="mb-4 flex justify-center">
            <Button size="sm" variant="outline" disabled={!hasOlder || older.isFetching} onClick={loadOlder}>
              {older.isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <ChevronUp className="size-3.5" />}
              Carica precedenti
            </Button>
          </div>
        )}
        <div className="space-y-3">
          {messages.map(message => (
            <article key={message.id} className={cn("flex", message.direzione === "out" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] rounded-md border px-3 py-2.5 text-sm shadow-xs sm:max-w-[72%]", message.direzione === "out" ? "border-primary/20 bg-primary-soft text-foreground" : "border-border-soft bg-surface text-foreground")}>
                <p className="whitespace-pre-wrap break-words leading-6">{message.testo || message.oggetto || "Media o allegato"}</p>
                {message.allegati.length > 0 && (
                  <div className="mt-2 space-y-1.5 border-t border-border-soft pt-2">
                    {message.allegati.map((attachment, index) => (
                      <button key={`${attachment.nome}-${index}`} type="button" className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-sm px-1 text-left text-xs text-text-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {attachment.mediaId ? <Paperclip className="size-4 shrink-0" /> : <FileText className="size-4 shrink-0" />}
                        <span className="truncate">{attachment.nome}</span>
                      </button>
                    ))}
                  </div>
                )}
                <time className="mt-1 block text-right text-[10px] tabular-nums text-text-3">{timestamp(message.receivedAt)}</time>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
