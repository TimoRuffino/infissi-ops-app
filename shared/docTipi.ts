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
  "nota_credito",
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
  // Aggiunti l'08/09/2026 su mandato della direzione: erano i fogli che
  // finivano tutti in «altro» e poi non si ritrovavano.
  "pratica_fiscale",
  "pratica_edilizia",
  "asseverazione",
  "scheda_tecnica",
  "disegno",
  "dichiarazione_conformita",
  "garanzia",
  "verbale_posa",
  "assistenza",
  "contabile_pagamento",
  "polizza",
  "delibera_condominio",
  "altro",
] as const;

export type DocTipo = (typeof DOC_TIPI)[number];

export const DOC_TIPO_LABEL: Record<DocTipo, string> = {
  preventivo: "Preventivo",
  contratto: "Contratto",
  misure: "Misure esecutive",
  fattura: "Fattura",
  nota_credito: "Nota di credito",
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
  pratica_fiscale: "Pratica fiscale (ENEA, bonus)",
  pratica_edilizia: "Pratica edilizia (CILA, SCIA)",
  asseverazione: "Asseverazione e cessione del credito",
  scheda_tecnica: "Scheda tecnica o capitolato",
  disegno: "Disegno o computo",
  dichiarazione_conformita: "Dichiarazione di conformità",
  garanzia: "Garanzia",
  verbale_posa: "Verbale di posa o collaudo",
  assistenza: "Rapporto di assistenza",
  contabile_pagamento: "Contabile di pagamento",
  polizza: "Polizza assicurativa",
  delibera_condominio: "Delibera condominiale",
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

/**
 * Il nome del file nel fascicolo: «{Tipo} {cliente} {AAAA-MM-GG}.pdf»
 * (scelta della direzione, 08/09/2026). La data è quella del documento —
 * per un allegato, il giorno in cui il messaggio è arrivato — così due
 * fogli dello stesso tipo non si accavallano più con un «(2)» appiccicato
 * e l'elenco si ordina da solo.
 *
 * L'estensione resta quella del file originale: un HEIC non diventa un PDF
 * perché gli si cambia il nome.
 */
export function nomeDocumentoDaTipo(
  nomeOriginale: string,
  tipo: string,
  cliente?: string | null,
  data?: Date | string | null
): string {
  const punto = nomeOriginale.lastIndexOf(".");
  const estensione = punto > 0 ? nomeOriginale.slice(punto) : "";
  const quando = data ? new Date(data) : new Date();
  const giorno = Number.isNaN(quando.getTime())
    ? new Date().toISOString().slice(0, 10)
    : `${quando.getFullYear()}-${String(quando.getMonth() + 1).padStart(2, "0")}-${String(
        quando.getDate()
      ).padStart(2, "0")}`;
  const pezzi = [docTipoLabel(tipo) || "Documento", (cliente ?? "").trim(), giorno]
    .filter(Boolean)
    .join(" ");
  // Caratteri che i sistemi di file non digeriscono, e spazi doppi.
  const pulito = pezzi
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${pulito}${estensione}`;
}
