import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SmistamentoSituazione,
  smistamentoVuoto,
  type SmistamentoSezione,
} from "@/components/tars/TarsSmistamento";
import { Inbox } from "lucide-react";
import {
  AlertCircle,
  AlertTriangle,
  BellRing,
  BriefcaseBusiness,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  RefreshCw,
} from "lucide-react";

export type ContestoOperativoTars = {
  superficie: string | null;
  entita: {
    tipo: string;
    id: number;
    etichetta?: string;
  };
  dettagli?: readonly { etichetta: string; valore: string }[];
};

export type BriefingOperativoTars = {
  promemoriaOggi: readonly {
    id: number;
    testo: string;
    remindAtLocale: string;
  }[];
  casiMiei: readonly {
    id: number;
    titolo: string;
    priorita: string;
    prossimaAzione?: string;
    link: string;
  }[];
  segnalazioni:
    | readonly {
        titolo: string;
        dettaglio?: string;
        link: string;
        agganciataACasoAperto: boolean;
      }[]
    | null;
  /** Sezione smistamento (02/09/2026): assente o null = non inclusa. */
  smistamento?: SmistamentoSezione | null;
};

export type TarsContextPanelProps = {
  contesto: ContestoOperativoTars | null;
  briefing: BriefingOperativoTars | null;
  loading?: boolean;
  error?: string | null;
  onApriLink?: (link: string) => void;
  onRetry?: () => void;
};

function AzioneLink({
  label,
  dettaglio,
  onClick,
}: {
  label: string;
  dettaglio?: string;
  onClick?: () => void;
}) {
  if (!onClick) {
    return (
      <div className="min-w-0 px-3 py-2.5">
        <p className="break-words text-xs font-semibold text-text-1">{label}</p>
        {dettaglio && (
          <p className="mt-0.5 break-words text-[11px] leading-5 text-text-3">
            {dettaglio}
          </p>
        )}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClick}
    >
      <span className="min-w-0 flex-1">
        <span className="block break-words text-xs font-semibold text-text-1">
          {label}
        </span>
        {dettaglio && (
          <span className="mt-0.5 block break-words text-[11px] leading-5 text-text-3">
            {dettaglio}
          </span>
        )}
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-text-3"
        aria-hidden="true"
      />
    </button>
  );
}

