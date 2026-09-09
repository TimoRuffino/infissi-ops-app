// La scheda «Abbonamento e consumi» dell'hub Impostazioni (spec WS4 §8):
// che cosa ha l'azienda, fino a quando, e quanto ha consumato delle due
// risorse misurate. La legge chi ha il contratto in mano — proprietario e
// direzione — perché parla di piano, budget in euro e scadenze.
//
// Nessun pulsante di pagamento: il provider è `nessuno` (spec §5), quindi
// l'unica via per prorogare o chiedere capacità è scriverlo a chi gestisce
// la piattaforma. Una scheda che mostrasse un bottone morto sarebbe peggio
// di una scheda che dice come si fa davvero.
import { Ban, Clock } from "lucide-react";
import type { ReactNode } from "react";

import { useAuth } from "@/_core/hooks/useAuth";
import DataSurface from "@/components/patterns/DataSurface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatEuroSimbolo } from "@/lib/euro";
import { hasRuolo, isDirezione } from "@/lib/roles";
import { trpc } from "@/lib/trpc";
import { permessoNegato } from "@/lib/trpcErrors";
import { cn } from "@/lib/utils";

import {
  byteScritti,
  dataItaliana,
  etichettaStato,
  etichettaTipo,
  meseScritto,
  percentualeScritta,
  tonoStato,
} from "./testi";

/** L'ancora del link delle notifiche (`/integrazioni?scheda=abbonamento`). */
export const ID_SCHEDA_ABBONAMENTO = "abbonamento";

const VARIANTE_BADGE = {
  quieto: "secondary",
  attenzione: "warning",
  errore: "danger",
} as const;

function Voce({ etichetta, children }: { etichetta: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-text-3">
        {etichetta}
      </dt>
      <dd className="mt-1 min-w-0 text-sm leading-5 text-text-1">{children}</dd>
    </div>
  );
}

/**
 * Una risorsa misurata. `percentuale` a `null` significa «nessun tetto»
 * (tenant 1) o «non lo so» (ledger non leggibile): in quel caso la barra non
 * si disegna affatto, perché una barra a zero racconterebbe una bugia
 * rassicurante.
 */
