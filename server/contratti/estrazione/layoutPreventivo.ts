// Arricchimento facoltativo dal layout del preventivo Ruffino (2025, D-A
// bis — fase 3 dello studio sui dati reali, 06/09/2026). È il secondo
// layout deterministico dopo quello del configuratore WnD
// (`layoutWnd.ts`): i contratti del 2025 e buona parte del 2026 sono
// scansioni di un preventivo che stampa, per ogni prodotto, la riga
// «Larghezza: 1380mm - Altezza: 1530mm Prez. Tot. 2.173,94€» con la
// quantità («Q.ta 2», «Qt 1») poche righe sopra, e in fondo «Totale
// Imponibile Complessivo» e «Totale Complessivo IVA Compresa».
//
// Sul banco di prova (21 contratti scansionati) il modello leggeva bene le
// misure (63 righe su 66) ma sbagliava un prezzo di riga su tre e il
// pattuito in 8 documenti su 12: gli stessi numeri stampati nel testo OCR
// sono più affidabili di qualunque lettura, e diventano evidenza certa.
//
// Come per il layout WnD: NON è un parser di contratto, la lettura resta
// quella del modello; su qualunque altro documento la funzione restituisce
// la proposta intatta. Funzione pura.

import type { EvidenzaEstratta, PropostaContratto, RigaProposta } from "@shared/contratti/estrazione";
import { euroToCent } from "@shared/euroCent";
import type { PattuitoTipo } from "@shared/limiti/tipi";
import { campo } from "./evidenze";
import { costruisciControlli } from "./mappa";

/** «Larghezza: 1380mm - Altezza: 1530mm» (l'OCR a volte perde i due punti o lo spazio). */
const MISURE = /Larghezza\s*:?\s*(\d{3,4})\s*mm\s*[-–]\s*Altezza\s*:?\s*(\d{3,4})\s*mm/i;
/** «Prez. Tot. 2.173,94€», «Prez. Tot. 663,97 €». */
const PREZZO_TOTALE = /Prez\.?\s*Tot\.?\s*:?\s*([\d.]+,\d{2})\s*€?/i;
/** «Q.ta 2», «Q-ta 1», «Qta 4», «Qt 1». */
const QUANTITA = /\bQ[.\-]?\s*ta\s*:?\s*(\d{1,3})\b|\bQt\s*:?\s*(\d{1,3})\b/i;
const SCONTO = /\s*Sconto\s*\d+(?:[.,]\d+)?\s*%.*$/i;
const RIGA_TECNICA = /^\s*(Metri\s+quadri|Prez\.?\s*Unit|Profilo|Telaio|Vetro|Colore)/i;
const TOTALE_LORDO = /Totale\s+Complessivo\s+IVA\s+Compr[a-z.]*\s*:?\s*([\d.]+,\d{2})/i;
const TOTALE_IMPONIBILE = /Totale\s+Imponibile\s+Complessivo\s*:?\s*([\d.]+,\d{2})/i;

/** Quanto può scostarsi una misura letta dal modello da quella del blocco (OCR e arrotondamenti). */
const TOLLERANZA_MM = 5;
/** Quante righe sopra la riga del prezzo si cerca la quantità e il nome. */
const RIGHE_INDIETRO = 6;
const LUNGHEZZA_FRAMMENTO = 300;

type BloccoPreventivo = {
  pagina: number;
  nome: string;
  larghezzaMm: number;
  altezzaMm: number;
  quantita: number | null;
  prezzoTotCent: number;
  evidenza: EvidenzaEstratta;
};

