// Parser del sottoinsieme Markdown che Tars produce davvero.
//
// Il modello risponde in Markdown ma il suo testo è dato non fidato: qui non si
// costruisce HTML e non esiste alcun percorso verso `dangerouslySetInnerHTML`.
// Il risultato è una struttura tipizzata che `RispostaFormattata` rende con
// nodi JSX, quindi ogni carattere resta testo.
//
// Regole di robustezza volute (coperte da markdownOperativo.test.ts):
// - un testo senza sintassi Markdown resta identico carattere per carattere;
// - un marcatore spaiato o isolato (`2 * 3 = 6`, `**non chiuso`, `***`) resta
//   letterale e non fa sparire testo;
// - nessun segmento vuoto viene mai emesso;
// - stringa vuota o di soli spazi produce zero blocchi.

export type SegmentoInline = {
  tipo: "testo" | "forte" | "enfasi" | "codice";
  testo: string;
};

export type VoceElenco = {
  /** Numero dichiarato dalla sorgente per gli elenchi ordinati. */
  numero: number | null;
  contenuto: SegmentoInline[];
};

export type BloccoOperativo =
  | { tipo: "titolo"; livello: 1 | 2 | 3; contenuto: SegmentoInline[] }
  /** Righe di uno stesso paragrafo: gli a-capo singoli vanno preservati. */
  | { tipo: "paragrafo"; righe: SegmentoInline[][] }
  | { tipo: "elenco"; ordinato: boolean; voci: VoceElenco[] }
  | { tipo: "separatore" };

const RIGA_VUOTA = /^[ \t]*$/;
const SEPARATORE = /^[ \t]*-{3,}[ \t]*$/;
const TITOLO = /^[ \t]*(#{1,6})[ \t]+(\S.*)$/;
const VOCE_PUNTATA = /^[ \t]*[-*•][ \t]+(\S.*)$/;
const VOCE_NUMERATA = /^[ \t]*(\d{1,9})[.)][ \t]+(\S.*)$/;

function eSpazio(carattere: string | undefined): boolean {
  return carattere === undefined || /\s/.test(carattere);
}

/** `_` non apre né chiude dentro una parola: `chiave_valore_default` è testo. */
function eParola(carattere: string | undefined): boolean {
  return carattere !== undefined && /[\w]/.test(carattere);
}

function aggiungiTesto(segmenti: SegmentoInline[], testo: string): void {
  if (!testo) return;
  const ultimo = segmenti[segmenti.length - 1];
  if (ultimo && ultimo.tipo === "testo") {
    ultimo.testo += testo;
    return;
  }
  segmenti.push({ tipo: "testo", testo });
}

/**
 * Cerca il delimitatore di chiusura sulla stessa riga. Restituisce l'indice del
 * primo candidato valido, oppure -1: in quel caso il marcatore resta letterale.
 */
function cercaChiusura(
  riga: string,
  marcatore: string,
  da: number,
  soloParolaVietata: boolean
): number {
  let candidato = riga.indexOf(marcatore, da);
  while (candidato >= 0) {
    const contenuto = riga.slice(da, candidato);
    const precedente = riga[candidato - 1];
    const successivo = riga[candidato + marcatore.length];
    const contenutoValido = contenuto.trim().length > 0;
    const chiusuraValida =
      !eSpazio(precedente) && (!soloParolaVietata || !eParola(successivo));
    if (contenutoValido && chiusuraValida) return candidato;
    candidato = riga.indexOf(marcatore, candidato + 1);
  }
  return -1;
}

function apreDelimitatore(
  riga: string,
  indice: number,
  marcatore: string,
  soloParolaVietata: boolean
): boolean {
  const precedente = riga[indice - 1];
  const successivo = riga[indice + marcatore.length];
  if (eSpazio(successivo)) return false;
  return !soloParolaVietata || !eParola(precedente);
}

/** Il codice inline non interpreta altri marcatori al suo interno. */
function cercaChiusuraCodice(riga: string, da: number): number {
  let candidato = riga.indexOf("`", da);
  while (candidato >= 0) {
    if (riga.slice(da, candidato).trim().length > 0) return candidato;
    candidato = riga.indexOf("`", candidato + 1);
  }
  return -1;
}

