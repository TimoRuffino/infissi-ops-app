// Pattuito e piano rate della commessa.
//
// Dal 26/08/2026 il contratto è invertito rispetto alla versione precedente:
// la fonte autorevole del pattuito è Fatture in Cloud, non il CRM. Una
// commessa collegata a una o più fatture FiC prende da lì importo e rate, e
// i due valori non sono più scrivibili a mano — riscriverli creerebbe una
// verità parallela che nessuno riesce a riconciliare.
//
// Una commessa SENZA fattura collegata resta invece interamente manuale:
// l'operatore inserisce pattuito e rate e nessun automatismo glieli tocca.
// È il caso normale finché la fattura non viene emessa.
//
// Il passaggio manuale → FiC è automatico al primo collegamento. Il ritorno
// FiC → manuale avviene solo quando l'ultima fattura viene scollegata.

export type FontePattuito = "fic" | "manuale";

export type StatoRata = "attesa" | "pagata" | "stornata";

export type RataCommessa = {
  id: number;
  numero: number;
  importo: number;
  scadenza: string | null; // "YYYY-MM-DD"
  descrizione: string | null;
  origine: FontePattuito;
  // Provenienza FiC. `ficSourceKey` è la stessa chiave stabile usata dal
  // registro pagamenti: lega la rata al movimento incassato senza dipendere
  // dall'ordine in cui FiC restituisce le scadenze.
  ficDocumentoId: number | null;
  ficRataId: number | null;
  ficSourceKey: string | null;
  stato: StatoRata;
  dataPagamento: string | null;
  createdAt: Date;
  updatedAt: Date | null;
};

export type CommessaPattuito = {
  importoTotale?: number | null;
  pattuitoFonte?: FontePattuito | null;
  pattuitoFicDocumentoIds?: number[];
  pattuitoAggiornatoAt?: Date | null;
  pianoRate?: RataCommessa[];
};

