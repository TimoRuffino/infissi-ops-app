import {
  analizzaMarkdownOperativo,
  type BloccoOperativo,
  type SegmentoInline,
} from "@/lib/markdownOperativo";
import {
  spezzaRiferimenti,
  type RisolutoreRiferimenti,
} from "@/lib/riferimentiTars";
import { cn } from "@/lib/utils";
import { Fragment, useMemo, type ReactNode } from "react";
import { Link } from "wouter";

// Rende la risposta Markdown di Tars dentro la bolla di conversazione.
//
// Il testo del modello è dato non fidato: nessun HTML viene costruito qui, i
// blocchi tipizzati di `markdownOperativo` diventano nodi JSX e ogni carattere
// resta testo. Non usare mai `dangerouslySetInnerHTML` in questo percorso.
//
// I riferimenti citati (codice commessa, ticket) diventano link interni SOLO
// se `risolviRiferimento` li ha risolti in un record che l'utente può già
// vedere: senza risolutore, o con un codice che non risolve, il testo resta
// esattamente com'era. Il riconoscimento vive in `@/lib/riferimentiTars`, e
// nemmeno lì si costruisce mai un href da un codice non verificato.
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

// Link discreto: si legge come parte della frase, ma si vede che è cliccabile
// anche senza colore (sottolineatura) e prende un anello di focus da tastiera.
// La spaziatura orizzontale allarga l'area toccabile senza spostare il testo:
// su un link inline non si può imporre 44px di altezza senza sfondare
// l'interlinea della bolla.
const CLASSI_LINK =
  "-mx-0.5 rounded-[var(--radius-control)] px-0.5 py-1 text-primary underline decoration-primary/40 underline-offset-2 transition-colors hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Rende il testo di un segmento collegando i soli riferimenti risolti.
 *
 * Senza risolutore, o quando nessun candidato corrisponde a un record che
 * l'utente può già vedere, la stringa esce identica: nessun link, nessuna
 * segnalazione, nessun tooltip d'errore. Il testo mostrato dal link resta
 * quello scritto da Tars; è il nome accessibile a dichiarare la destinazione.
 */
function ConRiferimenti({
  testo,
  risolvi,
}: {
  testo: string;
  risolvi: RisolutoreRiferimenti | undefined;
}): ReactNode {
  if (!risolvi) return testo;

  const frammenti = spezzaRiferimenti(testo);
  if (!frammenti.some(frammento => frammento.tipo === "riferimento")) {
    return testo;
  }

  return frammenti.map((frammento, indice) => {
    if (frammento.tipo === "testo") {
      return <Fragment key={indice}>{frammento.testo}</Fragment>;
    }

    const destinazione = risolvi(frammento);
    if (!destinazione) {
      return <Fragment key={indice}>{frammento.testo}</Fragment>;
    }

    return (
      <Link
        key={indice}
        href={destinazione.href}
        aria-label={destinazione.nomeAccessibile}
        className={CLASSI_LINK}
      >
        {frammento.testo}
      </Link>
    );
  });
}

function Inline({
  segmenti,
  risolvi,
}: {
  segmenti: readonly SegmentoInline[];
  risolvi: RisolutoreRiferimenti | undefined;
}): ReactNode {
  return segmenti.map((segmento, indice) => {
    const chiave = `${segmento.tipo}-${indice}`;
    switch (segmento.tipo) {
      case "forte":
        return (
          <strong key={chiave} className="font-semibold text-text-1">
            <ConRiferimenti testo={segmento.testo} risolvi={risolvi} />
          </strong>
        );
      case "enfasi":
        return (
          <em key={chiave} className="italic">
            <ConRiferimenti testo={segmento.testo} risolvi={risolvi} />
          </em>
        );
      case "codice":
        // Il codice inline è letterale per contratto del parser: non
        // interpreta marcatori al suo interno e non diventa un link.
        return (
          <code
            key={chiave}
            className="rounded-sm bg-surface-2 px-1 py-px font-mono text-[0.85em] text-text-1"
          >
            {segmento.testo}
          </code>
        );
      default:
        return (
          <Fragment key={chiave}>
            <ConRiferimenti testo={segmento.testo} risolvi={risolvi} />
          </Fragment>
        );
    }
  });
}

function Titolo({
  livello,
  contenuto,
  risolvi,
}: {
  livello: 1 | 2 | 3;
  contenuto: readonly SegmentoInline[];
  risolvi: RisolutoreRiferimenti | undefined;
}): ReactNode {
  const classe = cn("mt-3 break-words first:mt-0", CLASSI_TITOLO[livello]);
  const figli = <Inline segmenti={contenuto} risolvi={risolvi} />;
  if (livello === 1) return <h3 className={classe}>{figli}</h3>;
  if (livello === 2) return <h4 className={classe}>{figli}</h4>;
  return <h5 className={classe}>{figli}</h5>;
}

function Blocco({
  blocco,
  risolvi,
}: {
  blocco: BloccoOperativo;
  risolvi: RisolutoreRiferimenti | undefined;
}): ReactNode {
  switch (blocco.tipo) {
    case "titolo":
      return (
        <Titolo
          livello={blocco.livello}
          contenuto={blocco.contenuto}
          risolvi={risolvi}
        />
      );

    case "paragrafo":
      return (
        <p className="mt-2 whitespace-pre-wrap break-words first:mt-0">
          {blocco.righe.map((riga, indice) => (
            <Fragment key={indice}>
              {indice > 0 ? "\n" : null}
              <Inline segmenti={riga} risolvi={risolvi} />
            </Fragment>
          ))}
        </p>
      );

    case "elenco": {
      const classe =
        "mt-2 space-y-1 break-words pl-5 first:mt-0 marker:font-semibold marker:text-text-3";
      const voci = blocco.voci.map((voce, indice) => (
        <li key={indice} value={voce.numero ?? undefined} className="pl-0.5">
          <Inline segmenti={voce.contenuto} risolvi={risolvi} />
        </li>
      ));
      return blocco.ordinato ? (
        <ol className={cn(classe, "list-decimal")}>{voci}</ol>
      ) : (
        <ul className={cn(classe, "list-disc")}>{voci}</ul>
      );
    }

    case "separatore":
      return (
        <hr className="mt-3 border-0 border-t border-border-soft first:mt-0" />
      );
  }
}

export default function RispostaFormattata({
  testo,
  className,
  risolviRiferimento,
}: {
  testo: string;
  className?: string;
  /**
   * Risolutore opzionale dei riferimenti citati. Assente finché le query di
   * supporto non hanno risposto: la conversazione non aspetta nessuno, il
   * testo si mostra subito e i link compaiono dopo, se e quando i codici
   * risultano risolti.
   */
  risolviRiferimento?: RisolutoreRiferimenti;
}) {
  const blocchi = useMemo(() => analizzaMarkdownOperativo(testo), [testo]);

  // Testo vuoto o di soli spazi: nessun blocco da rendere, si mostra il grezzo.
  if (blocchi.length === 0) {
    return (
      <p
        className={cn(
          "whitespace-pre-wrap break-words leading-6 text-text-1",
          className
        )}
      >
        {testo}
      </p>
    );
  }

  return (
    <div className={cn("min-w-0 leading-6 text-text-1", className)}>
      {blocchi.map((blocco, indice) => (
        <Blocco key={indice} blocco={blocco} risolvi={risolviRiferimento} />
      ))}
    </div>
  );
}
