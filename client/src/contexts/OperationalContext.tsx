import { useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { trpc } from "@/lib/trpc";
import {
  clearActiveOperationalScope,
  clearScopedUiState,
  isProtectedQueryKey,
  operationalScopeKey,
  readActiveOperationalScope,
  runSedeTransition,
  writeActiveOperationalScope,
} from "@/lib/operationalContext";
import type { AppRouter } from "../../../server/routers";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Sede = NonNullable<RouterOutputs["sedi"]["active"]>;
type Sedi = RouterOutputs["sedi"]["list"];
type OperationalFlags = RouterOutputs["platform"]["interruttori"];

export type OperationalStatus = "loading" | "ready" | "switching";

export interface OperationalContextValue {
  activeSede: Sede | null;
  sedi: Sedi;
  capabilities: ReadonlySet<string> | null;
  flags: OperationalFlags | null;
  scopeKey: string | null;
  status: OperationalStatus;
  error: Error | null;
  switchSede: (sedeId: number) => Promise<void>;
}

const OperationalContext = createContext<OperationalContextValue | undefined>(
  undefined
);

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Contesto non disponibile");
}

export function OperationalContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const authQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const authenticated = Boolean(authQuery.data);
  const sediQuery = trpc.sedi.list.useQuery(undefined, {
    enabled: authenticated,
    staleTime: 300_000,
  });
  const activeSedeQuery = trpc.sedi.active.useQuery(undefined, {
    enabled: authenticated,
    staleTime: 60_000,
  });
  const capabilitiesQuery = trpc.permessi.mie.useQuery(undefined, {
    enabled: authenticated,
    staleTime: 60_000,
  });
  const flagsQuery = trpc.platform.interruttori.useQuery(undefined, {
    enabled: authenticated,
    staleTime: 300_000,
  });
  const switchMutation = trpc.sedi.switch.useMutation();

  const [committedScope, setCommittedScope] = useState<string | null>(null);
  const [status, setStatus] = useState<OperationalStatus>("loading");
  const [error, setError] = useState<Error | null>(null);
  const transitionInFlight = useRef(false);

  const userId = (authQuery.data as { id?: number | string } | null)?.id;
  const fetchedScope = useMemo(() => {
    if (
      userId == null ||
      activeSedeQuery.data?.id == null ||
      !capabilitiesQuery.data
    ) {
      return null;
    }
    return operationalScopeKey({
      userId,
      sedeId: activeSedeQuery.data.id,
      capabilities: capabilitiesQuery.data,
    });
  }, [activeSedeQuery.data?.id, capabilitiesQuery.data, userId]);

  const cancelProtectedQueries = useCallback(
    () =>
      queryClient.cancelQueries({
        predicate: query => isProtectedQueryKey(query.queryKey),
      }),
    [queryClient]
  );

  const removeProtectedQueries = useCallback(() => {
    queryClient.removeQueries({
      predicate: query => isProtectedQueryKey(query.queryKey),
    });
  }, [queryClient]);

  const clearPreviousScope = useCallback(() => {
    const previous =
      committedScope ?? readActiveOperationalScope(window.localStorage);
    if (previous) clearScopedUiState(window.localStorage, previous);
  }, [committedScope]);

  const refetchActiveSede = useCallback(async (): Promise<Sede> => {
    const result = await activeSedeQuery.refetch();
    if (result.error) throw result.error;
    if (!result.data) throw new Error("Sede attiva non disponibile");
    return result.data;
  }, [activeSedeQuery]);

  const refetchCapabilities = useCallback(async (): Promise<string[]> => {
    const result = await capabilitiesQuery.refetch();
    if (result.error) throw result.error;
    if (!result.data) throw new Error("Permessi operativi non disponibili");
    return result.data;
  }, [capabilitiesQuery]);

  const commitScope = useCallback(
    (activeSede: Sede, capabilities: readonly string[]) => {
      if (userId == null) throw new Error("Utente operativo non disponibile");
      const nextScope = operationalScopeKey({
        userId,
        sedeId: activeSede.id,
        capabilities,
      });
      writeActiveOperationalScope(window.localStorage, nextScope);
      setCommittedScope(nextScope);
      setError(null);
      setStatus("ready");
    },
    [userId]
  );

  const executeTransition = useCallback(
    async (changeSede: () => Promise<void>) => {
      if (transitionInFlight.current) {
        throw new Error("Cambio sede già in corso");
      }
      transitionInFlight.current = true;
      setError(null);
      setStatus("switching");
      let serverConfirmed = false;

      try {
        await runSedeTransition({
          cancelProtectedQueries,
          changeSede: async () => {
            await changeSede();
            serverConfirmed = true;
          },
          removeProtectedQueries,
          clearPreviousScope,
          refetchActiveSede,
          refetchCapabilities,
          commitScope,
        });
      } catch (cause) {
        const nextError = asError(cause);
        setError(serverConfirmed ? nextError : null);
        setStatus(serverConfirmed ? "loading" : "ready");
        throw nextError;
      } finally {
        transitionInFlight.current = false;
      }
    },
    [
      cancelProtectedQueries,
      clearPreviousScope,
      commitScope,
      refetchActiveSede,
      refetchCapabilities,
      removeProtectedQueries,
    ]
  );

  const switchSede = useCallback(
    async (sedeId: number) => {
      if (!authenticated || activeSedeQuery.data?.id == null) {
        throw new Error("Contesto operativo non disponibile");
      }
      if (sedeId === activeSedeQuery.data.id) return;
      await executeTransition(async () => {
        await switchMutation.mutateAsync({ sedeId });
      });
    },
    [activeSedeQuery.data?.id, authenticated, executeTransition, switchMutation]
  );

  useEffect(() => {
    if (authQuery.isPending) {
      setStatus("loading");
      return;
    }

    if (!authenticated) {
      const previous =
        committedScope ?? readActiveOperationalScope(window.localStorage);
      if (previous) clearScopedUiState(window.localStorage, previous);
      clearActiveOperationalScope(window.localStorage);
      setCommittedScope(null);
      setError(null);
      setStatus("ready");
      return;
    }

    const contextPending =
      sediQuery.isPending ||
      activeSedeQuery.isPending ||
      capabilitiesQuery.isPending ||
      flagsQuery.isPending;
    if (contextPending) {
      setStatus("loading");
      return;
    }

    const contextFailure =
      sediQuery.error ?? activeSedeQuery.error ?? capabilitiesQuery.error;
    if (contextFailure) {
      setError(asError(contextFailure));
      setStatus("loading");
      return;
    }

    if (!fetchedScope) {
      setStatus("loading");
      return;
    }

    if (!committedScope) {
      const previous = readActiveOperationalScope(window.localStorage);
      if (previous && previous !== fetchedScope) {
        clearScopedUiState(window.localStorage, previous);
      }
      writeActiveOperationalScope(window.localStorage, fetchedScope);
      setCommittedScope(fetchedScope);
      setError(null);
      setStatus("ready");
      return;
    }

    if (committedScope === fetchedScope) {
      if (!transitionInFlight.current) setStatus("ready");
      return;
    }

    if (transitionInFlight.current || error) return;
    void executeTransition(async () => undefined).catch(() => undefined);
  }, [
    activeSedeQuery.error,
    activeSedeQuery.isPending,
    authQuery.isPending,
    capabilitiesQuery.error,
    capabilitiesQuery.isPending,
    committedScope,
    error,
    executeTransition,
    fetchedScope,
    flagsQuery.isPending,
    authenticated,
    sediQuery.error,
    sediQuery.isPending,
  ]);

  const value = useMemo<OperationalContextValue>(
    () => ({
      activeSede: authenticated ? (activeSedeQuery.data ?? null) : null,
      sedi: authenticated ? (sediQuery.data ?? []) : [],
      capabilities:
        authenticated && capabilitiesQuery.data
          ? new Set(capabilitiesQuery.data)
          : null,
      flags: authenticated ? (flagsQuery.data ?? null) : null,
      scopeKey: authenticated ? committedScope : null,
      status,
      error,
      switchSede,
    }),
    [
      activeSedeQuery.data,
      authenticated,
      capabilitiesQuery.data,
      committedScope,
      error,
      flagsQuery.data,
      sediQuery.data,
      status,
      switchSede,
    ]
  );

  return (
    <OperationalContext.Provider value={value}>
      {children}
    </OperationalContext.Provider>
  );
}

export function useOperationalContext(): OperationalContextValue {
  const context = useContext(OperationalContext);
  if (!context) {
    throw new Error(
      "useOperationalContext must be used within OperationalContextProvider"
    );
  }
  return context;
}

export function useOptionalOperationalContext():
  | OperationalContextValue
  | undefined {
  return useContext(OperationalContext);
}
