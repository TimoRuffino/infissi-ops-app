// Localizzatore delle evidenze (06/09/2026, anteprime «Dove l'ho letto»):
// da «dove nel testo» a «dove nella pagina».
//
// Gli estrattori sanno a quale carattere della pagina hanno trovato un
// valore; i parser sanno dove sta ogni tratto di testo sulla pagina. Qui le
// due cose si incontrano: una posizione (scarti nel testo) diventa un'area
// in frazioni della pagina, con la riga intera e la fascia di contesto per
// la vignetta. Quando la geometria non è allineata al testo — la
// trascrizione del modello — il frammento si cerca nei tratti con
// tolleranza: cifre esatte, una lettera di scarto sulle parole lunghe.
//
// Regola d'onestà: se la posizione non si trova, il grado è «pagina». Mai
// un ritaglio indovinato spacciato per prova. Funzioni pure, nessuna I/O.

import type {
  Area,
  GeometriaPagina,
  PosizioneEvidenza,
} from "@shared/documenti/evidenze";

/** Righe sopra e sotto quella letta che entrano nella fascia di contesto. */
const RIGHE_INTORNO = 2;
/** Sotto questo numero di token una ricerca parziale non identifica nulla. */
const TOKEN_MINIMI_PARZIALE = 2;

function arrotonda(valore: number): number {
  return Math.round(valore * 10_000) / 10_000;
}

function areaNormalizzata(
  geo: GeometriaPagina,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): Area {
  const larghezza = Math.max(1, geo.larghezza);
  const altezza = Math.max(1, geo.altezza);
  const x = Math.min(1, Math.max(0, x0 / larghezza));
  const y = Math.min(1, Math.max(0, y0 / altezza));
  return {
    x: arrotonda(x),
    y: arrotonda(y),
    w: arrotonda(Math.min(1 - x, Math.max(0, (x1 - x0) / larghezza))),
    h: arrotonda(Math.min(1 - y, Math.max(0, (y1 - y0) / altezza))),
  };
}

/** L'area della riga intera: dal primo all'ultimo tratto. */
export function areaDiRiga(geo: GeometriaPagina, indice: number): Area {
  const r = geo.righe[indice];
  const x0 = r.tratti.length ? Math.min(...r.tratti.map(t => t.x0)) : 0;
  const x1 = r.tratti.length ? Math.max(...r.tratti.map(t => t.x1)) : geo.larghezza;
  return areaNormalizzata(geo, x0, r.y0, x1, r.y1);
}

/** La fascia di contesto: tutta la larghezza, da due righe sopra a due sotto. */
export function fasciaDiContesto(
  geo: GeometriaPagina,
  indice: number,
  righeIntorno = RIGHE_INTORNO
): Area {
  const da = geo.righe[Math.max(0, indice - righeIntorno)];
  const a = geo.righe[Math.min(geo.righe.length - 1, indice + righeIntorno)];
  return areaNormalizzata(geo, 0, da.y0, geo.larghezza, a.y1);
}

function posizioneDaRiquadro(
  geo: GeometriaPagina,
  indiceRiga: number,
  x0: number,
  x1: number
): PosizioneEvidenza {
  const r = geo.righe[indiceRiga];
  return {
    grado: "riquadro",
    frammento: areaNormalizzata(geo, x0, r.y0, x1, r.y1),
    riga: areaDiRiga(geo, indiceRiga),
    contesto: fasciaDiContesto(geo, indiceRiga),
  };
}

function rigaPerOffset(geo: GeometriaPagina, offset: number): number {
  let trovata = -1;
  for (const [i, r] of geo.righe.entries()) {
    if (r.inizio <= offset) trovata = i;
    else break;
  }
  return trovata;
}

/**
 * Posizione da scarti nel testo della pagina (geometria allineata). Null
 * se la geometria non è allineata, se gli scarti cadono fuori dal testo o
 * su nessun tratto.
 */
