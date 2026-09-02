import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import superjson from "superjson";
import App from "./App";
import { ContextTransitionScreen } from "./components/DashboardLayoutSkeleton";
import { getLoginUrl } from "./const";
import {
  OperationalContextProvider,
  useOperationalContext,
} from "./contexts/OperationalContext";
import { UiGenerationProvider } from "./contexts/UiGenerationContext";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Quindici secondi di respiro prima di considerare vecchio un dato.
      //
      // Prima era zero con `refetchOnMount: "always"`: ogni volta che si
      // apriva una pagina — anche solo tornando indietro dopo due secondi —
      // ogni sua query ripartiva da capo. Sulla Dashboard sono venti
      // richieste e un paio di megabyte da leggere e ricostruire, e la
      // pagina restava sullo scheletro fino alla risposta invece di
      // mostrare quello che era già in memoria.
      //
      // Quindici secondi non allontanano il dato dalla realtà: le mutation
      // invalidano già le proprie query (una modifica si vede subito, non
      // fra quindici secondi), le pagine vive hanno il loro
      // `refetchInterval`, e il ritorno sulla finestra continua a
      // rinfrescare quello che nel frattempo è invecchiato.
      staleTime: 15_000,
      // Al montaggio si rinfresca quello che è vecchio, non tutto.
      refetchOnMount: true,
      // Re-fetch when the tab regains focus (returning from another tab/window)
      refetchOnWindowFocus: true,
      // Re-fetch when network reconnects
      refetchOnReconnect: true,
      retry: 1,
    },
  },
});

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

function installAnalytics() {
  if (!import.meta.env.PROD || typeof document === "undefined") return;

  const endpoint = import.meta.env.VITE_ANALYTICS_ENDPOINT;
  const websiteId = import.meta.env.VITE_ANALYTICS_WEBSITE_ID;

  if (!endpoint || !websiteId || document.getElementById("umami-analytics")) {
    return;
  }

  let scriptUrl: URL;
  try {
    scriptUrl = new URL(`${String(endpoint).replace(/\/$/, "")}/umami`);
    if (!(["http:", "https:"] as string[]).includes(scriptUrl.protocol)) return;
  } catch {
    return;
  }

  const script = document.createElement("script");
  script.id = "umami-analytics";
  script.async = true;
  script.defer = true;
  script.src = scriptUrl.toString();
  script.dataset.websiteId = String(websiteId);
  script.addEventListener("error", () => script.remove(), { once: true });
  document.head.appendChild(script);
}

installAnalytics();

function OperationalGate({ children }: { children: ReactNode }) {
  const { status, error } = useOperationalContext();
  if (status !== "ready") {
    return <ContextTransitionScreen status={status} error={error} />;
  }
  return children;
}

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <OperationalContextProvider>
        <UiGenerationProvider>
          <OperationalGate>
            <App />
          </OperationalGate>
        </UiGenerationProvider>
      </OperationalContextProvider>
    </QueryClientProvider>
  </trpc.Provider>
);
