// Ogni proposta del mattino al suo destinatario (punto 3 del piano
// `2026-09-08-tars-piu-intelligente`).
//
// La regola T6 esiste dal 03/09 (`server/tars/destinatari.ts`) e la usava
// solo la chat: l'analisi no. Il mattino era una pila sola per la
// direzione — l'amministrazione non vedeva mai le sue fatture, chi ha la
// commessa non vedeva il suo gate.
//
// Qui non nasce nessuna regola nuova: si deriva il TEMA dalla sezione da
// cui la proposta viene (`fonte`, già verificata contro le sezioni vere) e
// si chiama la stessa `destinatarioPerTema` della chat.

import { destinatarioPerTema, type DestinatarioTars } from "../destinatari";
import type { EsitoAnalisiAzienda, PropostaAnalisi } from "./types";

type Tema = "commerciale" | "amministrativo" | "post_vendita" | "comunicazione";

/**
 * Le sezioni che parlano di soldi vanno all'amministrazione, quelle di
 * post-vendita a chi ha il ticket, i messaggi a chi li gestisce. Tutto il
 * resto è lavoro di commessa: decide l'assegnatario, e se la commessa è in
 * una fase amministrativa ci pensa `destinatarioPerTema`.
 */
const TEMA_PER_FONTE: Readonly<Record<string, Tema>> = {
  fatture: "amministrativo",
  ticket: "post_vendita",
  comunicazioni: "comunicazione",
};

/**
 * Le sezioni che nessuno può gestire al posto della direzione: un'integrazione
 * si ricollega dalle impostazioni, e il perimetro è una decisione.
 */
const SOLO_DIREZIONE = new Set(["guasti", "perimetro", "dormienti", "riscontro_proposte", "derivata"]);

function idDa(entita: readonly string[], tipo: string): number | null {
  for (const rif of entita) {
    const [t, id] = rif.split(":");
    if (t === tipo) {
      const n = Number.parseInt(id ?? "", 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

export type DipendenzeDestinatari = {
  commessa: (id: number) => { assegnatoA?: number | null; stato?: string | null } | null;
  ticket: (id: number) => { assegnatoA?: number | null } | null;
};

/** A chi tocca questa proposta. Deterministico: nessuna scelta del modello. */
export function destinatarioDiProposta(
  proposta: Pick<PropostaAnalisi, "fonte" | "entita">,
  deps: DipendenzeDestinatari
): DestinatarioTars {
  const fonte = proposta.fonte ?? "";
  if (SOLO_DIREZIONE.has(fonte)) {
    return { utenteId: null, ruolo: "direzione", motivo: `sezione «${fonte}»` };
  }
  const commessaId = idDa(proposta.entita ?? [], "commessa");
  const ticketId = idDa(proposta.entita ?? [], "ticket");
  return destinatarioPerTema({
    tema: TEMA_PER_FONTE[fonte] ?? "commerciale",
    commessa: commessaId != null ? deps.commessa(commessaId) : null,
    ticket: ticketId != null ? deps.ticket(ticketId) : null,
  });
}

/** L'esito con il destinatario scritto dentro ogni proposta. */
export function conDestinatari(
  esito: EsitoAnalisiAzienda,
  deps: DipendenzeDestinatari
): EsitoAnalisiAzienda {
  return {
    ...esito,
    proposte: esito.proposte.map(p => ({
      ...p,
      destinatario: destinatarioDiProposta(p, deps),
    })),
  };
}

export type ChiGuarda = {
  utenteId: number;
  ruoli: readonly string[];
  direzione: boolean;
};

/**
 * La direzione vede tutto. Gli altri vedono le proposte indirizzate a loro
 * per nome o per ruolo: la coda di ognuno è la sua, non un elenco da cui
 * scremare. Una proposta senza destinatario resta della direzione.
 */
export function propostaVisibileA(
  proposta: Pick<PropostaAnalisi, "destinatario">,
  chi: ChiGuarda
): boolean {
  if (chi.direzione) return true;
  const destinatario = proposta.destinatario;
  if (!destinatario) return false;
  if (destinatario.utenteId != null) return destinatario.utenteId === chi.utenteId;
  return destinatario.ruolo != null && chi.ruoli.includes(destinatario.ruolo);
}

export function esitoVisibileA(
  esito: EsitoAnalisiAzienda,
  chi: ChiGuarda
): EsitoAnalisiAzienda {
  if (chi.direzione) return esito;
  return {
    ...esito,
    proposte: esito.proposte
      .filter(p => propostaVisibileA(p, chi))
      // Le cifre le vede solo la direzione (decisione 08/09/2026): il
      // segnale «sotto margine» resta, i numeri no.
      .map(({ economia: _cifre, ...resto }) => resto),
  };
}
