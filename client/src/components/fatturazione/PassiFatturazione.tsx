// Lo stepper del percorso «Fatturazione guidata» (piano 4): i quattro passi
// in ordine fisso con numero, etichetta ed esito, e la possibilità di
// saltare su quelli già toccati o sul prossimo. Non decide nulla: gli esiti
// arrivano dal server (`fatturazioneGuidata.passi`) e la regola su dove si
// può cliccare vive in `passoRaggiungibile`, testata da sola.
//
// Su telefono la fila scorre in orizzontale con aggancio (`snap`): quattro
// pulsanti da 44px non stanno in 390px, e comprimerli li renderebbe
// impossibili da centrare col pollice. Lo scroll resta dentro questo
// riquadro — la pagina non scorre mai in orizzontale.
//
// Specifica: docs/superpowers/specs/2026-09-05-fatturazione-guidata-design.md
// §3 (flusso) e §6 (client).
import {
  ETICHETTA_PASSO,
  ORDINE_PASSI,
  type EsitoPasso,
  type PassoFatturazione,
} from "@shared/fatturazione/passi";

import { passoRaggiungibile, tonoPasso } from "@/lib/fatturazioneView";
import { cn } from "@/lib/utils";

/**
 * Colore del pallino per tono, come nella card dell'elenco. Mai il solo
 * colore: ogni voce porta l'esito per esteso nel proprio nome accessibile.
 */
const TONO_PALLINO: Record<ReturnType<typeof tonoPasso>, string> = {
  neutro: "border border-border-strong bg-surface",
  attivo: "bg-warning",
  ok: "bg-success",
  spento: "border border-dashed border-border-soft bg-surface-2",
};

/** «da fare», «in corso», «fatto», «non disponibile». */
function esitoLeggibile(esito: EsitoPasso): string {
  return esito.replace(/_/g, " ");
}

export default function PassiFatturazione({
  passi,
  corrente,
  onVai,
}: {
  passi: Record<PassoFatturazione, EsitoPasso>;
  corrente: PassoFatturazione;
  onVai: (passo: PassoFatturazione) => void;
}) {
  return (
    <nav aria-label="Passi della fatturazione" className="min-w-0">
      <ol
        role="list"
        className="flex min-w-0 snap-x snap-mandatory gap-2 overflow-x-auto pb-1"
      >
        {ORDINE_PASSI.map((passo, indice) => {
          const esito = passi[passo];
          const attivo = passo === corrente;
          // Il passo corrente resta sempre premibile (torna su se stesso,
          // senza effetti — lo garantisce `vai` in `FatturazioneCommessa.tsx`,
          // che esce subito quando il passo richiesto è già quello attivo):
          // un pulsante disabilitato sotto `aria-current` sarebbe un punto
          // morto per chi naviga da tastiera.
          const raggiungibile = attivo || passoRaggiungibile(passi, passo);
          return (
            <li key={passo} className="min-w-0 shrink-0 snap-start">
              <button
                type="button"
                aria-current={attivo ? "step" : undefined}
                aria-label={`Passo ${indice + 1} di ${ORDINE_PASSI.length}: ${
                  ETICHETTA_PASSO[passo]
                } — ${esitoLeggibile(esito)}`}
                disabled={!raggiungibile}
                onClick={() => onVai(passo)}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border px-3 text-sm transition-colors motion-reduce:transition-none",
                  attivo
                    ? "border-border-strong bg-surface-2 font-semibold text-text-1"
                    : "border-border-soft bg-surface text-text-2",
                  raggiungibile
                    ? "hover:bg-surface-2"
                    : "cursor-not-allowed opacity-60"
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-2.5 shrink-0 rounded-full",
                    TONO_PALLINO[tonoPasso(esito)]
                  )}
                />
                <span aria-hidden="true" className="tabular-nums text-text-3">
                  {indice + 1}
                </span>
                <span aria-hidden="true" className="whitespace-nowrap">
                  {ETICHETTA_PASSO[passo]}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
