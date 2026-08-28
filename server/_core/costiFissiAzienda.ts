// Quanto costa tenere aperta l'azienda ogni mese.
//
// Prima di questo file la risposta era due risposte scollegate, e nessuna
// delle due funzionava:
//
//   1. Le fatture d'acquisto FiC classificate `fisso` — il lavoro che una
//      persona fa nella scheda Acquisti — non entravano da nessuna parte. Il
//      pareggio le ignorava del tutto. Classificare venti fornitori come
//      "Fisso" lasciava il totale a zero: da fuori sembrava che la
//      classificazione non si salvasse.
//   2. Il registro `costi_fissi_manuali` era l'unica fonte del pareggio, ma
//      si riempiva solo confermando le ricorrenze una per una in un dialog.
//
// Qui la risposta è una sola, con due sorgenti che non si sovrappongono:
//
//   FiC          i documenti classificati `fisso`, mensilizzati sul periodo.
//                Fatture in Cloud fa fede: nessuna conferma da ridare.
//   Dichiarato   quello che in FiC non c'è e non ci sarà — stipendi,
//                contributi, tasse, affitti pagati senza fattura passiva.
//
// Regola di precedenza, una sola e spiegabile: se una voce dichiarata a mano
// nomina un fornitore che FiC conosce già come fisso, vince la voce
// dichiarata e l'aggregato FiC di quel fornitore sparisce. Una persona che
// scrive cadenza e validità sa più della media aritmetica, e sommarli
// sarebbe contarli due volte.

import { chiaveFornitore } from "./costiRicorrenti";

export type CostoFicPerFissi = {
  id: number;
  sedeId: number;
  tipo: "expense" | "passive_credit_note";
  data: string; // "YYYY-MM-DD"
  fornitoreNome: string;
  descrizione: string | null;
  categoriaFic: string | null;
  importoNetto: number;
  classificazione: string;
  fonteClassificazione: string | null;
  presenteInFic: boolean;
};

export type VoceDichiarata = {
  id: number;
  descrizione: string;
  fornitore: string | null;
  /** Importo di UNA occorrenza. */
  importo: number;
  /** Peso mensile già calcolato dalla cadenza. */
  mensile: number;
  cadenza: string;
  categoria: string;
  dal: string; // "YYYY-MM"
  al: string | null;
  note: string | null;
};

export type RigaCostoFisso = {
  chiave: string;
  fonte: "fic" | "dichiarato";
  descrizione: string;
  fornitore: string | null;
  /** Quanto pesa al mese. È questo che si somma. */
  mensile: number;
  /** FiC: quanto è stato speso davvero nel periodo base. */
  totalePeriodo: number | null;
  documenti: number | null;
  mesi: number | null;
  /** Dichiarato: identità e validità della voce. */
  id: number | null;
  cadenza: string | null;
  categoria: string | null;
  dal: string | null;
  al: string | null;
  /** Dichiarato: il fornitore era anche fra i fissi FiC, e lo rimpiazza. */
  sostituisceFic: number | null;
  righe: Array<{ id: number; data: string; importo: number; descrizione: string | null }>;
};

export type CostiFissiAzienda = {
  periodoDa: string;
  periodoA: string;
  /** Mesi con dati d'acquisto utilizzabili: il divisore della parte FiC. */
  mesiCoperti: number;
  righe: RigaCostoFisso[];
  totaleFic: number;
  totaleDichiarato: number;
  totaleMensile: number;
  /** Documenti d'acquisto ancora `dubbio` nel periodo: il totale è provvisorio. */
  documentiDaClassificare: number;
  importoDaClassificare: number;
};

/**
 * Il periodo base: gli ultimi dodici mesi CHIUSI.
 *
 * Il mese in corso resta fuori di proposito — è mezzo mese di documenti, e
 * mediarlo con gli altri undici abbassa il costo fisso proprio nei giorni in
 * cui lo si guarda per decidere. Una sola definizione, usata dal registro dei
 * costi fissi e dal pareggio: due finestre diverse davano due totali diversi
 * per la stessa azienda.
 */
export function periodoBase(riferimento?: {
  anno: number;
  mese: number;
}): { periodoDa: string; periodoA: string } {
  const oggi = new Date();
  const anno = riferimento?.anno ?? oggi.getUTCFullYear();
  const mese = riferimento?.mese ?? oggi.getUTCMonth() + 1;
  const fine = new Date(Date.UTC(anno, mese - 1, 0));
  const inizio = new Date(
    Date.UTC(fine.getUTCFullYear(), fine.getUTCMonth() - 11, 1)
  );
  return {
    periodoDa: inizio.toISOString().slice(0, 10),
    periodoA: fine.toISOString().slice(0, 10),
  };
}

function arrotonda(valore: number): number {
  return Math.round((valore + Number.EPSILON) * 100) / 100;
}

function segno(tipo: CostoFicPerFissi["tipo"]): 1 | -1 {
  return tipo === "passive_credit_note" ? -1 : 1;
}

