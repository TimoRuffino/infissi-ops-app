// Unico punto di conversione euro ↔ centesimi. Le tabelle nuove (contratto,
// computo, fatture) tengono interi in centesimi: le somme sono esatte e
// l'arrotondamento avviene una volta, qui, half-up come richiede FatturaPA.
// Il resto del CRM parla ancora in euro float (`commessa.importoTotale`):
// si converte SOLO al confine, mai si sommano le due forme.

export function euroToCent(euro: number): number {
  if (typeof euro !== "number" || !Number.isFinite(euro)) {
    throw new Error("IMPORTO_NON_VALIDO");
  }
  // +Number.EPSILON evita 1.005 → 100 per la rappresentazione binaria.
  return Math.round((euro + Number.EPSILON) * 100);
}

export function centToEuro(cent: number): number {
  if (!Number.isInteger(cent)) throw new Error("CENT_NON_INTERI");
  return cent / 100;
}

export function sommaCent(
  ...valori: Array<number | null | undefined>
): number {
  let totale = 0;
  for (const v of valori) {
    if (v == null) continue;
    if (!Number.isInteger(v)) throw new Error("CENT_NON_INTERI");
    totale += v;
  }
  return totale;
}