export function analizzaInline(riga: string): SegmentoInline[] {
  const segmenti: SegmentoInline[] = [];
  let i = 0;

  while (i < riga.length) {
    const carattere = riga[i];

    if (carattere === "`") {
      const chiusura = cercaChiusuraCodice(riga, i + 1);
      if (chiusura > i) {
        segmenti.push({ tipo: "codice", testo: riga.slice(i + 1, chiusura) });
        i = chiusura + 1;
        continue;
      }
    } else if (carattere === "*" && riga[i + 1] === "*") {
      if (apreDelimitatore(riga, i, "**", false)) {
        const chiusura = cercaChiusura(riga, "**", i + 2, false);
        if (chiusura > i) {
          segmenti.push({ tipo: "forte", testo: riga.slice(i + 2, chiusura) });
          i = chiusura + 2;
          continue;
        }
      }
    } else if (carattere === "*" || carattere === "_") {
      const soloParolaVietata = carattere === "_";
      if (apreDelimitatore(riga, i, carattere, soloParolaVietata)) {
        const chiusura = cercaChiusura(
          riga,
          carattere,
          i + 1,
          soloParolaVietata
        );
        if (chiusura > i) {
          segmenti.push({ tipo: "enfasi", testo: riga.slice(i + 1, chiusura) });
          i = chiusura + 1;
          continue;
        }
      }
    }

    // Nessun delimitatore valido: il carattere resta letterale.
    aggiungiTesto(segmenti, carattere);
    i += 1;
  }

  return segmenti;
}

export function analizzaMarkdownOperativo(sorgente: string): BloccoOperativo[] {
  if (typeof sorgente !== "string" || sorgente.trim().length === 0) return [];

  const blocchi: BloccoOperativo[] = [];
  let paragrafo: SegmentoInline[][] | null = null;
  let elenco: { ordinato: boolean; voci: VoceElenco[] } | null = null;

  const chiudiParagrafo = (): void => {
    if (paragrafo && paragrafo.length > 0) {
      blocchi.push({ tipo: "paragrafo", righe: paragrafo });
    }
    paragrafo = null;
  };

  const chiudiElenco = (): void => {
    if (elenco && elenco.voci.length > 0) {
      blocchi.push({ tipo: "elenco", ordinato: elenco.ordinato, voci: elenco.voci });
    }
    elenco = null;
  };

  const chiudiTutto = (): void => {
    chiudiParagrafo();
    chiudiElenco();
  };

  const aggiungiVoce = (ordinato: boolean, voce: VoceElenco): void => {
    chiudiParagrafo();
    if (elenco && elenco.ordinato !== ordinato) chiudiElenco();
    if (!elenco) elenco = { ordinato, voci: [] };
    elenco.voci.push(voce);
  };

  for (const riga of sorgente.replace(/\r\n?/g, "\n").split("\n")) {
    if (RIGA_VUOTA.test(riga)) {
      chiudiTutto();
      continue;
    }

    if (SEPARATORE.test(riga)) {
      chiudiTutto();
      blocchi.push({ tipo: "separatore" });
      continue;
    }

    const titolo = TITOLO.exec(riga);
    if (titolo) {
      chiudiTutto();
      const livello = Math.min(titolo[1].length, 3) as 1 | 2 | 3;
      blocchi.push({
        tipo: "titolo",
        livello,
        contenuto: analizzaInline(titolo[2]),
      });
      continue;
    }

    const numerata = VOCE_NUMERATA.exec(riga);
    if (numerata) {
      aggiungiVoce(true, {
        numero: Number.parseInt(numerata[1], 10),
        contenuto: analizzaInline(numerata[2]),
      });
      continue;
    }

    const puntata = VOCE_PUNTATA.exec(riga);
    if (puntata) {
      aggiungiVoce(false, { numero: null, contenuto: analizzaInline(puntata[1]) });
      continue;
    }

    chiudiElenco();
    if (!paragrafo) paragrafo = [];
    paragrafo.push(analizzaInline(riga));
  }

  chiudiTutto();
  return blocchi;
}
