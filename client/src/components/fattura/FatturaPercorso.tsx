// Il percorso della fattura, in testa alla tab: contratto → limiti → bozza →
// controlli → emissione → SdI. Sei passi, ognuno con il suo stato e una riga
// che dice cosa c'è o cosa manca. Prima la tab mostrava solo il pezzo su cui
// si lavorava e da nessuna parte si leggeva dove si era nel processo.
//
// Nessuna logica qui: i passi arrivano già decisi da `passiFattura`
// (lib/fatturaView.ts, provata da sola). Il componente disegna e, dove ha
// senso, porta chi clicca nel posto giusto.
import { AlertTriangle, Check, Circle, Loader2 } from "lucide-react";

import type { PassoFattura, StatoPasso } from "@/lib/fatturaView";

const ASPETTO: Record<
  StatoPasso,
  { cerchio: string; testo: string; icona: "check" | "punto" | "alert" | "attesa" }
> = {
  fatto: {
    cerchio: "bg-success text-on-success",
    testo: "text-text-2",
    icona: "check",
  },
  corrente: {
    cerchio: "bg-primary text-primary-foreground ring-4 ring-primary/15",
    testo: "text-text-1",
    icona: "punto",
  },
  bloccato: {
    cerchio: "bg-danger text-on-danger",
    testo: "text-danger",
    icona: "alert",
  },
  attesa: {
    cerchio: "bg-surface-2 text-text-3",
    testo: "text-text-3",
    icona: "attesa",
  },
  da_fare: {
    cerchio: "bg-surface-2 text-text-3",
    testo: "text-text-3",
    icona: "punto",
  },
};

function Icona({ tipo }: { tipo: (typeof ASPETTO)[StatoPasso]["icona"] }) {
  if (tipo === "check") return <Check className="h-3.5 w-3.5" aria-hidden />;
  if (tipo === "alert") return <AlertTriangle className="h-3.5 w-3.5" aria-hidden />;
  if (tipo === "attesa")
    return <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />;
  return <Circle className="h-2 w-2 fill-current" aria-hidden />;
}

const NOME_STATO: Record<StatoPasso, string> = {
  fatto: "fatto",
  corrente: "in corso",
  bloccato: "bloccato",
  attesa: "in attesa",
  da_fare: "da fare",
};

export default function FatturaPercorso({
  passi,
  onVai,
}: {
  passi: PassoFattura[];
  /** Torna `false` quando per quel passo non c'è dove andare. */
  onVai: (chiave: PassoFattura["chiave"]) => boolean;
}) {
  return (
    <ol
      aria-label="Percorso della fattura"
      className="flex min-w-0 flex-wrap gap-2"
    >
      {passi.map((p, i) => {
        const a = ASPETTO[p.stato];
        const corpo = (
          <>
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${a.cerchio}`}
            >
              {p.stato === "fatto" || p.stato === "bloccato" || p.stato === "attesa" ? (
                <Icona tipo={a.icona} />
              ) : (
                i + 1
              )}
            </span>
            <span className="min-w-0">
              <span className={`block text-xs font-semibold leading-tight ${a.testo}`}>
                {p.etichetta}
                <span className="sr-only">: {NOME_STATO[p.stato]}</span>
              </span>
              <span className="block truncate text-[11px] leading-tight text-text-3">
                {p.dettaglio}
              </span>
            </span>
          </>
        );
        const classe = `flex min-h-11 min-w-0 items-center gap-2 rounded-[var(--radius-control)] border px-2.5 py-1.5 text-left ${
          p.stato === "corrente"
            ? "border-primary/40 bg-primary/[0.05]"
            : p.stato === "bloccato"
              ? "border-danger/40 bg-danger-soft"
              : "border-border-soft bg-surface"
        }`;
        return (
          <li key={p.chiave} className="min-w-0 flex-1 basis-[10.5rem]">
            <button
              type="button"
              className={`${classe} w-full outline-none transition-colors hover:bg-surface-2 focus-visible:ring-[3px] focus-visible:ring-ring/55 disabled:cursor-default disabled:hover:bg-transparent`}
              onClick={() => onVai(p.chiave)}
              aria-current={p.stato === "corrente" ? "step" : undefined}
            >
              {corpo}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
