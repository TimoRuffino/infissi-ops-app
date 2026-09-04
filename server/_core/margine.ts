// P0.2 — marginalità per commessa.
//
// margine lordo = ricavi IMPONIBILI (imponibile delle fatture FiC)
//              − costi fornitore IMPONIBILI (registro costi[] della commessa)
//              − costo posa stimato (campo manuale sulla commessa)
//
// BASE IVA (decisione direzione 03/09/2026): «il pattuito da FiC va sempre
// visto IVA inclusa, il margine va calcolato IVA esclusa, quindi imponibile
// fattura meno imponibile ordine fornitore». Quindi:
// - `commessa.importoTotale` (pattuito) resta LORDO: è quello che il cliente
//   paga e non si tocca;
// - il margine usa `commessa.pattuitoImponibile`, derivato dagli imponibili
//   delle fatture FiC collegate;
// - i costi in `costi[]` sono imponibili (l'IVA sugli acquisti è partita di
//   giro come quella sulle vendite).
//
// Senza fattura collegata l'imponibile non esiste: nessuna aliquota si
// inventa e il margine si dichiara incompleto — collegare la fattura è il
// modo di ottenerlo.
//
// I costi stanno in un registro embedded `costi[]` sulla commessa, come gli
// acconti. Nascono da soli quando una conferma d'ordine entra nel fascicolo
// (`server/commesse/costoDaConferma.ts`, direzione 03/09/2026) e si
// inseriscono a mano per il resto. Il modulo Ordini fornitore resta per la
// parte logistica (righe, ricevimento merce) ma NON alimenta il margine — un
// solo posto dove scrivere un costo, nessun doppio conteggio.
//
// Pure function: nessuna dipendenza dagli store, banale da testare.

export type CostoCommessa = {
  id: number;
  fornitore: string | null;
  descrizione: string | null;
  /** IMPONIBILE (IVA esclusa): è la base del margine. */
  importo: number;
  data: string | null; // "YYYY-MM-DD"
  numeroOrdine: string | null;
  note: string | null;
  /** La conferma d'ordine del fascicolo da cui il costo è nato (null = a mano). */
  documentoId: number | null;
  /** Una persona ha modificato l'importo dalla scheda: nessuna rilettura lo tocca più. */
  modificatoAMano?: boolean;
};

/** Perché i ricavi non sono utilizzabili: si dice, non si stima. */
export type FonteRicaviMargine = "fic_imponibile" | "assente";

export type MargineCommessa = {
  /** Ricavo IMPONIBILE (null = nessuna fattura collegata). */
  ricavi: number | null;
  /** Il pattuito lordo, solo per mostrarlo accanto: non entra nel calcolo. */
  pattuitoLordo: number | null;
  fonteRicavi: FonteRicaviMargine;
  costiFornitore: number;
  costoPosa: number | null;
  margineLordo: number | null;
  marginePerc: number | null; // 0–1
  costi: CostoCommessa[];
  // true quando i numeri non sono ancora affidabili: nessun imponibile
  // (fattura non collegata) o nessun costo registrato (i costi leggerebbero
  // zero → margine finto al 100%).
  datiIncompleti: boolean;
};

export function calcolaMargine(commessa: {
  importoTotale?: number | null;
  pattuitoImponibile?: number | null;
  costoPosaStimato?: number | null;
  costi?: any[] | null;
}): MargineCommessa {
  const pattuitoLordo = commessa.importoTotale ?? null;
  const ricavi = commessa.pattuitoImponibile ?? null;
  const fonteRicavi: FonteRicaviMargine =
    ricavi == null ? "assente" : "fic_imponibile";
  const costoPosa = commessa.costoPosaStimato ?? null;

  const costi: CostoCommessa[] = (
    Array.isArray(commessa.costi) ? commessa.costi : []
  ).map((c: any) => ({
    id: c.id,
    fornitore: c.fornitore ?? null,
    descrizione: c.descrizione ?? null,
    importo: c.importo ?? 0,
    data: c.data ?? null,
    numeroOrdine: c.numeroOrdine ?? null,
    note: c.note ?? null,
    documentoId: c.documentoId ?? null,
  }));
  const costiFornitore =
    Math.round(costi.reduce((sum, c) => sum + c.importo, 0) * 100) / 100;

  const datiIncompleti = ricavi == null || costi.length === 0;
  const margineLordo =
    ricavi == null ? null : ricavi - costiFornitore - (costoPosa ?? 0);
  const marginePerc =
    ricavi != null && ricavi > 0 && margineLordo != null
      ? margineLordo / ricavi
      : null;

  return {
    ricavi,
    pattuitoLordo,
    fonteRicavi,
    costiFornitore,
    costoPosa,
    margineLordo,
    marginePerc,
    costi,
    datiIncompleti,
  };
}