export function localizzaOffset(
  geo: GeometriaPagina,
  inizio: number,
  fine: number
): PosizioneEvidenza | null {
  if (!geo.allineata || geo.righe.length === 0) return null;
  if (!Number.isFinite(inizio) || !Number.isFinite(fine) || inizio < 0) return null;
  const i = rigaPerOffset(geo, inizio);
  if (i < 0) return null;
  const r = geo.righe[i];
  const lunghezzaRiga = r.tratti.length ? Math.max(...r.tratti.map(t => t.fine)) : 0;
  const daRiga = inizio - r.inizio;
  if (daRiga > lunghezzaRiga) return null;
  const aRiga = Math.max(daRiga + 1, fine - r.inizio);
  const toccati = r.tratti.filter(t => t.fine > daRiga && t.inizio < aRiga);
  if (toccati.length === 0) return null;
  return posizioneDaRiquadro(
    geo,
    i,
    Math.min(...toccati.map(t => t.x0)),
    Math.max(...toccati.map(t => t.x1))
  );
}

/** Minuscolo, senza accenti, spezzato in parole; punteggiatura ai bordi tolta. */
export function tokenNormalizzati(testo: string): string[] {
  return String(testo ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9.,%'-]+/)
    .map(t => t.replace(/^[.,'-]+|[.,'-]+$/g, ""))
    .filter(t => t.length > 0);
}

/**
 * Uguali, o una lettera di scarto su parole di almeno cinque lettere. Le
 * cifre sono esatte: «7.762,25» e «7.762,26» non sono la stessa cosa.
 */
function quasiUguali(a: string, b: string): boolean {
  if (a === b) return true;
  if (/\d/.test(a) || /\d/.test(b)) return false;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let differenze = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    differenze += 1;
    if (differenze > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return differenze + (a.length - i) + (b.length - j) <= 1;
}

function cercaSequenza(
  geo: GeometriaPagina,
  cercati: readonly string[]
): PosizioneEvidenza | null {
  for (const [i, r] of geo.righe.entries()) {
    const parole = r.tratti.flatMap(t => tokenNormalizzati(t.testo).map(tok => ({ tok, t })));
    for (let da = 0; da + cercati.length <= parole.length; da += 1) {
      let ok = true;
      for (let k = 0; k < cercati.length; k += 1) {
        if (!quasiUguali(parole[da + k].tok, cercati[k])) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const usati = parole.slice(da, da + cercati.length).map(p => p.t);
      return posizioneDaRiquadro(
        geo,
        i,
        Math.min(...usati.map(t => t.x0)),
        Math.max(...usati.map(t => t.x1))
      );
    }
  }
  return null;
}

/**
 * Posizione cercando il frammento nei tratti della geometria (anche non
 * allineata). Prima la sequenza intera sulla stessa riga; se non c'è, un
 * prefisso sempre più corto, mai sotto due token (o un token solo se porta
 * una cifra ed è lungo abbastanza da non essere un numero qualunque).
 * Si possono lasciar cadere solo token SENZA cifre: un numero che non si
 * ritrova non è un dettaglio, è la prova che manca — meglio «pagina» che
 * l'etichetta giusta con il numero sbagliato.
 */
export function localizzaFrammento(
  geo: GeometriaPagina,
  frammento: string
): PosizioneEvidenza | null {
  const cercati = tokenNormalizzati(frammento);
  if (cercati.length === 0 || geo.righe.length === 0) return null;
  for (let n = cercati.length; n >= 1; n -= 1) {
    if (n < cercati.length && /\d/.test(cercati[n])) break;
    if (n < TOKEN_MINIMI_PARZIALE && !(cercati.length === 1 || (/\d/.test(cercati[0]) && cercati[0].length >= 4))) {
      break;
    }
    const trovata = cercaSequenza(geo, cercati.slice(0, n));
    if (trovata) return trovata;
  }
  return null;
}

/**
 * L'area di un'evidenza: dalla posizione se la geometria è allineata, dal
 * frammento altrimenti; «pagina» quando non c'è geometria o non si trova.
 */
export function annotaEvidenza(
  geometria: ReadonlyArray<GeometriaPagina | null> | undefined,
  evidenza: {
    pagina: number;
    frammento: string;
    posizione?: { inizio: number; fine: number } | null;
  }
): PosizioneEvidenza {
  const geo = geometria?.[evidenza.pagina - 1] ?? null;
  if (!geo) return { grado: "pagina" };
  const daOffset =
    geo.allineata && evidenza.posizione
      ? localizzaOffset(geo, evidenza.posizione.inizio, evidenza.posizione.fine)
      : null;
  return daOffset ?? localizzaFrammento(geo, evidenza.frammento) ?? { grado: "pagina" };
}
