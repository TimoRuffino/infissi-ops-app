import { CalendarClock, Factory, MapPin, Package, PackageCheck, Plus } from "lucide-react";

import StatoChip from "@/components/StatoChip";
import { Button } from "@/components/ui/button";
import {
  deliveryState,
  deliveryStateCopy,
  type DeliveryState,
} from "@/lib/operationalRoutes";

/** Commessa già risolta dal contenitore: la scheda non fa lookup né query. */
export type ConsegnaCommessa = {
  id: number;
  codice?: string | null;
  cliente?: string | null;
  citta?: string | null;
  stato?: string | null;
};

export type ArticoloConsegna = {
  nome: string;
  quantita: number;
};

/** Riga di magazzino già sede-scoped dal router. */
export type ConsegnaItem = {
  id: number;
  nome: string;
  quantita: number;
  fornitore?: string | null;
  numeroOrdine?: string | null;
  /** `YYYY-MM-DD` oppure null quando la consegna non ha ancora una data. */
  dataConsegna?: string | null;
  /** Merce pronta dal fornitore da questa data (approntamento): non è la consegna. */
  prontaDal?: string | null;
  /** Gli articoli letti nella conferma d'ordine (null = riga a mano). */
  articoli?: ReadonlyArray<ArticoloConsegna> | null;
  arrivato: boolean;
};

/**
 * Sintesi calcolata sull'intera commessa, non sul sottoinsieme filtrato: dice
 * come sta la commessa, non cosa è rimasto a schermo. Il contenitore la
 * costruisce solo quando le consegne sono state lette davvero.
 */
export type ConsegneSintesi = {
  totale: number;
  ricevute: number;
  inRitardo: number;
};

export type CommessaConsegneCardProps = {
  /** Chiave del raggruppamento: resta distinta anche a commessa non letta. */
  commessaId: number;
  /** `null` finché il record non è stato letto: nessuna identità inventata. */
  commessa: ConsegnaCommessa | null;
  /** Consegne già filtrate e ordinate dal contenitore. */
  consegne: ReadonlyArray<ConsegnaItem>;
  sintesi: ConsegneSintesi;
  /** `YYYY-MM-DD` del giorno corrente: l'orologio resta nel contenitore. */
  today: string;
  /** Consegna con una mutation in volo: evita il doppio invio. */
  pendingId?: number | null;
  /** Commessa con «Ricevuto tutto» in volo. */
  pendingCommessaId?: number | null;
  onOpenCommessa?(id: number): void;
  /** Ingresso al form di aggiunta già esistente: la scheda non crea nulla. */
  onAddConsegna?(id: number): void;
  onToggleArrivato(id: number, arrivato: boolean): void;
  /** Tutte le consegne della commessa ricevute in un colpo (direzione 07/09/2026). */
  onRicevutoTutto?(commessaId: number): void;
};

// Il colore non è mai l'unico segnale: l'etichetta testuale è sempre presente.
const CLASSI_STATO: Record<DeliveryState, string> = {
  late: "bg-danger-soft text-danger",
  due: "bg-warning-soft text-warning",
  pending: "bg-surface-2 text-text-2",
  received: "bg-success-soft text-success",
  unscheduled: "bg-surface-2 text-text-3",
};

/** Stato di una consegna reso come testo, con fondo tenue di supporto. */
export function ConsegnaStatoChip({ stato }: { stato: DeliveryState }) {
  return (
    <span
      data-delivery-state={stato}
      className={`inline-flex shrink-0 items-center rounded-[var(--radius-pill)] px-2 py-0.5 text-xs font-semibold ${CLASSI_STATO[stato]}`}
    >
      {deliveryStateCopy(stato)}
    </span>
  );
}

/** Data leggibile; quando manca, lo stato testuale dice già "Data da definire". */
export function etichettaConsegna(data: string | null | undefined): string {
  if (!data) return "—";
  return new Date(`${data}T12:00:00`).toLocaleDateString("it-IT");
}

export function etichettaCommessa(commessa: ConsegnaCommessa | null): string {
  if (!commessa) return "Commessa non disponibile";
  return commessa.cliente || commessa.codice || `Commessa #${commessa.id}`;
}

