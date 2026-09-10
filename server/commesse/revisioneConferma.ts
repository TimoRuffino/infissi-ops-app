// Quale delle due conferme è la revisione dell'altra.
//
// La prova è la DATA DEL DOCUMENTO, non l'ordine con cui i file sono entrati
// in archivio. `createdAt` dice quando il worker ha archiviato: su un giro in
// blocco è rumore, e il 10/09/2026 quel rumore ha eletto come costo di
// COM-2026-092 il più basso di quattro importi discordi.
//
// Quando la data non distingue, la risposta è «nessuna prova» — non un
// vincitore scelto in un altro modo. È il punto di tutto: su un valore in
// euro, «non lo so» è un'informazione, e tenerla per sé è il difetto.

export type EsitoRevisione = "nuovo" | "originale" | "nessuna_prova";

/** `YYYY-MM-DD` valida, o null. */
function giorno(valore: string | null | undefined): number | null {
  const testo = String(valore ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(testo)) return null;
  const t = Date.parse(`${testo}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  // `Date.parse` accetta il 31 febbraio e lo sposta: una data che non torna
  // com'era scritta non è una data.
  return new Date(t).toISOString().slice(0, 10) === testo ? t : null;
}

export function revisionePerData(
  dataNuovo: string | null | undefined,
  dataOriginale: string | null | undefined
): EsitoRevisione {
  const a = giorno(dataNuovo);
  const b = giorno(dataOriginale);
  if (a == null || b == null || a === b) return "nessuna_prova";
  return a > b ? "nuovo" : "originale";
}