/** La voce è viva alla fine del periodo? È lì che si misura il costo di oggi. */
export function attivaA(voce: { dal: string; al: string | null }, mese: string): boolean {
  if (voce.dal > mese) return false;
  return voce.al == null || voce.al >= mese;
}

export function calcolaCostiFissiAzienda(input: {
  costiFic: readonly CostoFicPerFissi[];
  dichiarati: readonly VoceDichiarata[];
  sedeId: number;
  periodoDa: string; // "YYYY-MM-DD"
  periodoA: string; // "YYYY-MM-DD"
}): CostiFissiAzienda {
  const { periodoDa, periodoA, sedeId } = input;
  const meseFine = periodoA.slice(0, 7);

  const nelPeriodo = input.costiFic.filter(
    costo =>
      costo.sedeId === sedeId &&
      costo.presenteInFic &&
      costo.data >= periodoDa &&
      costo.data <= periodoA
  );

  // Il divisore: i mesi in cui la contabilità acquisti dice qualcosa. Dividere
  // per dodici quando i documenti coprono otto mesi abbassa il costo fisso di
  // un terzo, e il pareggio con lui.
  const mesiConDati = new Set<string>();
  for (const costo of nelPeriodo) {
    if (costo.classificazione === "dubbio") continue;
    mesiConDati.add(costo.data.slice(0, 7));
  }
  const mesiCoperti = Math.max(1, mesiConDati.size);

  const dubbi = nelPeriodo.filter(costo => costo.classificazione === "dubbio");

  type GruppoFic = {
    fornitore: string;
    totale: number;
    documenti: number;
    mesi: Set<string>;
    righe: RigaCostoFisso["righe"];
  };
  const perFornitore = new Map<string, GruppoFic>();
  for (const costo of nelPeriodo) {
    if (costo.classificazione !== "fisso") continue;
    const chiave = chiaveFornitore(costo.fornitoreNome) || costo.fornitoreNome;
    const gruppo = perFornitore.get(chiave) ?? {
      fornitore: costo.fornitoreNome,
      totale: 0,
      documenti: 0,
      mesi: new Set<string>(),
      righe: [],
    };
    const importo = segno(costo.tipo) * costo.importoNetto;
    gruppo.totale += importo;
    gruppo.documenti++;
    gruppo.mesi.add(costo.data.slice(0, 7));
    gruppo.righe.push({
      id: costo.id,
      data: costo.data,
      importo: arrotonda(importo),
      descrizione: costo.descrizione ?? costo.categoriaFic,
    });
    perFornitore.set(chiave, gruppo);
  }

  // Solo le voci vive adesso. Un canone chiuso a marzo non è un costo di
  // agosto, e uno acceso a luglio pesa per intero subito.
  const vive = input.dichiarati.filter(voce => attivaA(voce, meseFine));

  const righe: RigaCostoFisso[] = [];
  for (const voce of vive) {
    const chiave = voce.fornitore ? chiaveFornitore(voce.fornitore) : "";
    const gruppo = chiave ? perFornitore.get(chiave) : undefined;
    const sostituito = gruppo ? arrotonda(gruppo.totale / mesiCoperti) : null;
    if (gruppo && chiave) perFornitore.delete(chiave);
    righe.push({
      chiave: `dichiarato:${voce.id}`,
      fonte: "dichiarato",
      descrizione: voce.descrizione,
      fornitore: voce.fornitore,
      mensile: arrotonda(voce.mensile),
      totalePeriodo: null,
      documenti: null,
      mesi: null,
      id: voce.id,
      cadenza: voce.cadenza,
      categoria: voce.categoria,
      dal: voce.dal,
      al: voce.al,
      sostituisceFic: sostituito,
      righe: [],
    });
  }

  for (const [chiave, gruppo] of Array.from(perFornitore.entries())) {
    righe.push({
      chiave: `fic:${chiave}`,
      fonte: "fic",
      descrizione: gruppo.fornitore,
      fornitore: gruppo.fornitore,
      mensile: arrotonda(gruppo.totale / mesiCoperti),
      totalePeriodo: arrotonda(gruppo.totale),
      documenti: gruppo.documenti,
      mesi: gruppo.mesi.size,
      id: null,
      cadenza: null,
      categoria: null,
      dal: null,
      al: null,
      sostituisceFic: null,
      righe: gruppo.righe.sort((a, b) => b.data.localeCompare(a.data)),
    });
  }

  righe.sort((a, b) => b.mensile - a.mensile);

  const totaleFic = arrotonda(
    righe.filter(r => r.fonte === "fic").reduce((s, r) => s + r.mensile, 0)
  );
  const totaleDichiarato = arrotonda(
    righe.filter(r => r.fonte === "dichiarato").reduce((s, r) => s + r.mensile, 0)
  );

  return {
    periodoDa,
    periodoA,
    mesiCoperti,
    righe,
    totaleFic,
    totaleDichiarato,
    totaleMensile: arrotonda(totaleFic + totaleDichiarato),
    documentiDaClassificare: dubbi.length,
    importoDaClassificare: arrotonda(
      dubbi.reduce((s, c) => s + segno(c.tipo) * c.importoNetto, 0)
    ),
  };
}