function conteggio(n: number, singolare: string, plurale: string): string {
  return `${n} ${n === 1 ? singolare : plurale}`;
}

/**
 * Gli articoli di una consegna letta da una conferma: chiusi di default, si
 * aprono a richiesta. Un elemento nativo, leggibile da tastiera e screen
 * reader, senza stato React.
 */
export function ArticoliConsegna({
  articoli,
}: {
  articoli: ReadonlyArray<ArticoloConsegna>;
}) {
  return (
    <details className="min-w-0 text-xs text-text-2">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 text-text-2 hover:text-text-1 [&::-webkit-details-marker]:hidden">
        <Package className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {conteggio(articoli.length, "articolo", "articoli")}
      </summary>
      <ul className="mt-1 space-y-0.5 pl-5">
        {articoli.map((a, i) => (
          <li key={`${a.nome}-${i}`} className="flex min-w-0 gap-2 break-words [overflow-wrap:anywhere]">
            <span className="tabular-nums text-text-3">{a.quantita}×</span>
            <span className="min-w-0">{a.nome}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Scheda di una commessa con le sue consegne a magazzino.
 *
 * Non conosce tRPC, filtri o eleggibilità: riceve la commessa già risolta e le
 * consegne già filtrate e ordinate dal contenitore, ed emette solo callback.
 * Nessun dato economico.
 */
export default function CommessaConsegneCard({
  commessaId,
  commessa,
  consegne,
  sintesi,
  today,
  pendingId = null,
  pendingCommessaId = null,
  onOpenCommessa,
  onAddConsegna,
  onToggleArrivato,
  onRicevutoTutto,
}: CommessaConsegneCardProps) {
  const titoloId = `consegne-commessa-${commessaId}`;
  const etichetta = etichettaCommessa(commessa);
  const nascoste = sintesi.totale - consegne.length;
  const daRicevere = sintesi.totale - sintesi.ricevute;
  const tuttoInCorso = pendingCommessaId === commessaId;

  return (
    <article
      aria-labelledby={titoloId}
      className="flex min-w-0 flex-col gap-2.5 rounded-[var(--radius-panel)] border border-border-soft bg-surface-raised p-3 sm:p-4"
    >
      <header className="min-w-0">
        {commessa?.codice || commessa?.stato ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {commessa.codice ? (
              <span className="codice-mono text-xs text-text-3">
                {commessa.codice}
              </span>
            ) : null}
            {commessa.stato ? <StatoChip stato={commessa.stato} /> : null}
          </div>
        ) : null}

        <h3
          id={titoloId}
          className="min-w-0 text-base font-semibold text-text-1"
        >
          {commessa && onOpenCommessa ? (
            <button
              type="button"
              title="Apri il dettaglio delle consegne"
              onClick={() => onOpenCommessa(commessa.id)}
              className="flex min-h-11 w-full min-w-0 items-center rounded-[var(--radius-control)] text-left outline-none transition-colors hover:bg-surface-2 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/55"
            >
              <span className="min-w-0 truncate">{etichetta}</span>
            </button>
          ) : (
            <span className="flex min-h-11 min-w-0 items-center">
              <span className="min-w-0 truncate">{etichetta}</span>
            </span>
          )}
        </h3>

        {commessa ? (
          commessa.citta ? (
            <p className="flex min-w-0 items-center gap-1 text-sm text-text-3">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate">{commessa.citta}</span>
            </p>
          ) : null
        ) : (
          <p className="text-sm text-text-3">
            Dati della commessa non caricati: le consegne restano modificabili.
          </p>
        )}
      </header>

      {/* Con zero consegne i tre contatori direbbero solo «0 · 0 · 0»: la
          riga sotto lo dice meglio, e in parole. */}
      {sintesi.totale > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-sm text-text-2">
            <span className="tabular-nums">
              {conteggio(sintesi.totale, "consegna", "consegne")}
            </span>
            <span className="text-text-3"> · </span>
            <span className="tabular-nums">
              {conteggio(sintesi.ricevute, "ricevuta", "ricevute")}
            </span>
            <span className="text-text-3"> · </span>
            <span className="tabular-nums">{sintesi.inRitardo} in ritardo</span>
          </p>
          {onRicevutoTutto && daRicevere > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 shrink-0"
              disabled={tuttoInCorso}
              title={`Segna ricevute le ${daRicevere} consegne ancora aperte`}
              onClick={() => onRicevutoTutto(commessaId)}
            >
              <PackageCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Ricevuto tutto
            </Button>
          ) : null}
        </div>
      ) : null}

      {nascoste > 0 ? (
        <p className="min-w-0 text-xs text-text-3">
          {conteggio(consegne.length, "consegna mostrata", "consegne mostrate")}{" "}
          con i filtri correnti.
        </p>
      ) : null}

      {consegne.length === 0 ? (
        <div className="-mx-3 -mb-3 min-w-0 border-t border-border-soft px-3 py-2.5 sm:-mx-4 sm:-mb-4 sm:px-4">
          <p className="text-sm text-text-3">Nessuna consegna registrata</p>
          {commessa && onAddConsegna ? (
            <Button
              type="button"
              variant="outline"
              className="mt-2 min-h-11"
              onClick={() => onAddConsegna(commessa.id)}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Aggiungi consegna
            </Button>
          ) : null}
        </div>
      ) : (
        <ul
          aria-label={
            commessa
              ? `Consegne di ${etichetta}`
              : "Consegne della commessa non caricata"
          }
          className="-mx-3 -mb-3 min-w-0 divide-y divide-border-soft border-t border-border-soft sm:-mx-4 sm:-mb-4"
        >
          {consegne.map(item => {
            const stato = deliveryState({
              arrivato: item.arrivato,
              dataConsegna: item.dataConsegna,
              today,
            });
            const inCorso = pendingId === item.id || tuttoInCorso;
            const daConferma = item.articoli != null;
            return (
              <li key={item.id} className="min-w-0 px-3 py-2.5 sm:px-4">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <p className="flex min-w-0 flex-1 items-start gap-1.5 text-sm font-medium text-text-1">
                    <Package
                      className="mt-0.5 h-4 w-4 shrink-0 text-text-3"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                      {item.nome}
                      {/* Una consegna da conferma è una: la quantità sta negli articoli. */}
                      {!daConferma ? (
                        <>
                          <span className="text-text-3"> · Q.tà </span>
                          <span className="tabular-nums">{item.quantita}</span>
                        </>
                      ) : null}
                    </span>
                  </p>
                  <ConsegnaStatoChip stato={stato} />
                </div>

                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                  <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-2">
                    {/* Senza data non si ripete "Data da definire": lo dice
                      già lo stato testuale accanto al nome. Se il fornitore
                      ha detto da quando la merce è pronta, quello sì. */}
                    {item.dataConsegna ? (
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarClock
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                        />
                        <span className="tabular-nums">
                          {etichettaConsegna(item.dataConsegna)}
                        </span>
                      </span>
                    ) : item.prontaDal ? (
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarClock
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                        />
                        <span>
                          Pronta dal fornitore dal{" "}
                          <span className="tabular-nums">
                            {etichettaConsegna(item.prontaDal)}
                          </span>
                        </span>
                      </span>
                    ) : null}
                    {item.fornitore ? (
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <Factory
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                        />
                        <span className="min-w-0 truncate">
                          {item.fornitore}
                        </span>
                      </span>
                    ) : null}
                    {item.numeroOrdine ? (
                      <span className="codice-mono min-w-0 truncate text-text-3">
                        Ordine {item.numeroOrdine}
                      </span>
                    ) : null}
                  </p>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ml-auto min-h-11 shrink-0"
                    disabled={inCorso}
                    onClick={() => onToggleArrivato(item.id, !item.arrivato)}
                  >
                    {item.arrivato ? "Riapri consegna" : "Segna ricevuto"}
                  </Button>
                </div>

                {item.articoli && item.articoli.length > 0 ? (
                  <div className="mt-1">
                    <ArticoliConsegna articoli={item.articoli} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
