import { CheckCircle2, Circle, MinusCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import DataSurface from "@/components/patterns/DataSurface";
import { etichettaDi } from "./etichette";

/**
 * Gli stessi passi della pagina Impostazioni, in ordine. Non è una seconda
 * schermata: è la stessa, ordinata.
 *
 * «Salta» è disponibile su ogni passo, sempre. La spec madre §9 dice che il
 * CRM si usa prima di aver collegato tutto: chi si attiva di venerdì sera
 * deve poter entrare senza aver collegato niente.
 */
export function PercorsoAttivazione({ onFine }: { onFine: () => void }) {
  const passi = trpc.integrazioni.attivazione.useQuery();
  const salta = trpc.integrazioni.salta.useMutation({
    onSuccess: () => void passi.refetch(),
  });

  const elenco = passi.data ?? [];
  const fatti = elenco.filter(p => p.esito !== "da_fare").length;

  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl space-y-4">
      <DataSurface
        density="compact"
        tone="sunken"
        title="Collega le tue integrazioni"
        description={
          elenco.length === 0
            ? "Un momento…"
            : `${fatti} di ${elenco.length}. Puoi saltarne quante vuoi e tornarci dopo: il CRM funziona lo stesso.`
        }
      >
        <ul className="grid min-w-0 gap-2">
          {elenco.map(p => {
            const { titolo, descrizione } = etichettaDi(p.chiave);
            const Icona =
              p.esito === "collegata"
                ? CheckCircle2
                : p.esito === "saltata"
                  ? MinusCircle
                  : Circle;
            const colore =
              p.esito === "collegata"
                ? "text-success"
                : p.esito === "saltata"
                  ? "text-text-3"
                  : "text-text-2";

            return (
              <li
                key={p.chiave}
                className="flex min-w-0 items-start gap-3 rounded-[var(--radius-control)] border border-border-soft bg-surface p-3"
              >
                <Icona
                  aria-hidden="true"
                  className={`mt-0.5 size-4 shrink-0 ${colore}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-semibold text-text-1">{titolo}</span>
                    {p.esito === "collegata" && p.soggetto && (
                      <span className="truncate text-text-2">{p.soggetto}</span>
                    )}
                    {p.esito === "saltata" && (
                      <span className="text-text-3">saltato</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-text-3">
                    {descrizione}
                  </p>
                </div>
                {p.esito === "da_fare" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    disabled={salta.isPending}
                    onClick={() => salta.mutate({ chiave: p.chiave })}
                  >
                    Salta
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </DataSurface>

      <Button variant="outline" onClick={onFine}>
        Entra nel CRM
      </Button>
    </div>
  );
}
