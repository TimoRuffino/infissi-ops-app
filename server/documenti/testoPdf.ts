// Righe di testo di un PDF nativo ricostruite dalla GEOMETRIA dei frammenti.
//
// pdf.js consegna i frammenti nell'ordine del flusso di contenuto, che non è
// l'ordine di lettura: nei documenti a colonne (BT Glass, Alias, Gianesin)
// le etichette del riquadro totali finiscono dieci righe dopo i loro importi
// («Totale» da una parte, «7.762,25» dall'altra), «Vs. riferimento:» resta
// staccato dal suo valore e i pezzi di una riga di tabella si incollano a
// rovescio («1.292,19G71 SISTEMA SCORREVOLE»). Con gli estrattori che
// lavorano per righe, l'imponibile non si trovava e il fornitore sbagliava
// (04/09/2026, conferma BT Glass per De Petris: «è ancora troppo stupido»).
//
// Qui ogni frammento torna al suo posto, come fa `pdftotext -layout`:
// stessa quota = stessa riga; dentro la riga ogni frammento comincia alla
// COLONNA che corrisponde alla sua x (una colonna = la larghezza media di un
// carattere della pagina), così un valore resta allineato sotto la sua
// etichetta anche quando sta nella riga dopo («VS.RIFERIMENTO» ↵
// «GIACOMAZZI GIUL»). Un vuoto piccolo diventa uno spazio, un salto di
// colonna almeno TRE spazi: chi legge dopo (estrattori, riscontro, merce)
// distingue le celle con `\s{3,}`. Funzione pura sui frammenti, testabile
// senza aprire un PDF.
//
// Dal 06/09/2026 (anteprime delle evidenze) la stessa funzione restituisce
// anche la GEOMETRIA delle righe: per ogni riga di testo la sua quota nella
// pagina e, per ogni tratto, dove comincia nella riga e dove sta sulla
// pagina. Le posizioni che pdf.js consegna non vengono più buttate via:
// servono a mostrare, in una vignetta, il punto da cui un valore è stato
// letto. La geometria è allineata per costruzione: riga i del testo, riga i
// della geometria.

import type { GeometriaPagina, RigaGeometria } from "@shared/documenti/evidenze";

export type ElementoTesto = {
  str: string;
  /** Matrice pdf.js [a, b, c, d, e, f]: e ed f sono l'origine del frammento. */
  transform: ReadonlyArray<number>;
  width: number;
  height: number;
};

/** Il vuoto minimo fra due celle: tre spazi, distinguibile da uno spazio normale. */
export const SEPARATORE_CELLE = "   ";

const COLONNA_MASSIMA = 240;
const LARGHEZZA_CARATTERE_DEFAULT = 4.5;

/**
 * Le misure della pagina resa e la trasformazione dallo spazio utente del
 * PDF (y verso l'alto) allo spazio della vista (y verso il basso, rotazione
 * della pagina applicata): è il viewport di pdf.js a scala 1. Senza misure
 * il testo esce uguale ma la geometria resta vuota.
 */
export type MisurePagina = {
  larghezza: number;
  altezza: number;
  aVista?: (x: number, y: number) => [number, number];
};

type Frammento = {
  testo: string;
  x: number;
  y: number;
  fine: number;
  altezza: number;
  larghezzaCarattere: number | null;
};

