// `/piattaforma/:slug` — segnaposto del Task 8 (decisione pre-1 del piano
// WS6): la rotta nasce insieme all'elenco, così le righe cliccabili portano
// da qualche parte invece che sul 404. Il Task 9 la sostituisce con la scheda
// vera (stato, abbonamento, spazio, Tars, proprietari, backup, eventi,
// comandi), qui non c'è nessuna lettura del control plane da riscrivere.
import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";

import PageHeader from "@/components/patterns/PageHeader";
import StatePanel from "@/components/patterns/StatePanel";
import { Button } from "@/components/ui/button";

export default function AziendaDetail() {
  const { slug } = useParams<{ slug: string }>();

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1200px] space-y-5">
      <PageHeader
        variant="workbench"
        eyebrow="Piattaforma"
        title={slug}
        description="La scheda completa dell'azienda arriva con il passo successivo del pannello."
        secondaryActions={
          <Button asChild variant="quiet" className="min-h-11">
            <Link href="/piattaforma">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Tutte le aziende
            </Link>
          </Button>
        }
      />

      <StatePanel
        kind="unavailable"
        title="Scheda in costruzione"
        description={`L'azienda «${slug}» esiste ed è amministrabile, ma la sua scheda — abbonamento, spazio, Tars, proprietari, backup ed eventi — non è ancora stata costruita.`}
        action={
          <Button asChild variant="outline" className="min-h-11">
            <Link href="/piattaforma">Torna all'elenco</Link>
          </Button>
        }
      />
    </div>
  );
}
