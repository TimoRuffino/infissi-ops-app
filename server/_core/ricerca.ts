// Come si legge il testo digitato in un campo «Cerca».
//
// Sta qui e non dentro un router perché le due liste che la gente usa per
// trovare qualcuno — clienti e commesse — devono interpretarlo allo stesso
// modo, e la palette comandi (⌘K) interroga proprio quelle due: tre
// superfici, una regola sola.
//
// L'anagrafica vera impone due cose che il confronto fra stringhe non fa:
//
//  1. I numeri li scrivono a mano persone diverse: "+39 340 1234567",
//     "340-1234567", "0187 872687", "00393401234567". Chi cerca ne digita
//     una forma qualsiasi. Si confrontano le sole cifre, e in più la forma
//     internazionale, così il prefisso può mancare da una parte sola.
//  2. I nomi italiani hanno gli accenti e chi cerca non li mette: "forli"
//     deve trovare "Forlì", "citta" deve trovare "Città". Il confronto
//     avviene senza segni diacritici da entrambi i lati.

import { normalizzaTelefono } from "@shared/telefono";

/**
 * Sotto queste cifre un numero non è una ricerca: "12" sta dentro quasi
 * ogni utenza della sede e restituirebbe l'anagrafica intera.
 */
const CIFRE_MINIME_TELEFONO = 4;

/**
 * Cosa può contenere una ricerca per numero oltre alle cifre. Serve a
 * distinguere "+39 340 1234567" (un numero) da "Via Roma 1234" (un
 * indirizzo che per caso contiene quattro cifre): il secondo non deve
 * mettersi a pescare fra i telefoni.
 */
const PUNTEGGIATURA_TELEFONO = /^[\d\s+\-./()]+$/;

export type ChiaveRicerca = {
  /** Il testo ripulito: minuscolo, senza accenti, spazi compattati. */
  readonly testo: string;
  /** Le sole cifre, quando quello digitato è davvero un numero. */
  readonly cifre: string | null;
};

/** Minuscolo e senza segni diacritici: "Forlì" e "forli" devono incontrarsi. */
export function senzaAccenti(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Prepara una volta sola quello che servirebbe a ogni riga. Null quando non
 * resta niente da cercare: chi chiama salta il filtro invece di scartare
 * tutto.
 */
export function chiaveRicerca(raw: string): ChiaveRicerca | null {
  const testo = senzaAccenti(raw).trim().replace(/\s+/g, " ");
  if (!testo) return null;
  const cifre = raw.replace(/\D/g, "");
  const eUnNumero =
    PUNTEGGIATURA_TELEFONO.test(raw.trim()) &&
    cifre.length >= CIFRE_MINIME_TELEFONO;
  return { testo, cifre: eUnNumero ? cifre : null };
}

/** Vero se una qualsiasi delle voci contiene il testo cercato. */
export function testoCorrisponde(
  voci: readonly (string | null | undefined)[],
  chiave: ChiaveRicerca
): boolean {
  return voci.some((v) => !!v && senzaAccenti(v).includes(chiave.testo));
}

/**
 * Vero se una delle utenze contiene le cifre cercate. Confronta sia le
 * cifre così come sono scritte in anagrafica sia la forma internazionale:
 * "3401234567" salvato e "+39 340 1234567" digitato sono la stessa persona,
 * e nessuno dei due contiene l'altro.
 */
export function numeroCorrisponde(
  utenze: readonly (string | null | undefined)[],
  chiave: ChiaveRicerca
): boolean {
  const cercate = chiave.cifre;
  if (!cercate) return false;
  return utenze.some((u) => {
    if (!u) return false;
    const cifre = u.replace(/\D/g, "");
    if (!cifre) return false;
    if (cifre.includes(cercate)) return true;
    const internazionale = normalizzaTelefono(u);
    return internazionale ? internazionale.includes(cercate) : false;
  });
}
