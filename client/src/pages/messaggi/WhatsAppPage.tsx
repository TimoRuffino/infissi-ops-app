import WhatsAppContextPanel from "@/components/messaggi/WhatsAppContextPanel";
import WhatsAppConversationList from "@/components/messaggi/WhatsAppConversationList";
import WhatsAppThread from "@/components/messaggi/WhatsAppThread";
import PageHeader from "@/components/patterns/PageHeader";
import StatePanel from "@/components/patterns/StatePanel";
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
import { cn } from "@/lib/utils";
import { ArrowLeft, Eye, Loader2, RefreshCw } from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const PAGE_SIZE = 50;

// Tri-pane solo da 1280px; sotto i 1024px un pane alla volta.
const SINGLE_PANE_QUERY = "(max-width: 1023px)";
const TRI_PANE_QUERY = "(min-width: 1280px)";

function selectedFromLocation(): string | null {
  return parseWhatsAppConversationSelection(window.location.search).key;
}

function replaceConversationQuery(key: string | null) {
  const url = key ? whatsappConversationHref(key) : "/messaggi/whatsapp";
  window.history.replaceState(window.history.state, "", url);
}

function useMediaMatch(query: string): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

export default function WhatsAppPage() {
  const [selectedKey, setSelectedKey] = useState<string | null>(() =>
    selectedFromLocation()
  );
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [page, setPage] = useState(0);
  const mobile = useMediaMatch(SINGLE_PANE_QUERY);
  const wide = useMediaMatch(TRI_PANE_QUERY);
  const [contextOpen, setContextOpen] = useState(false);
  const [loadedThread, setLoadedThread] = useState<{
    key: string | null;
    ids: number[];
  }>({ key: null, ids: [] });
  const lastViewedKey = useRef<string | null>(null);
  const utils = trpc.useUtils();
  const conversations = trpc.mail.whatsapp.conversazioni.useQuery({
    search: deferredSearch.trim() || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
  const selected = useMemo(
    () =>
      (conversations.data ?? []).find(
        conversation => conversation.key === selectedKey
      ) ?? null,
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
  const selectedConversation =
    selected ?? selectedThread.data?.conversazione ?? null;
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
    const onPopState = () => setSelectedKey(selectedFromLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => setPage(0), [deferredSearch]);
  // Con il tri-pane l'inspector è già in pagina: lo sheet non deve restare
  // aperto sotto la terza colonna.
  useEffect(() => {
    if (wide) setContextOpen(false);
  }, [wide]);

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
  const invalidLink = selectedKey != null && selectedKeyParts == null;
  const selectionError = invalidLink
    ? "Il link alla conversazione non è valido: l'identificativo non ha il formato atteso."
    : selectedThread.isError
      ? selectedThread.error.message
      : null;
  const readOnlyBadge = (
    <Badge
      variant="outline"
      className="h-8 gap-1.5 border-info/25 bg-info-soft px-2 text-xs text-info"
    >
      <Eye className="size-3.5" aria-hidden="true" />
      Sola lettura
    </Badge>
  );

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-h-[620px] min-w-0 flex-col gap-3 overflow-hidden">
      <PageHeader
        variant="workbench"
        eyebrow="Messaggistica"
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            WhatsApp
            {readOnlyBadge}
          </span>
        }
        description="Cronologia delle conversazioni importate: si legge e si collega, non si risponde da qui."
        busy={conversations.isFetching}
        metadata={
          <span>
            {conversations.isLoading
              ? "Conversazioni in caricamento"
              : conversations.isError
                ? "Elenco non disponibile"
                : `${conversations.data?.length ?? 0} conversazioni in pagina`}
          </span>
        }
        primaryAction={
          <Button
            variant="outline"
            className="min-h-11"
            disabled={conversations.isFetching}
            onClick={() => conversations.refetch()}
          >
            {conversations.isFetching ? (
              <Loader2 className="size-4 motion-safe:animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Aggiorna
          </Button>
        }
      />

      <section
        aria-label="Workspace WhatsApp"
        className={cn(
          "grid min-h-0 min-w-0 flex-1 overflow-hidden rounded-[var(--radius-panel)] border border-border-soft bg-surface",
          showList &&
            "lg:grid-cols-[minmax(17rem,0.9fr)_minmax(0,1.7fr)] xl:grid-cols-[minmax(17rem,0.85fr)_minmax(0,1.6fr)_minmax(17rem,0.85fr)]"
        )}
      >
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
          <WhatsAppThread
            conversation={selectedConversation}
            mobile={mobile}
            onBack={closeConversation}
            onOpenContext={() => setContextOpen(true)}
            onMessageIdsChange={handleMessageIdsChange}
          />
        ) : selectionError ? (
          <div
            className={cn(
              "min-h-0 min-w-0 overflow-y-auto p-4",
              showList && "border-border-soft lg:border-l"
            )}
          >
            <StatePanel
              kind={invalidLink ? "unavailable" : "error"}
              title="Conversazione non disponibile"
              description={selectionError}
              action={
                <>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={retrySelectedConversation}
                  >
                    <RefreshCw className="size-4" />
                    Riprova
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={closeConversation}
                  >
                    <ArrowLeft className="size-4" />
                    Torna all'elenco
                  </Button>
                </>
              }
            />
          </div>
        ) : selectedKey && selectedThread.isLoading ? (
          <div
            className={cn(
              "min-h-0 min-w-0 overflow-y-auto p-4",
              showList && "border-border-soft lg:border-l"
            )}
          >
            <StatePanel
              kind="loading"
              title="Apertura conversazione"
              description="Sto recuperando la cronologia di questo contatto."
              rows={3}
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
              title="Nessuna conversazione aperta"
              description="Scegli un contatto dall'elenco per leggere la cronologia e il contesto collegato."
            />
          </div>
        )}

        {selectedConversation && wide && (
          <div className="hidden min-h-0 min-w-0 border-l border-border-soft xl:block">
            <WhatsAppContextPanel
              conversation={selectedConversation}
              communicationIds={communicationIds}
            />
          </div>
        )}
      </section>

      {selectedConversation && !wide && (
        <Sheet open={contextOpen} onOpenChange={setContextOpen}>
          <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
            <SheetHeader className="border-b border-border-soft pr-12">
              <SheetTitle>Contesto conversazione</SheetTitle>
              <SheetDescription>
                {selectedConversation.nomeProfilo ??
                  selectedConversation.controparte}
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-hidden">
              <WhatsAppContextPanel
                conversation={selectedConversation}
                communicationIds={communicationIds}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
