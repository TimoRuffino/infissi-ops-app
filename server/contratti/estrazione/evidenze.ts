// Evidenze verificate della lettura del contratto (piano 3, Task 4).
//
// Il modello cita pagina e frammento per ogni gruppo di fatti; qui si
// CONTROLLA che quella citazione esista davvero nel testo estratto dal PDF,
// come fa `trovaRiferimentoTesto` (server/documenti/estrazioneConferma.ts)
// per i riferimenti certi: un valore la cui citazione non si trova resta
// senza evidenza e nasce «da verificare», mai spacciato per letto.
//
// Il confronto avviene su una forma normalizzata (minuscolo, senza accenti,
// legature sciolte, apostrofi uniformati, spazi collassati) perché il testo
// che esce dal parser non è mai identico a quello che il modello riscrive:
// «inﬁssi» con la legatura tipografica, doppi spazi delle colonne, «città»
// con l'accento. Il frammento RESTITUITO è però il testo vero della pagina:
// è quello che l'operatore ritrova nel PDF.
//
// Funzioni pure e deterministiche: nessuna I/O, nessun orologio, nessun
// import da server/tars/*.

import type { CampoProposto, EvidenzaEstratta } from "@shared/contratti/estrazione";

/** Sotto questa soglia una citazione non identifica nulla: «IVA», «127». */
const LUNGHEZZA_MINIMA_FRAMMENTO = 6;

/** Stesso limite del frammento nello schema del modello. */
const LUNGHEZZA_MASSIMA_FRAMMENTO = 300;

/** Caratteri che il PDF scrive in forma tipografica e il modello in forma semplice. */
const SOSTITUZIONI: Record<string, string> = {
  "’": "'", // ’ apostrofo tipografico
  "‘": "'", // ‘
  "‛": "'", // ‛
  "′": "'", // ′ primo
  "´": "'", // ´ accento acuto isolato
  "`": "'", // ` accento grave isolato
  "“": '"', // “
  "”": '"', // ”
  "„": '"', // „
  "″": '"', // ″
};

function normalizzaCarattere(carattere: string): string {
  const base = SOSTITUZIONI[carattere] ?? carattere;
  // NFKD scioglie le legature («ﬁ» → «fi») e separa gli accenti, che poi si
  // eliminano: «città» e «citta' » diventano la stessa cosa.
  return base.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/**
 * Testo normalizzato e, per ogni suo carattere, l'indice del carattere
 * ORIGINALE da cui proviene: serve a ritagliare dal testo vero il frammento
 * trovato sulla forma normalizzata.
 */
function normalizzaConMappa(testo: string): { testo: string; mappa: number[] } {
  const caratteri: string[] = [];
  const mappa: number[] = [];
  let spazioPendente = false;
  for (let i = 0; i < testo.length; i++) {
    const carattere = testo[i];
    if (/\s/.test(carattere)) {
      // Gli spazi (anche a capo e tabulazioni) collassano in uno solo, e
      // quelli in testa e in coda spariscono.
      spazioPendente = caratteri.length > 0;
      continue;
    }
    const normalizzato = normalizzaCarattere(carattere);
    if (normalizzato === "") continue;
    if (spazioPendente) {
      caratteri.push(" ");
      mappa.push(i);
      spazioPendente = false;
    }
    for (const c of normalizzato) {
      caratteri.push(c);
      mappa.push(i);
    }
  }
  return { testo: caratteri.join(""), mappa };
}

// La stessa pagina viene normalizzata una volta per riga estratta: una cache
// piccola e limitata evita di rifare il lavoro 200 volte senza diventare una
// perdita di memoria. La funzione resta pura (stesso input, stesso output).
const CACHE_PAGINE = new Map<string, { testo: string; mappa: number[] }>();
const CACHE_MASSIMA = 64;

function paginaNormalizzata(testo: string): { testo: string; mappa: number[] } {
  const memorizzata = CACHE_PAGINE.get(testo);
  if (memorizzata) return memorizzata;
  const calcolata = normalizzaConMappa(testo);
  if (CACHE_PAGINE.size >= CACHE_MASSIMA) CACHE_PAGINE.clear();
  CACHE_PAGINE.set(testo, calcolata);
  return calcolata;
}

/** Minuscolo, senza accenti, legature sciolte, apostrofi uniformati, spazi collassati. */
export function normalizzaTesto(t: string): string {
  return normalizzaConMappa(t).testo;
}

function ritaglia(pagina: string, inizio: number, fine: number): string {
  return pagina
    .slice(inizio, fine)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LUNGHEZZA_MASSIMA_FRAMMENTO);
}

/**
 * Cerca il frammento citato dal modello prima nella pagina dichiarata, poi
 * nelle altre (il numero di pagina è la cosa che il modello sbaglia più
 * spesso): l'evidenza restituita porta la pagina VERA. `null` quando il
 * frammento non esiste nel documento o è troppo corto per identificare
 * qualcosa — in entrambi i casi il campo nascerà da verificare.
 */
export function verificaEvidenza(
  pagine: readonly string[],
  pagina: number,
  frammento: string
): EvidenzaEstratta | null {
  const cercato = normalizzaTesto(frammento ?? "");
  if (cercato.length < LUNGHEZZA_MINIMA_FRAMMENTO) return null;

  const dichiarata = pagina - 1;
  const ordine = [dichiarata, ...pagine.map((_, i) => i).filter(i => i !== dichiarata)];
  for (const indice of ordine) {
    if (indice < 0 || indice >= pagine.length) continue;
    const { testo, mappa } = paginaNormalizzata(pagine[indice]);
    const posizione = testo.indexOf(cercato);
    if (posizione < 0) continue;
    const inizio = mappa[posizione];
    const fine = mappa[posizione + cercato.length - 1] + 1;
    // Gli scarti nel testo VERO della pagina: sono quelli che il
    // localizzatore trasforma nell'area della vignetta (anteprime).
    return { pagina: indice + 1, frammento: ritaglia(pagine[indice], inizio, fine), posizione: { inizio, fine } };
  }
  return null;
}

/**
 * Un valore proposto con la sua evidenza. Senza evidenza il campo nasce «da
 * verificare»: è la regola, non un caso particolare. `daVerificare` esplicito
 * serve ai valori dedotti (città del cliente, data del documento, oscurante
 * abbinato) che un'evidenza ce l'hanno ma non provano il fatto proposto.
 */
export function campo<T>(
  valore: T,
  evidenza: EvidenzaEstratta | null,
  opzioni?: { daVerificare?: boolean; nota?: string | null }
): CampoProposto<T> {
  return {
    valore,
    evidenza,
    daVerificare: opzioni?.daVerificare ?? evidenza == null,
    nota: opzioni?.nota ?? null,
  };
}