function Barra({
  etichetta,
  percentuale,
  dettaglio,
  senzaTetto,
  blocco,
}: {
  etichetta: string;
  percentuale: number | null;
  dettaglio: string;
  senzaTetto: string;
  blocco: { data: Date; fermo: boolean } | null;
}) {
  const valore =
    percentuale == null ? null : Math.max(0, Math.min(100, Math.round(percentuale)));
  const pieno =
    percentuale == null
      ? ""
      : percentuale >= 100
        ? "bg-danger"
        : percentuale >= 80
          ? "bg-warning"
          : "bg-success";

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold text-text-1">
          {etichetta}
        </span>
        {percentuale != null ? (
          <span className="shrink-0 text-sm font-semibold tabular-nums text-text-1">
            {percentualeScritta(percentuale)}
          </span>
        ) : null}
      </div>
      {percentuale != null && valore != null ? (
        <div
          role="progressbar"
          aria-valuenow={valore}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${etichetta}: ${percentualeScritta(percentuale)}`}
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2"
        >
          <div className={cn("h-full", pieno)} style={{ width: `${valore}%` }} />
        </div>
      ) : null}
      <p className="mt-1.5 min-w-0 text-xs leading-4 text-text-2">
        {percentuale == null ? senzaTetto : dettaglio}
      </p>
      {blocco ? (
        <p
          className={cn(
            "mt-1 flex min-w-0 items-center gap-1.5 text-xs font-semibold leading-4",
            blocco.fermo ? "text-danger" : "text-warning"
          )}
        >
          {blocco.fermo ? (
            <Ban className="size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <Clock className="size-3.5 shrink-0" aria-hidden="true" />
          )}
          <span className="min-w-0">
            {blocco.fermo
              ? `Fermo dal ${dataItaliana(blocco.data)}`
              : `Blocco dal ${dataItaliana(blocco.data)}`}
          </span>
        </p>
      ) : null}
    </div>
  );
}

export default function AbbonamentoCard() {
  const { user } = useAuth();
  // Stesso gate delle altre schede di direzione: specchio UX del confine
  // vero, che resta la `protectedProcedure` (budget ed extra in euro il
  // server li dà solo a proprietario e direzione).
  const puoVedere = isDirezione(user) || hasRuolo(user, "proprietario");
  const abbonamento = trpc.tenants.abbonamento.useQuery(undefined, {
    enabled: puoVedere,
    staleTime: 60_000,
    retry: false,
  });
  const consumi = trpc.tenants.consumi.useQuery(undefined, {
    enabled: puoVedere,
    staleTime: 60_000,
    retry: false,
  });

  if (!puoVedere) return null;

  const titolo = "Abbonamento e consumi";
  const descrizione =
    "Il contratto dell'azienda e le due risorse misurate: lo spazio dei file e il budget mensile di Tars.";

  if (permessoNegato(abbonamento.error) || permessoNegato(consumi.error)) return null;

  if (abbonamento.isLoading || consumi.isLoading) {
    return (
      <DataSurface
        id={ID_SCHEDA_ABBONAMENTO}
        density="comfortable"
        tone="default"
        title={titolo}
        description={descrizione}
        state={{
          kind: "loading",
          title: "Lettura del contratto",
          description: "Stato dell'abbonamento e consumi del periodo.",
          rows: 2,
        }}
      />
    );
  }

  if (abbonamento.error || consumi.error || !abbonamento.data || !consumi.data) {
    return (
      <DataSurface
        id={ID_SCHEDA_ABBONAMENTO}
        density="comfortable"
        tone="default"
        title={titolo}
        description={descrizione}
        state={{
          kind: "error",
          title: "Abbonamento non leggibile",
          description:
            abbonamento.error?.message ??
            consumi.error?.message ??
            "Il server non ha risposto con lo stato dell'abbonamento.",
          action: (
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 sm:min-h-9"
              onClick={() => {
                void abbonamento.refetch();
                void consumi.refetch();
              }}
            >
              Riprova
            </Button>
          ),
        }}
      />
    );
  }

  const a = abbonamento.data;
  const { storage, tars } = consumi.data;
  const adesso = new Date();
  const scadenza = a.finePeriodo ?? a.omaggio?.scadenza ?? null;
  const giorni = a.giorniAllaScadenza;

  const bloccoStorage = storage.bloccoDal
    ? { data: storage.bloccoDal, fermo: adesso.getTime() >= storage.bloccoDal.getTime() }
    : null;
  const bloccoTars = tars.bloccoDal
    ? { data: tars.bloccoDal, fermo: adesso.getTime() >= tars.bloccoDal.getTime() }
    : null;

  // Il budget in euro il server lo dà solo a chi può vederlo: qui non si
  // inventa un «0 €» quando è `null`, si tace il numero e resta il mese.
  const budget =
    tars.budgetEur == null
      ? `Budget di ${meseScritto(tars.mese)}`
      : `${formatEuroSimbolo(tars.budgetEur)} al mese` +
        (tars.extraEur ? ` + ${formatEuroSimbolo(tars.extraEur)} di extra` : "") +
        ` · ${meseScritto(tars.mese)}`;
  // Percentuale assente vuol dire due cose diverse: nessun tetto per questa
  // azienda (tenant 1, piano senza budget) oppure un consumo che il server
  // non è riuscito a leggere. Dirle con la stessa frase sarebbe una bugia
  // comoda: un budget c'è, e non saperlo contare non lo cancella.
  const tarsSenzaPercentuale =
    tars.budgetEur == null
      ? "Nessun budget per azienda"
      : `${budget} · consumo del mese non disponibile`;

  return (
    <DataSurface
      id={ID_SCHEDA_ABBONAMENTO}
      density="comfortable"
      tone="default"
      title={titolo}
      description={descrizione}
      footer="Per estendere la prova o chiedere capacità scrivi a chi gestisce la piattaforma."
    >
      <dl className="grid min-w-0 gap-4 sm:grid-cols-3">
        <Voce etichetta="Piano">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0">{etichettaTipo(a.tipo)}</span>
            {a.tipo === "complimentary" ? (
              <Badge variant="brand">Omaggio</Badge>
            ) : null}
          </span>
        </Voce>
        <Voce etichetta="Stato">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant={VARIANTE_BADGE[tonoStato(a.stato)]}>
              {etichettaStato(a.stato)}
            </Badge>
            {a.disdettaAFinePeriodo ? (
              <Badge variant="outline">Disdetta a fine periodo</Badge>
            ) : null}
          </span>
        </Voce>
        <Voce etichetta="Scadenza">
          {scadenza ? (
            <span className="flex min-w-0 flex-col">
              <span className="tabular-nums">{dataItaliana(scadenza)}</span>
              {giorni != null ? (
                <span className="text-xs text-text-2">
                  {giorni > 0
                    ? `fra ${giorni} ${giorni === 1 ? "giorno" : "giorni"}`
                    : giorni === 0
                      ? "oggi"
                      : `scaduta da ${-giorni} ${giorni === -1 ? "giorno" : "giorni"}`}
                </span>
              ) : null}
            </span>
          ) : (
            "Senza scadenza"
          )}
        </Voce>
      </dl>

      <div className="grid min-w-0 gap-4 border-t border-border-soft pt-4 sm:grid-cols-2">
        <Barra
          etichetta="Spazio dei file"
          percentuale={storage.percentuale}
          dettaglio={`${byteScritti(storage.bytes)} di ${byteScritti(storage.quotaBytes)} · tolleranza ${storage.tolleranzaGiorni} giorni`}
          senzaTetto="Nessuna quota per questa azienda"
          blocco={bloccoStorage}
        />
        <Barra
          etichetta="Budget di Tars"
          percentuale={tars.percentuale}
          dettaglio={budget}
          senzaTetto={tarsSenzaPercentuale}
          blocco={bloccoTars}
        />
      </div>
    </DataSurface>
  );
}
