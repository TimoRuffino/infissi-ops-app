import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  CircleOff,
  Cpu,
  Flag,
  Gauge,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import {
  derivaGateQueryAgente,
  derivaStatoAgente,
  etichettaAmbitoCosti,
  etichettaStatoAgente,
  formattaCostoUsd,
  percentualeBudget,
  type TarsAgentStatus,
} from "@/lib/tarsAgentView";

const LABEL_STATO: Record<TarsAgentStatus, string> = {
  spento: "bg-surface-2 text-text-3",
  disponibile: "bg-success-soft text-success",
  degradato: "bg-warning-soft text-warning",
};

function IconaStato({ stato }: { stato: TarsAgentStatus }) {
  if (stato === "spento")
    return <CircleOff className="h-3.5 w-3.5" aria-hidden="true" />;
  if (stato === "degradato")
    return <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />;
  return <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />;
}

function valore<T>(value: T | null | undefined, fallback = "—"): T | string {
  return value == null || value === "" ? fallback : value;
}

export type TarsAgentCardProps = {
  direzione: boolean;
};

export function TarsAgentCard({ direzione }: TarsAgentCardProps) {
  const [dettagliAperti, setDettagliAperti] = useState(false);
  const interruttori = trpc.platform.interruttori.useQuery(undefined, {
    staleTime: 300_000,
    retry: false,
  });
  const gate = derivaGateQueryAgente(interruttori.data, direzione);
  const stato = trpc.tars.stato.useQuery(undefined, {
    enabled: gate.statoAbilitato,
    retry: false,
    staleTime: 60_000,
  });
  const costi = trpc.tars.costi.useQuery(undefined, {
    enabled: gate.costiAbilitati,
    retry: false,
    staleTime: 60_000,
  });

  const statoAgente = derivaStatoAgente({
    interruttori: interruttori.data,
    stato: stato.data,
    erroreStato: Boolean(interruttori.error || stato.error),
  });
  const providerDettaglio = stato.data?.providerDettaglio;
  const riepilogoCosti = costi.data?.riepilogo;
  const budget = costi.data?.budgetConfigurato;
  const percentualeGiorno = percentualeBudget(
    riepilogoCosti?.spesaGiornoUsd,
    budget?.giornalieroUsd
  );
  const percentualeMese = percentualeBudget(
    riepilogoCosti?.spesaMeseUsd,
    budget?.mensileUsd
  );
  const flag = interruttori.data
    ? Object.entries(interruttori.data).filter(([, attivo]) => attivo)
    : [];
  const strumenti = stato.data?.strumentiDisponibili ?? [];
  const run = stato.data?.run;

  return (
    <Card aria-label="Stato tecnico dell'agente Tars">
      <CardHeader className="gap-3">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <Cpu className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base">Agente</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Stato tecnico e capacità disponibili per Tars
              </p>
            </div>
          </div>
          <Badge className={`gap-1 ${LABEL_STATO[statoAgente]}`}>
            <IconaStato stato={statoAgente} />
            {etichettaStatoAgente(statoAgente)}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 border-t pt-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-5">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Provider</dt>
            <dd className="mt-0.5 truncate font-medium">
              {valore(stato.data?.provider)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Modello</dt>
            <dd className="mt-0.5 truncate font-medium">
              {valore(stato.data?.modello)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Run totali</dt>
            <dd className="mt-0.5 font-medium">{valore(run?.totale)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Run degradati</dt>
            <dd className="mt-0.5 font-medium">{valore(run?.degradati)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Ultimo run</dt>
            <dd className="mt-0.5 truncate font-medium">
              {run?.ultimo
                ? new Intl.DateTimeFormat("it-IT", {
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(new Date(run.ultimo))
                : "—"}
            </dd>
          </div>
        </dl>

        {direzione && gate.costiAbilitati && costi.data && (
          <section
            aria-labelledby="tars-consumi-title"
            className="space-y-3 rounded-lg bg-surface-2 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3
                  id="tars-consumi-title"
                  className="flex items-center gap-1.5 text-sm font-semibold"
                >
                  <Gauge className="h-4 w-4 text-text-3" aria-hidden="true" />
                  Consumi
                </h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {etichettaAmbitoCosti()}
                </p>
              </div>
              <Badge variant="outline" className="text-[10px]">
                USD
              </Badge>
            </div>
            <div className="space-y-3">
              <BudgetRow
                label="Oggi"
                spent={riepilogoCosti?.spesaGiornoUsd}
                remaining={riepilogoCosti?.residuoGiornoUsd}
                limit={budget?.giornalieroUsd}
                percentage={percentualeGiorno}
              />
              <BudgetRow
                label="Questo mese"
                spent={riepilogoCosti?.spesaMeseUsd}
                remaining={riepilogoCosti?.residuoMeseUsd}
                limit={budget?.mensileUsd}
                percentage={percentualeMese}
              />
            </div>
            {riepilogoCosti && (
              <p className="text-[11px] text-muted-foreground">
                {riepilogoCosti.chiamateGiorno} chiamate ·{" "}
                {riepilogoCosti.runGiorno} run · media{" "}
                {formattaCostoUsd(riepilogoCosti.costoMedioRunUsd)} · massimo{" "}
                {formattaCostoUsd(riepilogoCosti.costoMassimoRunUsd)}
              </p>
            )}
          </section>
        )}

        <Collapsible open={dettagliAperti} onOpenChange={setDettagliAperti}>
          <CollapsibleTrigger asChild>
            <Button
              variant="outline"
              className="h-9 w-full justify-between px-3 text-xs"
            >
              <span className="flex items-center gap-2">
                <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                Diagnostica, strumenti e interruttori
              </span>
              <ChevronDown
                className={`h-4 w-4 transition-transform ${dettagliAperti ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-3">
            {providerDettaglio?.motivoIndisponibilita && (
              <p className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
                <AlertCircle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  aria-hidden="true"
                />
                {providerDettaglio.motivoIndisponibilita}
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0 space-y-2">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Wrench className="h-3.5 w-3.5" aria-hidden="true" />{" "}
                  Strumenti attivi
                </h3>
                {strumenti.length ? (
                  <ul className="space-y-1 text-xs text-text-1">
                    {strumenti.map(strumento => (
                      <li key={strumento.nome} className="truncate">
                        {strumento.nome}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Nessuno strumento disponibile.
                  </p>
                )}
              </div>
              <div className="min-w-0 space-y-2">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Flag className="h-3.5 w-3.5" aria-hidden="true" />{" "}
                  Interruttori attivi
                </h3>
                {flag.length ? (
                  <ul className="space-y-1 text-xs text-text-1">
                    {flag.map(([nome]) => (
                      <li key={nome} className="truncate">
                        {nome}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Tars non è attivo.
                  </p>
                )}
              </div>
            </div>
            {stato.data?.contestoAttivo && (
              <p className="text-[11px] text-muted-foreground">
                Contesto attivo:{" "}
                {stato.data.contestoAttivo.superficie ?? "operativo"}
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

function BudgetRow({
  label,
  spent,
  remaining,
  limit,
  percentage,
}: {
  label: string;
  spent: number | null | undefined;
  remaining: number | null | undefined;
  limit: number | null | undefined;
  percentage: number | null;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {formattaCostoUsd(spent)} / {formattaCostoUsd(limit)}
        </span>
      </div>
      <Progress value={percentage ?? 0} aria-label={`Budget ${label}`} />
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {percentage == null
            ? "Budget non disponibile"
            : `${Math.round(percentage)}% utilizzato`}
        </span>
        <span>Residuo {formattaCostoUsd(remaining)}</span>
      </div>
    </div>
  );
}

export default TarsAgentCard;
