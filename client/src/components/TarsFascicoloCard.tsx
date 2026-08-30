// Pannello contestuale di Tars (T3) — fascicolo C3 della commessa.
// Nessun run del modello e nessun token: solo il derivato deterministico
// servito da tars.fascicolo. La query parte SOLO con i flag accesi
// (platform.interruttori è già in cache dal layout): con Tars spento il
// pannello non esiste nel DOM e non produce né richieste né errori.

import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, ArrowRight, BrainCircuit, CheckCircle2 } from "lucide-react";
import { useLocation } from "wouter";

export default function TarsFascicoloCard({
  commessaId,
}: {
  commessaId: number;
}) {
  const [, navigate] = useLocation();
  const interruttori = trpc.platform.interruttori.useQuery(undefined, {
    staleTime: 300_000,
  });
  const attivo = Boolean(
    (interruttori.data as any)?.tars &&
      (interruttori.data as any)?.tarsReadTools
  );
  const fascicolo = trpc.tars.fascicolo.useQuery(
    { commessaId },
    { retry: false, staleTime: 60_000, enabled: attivo }
  );
  if (!attivo || !fascicolo.data) return null;
  const f = fascicolo.data;
  const ordiniInRitardo = f.ordini.filter(o => o.inRitardo).length;
  const dataConfermata = f.dataConsegnaConfermata
    ? new Date(f.dataConsegnaConfermata).toLocaleDateString("it-IT")
    : null;

  return (
    <Card className="mt-4">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <BrainCircuit className="h-4 w-4 shrink-0" />
          <p className="text-sm font-semibold">Tars — fascicolo</p>
          {f.stale && (
            <Badge variant="outline" className="text-[10px] text-warning">
              dati non aggiornati
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2 text-xs"
            onClick={() => navigate("/tars")}
          >
            Apri Tars <ArrowRight className="h-3 w-3 ml-1" />
          </Button>
        </div>

        <div className="mt-2 flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            {f.gate.soddisfatto ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            )}
            Gate {f.gate.soddisfatto ? "soddisfatto" : "da completare"}
          </span>
          <span>
            {f.ordini.length} ordini fornitori
            {ordiniInRitardo > 0 ? ` (${ordiniInRitardo} in ritardo)` : ""}
          </span>
          {dataConfermata && <span>consegna confermata {dataConfermata}</span>}
        </div>

        {f.domandeAperte.length > 0 && (
          <ul className="mt-2 space-y-1">
            {f.domandeAperte.slice(0, 4).map((domanda, i) => (
              <li key={i} className="text-xs flex gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-px" />
                <span className="min-w-0 break-words">{domanda}</span>
              </li>
            ))}
            {f.domandeAperte.length > 4 && (
              <li className="text-[11px] text-muted-foreground">
                +{f.domandeAperte.length - 4} altre: chiedi a Tars.
              </li>
            )}
          </ul>
        )}
        {f.domandeAperte.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Nessuna domanda aperta: gate e date degli ordini coerenti.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
