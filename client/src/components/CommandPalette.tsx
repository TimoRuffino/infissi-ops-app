// Palette comandi (⌘K / Ctrl+K) — shell Modular Control.
//
// La ricerca resta deterministica e sede-scoped. Tars compare come passaggio
// esplicito che compila una bozza; nessuna procedura del modello parte mentre
// l'utente digita o seleziona la voce.
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  compileTarsDraftPath,
  MAX_PALETTE_QUERY_LENGTH,
  readPaletteRecents,
  rememberPaletteRecent,
  revalidateRecent,
  type PaletteRecent,
} from "@/lib/commandPalette";
import {
  type NavigationAccess,
  navigationDestinations,
} from "@/lib/navigation";
import { statoLabel } from "@/lib/stato";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  Bot,
  Building2,
  Clock,
  Contact,
  Loader2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";

const MAX_SEARCH_RESULTS = 6;

export type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  access: NavigationAccess;
  scopeKey: string | null;
};

export default function CommandPalette({
  open,
  onOpenChange,
  access,
  scopeKey,
}: CommandPaletteProps) {
  const [, setLocation] = useLocation();
  const previousScope = useRef(scopeKey);
  const [queryText, setQueryText] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [recents, setRecents] = useState<PaletteRecent[]>([]);

  // Any committed scope change invalidates both visible state and the open
  // dialog. OperationalContext has already cancelled/removed protected query
  // results before publishing this new scope.
  useEffect(() => {
    if (previousScope.current === scopeKey) return;
    previousScope.current = scopeKey;
    setQueryText("");
    setDebouncedQuery("");
    setRecents([]);
    if (open) onOpenChange(false);
  }, [onOpenChange, open, scopeKey]);

  useEffect(() => {
    if (!open) return;
    setQueryText("");
    setDebouncedQuery("");
    setRecents(
      readPaletteRecents(window.localStorage, scopeKey).filter(recent =>
        revalidateRecent(recent, access)
      )
    );
  }, [access, open, scopeKey]);

  useEffect(() => {
    const pause = window.setTimeout(
      () => setDebouncedQuery(queryText.trim()),
      200
    );
    return () => window.clearTimeout(pause);
  }, [queryText]);

  const query = queryText.trim();
  const navigation = useMemo(() => navigationDestinations(access), [access]);
  const visiblePaths = useMemo(
    () => new Set(navigation.map(destination => destination.path)),
    [navigation]
  );
  const filteredNavigation = useMemo(() => {
    if (!query) return navigation;
    const normalized = query.toLocaleLowerCase("it");
    return navigation.filter(destination =>
      destination.label.toLocaleLowerCase("it").includes(normalized)
    );
  }, [navigation, query]);

  const canSearchClients = visiblePaths.has("/clienti");
  const canSearchJobs = visiblePaths.has("/commesse");
  const hasEntitySearch = canSearchClients || canSearchJobs;
  const debounceReady = debouncedQuery === query;
  const searchEntities =
    open && query.length >= 2 && debounceReady && hasEntitySearch;

  // Existing list procedures remain the authority: no palette-specific
  // endpoint and no model/provider procedure is called here.
  const clientsQuery = trpc.clienti.list.useQuery(
    { search: debouncedQuery },
    {
      enabled: searchEntities && canSearchClients,
      staleTime: 30_000,
      retry: false,
    }
  );
  const jobsQuery = trpc.commesse.list.useQuery(
    { search: debouncedQuery },
    {
      enabled: searchEntities && canSearchJobs,
      staleTime: 30_000,
      retry: false,
    }
  );

  const clients =
    searchEntities && canSearchClients
      ? (clientsQuery.data ?? []).slice(0, MAX_SEARCH_RESULTS)
      : [];
  const jobs =
    searchEntities && canSearchJobs
      ? (jobsQuery.data ?? []).slice(0, MAX_SEARCH_RESULTS)
      : [];
  const loading =
    open &&
    query.length >= 2 &&
    hasEntitySearch &&
    (!debounceReady ||
      (canSearchClients && clientsQuery.isPending) ||
      (canSearchJobs && jobsQuery.isPending));
  const searchError =
    searchEntities &&
    ((canSearchClients && clientsQuery.isError) ||
      (canSearchJobs && jobsQuery.isError));
  const noDeterministicResult =
    Boolean(query) &&
    !loading &&
    !searchError &&
    filteredNavigation.length === 0 &&
    clients.length === 0 &&
    jobs.length === 0;
  const tarsVisible = visiblePaths.has("/tars");

  const navigate = (targetPath: string, recent: PaletteRecent | null): void => {
    if (recent && revalidateRecent(recent, access)) {
      rememberPaletteRecent(window.localStorage, scopeKey, recent);
    }
    onOpenChange(false);
    setLocation(targetPath);
  };

  const retrySearch = () => {
    if (canSearchClients) void clientsQuery.refetch();
    if (canSearchJobs) void jobsQuery.refetch();
  };

  const mac =
    typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Cerca e naviga"
      description="Cerca destinazioni, clienti e commesse oppure prepara una domanda per Tars"
      shouldFilter={false}
      showCloseButton={false}
      className="max-w-[calc(100%-1rem)] sm:max-w-2xl"
    >
      <CommandInput
        value={queryText}
        onValueChange={setQueryText}
        placeholder="Cerca clienti, commesse o destinazioni…"
        aria-label="Cerca nella palette comandi"
        maxLength={MAX_PALETTE_QUERY_LENGTH}
      />
      <CommandList className="max-h-[min(65dvh,32rem)]">
        {noDeterministicResult ? (
          <div
            className="px-4 py-5 text-center text-sm text-text-3"
            role="status"
          >
            Nessuna corrispondenza deterministica per «{query}».
          </div>
        ) : null}

        {!query && recents.length > 0 ? (
          <>
            <CommandGroup heading="Recenti">
              {recents.map(recent => (
                <CommandItem
                  key={`recent-${recent.kind}-${recent.path}`}
                  value={`recent-${recent.kind}-${recent.path}`}
                  onSelect={() => navigate(recent.path, recent)}
                >
                  <Clock className="text-text-3" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">
                    {recent.label}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-text-3">
                    {recent.kind === "route" ? "Pagina" : recent.kind}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        ) : null}

        {filteredNavigation.length > 0 ? (
          <CommandGroup heading="Naviga">
            {filteredNavigation.map(destination => (
              <CommandItem
                key={`navigation-${destination.path}`}
                value={`navigation-${destination.path}`}
                onSelect={() =>
                  navigate(destination.path, {
                    kind: "route",
                    label: destination.label,
                    path: destination.path,
                  })
                }
              >
                <destination.icon className="text-text-3" aria-hidden="true" />
                <span>{destination.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {loading ? (
          <CommandGroup heading="Ricerca">
            <CommandItem value="search-loading" disabled>
              <Loader2
                className="animate-spin text-text-3"
                aria-hidden="true"
              />
              Cerco «{query}» tra clienti e commesse…
            </CommandItem>
          </CommandGroup>
        ) : null}

        {searchError ? (
          <CommandGroup heading="Ricerca">
            <CommandItem value="search-retry" onSelect={retrySearch}>
              <AlertTriangle className="text-warning" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                Alcuni risultati non sono disponibili.
              </span>
              <span className="text-xs font-semibold text-accent-text">
                Riprova
              </span>
            </CommandItem>
          </CommandGroup>
        ) : null}

        {clients.length > 0 ? (
          <CommandGroup heading="Clienti">
            {clients.map((client: any) => {
              const name =
                [client.cognome, client.nome]
                  .filter((part: string) => part && part.trim())
                  .join(" ")
                  .trim() || `Cliente ${client.id}`;
              const recent: PaletteRecent = {
                kind: "cliente",
                label: name,
                path: `/clienti/${client.id}`,
              };
              return (
                <CommandItem
                  key={`client-${client.id}`}
                  value={`client-${client.id}`}
                  onSelect={() => navigate(recent.path, recent)}
                >
                  <Contact className="text-text-3" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  {client.citta ? (
                    <span className="max-w-32 truncate text-xs text-text-3">
                      {client.citta}
                    </span>
                  ) : null}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {jobs.length > 0 ? (
          <CommandGroup heading="Commesse">
            {jobs.map((job: any) => {
              const label = job.codice ?? `Commessa ${job.id}`;
              const recent: PaletteRecent = {
                kind: "commessa",
                label,
                path: `/commesse/${job.id}`,
              };
              return (
                <CommandItem
                  key={`job-${job.id}`}
                  value={`job-${job.id}`}
                  onSelect={() => navigate(recent.path, recent)}
                >
                  <Building2 className="text-text-3" aria-hidden="true" />
                  <span className="codice-mono shrink-0">{job.codice}</span>
                  <span className="min-w-0 flex-1 truncate text-text-2">
                    {job.cliente}
                  </span>
                  {job.stato ? (
                    <span className="hidden text-xs text-text-3 sm:inline">
                      {statoLabel(job.stato)}
                    </span>
                  ) : null}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {tarsVisible ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Chiedi a Tars">
              {query ? (
                <CommandItem
                  value="tars-draft"
                  onSelect={() => {
                    const draftPath = compileTarsDraftPath(query);
                    if (!draftPath) return;
                    navigate(draftPath, {
                      kind: "route",
                      label: "Tars",
                      path: "/tars",
                    });
                  }}
                >
                  <Bot className="text-accent-text" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">
                    Prepara: «{query}»
                  </span>
                  <span className="hidden text-xs text-text-3 sm:inline">
                    bozza, non invia
                  </span>
                </CommandItem>
              ) : null}
              <CommandItem
                value="tars-open"
                onSelect={() =>
                  navigate("/tars", {
                    kind: "route",
                    label: "Tars",
                    path: "/tars",
                  })
                }
              >
                <Bot className="text-text-3" aria-hidden="true" />
                <span>Apri Tars senza domanda</span>
              </CommandItem>
            </CommandGroup>
          </>
        ) : null}

        {!query ? (
          <div className="border-t border-border-soft px-3 py-2 text-[11px] text-text-3">
            Frecce per muoverti · Invio per aprire · Esc per chiudere ·{" "}
            {mac ? "⌘K" : "Ctrl+K"}
          </div>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
