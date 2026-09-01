import {
  analizzaMarkdownOperativo,
  type BloccoOperativo,
  type SegmentoInline,
} from "@/lib/markdownOperativo";
import { cn } from "@/lib/utils";
import { Fragment, useMemo, type ReactNode } from "react";

// Rende la risposta Markdown di Tars dentro la bolla di conversazione.
//
// Il testo del modello è dato non fidato: nessun HTML viene costruito qui, i
// blocchi tipizzati di `markdownOperativo` diventano nodi JSX e ogni carattere
// resta testo. Non usare mai `dangerouslySetInnerHTML` in questo percorso.
//
// Gerarchia dei titoli: la bolla vive sotto l'h1 del thread e accanto agli h2
// dei pannelli, quindi i titoli del messaggio partono da h3 e scendono. Così
// nessun titolo generato dal modello scavalca la struttura della pagina e i tre
// livelli restano annidati fra loro.
const CLASSI_TITOLO: Record<1 | 2 | 3, string> = {
  1: "text-[15px] font-bold text-text-1",
  2: "text-sm font-bold text-text-1",
  3: "text-[13px] font-bold uppercase tracking-[0.04em] text-text-1",
};

function Inline({ segmenti }: { segmenti: readonly SegmentoInline[] }): ReactNode {
  return segmenti.map((segmento, indice) => {
    const chiave = `${segmento.tipo}-${indice}`;
    switch (segmento.tipo) {
      case "forte":
        return (
          <strong key={chiave} className="font-semibold text-text-1">
            {segmento.testo}
          </strong>
        );
      case "enfasi":
        return (
          <em key={chiave} className="italic">
            {segmento.testo}
          </em>
        );
      case "codice":
        return (
          <code
            key={chiave}
            className="rounded-sm bg-surface-2 px-1 py-px font-mono text-[0.85em] text-text-1"
          >
            {segmento.testo}
          </code>
        );
      default:
        return <Fragment key={chiave}>{segmento.testo}</Fragment>;
    }
  });
}

function Titolo({
  livello,
  contenuto,
}: {
  livello: 1 | 2 | 3;
  contenuto: readonly SegmentoInline[];
}): ReactNode {
  const classe = cn("mt-3 break-words first:mt-0", CLASSI_TITOLO[livello]);
  const figli = <Inline segmenti={contenuto} />;
  if (livello === 1) return <h3 className={classe}>{figli}</h3>;
  if (livello === 2) return <h4 className={classe}>{figli}</h4>;
  return <h5 className={classe}>{figli}</h5>;
}

function Blocco({ blocco }: { blocco: BloccoOperativo }): ReactNode {
  switch (blocco.tipo) {
    case "titolo":
      return <Titolo livello={blocco.livello} contenuto={blocco.contenuto} />;

    case "paragrafo":
      return (
        <p className="mt-2 whitespace-pre-wrap break-words first:mt-0">
          {blocco.righe.map((riga, indice) => (
            <Fragment key={indice}>
              {indice > 0 ? "\n" : null}
              <Inline segmenti={riga} />
            </Fragment>
          ))}
        </p>
      );

    case "elenco": {
      const classe =
        "mt-2 space-y-1 break-words pl-5 first:mt-0 marker:font-semibold marker:text-text-3";
      const voci = blocco.voci.map((voce, indice) => (
        <li key={indice} value={voce.numero ?? undefined} className="pl-0.5">
          <Inline segmenti={voce.contenuto} />
        </li>
      ));
      return blocco.ordinato ? (
        <ol className={cn(classe, "list-decimal")}>{voci}</ol>
      ) : (
        <ul className={cn(classe, "list-disc")}>{voci}</ul>
      );
    }

    case "separatore":
      return <hr className="mt-3 border-0 border-t border-border-soft first:mt-0" />;
  }
}

export default function RispostaFormattata({
  testo,
  className,
}: {
  testo: string;
  className?: string;
}) {
  const blocchi = useMemo(() => analizzaMarkdownOperativo(testo), [testo]);

  // Testo vuoto o di soli spazi: nessun blocco da rendere, si mostra il grezzo.
  if (blocchi.length === 0) {
    return (
      <p
        className={cn(
          "whitespace-pre-wrap break-words leading-6 text-text-2",
          className
        )}
      >
        {testo}
      </p>
    );
  }

  return (
    <div className={cn("min-w-0 leading-6 text-text-2", className)}>
      {blocchi.map((blocco, indice) => (
        <Blocco key={indice} blocco={blocco} />
      ))}
    </div>
  );
}
