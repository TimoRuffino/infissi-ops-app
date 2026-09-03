// I tipi dei documenti del fascicolo commessa, con le loro etichette.
// Sta in /shared perché la lista serve identica al server (enum zod, gate
// documentale, rinomina in upload) e al client (menu di caricamento, chip
// del fascicolo): tenerne due copie le ha già fatte divergere.
//
// «ordine» è stato accorpato in «conferma_ordine» il 03/09/2026: erano due
// voci per lo stesso foglio, il gate accettava indifferentemente l'una o
// l'altra e la rail mostrava due pastiglie di cui una arancione. I documenti
// storici vengono riportati al tipo superstite da `migraTipiDocumento`.

export const DOC_TIPI = [
  "preventivo",
  "contratto",
  "misure",
  "fattura",
  "conferma_ordine",
  "ddt_consegna",
  "ddt_posa",
  "ddt_finale",
  "saldo",
  "foto",
  "documento_identita",
  "visura",
  "planimetria",
  "certificazione",
  "altro",
] as const;

export type DocTipo = (typeof DOC_TIPI)[number];

export const DOC_TIPO_LABEL: Record<DocTipo, string> = {
  preventivo: "Preventivo",
  contratto: "Contratto",
  misure: "Misure esecutive",
  fattura: "Fattura",
  conferma_ordine: "Conferma ordine fornitore",
  ddt_consegna: "DDT consegna",
  ddt_posa: "DDT posa",
  ddt_finale: "DDT finale",
  saldo: "Ricevuta saldo",
  foto: "Foto",
  documento_identita: "Documento d'identità",
  visura: "Visura",
  planimetria: "Planimetria",
  certificazione: "Certificazione",
  altro: "Altro",
};

/**
 * L'etichetta di un tipo, anche quando arriva da un record storico con un
 * tipo che non è più nell'elenco: si mostra il valore grezzo invece di una
 * casella vuota.
 */
export function docTipoLabel(tipo: string | null | undefined): string {
  if (!tipo) return "";
  return (DOC_TIPO_LABEL as Record<string, string>)[tipo] ?? tipo;
}