export default function TarsContextPanel({
  contesto,
  briefing,
  loading = false,
  error = null,
  onApriLink,
  onRetry,
}: TarsContextPanelProps) {
  return (
    <aside
      aria-label="Contesto operativo Tars"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto bg-card p-4"
    >
      <div className="mb-4">
        <h2 className="text-sm font-bold text-text-1">Contesto operativo</h2>
        <p className="mt-0.5 text-xs leading-5 text-text-3">
          Entità attiva e situazione di oggi.
        </p>
      </div>

      {loading ? (
        <div aria-label="Caricamento contesto" className="space-y-5">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24 motion-reduce:animate-none" />
            <Skeleton className="h-20 w-full motion-reduce:animate-none" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-32 motion-reduce:animate-none" />
            <Skeleton className="h-14 w-full motion-reduce:animate-none" />
            <Skeleton className="h-14 w-full motion-reduce:animate-none" />
          </div>
        </div>
      ) : error ? (
        <div className="grid min-h-64 place-items-center text-center">
          <div>
            <AlertCircle
              className="mx-auto size-6 text-danger"
              aria-hidden="true"
            />
            <p className="mt-3 text-sm font-semibold">
              Contesto non disponibile
            </p>
            <p className="mt-1 text-xs leading-5 text-text-3">{error}</p>
            {onRetry && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-4 min-h-11"
                onClick={onRetry}
              >
                <RefreshCw aria-hidden="true" />
                Riprova
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <section aria-labelledby="tars-entita-attiva">
            <h3
              id="tars-entita-attiva"
              className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-text-3"
            >
              <BriefcaseBusiness className="size-4" aria-hidden="true" />
              Entità attiva
            </h3>
            {contesto ? (
              <div className="mt-2 rounded-md border border-border-soft bg-surface px-3 py-3">
                <p className="text-sm font-semibold text-text-1">
                  {contesto.entita.etichetta ??
                    `${contesto.entita.tipo} #${contesto.entita.id}`}
                </p>
                {contesto.superficie && (
                  <p className="mt-0.5 text-xs capitalize text-text-3">
                    Area: {contesto.superficie.replaceAll("-", " ")}
                  </p>
                )}
                {contesto.dettagli && contesto.dettagli.length > 0 && (
                  <dl className="mt-3 space-y-2 border-t border-border-soft pt-2">
                    {contesto.dettagli.map(dettaglio => (
                      <div
                        key={dettaglio.etichetta}
                        className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-2 text-xs"
                      >
                        <dt className="text-text-3">{dettaglio.etichetta}</dt>
                        <dd className="break-words text-right font-medium text-text-1">
                          {dettaglio.valore}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            ) : (
              <p className="mt-2 rounded-md border border-dashed border-border-strong px-3 py-3 text-xs leading-5 text-text-3">
                Nessuna entità selezionata in questa conversazione.
              </p>
            )}
          </section>

          <section aria-labelledby="tars-briefing-oggi">
            <h3
              id="tars-briefing-oggi"
              className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-text-3"
            >
              <ClipboardList className="size-4" aria-hidden="true" />
              Briefing di oggi
            </h3>
            {briefing === null ? (
              <p className="mt-2 rounded-md bg-surface-2 px-3 py-3 text-xs leading-5 text-text-3">
                Briefing non disponibile. I dati operativi non sono stati
                inclusi.
              </p>
            ) : briefing.promemoriaOggi.length === 0 &&
              briefing.casiMiei.length === 0 &&
              briefing.segnalazioni === null ? (
              <p className="mt-2 rounded-md bg-surface-2 px-3 py-3 text-xs leading-5 text-text-3">
                Nessun promemoria o caso assegnato da evidenziare.
              </p>
            ) : briefing.promemoriaOggi.length === 0 &&
              briefing.casiMiei.length === 0 &&
              briefing.segnalazioni !== null &&
              briefing.segnalazioni.length === 0 ? (
              <p className="mt-2 rounded-md bg-success-soft px-3 py-3 text-xs leading-5 text-success">
                Nessun promemoria, caso assegnato o segnale operativo da
                evidenziare.
              </p>
            ) : (
              <div className="mt-2 space-y-3">
                {briefing.promemoriaOggi.length > 0 && (
                  <div className="rounded-md border border-border-soft bg-surface py-1">
                    <p className="flex items-center gap-2 px-3 py-2 text-xs font-semibold">
                      <CalendarClock
                        className="size-4 text-text-3"
                        aria-hidden="true"
                      />
                      Promemoria
                    </p>
                    {briefing.promemoriaOggi.slice(0, 5).map(promemoria => (
                      <AzioneLink
                        key={promemoria.id}
                        label={promemoria.testo}
                        dettaglio={promemoria.remindAtLocale}
                      />
                    ))}
                  </div>
                )}
                {briefing.casiMiei.length > 0 && (
                  <div className="rounded-md border border-border-soft bg-surface py-1">
                    <p className="flex items-center gap-2 px-3 py-2 text-xs font-semibold">
                      <BriefcaseBusiness
                        className="size-4 text-text-3"
                        aria-hidden="true"
                      />
                      Casi assegnati
                    </p>
                    {briefing.casiMiei.slice(0, 5).map(caso => (
                      <AzioneLink
                        key={caso.id}
                        label={caso.titolo}
                        dettaglio={`${caso.priorita}${caso.prossimaAzione ? ` · ${caso.prossimaAzione}` : ""}`}
                        onClick={
                          onApriLink ? () => onApriLink(caso.link) : undefined
                        }
                      />
                    ))}
                  </div>
                )}
                {(briefing.segnalazioni?.length ?? 0) > 0 && (
                  <div className="rounded-md border border-warning/25 bg-warning-soft py-1">
                    <p className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-warning">
                      <BellRing className="size-4" aria-hidden="true" />
                      Segnalazioni
                    </p>
                    {briefing
                      .segnalazioni!.slice(0, 5)
                      .map((segnalazione, index) => (
                        <AzioneLink
                          key={`${segnalazione.link}-${index}`}
                          label={segnalazione.titolo}
                          dettaglio={
                            segnalazione.agganciataACasoAperto
                              ? "Già seguita nel Centro Azioni"
                              : segnalazione.dettaglio
                          }
                          onClick={
                            onApriLink
                              ? () => onApriLink(segnalazione.link)
                              : undefined
                          }
                        />
                      ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {briefing?.smistamento && !smistamentoVuoto(briefing.smistamento) && (
            <section aria-labelledby="tars-smistamento-oggi">
              <h3
                id="tars-smistamento-oggi"
                className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-text-3"
              >
                <Inbox className="size-4" aria-hidden="true" />
                Comunicazioni
              </h3>
              <div className="mt-2">
                <SmistamentoSituazione
                  smistamento={briefing.smistamento}
                  onApriLink={onApriLink}
                  compatto
                />
              </div>
            </section>
          )}

          {briefing?.segnalazioni === null && (
            <p className="flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2.5 text-[11px] leading-5 text-text-3">
              <AlertTriangle
                className="mt-0.5 size-3.5 shrink-0"
                aria-hidden="true"
              />
              Segnalazioni non incluse in questo briefing.
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
