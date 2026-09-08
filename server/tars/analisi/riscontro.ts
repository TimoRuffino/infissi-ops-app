// Il riscontro sulle proposte: cosa è stato scartato, e quali sezioni
// producono proposte che la direzione accetta davvero (punti 4 e 12 del
// piano `2026-09-08-tars-piu-intelligente`).
//
// Fino a oggi la memoria durava un giorno: l'analisi rileggeva solo le
// proposte scartate OGGI, e domani la stessa proposta tornava identica. E
// nessuno misurava niente — «gate 80 %, dormienti 5 %» non si poteva
// nemmeno calcolare, perché una proposta non diceva da quale sezione
// nascesse. Ora la dichiara (`fonte`, verificata contro le sezioni vere) e
// qui si guarda indietro.
//
// Deterministico e in sola lettura: legge i record già salvati.

import type { RecordAnalisiAzienda } from "./types";

/** Quanto indietro si guarda: due settimane di analisi, non di più. */
export const GIORNI_MEMORIA_SCARTATE = 14;
/** La misura ha senso su un campione: sotto questo numero non si dichiara. */
export const CAMPIONE_MINIMO_FONTE = 3;

export type PropostaScartata = {
  testo: string;
  fonte: string | null;
  giorno: string;
  entita: string[];
};

export type RiscontroFonte = {
  fonte: string;
  proposte: number;
  eseguite: number;
  scartate: number;
  /** Eseguite su (eseguite + scartate): le ignorate non dicono niente. */
  tasso: number | null;
};

/** Il giorno da cui leggere, in formato `YYYY-MM-DD`. */
export function giornoDiInizio(giornoCorrente: string, giorni = GIORNI_MEMORIA_SCARTATE): string {
  const [a, m, g] = giornoCorrente.split("-").map(Number);
  const d = new Date(Date.UTC(a, (m ?? 1) - 1, g ?? 1));
  d.setUTCDate(d.getUTCDate() - giorni);
  return d.toISOString().slice(0, 10);
}

/**
 * Le proposte rifiutate nella finestra, dalla più recente. Una proposta
 * scartata resta scartata: non torna domani con parole diverse.
 */
export function scartateRecenti(
  record: readonly RecordAnalisiAzienda[]
): PropostaScartata[] {
  const scartate: PropostaScartata[] = [];
  for (const r of [...record].sort((a, b) => b.giorno.localeCompare(a.giorno))) {
    for (const p of r.esito?.proposte ?? []) {
      if (p.esecuzione?.stato !== "scartata") continue;
      scartate.push({
        testo: p.testo,
        fonte: p.fonte ?? null,
        giorno: r.giorno,
        entita: p.entita ?? [],
      });
    }
  }
  return scartate;
}

/**
 * Quante proposte ha prodotto ogni sezione, quante ne sono state eseguite
 * e quante rifiutate. Le proposte mai toccate non contano nel tasso: il
 * silenzio non è un rifiuto.
 */
export function riscontroPerFonte(
  record: readonly RecordAnalisiAzienda[]
): RiscontroFonte[] {
  const per = new Map<string, RiscontroFonte>();
  for (const r of record) {
    for (const p of r.esito?.proposte ?? []) {
      const fonte = p.fonte ?? null;
      if (!fonte) continue;
      const riga =
        per.get(fonte) ?? { fonte, proposte: 0, eseguite: 0, scartate: 0, tasso: null };
      riga.proposte += 1;
      const stato = p.esecuzione?.stato ?? null;
      if (stato === "scartata") riga.scartate += 1;
      else if (stato != null && stato !== "non_eseguito") riga.eseguite += 1;
      per.set(fonte, riga);
    }
  }
  const righe = [...per.values()];
  for (const riga of righe) {
    const decise = riga.eseguite + riga.scartate;
    riga.tasso = decise >= CAMPIONE_MINIMO_FONTE ? riga.eseguite / decise : null;
  }
  return righe.sort((a, b) => b.proposte - a.proposte);
}

/** La riga che finisce nella fotografia, in italiano e senza percentuali finte. */
export function testoRiscontro(riga: RiscontroFonte): string {
  const decise = riga.eseguite + riga.scartate;
  if (riga.tasso == null) {
    return `${riga.fonte}: ${riga.proposte} proposte, ${decise} decise — troppo poche per dire se funziona.`;
  }
  const percento = Math.round(riga.tasso * 100);
  const giudizio =
    percento >= 70
      ? "questa sezione paga: usala"
      : percento <= 25
        ? "quasi sempre rifiutate: non insistere"
        : "risultati misti";
  return `${riga.fonte}: ${riga.eseguite} eseguite su ${decise} decise (${percento}%) — ${giudizio}.`;
}
