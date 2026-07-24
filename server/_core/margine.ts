// P0.2 — marginalità per commessa.
//
// margine lordo = ricavi (importoTotale pattuito)
//              − costi fornitore (Σ fornitori_ordini.importoTotale, esclusi
//                gli ordini in "bozza" e "contestato")
//              − costo posa stimato (campo manuale sulla commessa)
//
// Pure function: callers pass the commessa and its supplier orders, so the
// module has zero store dependencies and is trivially testable.

export type OrdinePerMargine = {
  id: number;
  codiceOrdine: string;
  fornitoreNome: string;
  stato: string;
  importoTotale: number;
};

export type MargineCommessa = {
  ricavi: number | null; // importoTotale pattuito (null = non impostato)
  costiFornitore: number;
  costoPosa: number | null;
  margineLordo: number | null;
  marginePerc: number | null; // 0–1
  dettaglioOrdini: OrdinePerMargine[];
  // true when the numbers cannot be trusted yet: no pattuito, or no supplier
  // order registered at all (costs would read as zero → fake 100% margin).
  datiIncompleti: boolean;
};

// Ordini che non rappresentano un costo reale: una bozza può sparire, un
// ordine contestato è in discussione.
const STATI_ORDINE_ESCLUSI = new Set(["bozza", "contestato"]);

export function calcolaMargine(
  commessa: { importoTotale?: number | null; costoPosaStimato?: number | null },
  ordini: Array<{
    id: number;
    codiceOrdine: string;
    fornitoreNome: string;
    stato: string;
    importoTotale?: number | null;
  }>
): MargineCommessa {
  const ricavi = commessa.importoTotale ?? null;
  const costoPosa = commessa.costoPosaStimato ?? null;

  const dettaglioOrdini: OrdinePerMargine[] = ordini
    .filter((o) => !STATI_ORDINE_ESCLUSI.has(o.stato))
    .map((o) => ({
      id: o.id,
      codiceOrdine: o.codiceOrdine,
      fornitoreNome: o.fornitoreNome,
      stato: o.stato,
      importoTotale: o.importoTotale ?? 0,
    }));
  const costiFornitore = dettaglioOrdini.reduce(
    (sum, o) => sum + o.importoTotale,
    0
  );

  const datiIncompleti = ricavi == null || dettaglioOrdini.length === 0;
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
    dettaglioOrdini,
    datiIncompleti,
  };
}