function frammentoDi(elemento: ElementoTesto): Frammento | null {
  const testo = String(elemento?.str ?? "").replace(/\s+/g, " ");
  if (testo.trim().length === 0) return null;
  const t = elemento.transform ?? [];
  const x = Number(t[4]);
  const y = Number(t[5]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  // L'altezza del carattere: dal frammento o dalla scala verticale della matrice.
  const scala = Math.hypot(Number(t[1]) || 0, Number(t[3]) || 0);
  const altezza =
    Number(elemento.height) > 0 ? Number(elemento.height) : scala > 0 ? scala : 8;
  const larghezzaNota = Number(elemento.width) > 0 ? Number(elemento.width) : null;
  const larghezza = larghezzaNota ?? testo.length * altezza * 0.5;
  return {
    testo,
    x,
    y,
    fine: x + larghezza,
    altezza,
    larghezzaCarattere:
      larghezzaNota != null && testo.trim().length >= 3 ? larghezzaNota / testo.length : null,
  };
}

/** La larghezza media di un carattere nella pagina: la mediana dei frammenti misurabili. */
function larghezzaCarattere(frammenti: readonly Frammento[]): number {
  const misure = frammenti
    .map(f => f.larghezzaCarattere)
    .filter((v): v is number => v != null && v > 0.5 && v < 40)
    .sort((a, b) => a - b);
  if (misure.length === 0) return LARGHEZZA_CARATTERE_DEFAULT;
  return misure[Math.floor(misure.length / 2)];
}

type TrattoRiga = { frammento: Frammento; inizio: number; fine: number };

/**
 * La riga di testo e, per ogni pezzo aggiunto, gli scarti di carattere in cui
 * è finito: sono i tratti della geometria.
 */
function unisciRiga(riga: Frammento[], carattere: number): { testo: string; tratti: TrattoRiga[] } {
  riga.sort((a, b) => a.x - b.x);
  let testo = "";
  let fine = 0;
  let precedente: Frammento | null = null;
  const tratti: TrattoRiga[] = [];
  const aggiungi = (frammento: Frammento, pezzo: string) => {
    const inizio = testo.length;
    testo += pezzo;
    tratti.push({ frammento, inizio, fine: testo.length });
  };
  for (const f of riga) {
    const pezzo = f.testo.trim();
    const colonna = Math.min(COLONNA_MASSIMA, Math.max(0, Math.round(f.x / carattere)));
    if (!precedente) {
      testo = " ".repeat(colonna);
      aggiungi(f, pezzo);
      fine = f.fine;
      precedente = f;
      continue;
    }
    // Lo stesso testo disegnato due volte nello stesso punto (grassetto
    // «a mano» di alcuni generatori) non è una parola in più.
    if (pezzo === precedente.testo.trim() && Math.abs(f.x - precedente.x) < 1) continue;
    const vuoto = f.x - fine;
    const riferimento = Math.max(f.altezza, precedente.altezza, 4);
    const spazioEsplicito = /\s$/.test(precedente.testo) || /^\s/.test(f.testo);
    if (vuoto > riferimento * 1.5) {
      // Salto di colonna: alla sua colonna, e comunque almeno tre spazi.
      const inizio = Math.max(colonna, testo.length + SEPARATORE_CELLE.length);
      testo = testo.padEnd(inizio, " ");
      aggiungi(f, pezzo);
    } else if (vuoto > riferimento * 0.12 || spazioEsplicito) {
      testo += " ";
      aggiungi(f, pezzo);
    } else {
      aggiungi(f, pezzo);
    }
    fine = Math.max(fine, f.fine);
    precedente = f;
  }
  return { testo: testo.trimEnd(), tratti };
}

/**
 * Il riquadro di un frammento nello spazio della vista. La quota del
 * frammento è la sua linea di base: il glifo sale di circa 0,8 altezze e
 * scende di circa 0,25. Si trasformano i quattro angoli, così una pagina
 * ruotata dà comunque un rettangolo dritto nella vista.
 */
function riquadroVista(
  f: Frammento,
  misure: MisurePagina
): { x0: number; x1: number; y0: number; y1: number } {
  const trasforma = misure.aVista ?? ((x: number, y: number): [number, number] => [x, misure.altezza - y]);
  const angoli: Array<[number, number]> = [
    trasforma(f.x, f.y - 0.25 * f.altezza),
    trasforma(f.fine, f.y - 0.25 * f.altezza),
    trasforma(f.x, f.y + 0.8 * f.altezza),
    trasforma(f.fine, f.y + 0.8 * f.altezza),
  ];
  const xs = angoli.map(a => a[0]);
  const ys = angoli.map(a => a[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/**
 * Le righe di una pagina, dall'alto in basso, dai frammenti di pdf.js, con
 * la loro geometria quando si conoscono le misure della pagina. Frammenti
 * sulla stessa quota (tolleranza: metà dell'altezza del carattere più
 * piccolo) stanno sulla stessa riga; dentro la riga ognuno comincia alla
 * colonna della sua x.
 */
export function righeConGeometriaDaElementi(
  elementi: ReadonlyArray<ElementoTesto>,
  misure?: MisurePagina
): { testo: string; righe: RigaGeometria[] } {
  const frammenti = elementi
    .map(frammentoDi)
    .filter((f): f is Frammento => f != null);
  const carattere = larghezzaCarattere(frammenti);
  frammenti.sort((a, b) => b.y - a.y || a.x - b.x);
  const gruppi: Frammento[][] = [];
  let corrente: Frammento[] = [];
  let quota = 0;
  let altezzaRiga = 0;
  for (const f of frammenti) {
    if (corrente.length > 0) {
      const tolleranza = Math.max(1.5, 0.45 * Math.min(altezzaRiga, f.altezza));
      if (Math.abs(f.y - quota) <= tolleranza) {
        corrente.push(f);
        continue;
      }
      gruppi.push(corrente);
    }
    corrente = [f];
    quota = f.y;
    altezzaRiga = f.altezza;
  }
  if (corrente.length > 0) gruppi.push(corrente);

  const righeTesto: string[] = [];
  const righe: RigaGeometria[] = [];
  let scarto = 0;
  for (const gruppo of gruppi) {
    const unita = unisciRiga(gruppo, carattere);
    if (unita.testo.trim().length === 0) continue;
    righeTesto.push(unita.testo);
    if (misure) {
      const riquadri = unita.tratti.map(t => ({ t, r: riquadroVista(t.frammento, misure) }));
      righe.push({
        inizio: scarto,
        y0: Math.min(...riquadri.map(q => q.r.y0)),
        y1: Math.max(...riquadri.map(q => q.r.y1)),
        tratti: riquadri.map(({ t, r }) => ({
          testo: t.frammento.testo.trim(),
          inizio: t.inizio,
          fine: t.fine,
          x0: r.x0,
          x1: r.x1,
        })),
      });
    }
    scarto += unita.testo.length + 1;
  }
  return { testo: righeTesto.join("\n"), righe };
}

/** Le righe di una pagina come testo, senza geometria. */
export function righeDaElementi(elementi: ReadonlyArray<ElementoTesto>): string {
  return righeConGeometriaDaElementi(elementi).testo;
}

export type DocumentoPdf = {
  numPages: number;
  getPage(numero: number): Promise<{
    getTextContent(): Promise<{ items: ReadonlyArray<unknown> }>;
    /** Il viewport di pdf.js: misure della pagina resa e trasformazione dei punti. */
    getViewport?(parametri: { scale: number }): {
      width: number;
      height: number;
      convertToViewportPoint(x: number, y: number): [number, number] | number[];
    };
    cleanup?: () => void;
  }>;
};

/**
 * Il testo di ogni pagina, righe ricostruite dalla geometria, e la geometria
 * stessa quando la pagina espone il suo viewport (null altrimenti).
 */
export async function pagineConGeometriaDaDocumento(
  pdf: DocumentoPdf
): Promise<{ pagine: string[]; geometria: Array<GeometriaPagina | null> }> {
  const pagine: string[] = [];
  const geometria: Array<GeometriaPagina | null> = [];
  for (let numero = 1; numero <= pdf.numPages; numero += 1) {
    const pagina = await pdf.getPage(numero);
    const contenuto = await pagina.getTextContent();
    const elementi = contenuto.items.filter(
      (item): item is ElementoTesto =>
        typeof (item as any)?.str === "string" && Array.isArray((item as any)?.transform)
    );
    const viewport = pagina.getViewport?.({ scale: 1 }) ?? null;
    const misure: MisurePagina | undefined =
      viewport && viewport.width > 0 && viewport.height > 0
        ? {
            larghezza: viewport.width,
            altezza: viewport.height,
            aVista: (x, y) => {
              const punto = viewport.convertToViewportPoint(x, y);
              return [Number(punto[0]), Number(punto[1])];
            },
          }
        : undefined;
    const { testo, righe } = righeConGeometriaDaElementi(elementi, misure);
    pagine.push(testo);
    geometria.push(
      misure ? { larghezza: misure.larghezza, altezza: misure.altezza, allineata: true, righe } : null
    );
    pagina.cleanup?.();
  }
  return { pagine, geometria };
}

/** Il testo di ogni pagina, righe ricostruite dalla geometria. */
export async function pagineDaDocumento(pdf: DocumentoPdf): Promise<string[]> {
  return (await pagineConGeometriaDaDocumento(pdf)).pagine;
}

/** Le celle di una riga (separate da almeno tre spazi) con la colonna in cui cominciano. */
export function celleDiRiga(riga: string): Array<{ testo: string; inizio: number }> {
  const celle: Array<{ testo: string; inizio: number }> = [];
  const re = /\S(?:.*?\S)?(?=\s{3,}|\s*$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(riga)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    celle.push({ testo: m[0], inizio: m.index });
  }
  return celle;
}