function dateOrNull(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function importoValido(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

export function normalizzaRataLegacy(value: any, index: number): RataCommessa {
  const origine: FontePattuito = value?.origine === "fic" ? "fic" : "manuale";
  const stato: StatoRata =
    value?.stato === "pagata" || value?.stato === "stornata"
      ? value.stato
      : "attesa";
  return {
    id: Number(value?.id ?? index + 1),
    numero: Number(value?.numero ?? index + 1),
    importo: importoValido(value?.importo),
    scadenza: value?.scadenza ? String(value.scadenza) : null,
    descrizione: value?.descrizione ? String(value.descrizione) : null,
    origine,
    ficDocumentoId:
      value?.ficDocumentoId == null ? null : Number(value.ficDocumentoId),
    ficRataId: value?.ficRataId == null ? null : Number(value.ficRataId),
    ficSourceKey: value?.ficSourceKey ? String(value.ficSourceKey) : null,
    stato,
    dataPagamento: value?.dataPagamento ? String(value.dataPagamento) : null,
    createdAt: dateOrNull(value?.createdAt) ?? new Date(),
    updatedAt: dateOrNull(value?.updatedAt),
  };
}

/**
 * Backfill in `onLoad`: ogni commessa persistita prima di questa versione non
 * ha né fonte né piano rate. Il pattuito già presente viene dichiarato
 * `manuale` — è quello che era, e il primo collegamento FiC lo promuoverà.
 */
export function backfillPattuito(commessa: CommessaPattuito): void {
  if (!Array.isArray(commessa.pianoRate)) commessa.pianoRate = [];
  commessa.pianoRate = commessa.pianoRate.map(normalizzaRataLegacy);
  if (!Array.isArray(commessa.pattuitoFicDocumentoIds)) {
    commessa.pattuitoFicDocumentoIds = [];
  }
  if (commessa.pattuitoAggiornatoAt !== undefined) {
    commessa.pattuitoAggiornatoAt = dateOrNull(commessa.pattuitoAggiornatoAt);
  } else {
    commessa.pattuitoAggiornatoAt = null;
  }
  if (commessa.pattuitoFonte === undefined) {
    commessa.pattuitoFonte =
      commessa.pattuitoFicDocumentoIds.length > 0
        ? "fic"
        : commessa.importoTotale == null
          ? null
          : "manuale";
  }
}

/**
 * Il pattuito è modificabile a mano solo finché nessuna fattura FiC lo
 * alimenta. Non è un controllo di ruolo: è il confine fra le due fonti.
 */
export function pattuitoModificabileAMano(commessa: CommessaPattuito): boolean {
  return (commessa.pattuitoFicDocumentoIds ?? []).length === 0;
}

export const MOTIVO_PATTUITO_BLOCCATO =
  "Il pattuito e le rate di questa commessa arrivano da Fatture in Cloud. " +
  "Per cambiarli, correggi la fattura in FiC oppure scollegala dalla commessa.";

export type RataFicPerPiano = {
  id: number | null;
  sourceKey: string;
  importo: number;
  scadenza: string | null;
  stato: string;
  dataPagamento: string | null;
};

export type DocumentoFicPerPiano = {
  id: number;
  tipo: "invoice" | "credit_note";
  numero: string;
  data: string;
  importoLordo: number;
  rate: readonly RataFicPerPiano[];
};

function statoRataDaFic(stato: string): StatoRata {
  if (stato === "paid") return "pagata";
  if (stato === "reversed") return "stornata";
  return "attesa";
}

/**
 * Ricostruisce pattuito e piano rate dalle fatture FiC collegate alla
 * commessa. Deterministico e idempotente: le stesse fatture producono lo
 * stesso piano, quindi il sync può richiamarlo a ogni giro senza sporcare.
 *
 * Le note di credito abbattono il pattuito e non generano rate da incassare:
 * una restituzione non è una scadenza in attesa.
 */
export function derivaPattuitoDaFic(
  documenti: readonly DocumentoFicPerPiano[]
): { importoTotale: number; rate: RataCommessa[]; documentoIds: number[] } {
  const ordinati = [...documenti].sort(
    (a, b) => a.data.localeCompare(b.data) || a.id - b.id
  );
  const now = new Date();
  const rate: RataCommessa[] = [];
  let importoTotale = 0;

  for (const documento of ordinati) {
    const segno = documento.tipo === "credit_note" ? -1 : 1;
    importoTotale += segno * importoValido(documento.importoLordo);
    if (segno < 0) continue;
    const scadenze = [...documento.rate].sort(
      (a, b) =>
        (a.scadenza ?? "9999-12-31").localeCompare(b.scadenza ?? "9999-12-31") ||
        a.sourceKey.localeCompare(b.sourceKey)
    );
    for (const scadenza of scadenze) {
      rate.push({
        id: rate.length + 1,
        numero: rate.length + 1,
        importo: importoValido(scadenza.importo),
        scadenza: scadenza.scadenza,
        descrizione: `Fattura ${documento.numero}`,
        origine: "fic",
        ficDocumentoId: documento.id,
        ficRataId: scadenza.id,
        ficSourceKey: scadenza.sourceKey,
        stato: statoRataDaFic(scadenza.stato),
        dataPagamento: scadenza.dataPagamento,
        createdAt: now,
        updatedAt: null,
      });
    }
  }

  return {
    importoTotale: Math.round((importoTotale + Number.EPSILON) * 100) / 100,
    rate,
    documentoIds: ordinati.map(documento => documento.id),
  };
}

/** Somma delle rate: serve a dichiarare uno scostamento, non a correggerlo. */
export function totaleRate(rate: readonly RataCommessa[]): number {
  const totale = rate.reduce(
    (sum, rata) => (rata.stato === "stornata" ? sum : sum + rata.importo),
    0
  );
  return Math.round((totale + Number.EPSILON) * 100) / 100;
}

/**
 * Il piano copre il pattuito? Con FiC lo scostamento è un fatto da mostrare
 * (una fattura può essere parzialmente rateizzata); a mano è un errore di
 * compilazione da segnalare all'operatore mentre scrive.
 */
export function scostamentoPiano(commessa: CommessaPattuito): number | null {
  const pattuito = commessa.importoTotale;
  if (pattuito == null) return null;
  const rate = commessa.pianoRate ?? [];
  if (rate.length === 0) return null;
  return Math.round((totaleRate(rate) - pattuito + Number.EPSILON) * 100) / 100;
}
