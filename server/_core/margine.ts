// P0.2 — marginalità per commessa.
//
// margine lordo = ricavi (importoTotale pattuito)
//              − costi fornitore (Σ del registro costi[] della commessa)
//              − costo posa stimato (campo manuale sulla commessa)
//
// I costi si inseriscono direttamente in scheda commessa, come gli acconti:
// un registro embedded `costi[]`. Il modulo Ordini fornitore resta per la
// parte logistica (righe, ricevimento merce) ma NON alimenta più il margine
// — un solo posto dove scrivere un costo, nessun doppio conteggio.
//
// Pure function: nessuna dipendenza dagli store, banale da testare.

export type CostoCommessa = {
  id: number;
  fornitore: string | null;
  descrizione: string | null;
  importo: number;
  data: string | null; // "YYYY-MM-DD"
  numeroOrdine: string | null;
  note: string | null;
};

export type MargineCommessa = {
  ricavi: number | null; // importoTotale pattuito (null = non impostato)
  costiFornitore: number;
  costoPosa: number | null;
  margineLordo: number | null;
  marginePerc: number | null; // 0–1
  costi: CostoCommessa[];
  // true when the numbers cannot be trusted yet: no pattuito, or no cost
  // registered at all (costs would read as zero → fake 100% margin).
  datiIncompleti: boolean;
};

export function calcolaMargine(commessa: {
  importoTotale?: number | null;
  costoPosaStimato?: number | null;
  costi?: any[] | null;
}): MargineCommessa {
  const ricavi = commessa.importoTotale ?? null;
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
  }));
  const costiFornitore = costi.reduce((sum, c) => sum + c.importo, 0);

  const datiIncompleti = ricavi == null || costi.length === 0;
  const margineLordo =
    ricavi == null ? null : ricavi - costiFornitore - (costoPosa ?? 0);
  const marginePerc =
    ricavi != null && ricavi > 0 && margineLordo != null
      ? margineLordo / ricavi
      : null;

  return {
    ricavi,
    costiFornitore,
    costoPosa,
    margineLordo,
    marginePerc,
    costi,
    datiIncompleti,
  };
}
