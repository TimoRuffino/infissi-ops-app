import WhatsAppContextPanel from "@/components/messaggi/WhatsAppContextPanel";
import WhatsAppConversationList from "@/components/messaggi/WhatsAppConversationList";
import WhatsAppThread from "@/components/messaggi/WhatsAppThread";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  communicationIdsForConversation,
  parseConversationKey,
  parseWhatsAppConversationSelection,
  whatsappConversationHref,
  type WhatsAppConversation,
} from "@/lib/messaggi";
import { trpc } from "@/lib/trpc";
import { AlertCircle, ArrowLeft, MessageCircle, RefreshCw } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

const PAGE_SIZE = 50;

function selectedFromLocation(): string | null {
  return parseWhatsAppConversationSelection(window.location.search).key;
}

function replaceConversationQuery(key: string | null) {
  const url = key ? whatsappConversationHref(key) : "/messaggi/whatsapp";
  window.history.replaceState(null, "", url);
}

export default function WhatsAppPage() {
  const [selectedKey, setSelectedKey] = useState<string | null>(() => selectedFromLocation());
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [page, setPage] = useState(0);
  const [mobile, setMobile] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [loadedThread, setLoadedThread] = useState<{ key: string; ids: number[] }>({ key: "", ids: [] });
  const lastViewedKey = useRef<string | null>(null);
  const utils = trpc.useUtils();
  const conversations = trpc.mail.whatsapp.conversazioni.useQuery({
    search: deferredSearch.trim() || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
  const selected = useMemo(
    () => (conversations.data ?? []).find(conversation => conversation.key === selectedKey) ?? null,
    [conversations.data, selectedKey]
  );
  const selectedKeyParts = parseConversationKey(selectedKey);
  const selectedThread = trpc.mail.whatsapp.thread.useQuery(
    selectedKeyParts
      ? {
          casellaId: selectedKeyParts.casellaId,
          controparte: selectedKeyParts.controparte,
          limit: 1,
        }
      : { casellaId: 0, controparte: "0", limit: 1 },
    { enabled: selected == null && selectedKeyParts != null, retry: false }
  );
  const selectedConversation = selected ?? selectedThread.data?.conversazione ?? null;
  const communicationIds = selectedConversation
    ? communicationIdsForConversation(selectedConversation.key, loadedThread)
    : [];
  const handleMessageIdsChange = useCallback(
    (conversationKey: string, ids: number[]) => {
      setLoadedThread({ key: conversationKey, ids });
    },
    []
  );
  const markViewed = trpc.mail.whatsapp.segnaVista.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.mail.whatsapp.conversazioni.invalidate(),
        utils.mail.whatsapp.thread.invalidate(),
      ]);
    },
  });

  useEffect(() => {
    if (!selectedConversation) {
      lastViewedKey.current = null;
      return;
    }
    if (lastViewedKey.current === selectedConversation.key) return;
    lastViewedKey.current = selectedConversation.key;
    markViewed.mutate({
      casellaId: selectedConversation.casellaId,
      controparte: selectedConversation.controparte,
    });
  }, [selectedConversation?.key]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const onPopState = () => setSelectedKey(selectedFromLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => setPage(0), [deferredSearch]);

  const openConversation = (conversation: WhatsAppConversation) => {
    setSelectedKey(conversation.key);
    replaceConversationQuery(conversation.key);
  };
  const closeConversation = () => {
    setSelectedKey(null);
    replaceConversationQuery(null);
    setContextOpen(false);
  };
  const retrySelectedConversation = () => {
    if (selectedKeyParts) {
      void selectedThread.refetch();
      return;
    }
    setSelectedKey(null);
    window.setTimeout(() => setSelectedKey(selectedFromLocation()), 0);
  };
  const showList = !mobile || selectedKey == null;
  const selectionError =
    selectedKey != null && selectedKeyParts == null
      ? "Il link alla conversazione non è valido."
      : selectedThread.isError
        ? selectedThread.error.message
        : null;

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-h-[620px] min-w-0 flex-col gap-3 overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-md bg-success/10 text-success">
            <MessageCircle className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight sm:text-2xl">WhatsApp</h1>
            <p className="truncate text-sm text-text-2">Conversazioni, contatti e cronologia</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="h-8 border-info/25 bg-info/10 px-2 text-xs text-info">Sola lettura</Badge>
          <Button size="icon" variant="outline" className="size-11 sm:h-10 sm:w-auto sm:px-3" disabled={conversations.isFetching} onClick={() => conversations.refetch()} aria-label="Aggiorna elenco WhatsApp" title="Aggiorna elenco">
            <RefreshCw className={conversations.isFetching ? "size-4 animate-spin" : "size-4"} />
            <span className="hidden sm:inline">Aggiorna</span>
          </Button>
        </div>
      </header>

      <section className="grid min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border border-border-soft bg-card lg:grid-cols-[minmax(18rem,0.9fr)_minmax(28rem,1.6fr)_minmax(17rem,0.8fr)]">
        {showList && (
          <WhatsAppConversationList
            conversations={conversations.data ?? []}
            selectedKey={selectedKey}
            search={search}
            loading={conversations.isLoading}
            fetching={conversations.isFetching}
            error={conversations.error?.message ?? null}
            page={page}
            hasPreviousPage={page > 0}
            hasNextPage={(conversations.data?.length ?? 0) === PAGE_SIZE}
            onSearchChange={setSearch}
            onOpen={openConversation}
            onRetry={() => conversations.refetch()}
            onPreviousPage={() => setPage(value => Math.max(0, value - 1))}
            onNextPage={() => setPage(value => value + 1)}
          />
        )}
        {selectedConversation ? (
          <WhatsAppThread conversation={selectedConversation} mobile={mobile} onBack={closeConversation} onOpenContext={() => setContextOpen(true)} onMessageIdsChange={handleMessageIdsChange} />
        ) : selectionError ? (
          <div className="grid min-w-0 place-items-center border-l border-border-soft px-5 text-center" role="alert">
            <div className="max-w-sm">
              <AlertCircle className="mx-auto size-6 text-destructive" aria-hidden="true" />
              <h2 className="mt-3 text-sm font-bold">Conversazione non disponibile</h2>
              <p className="mt-1 text-xs leading-5 text-text-3">{selectionError}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button variant="outline" className="min-h-11" onClick={retrySelectedConversation}>
                  <RefreshCw className="size-4" />
                  Riprova
                </Button>
                <Button variant="outline" className="min-h-11" onClick={closeConversation}>
                  <ArrowLeft className="size-4" />
                  Torna all'elenco
                </Button>
              </div>
            </div>
          </div>
        ) : selectedKey && selectedThread.isLoading ? (
          <div className="grid min-w-0 place-items-center border-l border-border-soft px-5 text-sm text-text-3">Caricamento conversazione...</div>
        ) : !mobile && (
          <div className="grid min-w-0 place-items-center border-l border-border-soft px-5 text-center text-sm text-text-3">
            Seleziona una conversazione per leggere la cronologia.
          </div>
        )}
        {selectedConversation && <div className="hidden min-h-0 border-l border-border-soft lg:block"><WhatsAppContextPanel conversation={selectedConversation} communicationIds={communicationIds} /></div>}
      </section>

      {selectedConversation && (
        <Sheet open={contextOpen} onOpenChange={setContextOpen}>
          <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md lg:hidden">
            <SheetHeader className="border-b border-border-soft pr-12">
              <SheetTitle>Contesto conversazione</SheetTitle>
              <SheetDescription>{selectedConversation.nomeProfilo ?? selectedConversation.controparte}</SheetDescription>
            </SheetHeader>
            <WhatsAppContextPanel conversation={selectedConversation} communicationIds={communicationIds} />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
