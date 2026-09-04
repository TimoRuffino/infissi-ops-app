// Controlli fiscali deterministici per la fattura elettronica: il CF con il
// carattere di controllo (omocodia inclusa), la P.IVA con Luhn, la sigla di
// provincia. Nessuna chiamata esterna: sono regole, non servizi.

const DISPARI: Record<string, number> = {
  "0": 1,
  "1": 0,
  "2": 5,
  "3": 7,
  "4": 9,
  "5": 13,
  "6": 15,
  "7": 17,
  "8": 19,
  "9": 21,
  A: 1,
  B: 0,
  C: 5,
  D: 7,
  E: 9,
  F: 13,
  G: 15,
  H: 17,
  I: 19,
  J: 21,
  K: 2,
  L: 4,
  M: 18,
  N: 20,
  O: 11,
  P: 3,
  Q: 6,
  R: 8,
  S: 12,
  T: 14,
  U: 16,
  V: 10,
  W: 22,
  X: 25,
  Y: 24,
  Z: 23,
};
const PARI: Record<string, number> = {
  "0": 0,
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  A: 0,
  B: 1,
  C: 2,
  D: 3,
  E: 4,
  F: 5,
  G: 6,
  H: 7,
  I: 8,
  J: 9,
  K: 10,
  L: 11,
  M: 12,
  N: 13,
  O: 14,
  P: 15,
  Q: 16,
  R: 17,
  S: 18,
  T: 19,
  U: 20,
  V: 21,
  W: 22,
  X: 23,
  Y: 24,
  Z: 25,
};
// Omocodia: nelle 7 posizioni numeriche una cifra può diventare una lettera
// (0→L, 1→M, 2→N, 3→P, 4→Q, 5→R, 6→S, 7→T, 8→U, 9→V) quando il codice
// numerico collide con uno già assegnato. Esportata per i chiamanti che
// devono riconoscere/spiegare un CF omocodificato, non usata nel checksum:
// il regex sotto accetta già le lettere di omocodia in ogni posizione
// numerica.
const OMOCODIA = "LMNPQRSTUV";

/**
 * Valida un codice fiscale italiano: formato a 16 caratteri e carattere di
 * controllo secondo l'algoritmo ufficiale (tabelle pari/dispari sopra).
 * Case-insensitive; gestisce l'omocodia perché il regex accetta le lettere
 * L-M-N-P-Q-R-S-T-U-V nelle posizioni numeriche.
 */
export function codiceFiscaleValido(cf: string): boolean {
  const s = (cf ?? "").trim().toUpperCase();
  if (
    !/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(
      s
    )
  )
    return false;
  let somma = 0;
  for (let i = 0; i < 15; i++) {
    const c = s[i];
    somma += i % 2 === 0 ? DISPARI[c] : PARI[c]; // posizioni 1,3,5… (indice pari) sono "dispari"
  }
  return String.fromCharCode(65 + (somma % 26)) === s[15];
}

/**
 * Valida una partita IVA italiana: 11 cifre, ultima cifra di controllo
 * secondo l'algoritmo di Luhn (raddoppio delle posizioni pari, sottrazione
 * di 9 se il risultato supera 9). Accetta anche il prefisso "IT".
 */
export function partitaIvaValida(piva: string): boolean {
  const s = (piva ?? "").trim().toUpperCase().replace(/^IT/, "");
  if (!/^\d{11}$/.test(s)) return false;
  let somma = 0;
  for (let i = 0; i < 11; i++) {
    let n = Number(s[i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    somma += n;
  }
  return somma % 10 === 0;
}

/**
 * Estrae la sigla di provincia (2 lettere maiuscole) da forme diverse di
 * anagrafica: «SP», «(SP)» o «La Spezia (SP)». Null quando il testo non
 * contiene una sigla riconoscibile: meglio un campo vuoto che una sigla
 * inventata.
 */
export function normalizzaProvincia(
  testo: string | null | undefined
): string | null {
  if (!testo) return null;
  const t = testo.trim();
  const traParentesi = t.match(/\(([A-Za-z]{2})\)\s*$/);
  if (traParentesi) return traParentesi[1].toUpperCase();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return null;
}

export { OMOCODIA };
