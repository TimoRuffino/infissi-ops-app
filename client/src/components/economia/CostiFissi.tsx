// Costi fissi dell'azienda — l'elenco, non la somma.
//
// La regola è quella data dalla direzione: stesso fornitore, stesso importo,
// ogni mese. Il valore di questa vista non è il totale (quello si legge già
// nel break-even) ma il DETTAGLIO: "quali sono?" è la domanda che nessuna
// pagina sapeva rispondere, e senza risposta il numero del pareggio resta
// una cifra di cui fidarsi ciecamente.

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatEuroSimbolo } from "@/lib/euro";
import { trpc } from "@/lib/trpc";
import { CalendarRange, Loader2, Repeat } from "lucide-react";

function etichettaMese(mese: string): string {
  const [anno, numero] = mese.split("-");
  const nomi = [
    "gen", "feb", "mar", "apr", "mag", "giu",
    "lug", "ago", "set", "ott", "nov", "dic",
  ];
  return `${nomi[Number(numero) - 1] ?? numero} ${anno.slice(2)}`;
}

export default function CostiFissi() {
  const q = trpc.ficCosti.ricorrenti.useQuery();

  if (q.isLoading) {
    return (
      <div className="py-12 text-center">
        <Loader2 className="h-5 w-5 mx-auto animate-spin text-text-3" />
      </div>
    );
  }

  const gruppi = q.data?.gruppi ?? [];
  const totale = q.data?.totaleMensile ?? 0;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
              <Repeat className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">Costi fissi mensili</p>
              <p className="text-xs text-text-3">
                Stesso fornitore, stesso importo, ogni mese
              </p>
            </div>
          </div>
          <div className="ml-auto text-right">
            <p className="eyebrow !text-text-3">Totale al mese</p>
            <p className="text-2xl font-bold tabular-nums">
              {formatEuroSimbolo(totale)}
            </p>
          </div>
        </CardContent>
      </Card>

      {gruppi.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-text-3">
            Nessun costo ricorrente rilevato. Servono almeno tre mesi
            consecutivi con lo stesso importo dallo stesso fornitore: dopo il
            terzo, il costo compare qui da solo.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            {/* La tabella scorre dentro il suo contenitore: la pagina non
                deve mai guadagnare uno scroll orizzontale. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-text-3">
                    <th scope="col" className="px-3 py-2 font-medium">
                      Fornitore
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium text-right">
                      Importo/mese
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Periodo
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium text-right">
                      Mesi
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {gruppi.map(gruppo => (
                    <tr
                      key={gruppo.chiave}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="px-3 py-2.5 font-medium">
                        <span className="block truncate max-w-[16rem]">
                          {gruppo.fornitore}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatEuroSimbolo(gruppo.importo)}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-text-3">
                        <span className="inline-flex items-center gap-1">
                          <CalendarRange className="h-3.5 w-3.5" />
                          {etichettaMese(gruppo.mesi[0])} →{" "}
                          {etichettaMese(gruppo.mesi[gruppo.mesi.length - 1])}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Badge variant="outline" className="tabular-nums">
                          {gruppo.mesi.length}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-text-3">
        L&apos;elenco è calcolato dai documenti di Fatture in Cloud, senza
        chiedere niente a Tars. Un costo classificato a mano dalla direzione
        mantiene la classificazione scelta.
      </p>
    </div>
  );
}
