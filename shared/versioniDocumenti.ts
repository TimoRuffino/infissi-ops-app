// Quando il fascicolo tiene due versioni della stessa cosa (punto 26 del
// piano `2026-09-08-tars-piu-intelligente`).
//
// Il duplicato si riconosce già dal checksum, dentro una sola commessa:
// byte identici, stesso file. Ma il cliente che rimanda «misure.pdf»
// corretto produce byte DIVERSI, quindi un secondo documento scollegato dal
// primo. Il fascicolo si ritrova due misure e nessuno sa quale vale: il
// posatore apre quella sbagliata.
//
// Qui non si cancella e non si sposta niente. Si DICE quale è l'ultima e
// quali sono superate — un calcolo puro sui documenti che ci sono già, così
// non serve nessuna migrazione e nessuna colonna nuova. Confrontare il
// CONTENUTO delle due versioni (dove differiscono le misure) è un passo
// successivo: qui si dichiara che esistono.

import type { DocTipo } from "./docTipi";

/**
 * I tipi che per natura sono molti: due foto non sono due versioni della
 * stessa foto, e due DDT sono due consegne. Per questi non si parla di
 * versioni.
 */
export const TIPI_NATURALMENTE_MULTIPLI: ReadonlySet<string> = new Set<DocTipo>([
  "foto",
  "ddt_consegna",
  "ddt_posa",
  "ddt_finale",
  "fattura",
  "nota_credito",
  "saldo",
  "contabile_pagamento",
  "conferma_ordine",
  "assistenza",
  "documento_identita",
  "altro",
]);

export type DocumentoVersionabile = {
  id: number;
  tipo: string;
  /** La data del documento quando c'è; altrimenti quella di caricamento. */
  dataDocumento?: string | null;
  createdAt?: Date | string | null;
  checksum?: string | null;
  nome: string;
};

export type CatenaVersioni = {
  tipo: string;
  /** L'ultima arrivata: è quella che vale. */
  vigente: DocumentoVersionabile;
  /** Le precedenti, dalla più recente. Restano nel fascicolo. */
  superate: DocumentoVersionabile[];
};

function istante(d: DocumentoVersionabile): number {
  const data = d.dataDocumento ? Date.parse(`${d.dataDocumento}T12:00:00Z`) : NaN;
  if (!Number.isNaN(data)) return data;
  const creato = d.createdAt ? new Date(d.createdAt).getTime() : NaN;
  return Number.isNaN(creato) ? 0 : creato;
}

/**
 * Le catene di versioni di un fascicolo: un tipo con più di un documento
 * di contenuto diverso. Documenti con lo stesso checksum sono lo stesso
 * file caricato due volte, non due versioni — quelli li gestisce già il
 * dedup, e qui non contano.
 */
export function catenePerTipo(
  documenti: readonly DocumentoVersionabile[]
): CatenaVersioni[] {
  const perTipo = new Map<string, DocumentoVersionabile[]>();
  for (const d of documenti) {
    if (TIPI_NATURALMENTE_MULTIPLI.has(d.tipo)) continue;
    const lista = perTipo.get(d.tipo) ?? [];
    // Stesso checksum = stesso file: una versione sola.
    if (d.checksum && lista.some(x => x.checksum === d.checksum)) continue;
    lista.push(d);
    perTipo.set(d.tipo, lista);
  }
  const catene: CatenaVersioni[] = [];
  for (const [tipo, lista] of perTipo) {
    if (lista.length < 2) continue;
    const ordinati = [...lista].sort((a, b) => istante(b) - istante(a));
    catene.push({ tipo, vigente: ordinati[0], superate: ordinati.slice(1) });
  }
  return catene.sort((a, b) => b.superate.length - a.superate.length);
}

/**
 * Per ogni documento: è quello che vale, oppure ce n'è uno più recente
 * dello stesso tipo. I documenti senza catena non compaiono (non c'è
 * niente da dire su di loro).
 */
export function statoVersioni(
  documenti: readonly DocumentoVersionabile[]
): Map<number, { vigente: boolean; superatoDa: number | null; quante: number }> {
  const stato = new Map<number, { vigente: boolean; superatoDa: number | null; quante: number }>();
  for (const catena of catenePerTipo(documenti)) {
    const quante = catena.superate.length + 1;
    stato.set(catena.vigente.id, { vigente: true, superatoDa: null, quante });
    for (const superato of catena.superate) {
      stato.set(superato.id, { vigente: false, superatoDa: catena.vigente.id, quante });
    }
  }
  return stato;
}
