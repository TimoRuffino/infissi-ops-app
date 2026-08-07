// Normalizzazione dei numeri di telefono — unica fonte di verità.
//
// Sta in /shared perché serve identica su due fronti che devono
// coincidere: il client la usa per i link wa.me, il server per agganciare
// un messaggio WhatsApp in arrivo al cliente giusto. Se le due versioni
// divergessero, un messaggio finirebbe sulla commessa sbagliata.
//
// I numeri in anagrafica sono scritti a mano da persone diverse:
// "0187 872687", "+39 340 1234567", "340-1234567", "00393401234567".
// Qui diventano tutti cifre in formato internazionale senza prefisso.

/**
 * Riduce un numero a sole cifre in formato internazionale (es. "393401234567").
 * Null quando non resta abbastanza per essere un numero vero.
 */
export function normalizzaTelefono(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  // Numeri italiani salvati senza prefisso internazionale (mobili 3xx…,
  // fissi 0xx…). Il controllo sulla lunghezza evita di trattare come
  // prefisso un "39" che è invece l'inizio del numero.
  if (!d.startsWith("39") || d.length <= 10) {
    if (d.startsWith("3") || d.startsWith("0")) d = "39" + d;
  }
  return d.length >= 10 ? d : null;
}

/**
 * Due numeri sono la stessa utenza? Confronto sulle ultime 9 cifre: copre
 * i casi in cui uno dei due è salvato col prefisso e l'altro no, senza
 * dare per buoni accostamenti troppo corti.
 */
export function stessoNumero(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const na = normalizzaTelefono(a);
  const nb = normalizzaTelefono(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.slice(-9) === nb.slice(-9);
}
