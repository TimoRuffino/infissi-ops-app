// Fallback delle route non riconosciute (`/404` e `*`).
//
// Vive dentro la shell autenticata: il landmark `main` è di ShellWorkspace,
// qui restano soltanto l'intestazione della pagina e uno stato esplicito.
// Nessuna card marketing, nessun gradiente: è un errore operativo, e dice
// cosa è successo e come rientrare.

import { Home } from "lucide-react";
import { useLocation } from "wouter";

import DataSurface from "@/components/patterns/DataSurface";
import PageHeader from "@/components/patterns/PageHeader";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  const [location, setLocation] = useLocation();

  // Solo il percorso: la query di un deep link può portare id, filtri o token
  // e non ha motivo di comparire in una schermata di errore.
  const percorso = location.split("?")[0].split("#")[0];

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-5">
      <PageHeader
        eyebrow="Errore 404"
        title="Pagina non trovata"
        description="L'indirizzo richiesto non corrisponde a nessuna sezione del gestionale. Di solito è un segnalibro vecchio, un link troncato o un refuso."
        metadata={
          <span className="codice-mono min-w-0 break-all">{percorso}</span>
        }
      />

      <DataSurface
        density="comfortable"
        tone="default"
        state={{
          kind: "unavailable",
          title: "Nessuna sezione a questo indirizzo",
          description:
            "Il tuo accesso non è cambiato e nessun dato è stato toccato. Torna alla dashboard e riparti dalla navigazione, oppure controlla il link che hai seguito.",
          action: (
            <Button className="min-h-11" onClick={() => setLocation("/")}>
              <Home className="size-4" aria-hidden="true" />
              Torna alla dashboard
            </Button>
          ),
        }}
      />
    </div>
  );
}
