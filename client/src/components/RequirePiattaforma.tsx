import { useAuth } from "@/_core/hooks/useAuth";
import { piattaformaGateLabel } from "@/lib/piattaforma";
import { trpc } from "@/lib/trpc";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

/**
 * Guardia UX della sezione `/piattaforma` (spec WS6 §8), sul modello di
 * `RequireDirezione`. La capacità non arriva dai ruoli — non è un ruolo:
 * `tenants.mio.piattaforma` la calcola sul server con lo stesso helper di
 * `piattaformaProcedure`, e questo è l'unico segnale che il client legge.
 *
 * Non sostituisce l'autorizzazione delle procedure server: ogni query e ogni
 * mutation del router `piattaforma` ricontrolla l'email dell'utente contro
 * PLATFORM_ADMIN_EMAILS a ogni chiamata.
 */
export default function RequirePiattaforma({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  // La query parte solo a identità nota: senza utente non c'è sessione da
  // interrogare, e `tenants.mio` risponderebbe UNAUTHORIZED.
  const mio = trpc.tenants.mio.useQuery(undefined, { enabled: Boolean(user) });
  const gate = piattaformaGateLabel({
    mio: mio.data,
    loading: loading || mio.isLoading,
  });

  if (gate === "loading") {
    return (
      <div
        className="grid min-h-[40dvh] place-items-center text-sm text-text-3"
        role="status"
        aria-live="polite"
      >
        Verifica autorizzazione…
      </div>
    );
  }

  if (gate === "blocked") {
    return (
      <div
        className="flex min-h-[60dvh] items-center justify-center p-4"
        data-authorization-guard="piattaforma"
      >
        <section
          className="w-full max-w-sm space-y-4 rounded-[var(--radius-card)] border border-border-soft bg-surface p-6 text-center shadow-[var(--shadow-card)]"
          role="alert"
          aria-labelledby="piattaforma-required-title"
        >
          <ShieldAlert
            className="mx-auto h-10 w-10 text-text-3"
            aria-hidden="true"
          />
          <div className="space-y-1">
            <h2
              id="piattaforma-required-title"
              className="font-semibold text-text-1"
            >
              Sezione riservata alla piattaforma
            </h2>
            <p className="text-sm text-text-3">
              Questa sezione amministra tutte le aziende di Wyndoor: la aprono
              solo gli amministratori della piattaforma. Le procedure del
              server verificano comunque l’autorizzazione di ogni operazione.
            </p>
          </div>
          <Button
            type="button"
            variant="quiet"
            className="min-h-11"
            onClick={() => setLocation("/")}
          >
            Torna alla dashboard
          </Button>
        </section>
      </div>
    );
  }

  return <>{children}</>;
}
