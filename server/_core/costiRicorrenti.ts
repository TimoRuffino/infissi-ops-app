// Candidati a costo fisso per ricorrenza.
//
// La ricorrenza è aritmetica su fornitore, importo e mese: individua canoni,
// assicurazioni e leasing senza chiedere un modello. Non è però una decisione
// contabile: un operatore deve confermare il candidato nel registro dei costi
// fissi prima che pesi sul punto di pareggio.

export type CostoPerRicorrenza = {
  id: number;
  sedeId: number;
  tipo: "expense" | "passive_credit_note";
  data: string; // "YYYY-MM-DD"
  fornitoreNome: string;
  importoNetto: number;
};

export type GruppoRicorrente = {
  chiave: string;
  fornitore: string;
  importo: number;
  mesi: string[]; // "YYYY-MM", ordinati
  ids: number[];
  motivazione: string;
};

// Tre mesi sono il minimo per distinguere una ricorrenza da una coincidenza:
// due fatture uguali a distanza di un mese capitano, tre no.
const MESI_MINIMI = 3;
// Tolleranza sull'importo: un canone indicizzato o un arrotondamento IVA non
// devono spezzare la serie. Mezzo euro non è una variazione di contratto.
const TOLLERANZA_IMPORTO = 0.5;

/**
 * Chiave del fornitore: le forme societarie non fanno due fornitori diversi.
 * "Brianzatende SRL" e "BRIANZATENDE S.R.L." sono la stessa azienda, e
 * trattarle come due gruppi raddoppia il lavoro di chi classifica.
 */
export function chiaveFornitore(valore: string): string {
  return normalizzaFornitore(valore);
}

function normalizzaFornitore(valore: string): string {
  return valore
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(s\.?r\.?l\.?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|societa|ditta)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function mese(data: string): string {
  return data.slice(0, 7);
}

/** Bucket dell'importo: raggruppa cifre che differiscono meno della soglia. */
function bucketImporto(importo: number): number {
  return Math.round(importo / TOLLERANZA_IMPORTO);
}

/**
 * Il gruppo copre mesi CONSECUTIVI? "Ogni mese" è la regola: quattro fatture
 * uguali sparse su due anni sono un caso ripetuto, non un costo fisso.
 */
function serieConsecutivaPiuLunga(mesi: readonly string[]): string[] {
  if (mesi.length === 0) return [];
  const ordinati = Array.from(new Set(mesi)).sort();
  let migliore: string[] = [ordinati[0]];
  let corrente: string[] = [ordinati[0]];
  for (let i = 1; i < ordinati.length; i++) {
    const [annoPrec, mesePrec] = ordinati[i - 1].split("-").map(Number);
    const [anno, mesePos] = ordinati[i].split("-").map(Number);
    const distanza = (anno - annoPrec) * 12 + (mesePos - mesePrec);
    if (distanza === 1) corrente.push(ordinati[i]);
    else corrente = [ordinati[i]];
    if (corrente.length > migliore.length) migliore = [...corrente];
  }
  return migliore;
}

/**
 * I gruppi di costi che si ripetono ogni mese, per una sede.
 *
 * Le note di credito passive restano fuori: sono rettifiche, e una
 * rettifica ricorrente non è un costo ricorrente.
 */
export function rilevaCostiRicorrenti(
  costi: readonly CostoPerRicorrenza[],
  sedeId: number
): GruppoRicorrente[] {
  const gruppi = new Map<string, CostoPerRicorrenza[]>();
  for (const costo of costi) {
    if (costo.sedeId !== sedeId || costo.tipo !== "expense") continue;
    if (!costo.data || costo.importoNetto <= 0) continue;
    const fornitore = normalizzaFornitore(costo.fornitoreNome);
    if (!fornitore) continue;
    const chiave = `${fornitore}|${bucketImporto(costo.importoNetto)}`;
    gruppi.set(chiave, [...(gruppi.get(chiave) ?? []), costo]);
  }

  const risultato: GruppoRicorrente[] = [];
  for (const [chiave, membri] of Array.from(gruppi.entries())) {
    const serie = serieConsecutivaPiuLunga(membri.map(c => mese(c.data)));
    if (serie.length < MESI_MINIMI) continue;
    const inSerie = membri.filter(c => serie.includes(mese(c.data)));
    const importoMedio =
      inSerie.reduce((somma, c) => somma + c.importoNetto, 0) / inSerie.length;
    risultato.push({
      chiave,
      fornitore: inSerie[0].fornitoreNome,
      importo: Math.round(importoMedio * 100) / 100,
      mesi: serie,
      ids: inSerie.map(c => c.id).sort((a, b) => a - b),
      motivazione: `Stesso importo dallo stesso fornitore per ${serie.length} mesi consecutivi (${serie[0]} → ${serie[serie.length - 1]}).`,
    });
  }
  return risultato.sort((a, b) => b.importo - a.importo);
}
