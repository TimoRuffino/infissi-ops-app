// server/fatture/risolutore.ts
// Il risolutore della fattura (spec §7.2, delta D-A): dati il pattuito G e le
// somme di beni significativi B, altri beni N e servizi S, deriva prestazione
// P, markup M, storno Q e riepilogo IVA. Funzione pura, centesimi interi.
// Regola dei beni significativi (DM 29/12/1999): se B > P l'IVA 10 % vale su
// 2P e il 22 % su B − P; se B ≤ P tutto al 10 %.
import type { Aliquota, RiepilogoIva } from "@shared/fatturazione/tipi";

export type InputRisolutore = {
  pattuitoCent: number;
  pattuitoTipo: "lordo" | "imponibile";
  beniSignificativiCent: number;
  beniAltriCent: number;
  serviziCent: number;
};

export type EsitoRisolutore = {
  prestazioneCent: number;
  markupCent: number;
  stornoCent: number;
  riepilogo: RiepilogoIva[];
  imponibileCent: number;
  ivaCent: number;
  totaleCent: number;
  deltaPattuitoCent: number;
  casoBeniSignificativi: "b_maggiore_p" | "b_minore_uguale_p" | "senza_beni";
  avvertenze: string[];
};

export function impostaCent(imponibileCent: number, aliquota: Aliquota): number {
  // half-up sui centesimi: 95.971,8 → 95.972; l'EPSILON evita 0,5 letti come 0,4999
  return Math.floor((imponibileCent * aliquota) / 100 + 0.5 + Number.EPSILON);
}

function euro(cent: number): string {
  return (cent / 100).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type Riepilogo = {
  stornoCent: number; riepilogo: RiepilogoIva[]; imponibileCent: number; ivaCent: number; totaleCent: number;
  caso: EsitoRisolutore["casoBeniSignificativi"];
};

function riepilogoPer(B: number, P: number): Riepilogo {
  const caso: Riepilogo["caso"] = B <= 0 ? "senza_beni" : B > P ? "b_maggiore_p" : "b_minore_uguale_p";
  const Q = B > 0 && P > 0 ? Math.min(B, P) : 0;
  const imp22 = B - Q;
  const imp10 = P + Q;
  const righe: RiepilogoIva[] = [];
  if (imp22 !== 0) righe.push({ aliquota: 22, imponibileCent: imp22, impostaCent: impostaCent(imp22, 22) });
  if (imp10 !== 0) righe.push({ aliquota: 10, imponibileCent: imp10, impostaCent: impostaCent(imp10, 10) });
  const imponibileCent = righe.reduce((s, r) => s + r.imponibileCent, 0);
  const ivaCent = righe.reduce((s, r) => s + r.impostaCent, 0);
  return { stornoCent: Q, riepilogo: righe, imponibileCent, ivaCent, totaleCent: imponibileCent + ivaCent, caso };
}

export function risolvi(input: InputRisolutore): EsitoRisolutore {
  const G = input.pattuitoCent;
  const B = input.beniSignificativiCent;
  const N = input.beniAltriCent;
  const S = input.serviziCent;
  const avvertenze: string[] = [];

  let P: number;
  if (input.pattuitoTipo === "imponibile") {
    P = G - B;
  } else {
    P = Math.round((G - 1.22 * B) / 0.98);
    if (P >= B) P = Math.round(G / 1.1 - B);
  }

  let scelto = riepilogoPer(B, P);
  let deltaPattuitoCent = input.pattuitoTipo === "lordo" ? scelto.totaleCent - G : scelto.imponibileCent - G;
  if (input.pattuitoTipo === "lordo" && deltaPattuitoCent !== 0) {
    // Il centesimo che l'IVA non restituisce: si cerca intorno a P (spec §7.2).
    for (const passo of [1, -1, 2, -2, 3, -3]) {
      const tentativo = riepilogoPer(B, P + passo);
      if (tentativo.totaleCent === G) {
        P = P + passo;
        scelto = tentativo;
        deltaPattuitoCent = 0;
        break;
      }
    }
  }

  const M = P - N - S;
  if (M < 0) {
    avvertenze.push(
      `I servizi e gli altri beni superano il pattuito di € ${euro(-M)}: riduci i servizi o riequilibra i beni.`
    );
  }
  return {
    prestazioneCent: P,
    markupCent: M,
    // Con markup negativo lo storno non si applica (niente da restituire
    // finché i conti non tornano), ma il riepilogo resta calcolato su P:
    // serve all'operatore per vedere subito cosa non torna, prima che
    // corregga servizi o beni.
    stornoCent: M < 0 ? 0 : scelto.stornoCent,
    riepilogo: scelto.riepilogo,
    imponibileCent: scelto.imponibileCent,
    ivaCent: scelto.ivaCent,
    totaleCent: scelto.totaleCent,
    deltaPattuitoCent,
    casoBeniSignificativi: scelto.caso,
    avvertenze,
  };
}

/**
 * Scala le righe bene in proporzione fino a `targetSommaCent`. Arrotondamento
 * cumulativo: si arrotonda la somma progressiva e si prende la differenza dal
 * passo precedente, invece di arrotondare ogni riga per conto suo — quella
 * strada può sforare il target (es. [1,1,1,1]→2 darebbe somma 3, non 2).
 * Così la somma torna sempre esatta e, con input non negativi, nessuna riga
 * risulta negativa (la somma cumulativa arrotondata non decresce mai).
 */
export function riequilibraBeni(righeBeniCent: number[], targetSommaCent: number): number[] {
  if (righeBeniCent.length === 0) return [];
  const somma = righeBeniCent.reduce((s, x) => s + x, 0);
  const target = Math.max(0, targetSommaCent);
  if (somma <= 0) {
    const base = Math.floor(target / righeBeniCent.length);
    const esito = righeBeniCent.map(() => base);
    esito[esito.length - 1] += target - base * righeBeniCent.length;
    return esito;
  }
  const esito: number[] = [];
  let cumulativo = 0;
  let cumulativoArrotondato = 0;
  for (const x of righeBeniCent) {
    cumulativo += x;
    const precedente = cumulativoArrotondato;
    cumulativoArrotondato = Math.round((cumulativo * target) / somma);
    esito.push(cumulativoArrotondato - precedente);
  }
  return esito;
}
