// Modello di filtro della coda Post-Vendita.
//
// Funzione pura: nessuna query, nessuna capability, nessuna transizione di
// stato. Gli stati sono quelli del router ticket e restano quattro; la
// ricerca guarda solo i campi che la pagina ha già ricevuto — un filtro non
// può far comparire un dato che il server non ha mandato.

/** Stati server del ticket, in ordine di avanzamento. */
export const SUPPORT_QUEUE_STATES = [
  "aperto",
  "assegnato",
  "in_lavorazione",
  "chiuso",
] as const;

export type SupportQueueState = (typeof SUPPORT_QUEUE_STATES)[number];

/** Sentinella della coda non filtrata: non è uno stato del router. */
export const SUPPORT_QUEUE_ALL = "tutti";

export type SupportQueueAdvance = {
  /** Stato successivo, identico a quello accettato da `ticket.updateStato`. */
  stato: SupportQueueState;
  label: string;
  /** Cosa manca perché il ticket avanzi, in chiaro accanto alla riga. */
  prossimaAzione: string;
};

const ADVANCE: Record<string, SupportQueueAdvance> = {
  aperto: {
    stato: "assegnato",
    label: "Assegna",
    prossimaAzione: "Da assegnare a chi se ne occupa",
  },
  assegnato: {
    stato: "in_lavorazione",
    label: "Lavora",
    prossimaAzione: "Assegnato: da prendere in lavorazione",
  },
  in_lavorazione: {
    stato: "chiuso",
    label: "Chiudi",
    prossimaAzione: "In lavorazione: da chiudere quando è risolto",
  },
};

/**
 * Passo successivo della coda. `chiuso` è terminale: la UI non inventa una
 * transizione che il router non accetta, e per tornare indietro resta il
 * rollback esistente.
 */
export function nextQueueAdvance(stato: string): SupportQueueAdvance | null {
  return ADVANCE[stato] ?? null;
}

/**
 * Reclami e rifacimenti. `risolto` è ritirato lato server (piegato su
 * `chiuso`): non torna qui come stato scrivibile.
 */
export const RECLAMO_STATES = ["aperto", "in_gestione", "chiuso"] as const;

export const RIFACIMENTO_STATES = [
  "aperto",
  "in_gestione",
  "in_produzione",
  "completato",
  "chiuso",
] as const;

export type PostVenditaAdvance = {
  stato: string;
  label: string;
  prossimaAzione: string;
};

const RECLAMO_ADVANCE: Record<string, PostVenditaAdvance> = {
  aperto: {
    stato: "in_gestione",
    label: "Gestisci",
    prossimaAzione: "Da prendere in gestione",
  },
  in_gestione: {
    stato: "chiuso",
    label: "Chiudi",
    prossimaAzione: "In gestione: da chiudere con la soluzione data",
  },
};

const RIFACIMENTO_ADVANCE: Record<string, PostVenditaAdvance> = {
  aperto: {
    stato: "in_gestione",
    label: "Gestisci",
    prossimaAzione: "Da prendere in gestione",
  },
  in_gestione: {
    stato: "in_produzione",
    label: "In produzione",
    prossimaAzione: "In gestione: da mandare in produzione",
  },
  in_produzione: {
    stato: "completato",
    label: "Completa",
    prossimaAzione: "In produzione: da completare quando il pezzo è pronto",
  },
  completato: {
    stato: "chiuso",
    label: "Chiudi",
    prossimaAzione: "Completato: da chiudere dopo la posa",
  },
};

export function nextReclamoAdvance(stato: string): PostVenditaAdvance | null {
  return RECLAMO_ADVANCE[stato] ?? null;
}

export function nextRifacimentoAdvance(
  stato: string
): PostVenditaAdvance | null {
  return RIFACIMENTO_ADVANCE[stato] ?? null;
}

export type SupportQueueTicket = {
  stato: string;
  oggetto?: string | null;
  descrizione?: string | null;
  contatto?: string | null;
  solleciti?: Array<{ nota?: string | null }>;
  /**
   * Riferimenti già risolti dalla pagina (codice commessa, nome cliente,
   * città, `TK-0001`, categoria). Restano un input perché la coda li mostra
   * già: l'helper non li ricostruisce e non fa lookup per conto suo.
   */
  riferimenti?: ReadonlyArray<string | null | undefined>;
};

export type SupportQueueFilter = {
  stato: string;
  search: string;
};

function normalizza(valore: string): string {
  return valore.trim().toLocaleLowerCase("it-IT");
}

export function ticketMatchesQueueFilter(
  ticket: SupportQueueTicket,
  filter: SupportQueueFilter
): boolean {
  if (filter.stato !== SUPPORT_QUEUE_ALL && ticket.stato !== filter.stato) {
    return false;
  }

  const query = normalizza(filter.search);
  if (!query) return true;

  const campi: Array<string | null | undefined> = [
    ticket.oggetto,
    ticket.descrizione,
    ticket.contatto,
    ...(ticket.solleciti ?? []).map(sollecito => sollecito.nota),
    ...(ticket.riferimenti ?? []),
  ];

  return campi.some(
    valore => typeof valore === "string" && normalizza(valore).includes(query)
  );
}
