// L'applicazione del profilo: le ancore girano DOPO l'estrattore generico e
// sovrascrivono solo i campi che trovano.
//
// L'ordine non è un dettaglio. Un profilo che girasse PRIMA e vincesse
// comunque potrebbe svuotare un campo che il generico avrebbe letto, e un
// imponibile mancante è un costo fornitore mancante. Qui il peggio che può
// fare un'ancora sbagliata è non trovare niente.

import type { AncoraCampo, FormaValore } from "@shared/documenti/profilo";
import type { CampoEstratto, EstrazioneConferma } from "./estrazioneConferma";

const PER_FORMA: Record<FormaValore, RegExp> = {
  importo: /\d{1,3}(?:[.\s]\d{3})*,\d{2}|\d+,\d{2}/,
  data: /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/,
  numero: /[A-Z]{0,4}[-_/]?\d{3,}/i,
  testo: /\S.*?(?=\s{2,}|$)/,
};

function numeroDa(testo: string): number {
  return Number(testo.replace(/[.\s]/g, "").replace(",", "."));
}

type Trovato = {
  valore: string;
  pagina: number;
  frammento: string;
  posizione: { inizio: number; fine: number };
};

/** La riga dove compare l'etichetta, e il valore che le sta accanto. */
function cerca(pagine: readonly string[], ancora: AncoraCampo): Trovato | null {
  const etichetta = ancora.etichetta.toLowerCase();
  if (!etichetta) return null;
  for (let p = 0; p < pagine.length; p += 1) {
    if (ancora.pagina != null && ancora.pagina !== p + 1) continue;
    const righe = pagine[p].split(/\r?\n/);
    let scarto = 0;
    for (let i = 0; i < righe.length; i += 1) {
      const riga = righe[i];
      const dove = riga.toLowerCase().indexOf(etichetta);
      if (dove >= 0) {
        const daRiga = ancora.posizione === "riga_successiva";
        const coda = daRiga ? (righe[i + 1] ?? "") : riga.slice(dove + etichetta.length);
        const m = PER_FORMA[ancora.forma].exec(coda);
        if (m && m[0].trim()) {
          const base = daRiga
            ? scarto + riga.length + 1
            : scarto + dove + etichetta.length;
          return {
            valore: m[0].trim(),
            pagina: p + 1,
            frammento: (daRiga ? righe[i + 1] ?? "" : riga).trim().slice(0, 160),
            posizione: { inizio: base + m.index, fine: base + m.index + m[0].length },
          };
        }
      }
      scarto += riga.length + 1;
    }
  }
  return null;
}

function campo<T>(trovato: Trovato, valore: T): CampoEstratto<T> {
  return {
    valore,
    evidenza: {
      pagina: trovato.pagina,
      frammento: trovato.frammento,
      metodo: "pattern_testo",
      confidenza: "alta",
      posizione: trovato.posizione,
    },
  };
}

export function applicaAncore(
  estrazione: EstrazioneConferma,
  pagine: readonly string[],
  ancore: readonly AncoraCampo[]
): EstrazioneConferma {
  if (ancore.length === 0) return estrazione;
  const esito: EstrazioneConferma = { ...estrazione };
  for (const ancora of ancore) {
    const trovato = cerca(pagine, ancora);
    // MAI svuotare: se l'ancora non trova, resta il valore del generico.
    if (!trovato) continue;
    if (ancora.forma === "importo") {
      const n = numeroDa(trovato.valore);
      if (!Number.isFinite(n)) continue;
      (esito as Record<string, unknown>)[ancora.campo] = campo(trovato, n);
    } else {
      (esito as Record<string, unknown>)[ancora.campo] = campo(trovato, trovato.valore);
    }
  }
  return esito;
}