function numeroItaliano(testo: string): number | null {
  const valore = Number(testo.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(valore) ? valore : null;
}

function frammento(riga: string): string {
  return riga.replace(/\s+/g, " ").trim().slice(0, LUNGHEZZA_FRAMMENTO);
}

/** I blocchi prodotto del layout, nell'ordine in cui compaiono: una riga «Larghezza … Altezza … Prez. Tot.» per prodotto. */
export function blocchiPreventivo(pagine: readonly string[]): BloccoPreventivo[] {
  const blocchi: BloccoPreventivo[] = [];
  pagine.forEach((testo, indice) => {
    const righe = testo.split(/\r?\n/);
    for (let i = 0; i < righe.length; i++) {
      const misure = MISURE.exec(righe[i]);
      const prezzo = misure ? PREZZO_TOTALE.exec(righe[i]) : null;
      if (!misure || !prezzo) continue;
      const totale = numeroItaliano(prezzo[1]);
      if (totale == null || totale <= 0) continue;

      // Quantità e nome stanno sopra, senza risalire oltre il prezzo del prodotto precedente.
      let quantita: number | null = null;
      let nome = "";
      for (let k = i - 1; k >= 0 && k >= i - RIGHE_INDIETRO; k--) {
        const riga = righe[k];
        if (PREZZO_TOTALE.test(riga) && MISURE.test(riga)) break;
        if (quantita == null) {
          const q = QUANTITA.exec(riga);
          if (q) quantita = Number(q[1] ?? q[2]);
        }
        if (!nome && !MISURE.test(riga) && !QUANTITA.test(riga) && !RIGA_TECNICA.test(riga)) {
          const candidato = riga.replace(SCONTO, "").replace(/\s+/g, " ").trim();
          if (candidato.length >= 4) nome = candidato;
        }
      }
      blocchi.push({
        pagina: indice + 1,
        nome,
        larghezzaMm: Number(misure[1]),
        altezzaMm: Number(misure[2]),
        quantita: quantita != null && quantita >= 1 ? quantita : null,
        prezzoTotCent: euroToCent(totale),
        evidenza: { pagina: indice + 1, frammento: frammento(righe[i]) },
      });
    }
  });
  return blocchi;
}

/** Il layout c'è quando almeno un prodotto ha misure e prezzo totale sulla stessa riga. */
export function riconosceLayoutPreventivo(pagine: readonly string[]): boolean {
  return blocchiPreventivo(pagine).length > 0;
}

function vicino(a: number | null, b: number): boolean {
  return a != null && Math.abs(a - b) <= TOLLERANZA_MM;
}

/** Stessa regola del layout WnD (P3-R36): la quota di un oscurante fuso nella riga va risommata al prezzo del documento. */
function prezzoArricchito(riga: RigaProposta, blocco: BloccoPreventivo) {
  const quota = riga.quotaOscuranteCent ?? 0;
  if (quota === 0) return campo<number | null>(blocco.prezzoTotCent, blocco.evidenza, { daVerificare: false });
  return campo<number | null>(blocco.prezzoTotCent + quota, blocco.evidenza, { daVerificare: true, nota: riga.prezzoTotCent.nota });
}

function rigaArricchita(riga: RigaProposta, blocco: BloccoPreventivo): RigaProposta {
  const certo = { daVerificare: false };
  return {
    ...riga,
    larghezzaMm: campo<number | null>(blocco.larghezzaMm, blocco.evidenza, certo),
    altezzaMm: campo<number | null>(blocco.altezzaMm, blocco.evidenza, certo),
    quantita: blocco.quantita != null ? campo(blocco.quantita, blocco.evidenza, certo) : riga.quantita,
    prezzoTotCent: prezzoArricchito(riga, blocco),
  };
}

function cercaTotale(pagine: readonly string[], regex: RegExp): { valori: number[]; evidenza: EvidenzaEstratta } | null {
  const valori: number[] = [];
  let evidenza: EvidenzaEstratta | null = null;
  pagine.forEach((testo, indice) => {
    for (const riga of testo.split(/\r?\n/)) {
      const trovata = regex.exec(riga);
      if (!trovata) continue;
      const valore = numeroItaliano(trovata[1]);
      if (valore == null || valore <= 0) continue;
      valori.push(valore);
      evidenza ??= { pagina: indice + 1, frammento: frammento(riga) };
    }
  });
  return evidenza ? { valori, evidenza } : null;
}

/**
 * Il pattuito dai totali del preventivo: il lordo («Totale Complessivo IVA
 * Compresa») quando c'è, altrimenti l'imponibile («Totale Imponibile
 * Complessivo»). Un fascicolo può contenere più preventivi (o un
 * preventivo e la sua revisione): con più totali diversi vale il primo, ma
 * resta da verificare.
 */
function pattuitoDaTotali(
  pagine: readonly string[]
): { cent: number; tipo: PattuitoTipo; evidenza: EvidenzaEstratta; ambiguo: boolean } | null {
  for (const [regex, tipo] of [
    [TOTALE_LORDO, "lordo"],
    [TOTALE_IMPONIBILE, "imponibile"],
  ] as Array<[RegExp, PattuitoTipo]>) {
    const totale = cercaTotale(pagine, regex);
    if (!totale) continue;
    const distinti = new Set(totale.valori.map(v => Math.round(v * 100)));
    return { cent: euroToCent(totale.valori[0]), tipo, evidenza: totale.evidenza, ambiguo: distinti.size > 1 };
  }
  return null;
}

/**
 * Corregge la proposta con i numeri del layout: ogni blocco cerca, in
 * ordine, la riga della proposta con le stesse misure (±5 mm) non ancora
 * usata — a parità di misure quella con la stessa quantità — e le riscrive
 * misure, quantità e prezzo con evidenza certa; poi pattuito e tipo dai
 * totali. Una riga che il modello ha letto con misure diverse dal documento
 * non si tocca: meglio una riga da verificare che un prezzo attaccato alla
 * riga sbagliata. I controlli derivabili si ricalcolano (P3-R9).
 */
export function arricchisciDaLayoutPreventivo(
  pagine: readonly string[],
  proposta: PropostaContratto,
  opzioni?: { ivaDescrizione?: string | null; troncato?: boolean }
): PropostaContratto {
  const blocchi = blocchiPreventivo(pagine);
  if (blocchi.length === 0) return proposta;

  const righe = [...proposta.righe];
  const usate = new Set<number>();
  let arricchite = 0;
  for (const blocco of blocchi) {
    const candidate = righe
      .map((riga, i) => ({ riga, i }))
      .filter(({ riga, i }) => !usate.has(i) && vicino(riga.larghezzaMm.valore, blocco.larghezzaMm) && vicino(riga.altezzaMm.valore, blocco.altezzaMm));
    if (candidate.length === 0) continue;
    const scelta = candidate.find(({ riga }) => blocco.quantita == null || riga.quantita.valore === blocco.quantita) ?? candidate[0];
    usate.add(scelta.i);
    righe[scelta.i] = rigaArricchita(scelta.riga, blocco);
    arricchite += 1;
  }

  const pattuito = pattuitoDaTotali(pagine);
  const arricchita: PropostaContratto = {
    ...proposta,
    righe,
    pattuitoCent: pattuito ? campo<number | null>(pattuito.cent, pattuito.evidenza, { daVerificare: pattuito.ambiguo }) : proposta.pattuitoCent,
    pattuitoTipo: pattuito ? campo<PattuitoTipo | null>(pattuito.tipo, pattuito.evidenza, { daVerificare: pattuito.ambiguo }) : proposta.pattuitoTipo,
    avvertenze: [
      ...proposta.avvertenze,
      `Layout del preventivo riconosciuto: misure, quantità e prezzi di ${arricchite} righe su ${blocchi.length} blocchi confermati dal documento${pattuito ? `, pattuito ${pattuito.tipo} dai totali${pattuito.ambiguo ? " (più totali diversi nel documento: da verificare)" : ""}` : ""}.`,
    ],
  };

  return {
    ...arricchita,
    controlli: costruisciControlli(arricchita, {
      ivaDescrizione: opzioni?.ivaDescrizione ?? null,
      troncato: opzioni?.troncato ?? false,
    }),
  };
}
