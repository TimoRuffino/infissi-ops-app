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

function unisciRiga(riga: Frammento[], carattere: number): string {
  riga.sort((a, b) => a.x - b.x);
  let testo = "";
  let fine = 0;
  let precedente: Frammento | null = null;
  for (const f of riga) {
    const pezzo = f.testo.trim();
    const colonna = Math.min(COLONNA_MASSIMA, Math.max(0, Math.round(f.x / carattere)));
    if (!precedente) {
      testo = " ".repeat(colonna) + pezzo;
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
      testo = testo.padEnd(inizio, " ") + pezzo;
    } else if (vuoto > riferimento * 0.12 || spazioEsplicito) {
      testo += " " + pezzo;
    } else {
      testo += pezzo;
    }
    fine = Math.max(fine, f.fine);
    precedente = f;
  }
  return testo.trimEnd();
}

/**
 * Le righe di una pagina, dall'alto in basso, dai frammenti di pdf.js.
 * Frammenti sulla stessa quota (tolleranza: metà dell'altezza del carattere
 * più piccolo) stanno sulla stessa riga; dentro la riga ognuno comincia
 * alla colonna della sua x.
 */
export function righeDaElementi(elementi: ReadonlyArray<ElementoTesto>): string {
  const frammenti = elementi
    .map(frammentoDi)
    .filter((f): f is Frammento => f != null);
  const carattere = larghezzaCarattere(frammenti);
  frammenti.sort((a, b) => b.y - a.y || a.x - b.x);
  const righe: Frammento[][] = [];
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
      righe.push(corrente);
    }
    corrente = [f];
    quota = f.y;
    altezzaRiga = f.altezza;
  }
  if (corrente.length > 0) righe.push(corrente);
  return righe
    .map(riga => unisciRiga(riga, carattere))
    .filter(riga => riga.trim().length > 0)
    .join("\n");
}

export type DocumentoPdf = {
  numPages: number;
  getPage(numero: number): Promise<{
    getTextContent(): Promise<{ items: ReadonlyArray<unknown> }>;
    cleanup?: () => void;
  }>;
};

/** Il testo di ogni pagina, righe ricostruite dalla geometria. */
export async function pagineDaDocumento(pdf: DocumentoPdf): Promise<string[]> {
  const pagine: string[] = [];
  for (let numero = 1; numero <= pdf.numPages; numero += 1) {
    const pagina = await pdf.getPage(numero);
    const contenuto = await pagina.getTextContent();
    const elementi = contenuto.items.filter(
      (item): item is ElementoTesto =>
        typeof (item as any)?.str === "string" && Array.isArray((item as any)?.transform)
    );
    pagine.push(righeDaElementi(elementi));
    pagina.cleanup?.();
  }
  return pagine;
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
