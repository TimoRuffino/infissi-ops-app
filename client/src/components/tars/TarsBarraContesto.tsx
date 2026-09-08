// L'entità di cui si sta parlando, in una riga sopra la conversazione.
//
// Prima questa informazione stava in cima a una colonna di 320 px che
// impilava cinque sezioni — entità, promemoria, casi assegnati,
// segnalazioni, comunicazioni, analisi di oggi — cioè la terza copia di
// cose che vivono già in «Da fare oggi» sulla Dashboard e nella coda delle
// Proposte. Tre elenchi della stessa roba, nessuno leggibile: la colonna è
// stata tolta (PRD §62) e di suo è rimasto solo ciò che la Dashboard non
// sa, perché dipende da questa conversazione: su cosa stai lavorando.
import { BriefcaseBusiness } from "lucide-react";

import type { SmistamentoSezione } from "@/components/tars/TarsSmistamento";

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

/**
 * Una riga sola: l'entità attiva e i suoi dati brevi. Senza entità non si
 * disegna niente — una barra che dice «nessuna entità» ruba spazio alla
 * conversazione per non dire nulla.
 */
export default function TarsBarraContesto({
  contesto,
}: {
  contesto: ContestoOperativoTars | null;
}) {
  if (!contesto) return null;
  const nome =
    contesto.entita.etichetta ?? `${contesto.entita.tipo} #${contesto.entita.id}`;
  const dettagli = (contesto.dettagli ?? []).slice(0, 3);
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border-soft bg-surface-2 px-3 py-2 sm:px-4">
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-text-1">
        <BriefcaseBusiness
          className="size-3.5 shrink-0 text-text-3"
          aria-hidden="true"
        />
        <span className="sr-only">Stai lavorando su: </span>
        <span className="min-w-0 truncate">{nome}</span>
      </span>
      {dettagli.map(d => (
        <span key={d.etichetta} className="min-w-0 truncate text-[11px] text-text-3">
          {d.etichetta}: <span className="text-text-2">{d.valore}</span>
        </span>
      ))}
    </div>
  );
}
