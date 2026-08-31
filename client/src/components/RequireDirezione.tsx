import { useAuth } from "@/_core/hooks/useAuth";
import { direzioneGateLabel } from "@/lib/roles";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

/**
 * Guard UX per le sole route il cui contratto resta esplicitamente basato sul
 * ruolo direzione. Non sostituisce l'autorizzazione delle procedure server.
 */
export default function RequireDirezione({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  // L'esito della guardia è una funzione pura, verificabile senza montare la
  // route: qui resta solo la sua presentazione.
  const gate = direzioneGateLabel({ user, loading });

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
        data-authorization-guard="direzione"
      >
        <section
          className="w-full max-w-sm space-y-4 rounded-[var(--radius-card)] border border-border-soft bg-surface p-6 text-center shadow-[var(--shadow-card)]"
          role="alert"
          aria-labelledby="direzione-required-title"
        >
          <ShieldAlert
            className="mx-auto h-10 w-10 text-text-3"
            aria-hidden="true"
          />
          <div className="space-y-1">
            <h2
              id="direzione-required-title"
              className="font-semibold text-text-1"
            >
              Accesso riservato alla direzione
            </h2>
            <p className="text-sm text-text-3">
              Il tuo profilo non può aprire questa sezione. Le procedure del
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
