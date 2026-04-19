import { useAuth } from "@/_core/hooks/useAuth";
import { isDirezione } from "@/lib/roles";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

/**
 * Route guard — renders children only when the current user has the
 * `direzione` role (or legacy `role: "admin"`). Otherwise shows a blocked
 * state with a link back to the dashboard so unauthorized users know why
 * they can't access the page instead of getting a silent redirect.
 */
export default function RequireDirezione({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();

  if (loading) return null;

  if (!isDirezione(user)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-4">
        <div className="max-w-sm w-full text-center space-y-4 p-6 rounded-lg border bg-muted/30">
          <ShieldAlert className="h-10 w-10 text-muted-foreground mx-auto" />
          <div className="space-y-1">
            <p className="font-semibold">Accesso riservato</p>
            <p className="text-sm text-muted-foreground">
              Questa sezione è accessibile solo agli utenti con ruolo{" "}
              <span className="font-medium">direzione</span>.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation("/")}
          >
            Torna alla dashboard
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
