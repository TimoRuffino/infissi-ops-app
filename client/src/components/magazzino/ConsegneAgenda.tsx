import { Briefcase, CalendarClock, Factory, Package } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  deliveryState,
  deliveryStateCopy,
  type DeliveryState,
} from "@/lib/operationalRoutes";

/** Commessa già risolta dal contenitore: l'agenda non fa lookup né query. */
export type ConsegnaCommessa = {
  id: number;
  codice?: string | null;
  cliente?: string | null;
};

/** Riga di magazzino già sede-scoped dal router. */
export type ConsegnaItem = {
  id: number;
  nome: string;
  quantita: number;
  fornitore?: string | null;
  /** `YYYY-MM-DD` oppure null quando la consegna non ha ancora una data. */
  dataConsegna?: string | null;
  arrivato: boolean;
  commessa: ConsegnaCommessa | null;
};

export type ConsegneAgendaProps = {
  items: ReadonlyArray<ConsegnaItem>;
  /** `YYYY-MM-DD` del giorno corrente: l'orologio resta nel contenitore. */
  today: string;
  /** Consegna con una mutation in volo: evita il doppio invio. */
  pendingId?: number | null;
  onOpenCommessa(id: number): void;
  onToggleArrivato(id: number, arrivato: boolean): void;
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

/**
 * Coda consegne sotto `lg`: una card per riga di magazzino.
 *
 * Non conosce tRPC, filtri o eleggibilità: riceve righe già filtrate e ordinate
 * dal contenitore ed emette solo callback. Nessun dato economico.
 */
export default function ConsegneAgenda({
  items,
  today,
  pendingId = null,
  onOpenCommessa,
  onToggleArrivato,
}: ConsegneAgendaProps) {
  return (
    <ol aria-label="Prossime consegne" className="min-w-0 space-y-2">
      {items.map(item => {
        const stato = deliveryState({
          arrivato: item.arrivato,
          dataConsegna: item.dataConsegna,
          today,
        });
        const inCorso = pendingId === item.id;
        return (
          <li
            key={item.id}
            className="min-w-0 space-y-2 rounded-[var(--radius-panel)] border border-border-soft bg-surface-raised p-3"
          >
            <div className="flex min-w-0 items-start justify-between gap-2">
              <p className="flex min-w-0 items-start gap-1.5 font-medium text-text-1">
                <Package
                  className="mt-0.5 h-4 w-4 shrink-0 text-text-3"
                  aria-hidden="true"
                />
                <span className="min-w-0 break-words">
                  {item.nome}
                  <span className="text-text-3"> · </span>
                  <span className="tabular-nums">{item.quantita}</span>
                </span>
              </p>
              <ConsegnaStatoChip stato={stato} />
            </div>

            <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-3">
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="tabular-nums">
                  {item.dataConsegna
                    ? etichettaConsegna(item.dataConsegna)
                    : deliveryStateCopy("unscheduled")}
                </span>
              </span>
              {item.fornitore ? (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Factory className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 truncate">{item.fornitore}</span>
                </span>
              ) : null}
            </p>

            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {item.commessa ? (
                <Button
                  type="button"
                  variant="link"
                  className="min-h-11 min-w-0 max-w-full justify-start px-0"
                  onClick={() => onOpenCommessa(item.commessa!.id)}
                >
                  <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="min-w-0 truncate">
                    {etichettaCommessa(item.commessa)}
                  </span>
                </Button>
              ) : (
                <span className="text-sm text-text-3">
                  {etichettaCommessa(null)}
                </span>
              )}

              <Button
                type="button"
                variant="outline"
                className="ml-auto min-h-12 shrink-0"
                disabled={inCorso}
                onClick={() => onToggleArrivato(item.id, !item.arrivato)}
              >
                {item.arrivato ? "Riapri consegna" : "Segna ricevuto"}
              </Button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
