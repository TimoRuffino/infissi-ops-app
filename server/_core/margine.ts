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
// Dal 27/08/2026 il registro ha una seconda sorgente: le fatture d'acquisto
// che arrivano da Fatture in Cloud e che qualcuno ha assegnato a questa
// commessa (`CostoFic.commessaId`). Erano già in azienda, classificate
// «Commessa», e restavano fuori dal margine perché nessuno poteva dire di
// QUALE commessa fossero — così lo stesso costo andava riscritto a mano.
// Quelle voci sono derivate: si correggono da Acquisti, non da qui.
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
  // "fic" = fattura d'acquisto assegnata a questa commessa: si legge, non si
  // modifica dalla scheda. `ficCostoId` è l'id del documento in `fic_costi`.
  origine: "manuale" | "fic";
  ficCostoId: number | null;
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

export function calcolaMargine(
  commessa: {
    importoTotale?: number | null;
    costoPosaStimato?: number | null;
    costi?: any[] | null;
  },
  /** Fatture d'acquisto FiC assegnate a questa commessa. */
  costiFic: readonly CostoCommessa[] = []
): MargineCommessa {
  const ricavi = commessa.importoTotale ?? null;
  const costoPosa = commessa.costoPosaStimato ?? null;

  const manuali: CostoCommessa[] = (
    Array.isArray(commessa.costi) ? commessa.costi : []
  ).map((c: any) => ({
    id: c.id,
    fornitore: c.fornitore ?? null,
    descrizione: c.descrizione ?? null,
    importo: c.importo ?? 0,
    data: c.data ?? null,
    numeroOrdine: c.numeroOrdine ?? null,
    note: c.note ?? null,
    origine: "manuale" as const,
    ficCostoId: null,
  }));
  const costi = [...manuali, ...costiFic].sort((a, b) =>
    (b.data ?? "").localeCompare(a.data ?? "")
  );
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
    costiFornitore,
    costoPosa,
    margineLordo,
    marginePerc,
    costi,
    datiIncompleti,
  };
}
