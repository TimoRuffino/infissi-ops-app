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
  /** Quanto pesa al mese. È questo che si somma — zero se non è più in forza. */
  mensile: number;
  /**
   * Il costo esiste ancora oggi? Un canone chiuso a ottobre 2025 non è un
   * costo di agosto 2026, ma restava nella media perché i suoi documenti
   * cadono comunque dentro il periodo base.
   */
  inForza: boolean;
  /** Perché è fuori dal totale. `null` quando ci sta dentro. */
  motivoFuori: string | null;
  /** FiC: quanto è stato speso davvero nel periodo base. */
  totalePeriodo: number | null;
  documenti: number | null;
  mesi: number | null;
  /** FiC: mesi fra un documento e il successivo — 1 mensile, 3 trimestrale. */
  intervalloMesi: number | null;
  /** FiC: primo e ultimo mese fatturato dentro il periodo. */
  primoMese: string | null;
  ultimoMese: string | null;
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
  /** Solo le voci in forza: sono queste che fanno il totale. */
  righe: RigaCostoFisso[];
  /** Le voci escluse, con il motivo. Non spariscono: si vedono e si spiegano. */
  fuoriTotale: RigaCostoFisso[];
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

/** "YYYY-MM" → progressivo di mesi, per sottrarre due mesi fra loro. */
function indiceMese(mese: string): number {
  const [anno, numero] = mese.slice(0, 7).split("-").map(Number);
  return anno * 12 + (numero - 1);
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
    // Le occorrenze si contano in MESI, non in documenti: un fornitore che
    // fattura due linee lo stesso mese ha una ricorrenza mensile, non
    // quindicinale, e contare i documenti ne dimezzava il peso.
    // Le note di credito non sono occorrenze: sono rettifiche.
    if (costo.tipo === "expense") gruppo.mesi.add(costo.data.slice(0, 7));
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
  const fuoriTotale: RigaCostoFisso[] = [];

  /**
   * Da un gruppo FiC alla sua riga: ritmo, peso mensile e se è ancora in
   * forza.
   *
   * Il peso NON è più `totale / mesi del periodo`. Quella formula sbagliava
   * due volte: spalmava su dodici mesi un canone acceso a maggio (che pesa
   * per intero, non per un quarto) e continuava a contare un canone spento a
   * ottobre. Ora ogni occorrenza copre `intervallo` mesi, quindi il peso è
   * `totale / (occorrenze × intervallo)` — che per un mensile è la media di
   * sempre, e per un trimestrale è finalmente un terzo.
   */
  const rigaFic = (chiave: string, gruppo: GruppoFic): RigaCostoFisso => {
    const mesi = Array.from(gruppo.mesi).sort();
    const primoMese = mesi[0] ?? null;
    const ultimoMese = mesi[mesi.length - 1] ?? null;
    const occorrenze = mesi.length;
    const intervallo =
      occorrenze >= 2
        ? Math.max(
            1,
            Math.round(
              (indiceMese(ultimoMese!) - indiceMese(primoMese!)) /
                (occorrenze - 1)
            )
          )
        : null;
    const mesiDiSilenzio =
      ultimoMese == null ? null : indiceMese(meseFine) - indiceMese(ultimoMese);

    let motivoFuori: string | null = null;
    if (occorrenze === 0) {
      motivoFuori = "Solo note di credito nel periodo.";
    } else if (intervallo == null) {
      // Un documento solo non stabilisce un ritmo, e indovinarlo è pericoloso
      // in entrambe le direzioni: un premio annuo da €12.000 letto come
      // mensile gonfierebbe l'obiettivo di dodici volte.
      motivoFuori = `Un solo documento (${ultimoMese}): non basta a stabilire una ricorrenza. Se è un costo periodico, dichiaralo a mano con la sua cadenza.`;
    } else if (mesiDiSilenzio! > intervallo + 1) {
      motivoFuori = `Ultima fattura ${ultimoMese}, ${mesiDiSilenzio} mesi fa: un costo che non arriva più non pesa sul mese di oggi.`;
    }

    return {
      chiave: `fic:${chiave}`,
      fonte: "fic",
      descrizione: gruppo.fornitore,
      fornitore: gruppo.fornitore,
      mensile:
        motivoFuori == null
          ? arrotonda(gruppo.totale / (occorrenze * intervallo!))
          : 0,
      inForza: motivoFuori == null,
      motivoFuori,
      totalePeriodo: arrotonda(gruppo.totale),
      documenti: gruppo.documenti,
      mesi: occorrenze,
      intervalloMesi: intervallo,
      primoMese,
      ultimoMese,
      id: null,
      cadenza: null,
      categoria: null,
      dal: null,
      al: null,
      sostituisceFic: null,
      righe: gruppo.righe.sort((a, b) => b.data.localeCompare(a.data)),
    };
  };

  for (const voce of vive) {
    const chiave = voce.fornitore ? chiaveFornitore(voce.fornitore) : "";
    const gruppo = chiave ? perFornitore.get(chiave) : undefined;
    // Il rimpiazzo si dichiara solo se c'era davvero qualcosa da rimpiazzare:
    // un fornitore già fuori dal totale non è una cifra sottratta.
    const sostituito = gruppo ? rigaFic(chiave, gruppo) : null;
    if (gruppo && chiave) perFornitore.delete(chiave);
    righe.push({
      chiave: `dichiarato:${voce.id}`,
      fonte: "dichiarato",
      descrizione: voce.descrizione,
      fornitore: voce.fornitore,
      mensile: arrotonda(voce.mensile),
      inForza: true,
      motivoFuori: null,
      totalePeriodo: null,
      documenti: null,
      mesi: null,
      intervalloMesi: null,
      primoMese: null,
      ultimoMese: null,
      id: voce.id,
      cadenza: voce.cadenza,
      categoria: voce.categoria,
      dal: voce.dal,
      al: voce.al,
      sostituisceFic:
        sostituito && sostituito.inForza ? sostituito.mensile : null,
      righe: [],
    });
  }

  for (const [chiave, gruppo] of Array.from(perFornitore.entries())) {
    const riga = rigaFic(chiave, gruppo);
    (riga.inForza ? righe : fuoriTotale).push(riga);
  }

  righe.sort((a, b) => b.mensile - a.mensile);
  fuoriTotale.sort(
    (a, b) => (b.ultimoMese ?? "").localeCompare(a.ultimoMese ?? "")
  );

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
    fuoriTotale,
    totaleFic,
    totaleDichiarato,
    totaleMensile: arrotonda(totaleFic + totaleDichiarato),
    documentiDaClassificare: dubbi.length,
    importoDaClassificare: arrotonda(
      dubbi.reduce((s, c) => s + segno(c.tipo) * c.importoNetto, 0)
    ),
  };
}
