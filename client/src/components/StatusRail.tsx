// StatusRail — la firma «Rail» di Frame & Flow: la state machine delle
// commesse come binario semantico, non una progress bar decorativa.
//
// Il rail RAPPRESENTA la posizione, non la calcola: lo stato arriva dal
// server e le transizioni restano di `commesse.update` (adiacenti, doc
// gate, force solo sul gate). Qui: passato in petrolio, presente in giallo
// Ruffino (lo stesso marcatore di posizione della sidebar), futuro in
// traccia neutra. Il colore non è mai l'unico segnale: etichetta corrente,
// conteggio passi e motivo del blocco sono sempre testuali.
import { STATI_ORDER, statoLabel } from "@/lib/stato";
import { Lock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export default function StatusRail({
  stato,
  gateBloccato = false,
  gateMotivo,
  compatto = false,
  className = "",
}: {
  stato: string;
  /** Il prossimo avanzamento è fermo al gate documentale. */
  gateBloccato?: boolean;
  /** Motivo testuale del blocco (es. «Mancano 2 documenti»). */
  gateMotivo?: string;
  /** Solo la traccia, per righe di tabella e card Board. */
  compatto?: boolean;
  className?: string;
}) {
  const indice = STATI_ORDER.indexOf(stato as (typeof STATI_ORDER)[number]);
  // Uno stato sconosciuto non disegna un rail sbagliato: meglio niente.
  if (indice === -1) return null;

  const descrizione = `Stato: ${statoLabel(stato)}, passo ${indice + 1} di ${
    STATI_ORDER.length
  }${gateBloccato ? ". Avanzamento fermo al gate documentale" : ""}${
    gateBloccato && gateMotivo ? `: ${gateMotivo}` : ""
  }`;

  return (
    <div className={`min-w-0 ${className}`} role="group" aria-label={descrizione}>
      <div
        className={`flex items-center ${compatto ? "gap-px" : "gap-0.5"}`}
        aria-hidden="true"
      >
        {STATI_ORDER.map((s, i) => {
          const passato = i < indice;
          const corrente = i === indice;
          const segmento = (
            <span
              key={s}
              className={`${compatto ? "h-1" : "h-1.5"} min-w-0 flex-1 rounded-full transition-colors duration-(--duration-base) ${
                corrente
                  ? "bg-brand"
                  : passato
                    ? "bg-structure/70"
                    : "bg-border-soft"
              } ${corrente && !compatto ? "flex-[1.6]" : ""}`}
            />
          );
          if (compatto) return segmento;
          return (
            <Tooltip key={s} delayDuration={300}>
              <TooltipTrigger asChild>{segmento}</TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {i + 1}. {statoLabel(s)}
                {corrente ? " — corrente" : passato ? " — attraversato" : ""}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      {!compatto && (
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span className="font-semibold text-text-1">{statoLabel(stato)}</span>
          <span className="text-text-3 tabular-nums">
            {indice + 1} di {STATI_ORDER.length}
          </span>
          {gateBloccato && (
            <span className="inline-flex min-w-0 items-center gap-1 text-warning">
              <Lock className="h-3 w-3 shrink-0" />
              <span className="min-w-0 truncate">
                {gateMotivo ?? "Fermo al gate documentale"}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
