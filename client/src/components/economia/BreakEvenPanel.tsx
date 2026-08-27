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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowRight,
  Calculator,
  CheckCircle2,
  CircleAlert,
  Loader2,
  SlidersHorizontal,
  Target,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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

/**
 * Le due leve del pareggio.
 *
 * Il margine di contribuzione si calcola dagli ultimi dodici mesi, ma in quel
 * periodo centinaia di costi erano ancora da classificare: una percentuale
 * precisa su dati incompleti resta una percentuale sbagliata, e chi conosce
 * l'azienda deve poterla fissare.
 *
 * Gli straordinari sono l'altra: sui dati veri valgono più dei costi fissi e
 * oggi non entrano nel calcolo da nessuna parte — né fissi né variabili.
 * Se per questa azienda sono struttura sotto un altro nome, vanno contati.
 *
 * L'impostazione è della sede: due persone che guardano lo stesso obiettivo
 * devono leggere lo stesso numero.
 */
function ImpostazioniPareggio({ data }: { data: any }) {
  const utils = trpc.useUtils();
  const [aperto, setAperto] = useState(false);
  const salvate = trpc.costiFissi.impostazioni.useQuery(undefined, {
    enabled: aperto,
  });
  const [margine, setMargine] = useState("");
  const [straordinari, setStraordinari] = useState(false);

  useEffect(() => {
    if (!salvate.data) return;
    setMargine(
      salvate.data.margineManuale == null
        ? ""
        : String(Math.round(salvate.data.margineManuale * 1000) / 10)
    );
    setStraordinari(salvate.data.includiStraordinari);
  }, [salvate.data]);

  const salva = trpc.costiFissi.salvaImpostazioni.useMutation({
    onSuccess: () => {
      utils.economia.invalidate();
      utils.costiFissi.invalidate();
      setAperto(false);
    },
    onError: e => toast.error(e.message),
  });

  const numero = Number(margine.replace(",", "."));
  const margineValido = margine.trim() === "" || (numero > 0 && numero <= 100);

  if (!aperto) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-xs"
          onClick={() => setAperto(true)}
        >
          <SlidersHorizontal className="mr-1 h-3 w-3" />
          Come calcolarlo
        </Button>
        {!data.straordinariInclusi && (data.costiStraordinari ?? 0) > 0 && (
          <span className="text-text-3">
            {formatEuroSimbolo(data.costiStraordinari)} di straordinari nel
            periodo restano fuori dal conto.
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border bg-surface-2 p-3">
      <div className="space-y-1">
        <Label htmlFor="be-margine" className="text-xs">
          Margine di contribuzione
        </Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="be-margine"
            inputMode="decimal"
            value={margine}
            onChange={e => setMargine(e.target.value)}
            placeholder={`${Math.round((data.margineCalcolato ?? 0) * 100)}`}
            className="h-10 w-24 tabular-nums"
            aria-invalid={!margineValido}
          />
          <span className="text-xs text-text-3">
            % — vuoto usa quello calcolato dai documenti (
            {Math.round((data.margineCalcolato ?? 0) * 100)}%, su{" "}
            {data.mesiCoperti} mesi)
          </span>
        </div>
        {!margineValido && (
          <p className="text-[11px] text-danger">
            Serve una percentuale fra 1 e 100.
          </p>
        )}
      </div>

      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
          checked={straordinari}
          onChange={e => setStraordinari(e.target.checked)}
        />
        <span className="min-w-0">
          Conta anche gli straordinari fra i costi da coprire
          <span className="block text-text-3">
            {formatEuroSimbolo(data.costiStraordinari ?? 0)} negli ultimi{" "}
            {data.mesiCoperti} mesi. Oggi non entrano né fra i fissi né fra i
            variabili: spariscono dal pareggio.
          </span>
        </span>
      </label>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          onClick={() => setAperto(false)}
        >
          Annulla
        </Button>
        <Button
          size="sm"
          className="h-9"
          disabled={!margineValido || salva.isPending}
          onClick={() =>
            salva.mutate({
              margineManuale:
                margine.trim() === ""
                  ? null
                  : Math.round((numero / 100) * 10000) / 10000,
              includiStraordinari: straordinari,
            })
          }
        >
          {salva.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : null}
          Salva
        </Button>
      </div>
    </div>
  );
}

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
                    <p className="eyebrow">Costi da coprire</p>
                    <p className="mt-1 text-lg font-bold tabular-nums">
                      {formatEuroSimbolo(data.daCoprireMensile ?? 0)}
                    </p>
                    {/* Se nessuno ha dichiarato stipendi e contributi,
                        l'obiettivo è calcolato su una parte sola dei costi:
                        va detto qui, dove il numero si legge. */}
                    {(data.costiFissiDichiarati ?? 0) === 0 && (
                      <p className="mt-0.5 text-[11px] leading-tight text-warning">
                        Solo fatture d&apos;acquisto: stipendi e contributi non
                        sono dichiarati.
                      </p>
                    )}
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
                {/* La catena per esteso. L'obiettivo non contiene nessun
                    utile: è solo il fatturato che serve perché i costi fissi
                    tornino a zero, e senza vedere la divisione sembrava che
                    dentro ci fosse un margine deciso da qualcuno. */}
                <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  {stato === "raggiunto" ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : (
                    <Calculator className="h-4 w-4 text-primary" />
                  )}
                  <span className="text-text-2">
                    {formatEuroSimbolo(data.daCoprireMensile ?? 0)} di costi
                    fissi ÷ {Math.round((data.margineContribuzione ?? 0) * 100)}%
                    di margine ={" "}
                    <strong>
                      {formatEuroSimbolo(data.obiettivoMensile ?? 0)}
                    </strong>{" "}
                    da fatturare. Nessun utile dentro.
                  </span>
                  {data.margineFonte === "manuale" && (
                    <Badge variant="outline" className="text-[10px]">
                      margine fissato a mano
                    </Badge>
                  )}
                </div>
                <ImpostazioniPareggio data={data} />
              </>
            ) : (
              <>
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
                {/* Il costo di esistere non dipende dal margine: si sa anche
                    quando l'obiettivo non è calcolabile, ed è metà della
                    risposta. Nasconderlo lasciava la pagina muta. */}
                {data.daCoprireMensile != null && (
                  <p className="mt-3 text-sm text-text-2">
                    Intanto: coprire i costi fissi costa{" "}
                    <strong className="tabular-nums">
                      {formatEuroSimbolo(data.daCoprireMensile)}
                    </strong>{" "}
                    al mese.
                  </p>
                )}
                <ImpostazioniPareggio data={data} />
              </>
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
              incassare. I costi fissi sommano le fatture d&apos;acquisto
              classificate «Fisso», mediate sul periodo, e le voci dichiarate
              a mano in Contabilità → Costi fissi, che invece pesano per
              quanto valgono oggi: un canone chiuso a marzo non deve alzare
              l&apos;obiettivo di agosto.
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
