import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatEuroSimbolo } from "@/lib/euro";
import {
  etichettaAffidabilita,
  percentualeCopertura,
  statoCopertura,
} from "@/lib/economiaView";
import { trpc } from "@/lib/trpc";
import {
  ArrowRight,
  Calculator,
  CheckCircle2,
  CircleAlert,
  Loader2,
  Target,
} from "lucide-react";

const MESI = [
  "Gennaio",
  "Febbraio",
  "Marzo",
  "Aprile",
  "Maggio",
  "Giugno",
  "Luglio",
  "Agosto",
  "Settembre",
  "Ottobre",
  "Novembre",
  "Dicembre",
];

export default function BreakEvenPanel({ onReview }: { onReview: () => void }) {
  const oggi = new Date();
  const anno = oggi.getFullYear();
  const mese = oggi.getMonth() + 1;
  const query = trpc.economia.breakEven.useQuery(
    { anno, mese },
    { retry: false }
  );

  if (query.error) return null;
  if (query.isLoading || !query.data) {
    return (
      <Card className="overflow-hidden">
        <CardContent className="flex min-h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-text-3" />
        </CardContent>
      </Card>
    );
  }

  const data = query.data;
  const progress = percentualeCopertura(
    data.fatturatoMese,
    data.obiettivoMensile
  );
  const stato = statoCopertura(data.stato, data.ancoraDaFatturare);

  return (
    <Card className="overflow-hidden border-primary/25 bg-gradient-to-br from-surface via-surface to-primary/5">
      <CardContent className="p-0">
        <div className="flex flex-col gap-5 p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 lg:max-w-[360px]">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Target className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Copertura costi fissi</p>
                <p className="text-xs text-text-3">
                  Obiettivo netto di {MESI[mese - 1].toLowerCase()}
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-end gap-2">
              <span className="text-2xl font-bold tabular-nums sm:text-3xl">
                {data.obiettivoMensile == null
                  ? "—"
                  : formatEuroSimbolo(data.obiettivoMensile)}
              </span>
              {data.stato === "disponibile" && (
                <span className="pb-1 text-xs text-text-3">da fatturare</span>
              )}
            </div>
            <Badge
              variant={
                data.affidabilita === "alta"
                  ? "success"
                  : data.affidabilita === "media"
                    ? "warning"
                    : "outline"
              }
              className="mt-2"
            >
              {etichettaAffidabilita(data.affidabilita)}
            </Badge>
          </div>

          <div className="min-w-0 flex-1 lg:max-w-3xl">
            {data.stato === "disponibile" ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <p className="eyebrow">Già fatturato netto</p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-success">
                      {formatEuroSimbolo(data.fatturatoMese)}
                    </p>
                  </div>
                  <div>
                    <p className="eyebrow">Ancora da fatturare</p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-warning">
                      {formatEuroSimbolo(data.ancoraDaFatturare ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="eyebrow">Costi fissi medi</p>
                    <p className="mt-1 text-lg font-bold tabular-nums">
                      {formatEuroSimbolo(data.costiFissiMensili ?? 0)}
                    </p>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="text-text-2">Copertura del mese</span>
                    <span className="font-semibold tabular-nums">
                      {progress}%
                    </span>
                  </div>
                  <Progress value={progress} className="h-2.5" />
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs">
                  {stato === "raggiunto" ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : (
                    <Calculator className="h-4 w-4 text-primary" />
                  )}
                  <span className="text-text-2">
                    Margine di contribuzione usato:{" "}
                    {Math.round((data.margineContribuzione ?? 0) * 100)}%
                  </span>
                </div>
              </>
            ) : (
              <div className="rounded-md border border-warning/30 bg-warning-soft p-3">
                <div className="flex gap-2">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div>
                    <p className="text-sm font-semibold">
                      Obiettivo non ancora affidabile
                    </p>
                    <p className="mt-1 text-xs text-text-2">
                      {data.motivi.join(" ")}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <details className="text-xs text-text-2">
            <summary className="min-h-11 cursor-pointer py-3 font-medium text-text-1">
              Come viene calcolato
            </summary>
            <p className="max-w-3xl pb-3 leading-relaxed">
              Costi fissi medi divisi per il margine di contribuzione degli
              ultimi {data.mesiCoperti} mesi disponibili, dal {data.periodoDa}
              al {data.periodoA}. IVA esclusa. Fatturare non equivale a
              incassare.
            </p>
          </details>
          {data.documentiDubbi > 0 && (
            <Button variant="outline" className="min-h-11" onClick={onReview}>
              Rivedi {data.documentiDubbi} costi dubbi
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
