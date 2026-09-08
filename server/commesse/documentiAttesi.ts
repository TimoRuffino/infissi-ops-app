// I documenti che questo lavoro vuole, oltre a quelli che vuole la fase
// (punto 31 del piano `2026-09-08-tars-piu-intelligente`).
//
// `documentiRichiesti(stato)` dipende SOLO dallo stato: la stessa lista per
// tutti. Ma un condominio vuole la delibera, una posa fatta vuole il suo
// verbale, una pratica fiscale vuole l'asseverazione. Dall'08/09/2026 il
// fascicolo conosce dodici tipi nuovi e il gate non li guardava.
//
// **Questo elenco NON blocca niente.** Il gate documentale resta quello che
// è: irrigidirlo fermerebbe lavori veri in un CRM in produzione, e non è una
// decisione che si prende di straforo. Qui si dice soltanto che cosa manca,
// e lo si dice a chi può deciderlo. Se un giorno la direzione vorrà che una
// di queste righe blocchi davvero, sarà un'aggiunta a
// `REQUIRED_DOC_TIPI_PER_STATO`, registrata e voluta.

import { DOC_TIPO_LABEL, type DocTipo } from "@shared/docTipi";

export type DocumentoAtteso = {
  tipo: DocTipo;
  /** Perché questo lavoro lo vuole: la ragione, non la regola. */
  perche: string;
};

export type NaturaCommessa = {
  /** Il tipo del cliente: `condominio`, `azienda`, `privato`, `ente_pubblico`. */
  tipoCliente: string | null;
  /** I tipi di documento già nel fascicolo. */
  tipiPresenti: ReadonlySet<string>;
  /** Almeno una posa risulta eseguita. */
  posaFatta: boolean;
};

/**
 * Che cosa manca a questo lavoro per essere completo, secondo la sua
 * natura. Solo regole che una persona dell'azienda riconoscerebbe.
 */
export function documentiAttesi(natura: NaturaCommessa): DocumentoAtteso[] {
  const attesi: DocumentoAtteso[] = [];
  const manca = (tipo: DocTipo) => !natura.tipiPresenti.has(tipo);

  // Un condominio delibera in assemblea: senza quel verbale il lavoro non
  // è autorizzato, per quanto l'amministratore abbia detto di sì.
  if (natura.tipoCliente === "condominio" && manca("delibera_condominio")) {
    attesi.push({
      tipo: "delibera_condominio",
      perche: "il cliente è un condominio: il lavoro lo autorizza l'assemblea",
    });
  }

  // La posa è avvenuta: il verbale è la prova di com'è stata consegnata, e
  // serve alla garanzia quanto al saldo.
  if (natura.posaFatta && manca("verbale_posa")) {
    attesi.push({
      tipo: "verbale_posa",
      perche: "la posa risulta eseguita e il verbale non è nel fascicolo",
    });
  }

  // Le due viaggiano insieme: una pratica fiscale senza asseverazione è
  // una pratica che non si chiude.
  if (natura.tipiPresenti.has("pratica_fiscale") && manca("asseverazione")) {
    attesi.push({
      tipo: "asseverazione",
      perche: "c'è una pratica fiscale, e senza asseverazione non si chiude",
    });
  }

  // Chi ha aperto una pratica edilizia deve poterla chiudere.
  if (natura.tipiPresenti.has("pratica_edilizia") && manca("dichiarazione_conformita")) {
    attesi.push({
      tipo: "dichiarazione_conformita",
      perche: "c'è una pratica edilizia: la conformità la chiude",
    });
  }

  return attesi;
}

/** La riga per la fotografia e per la scheda. */
export function testoAttesi(attesi: readonly DocumentoAtteso[]): string {
  return attesi
    .map(a => `${DOC_TIPO_LABEL[a.tipo] ?? a.tipo} (${a.perche})`)
    .join("; ");
}
