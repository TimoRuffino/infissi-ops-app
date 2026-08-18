import { persistedStore } from "../_core/persistence";

export const CATEGORIE_COMUNICAZIONE = [
  "operativa",
  "nuovo_lead",
  "amministrativa",
  "fornitore",
  "da_classificare",
  "offerta_marketing",
  "spam",
] as const;

export type CategoriaComunicazione =
  (typeof CATEGORIE_COMUNICAZIONE)[number];

export const CATEGORIE_ESCLUSE: readonly CategoriaComunicazione[] = [
  "offerta_marketing",
  "spam",
];

export function categoriaEsclusa(categoria: CategoriaComunicazione): boolean {
  return CATEGORIE_ESCLUSE.includes(categoria);
}

export type SegnaliFiltro = {
  spamStatus?: string | null;
  spamFlag?: string | null;
  spamScore?: string | null;
  listUnsubscribe?: string | null;
  precedence?: string | null;
};

export type EsitoFiltro = {
  categoria: CategoriaComunicazione;
  score: number;
  motivo: string;
  fonte: "regola_mittente" | "regole";
};

export type RegolaFiltroMittente = {
  id: number;
  sedeId: number;
  mittente: string;
  categoria: "offerta_marketing" | "spam";
  createdAt: Date;
  createdBy: number | null;
  createdByNome: string | null;
};

let nextRegolaId = 1;
const _regoleStore = persistedStore<RegolaFiltroMittente>(
  "comunicazioni_regole_filtro",
  items => {
    nextRegolaId = items.length ? Math.max(...items.map(r => r.id)) + 1 : 1;
  }
);
export const regoleFiltroMittente = _regoleStore.items;
export const saveRegoleFiltroMittente = () => _regoleStore.save();

export function normalizzaMittente(mittente: string): string {
  const traAngoli = mittente.match(/<([^>]+)>/);
  return (traAngoli?.[1] ?? mittente).trim().toLowerCase();
}

export function trovaRegolaMittente(
  sedeId: number,
  mittente: string
): RegolaFiltroMittente | undefined {
  const normalizzato = normalizzaMittente(mittente);
  return regoleFiltroMittente.find(
    r => r.sedeId === sedeId && r.mittente === normalizzato
  );
}

export function salvaRegolaMittente(input: {
  sedeId: number;
  mittente: string;
  categoria: "offerta_marketing" | "spam";
  createdBy?: number | null;
  createdByNome?: string | null;
}): RegolaFiltroMittente {
  const mittente = normalizzaMittente(input.mittente);
  const esistente = regoleFiltroMittente.find(
    r => r.sedeId === input.sedeId && r.mittente === mittente
  );
  if (esistente) {
    esistente.categoria = input.categoria;
    esistente.createdBy = input.createdBy ?? null;
    esistente.createdByNome = input.createdByNome ?? null;
    esistente.createdAt = new Date();
    saveRegoleFiltroMittente();
    return esistente;
  }
  const regola: RegolaFiltroMittente = {
    id: nextRegolaId++,
    sedeId: input.sedeId,
    mittente,
    categoria: input.categoria,
    createdAt: new Date(),
    createdBy: input.createdBy ?? null,
    createdByNome: input.createdByNome ?? null,
  };
  regoleFiltroMittente.push(regola);
  saveRegoleFiltroMittente();
  return regola;
}

export function eliminaRegolaMittente(id: number, sedeId: number): boolean {
  const index = regoleFiltroMittente.findIndex(
    r => r.id === id && r.sedeId === sedeId
  );
  if (index === -1) return false;
  regoleFiltroMittente.splice(index, 1);
  saveRegoleFiltroMittente();
  return true;
}

function include(re: RegExp, value: string): boolean {
  return re.test(value);
}

function limitaScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Filtro locale ad alta precisione. Non tenta di decidere ogni messaggio:
 * esclude automaticamente solo spam/marketing con segnali convergenti e
 * lascia i casi dubbi alla coda "da classificare".
 */
export function classificaComunicazione(input: {
  sedeId: number;
  mittente: string;
  oggetto: string;
  testo: string;
  allegati?: Array<{ nome?: string; mimeType?: string }>;
  clienteId?: number | null;
  commessaId?: number | null;
  segnali?: SegnaliFiltro;
}): EsitoFiltro {
  const regola = trovaRegolaMittente(input.sedeId, input.mittente);
  if (regola) {
    return {
      categoria: regola.categoria,
      score: 100,
      motivo: `Mittente escluso da una regola aziendale: ${regola.mittente}.`,
      fonte: "regola_mittente",
    };
  }

  const mittente = normalizzaMittente(input.mittente);
  const oggetto = input.oggetto.toLowerCase();
  const testo = input.testo.toLowerCase().slice(0, 12_000);
  const insieme = `${mittente}\n${oggetto}\n${testo}`;
  const segnali = input.segnali ?? {};
  const motiviSpam: string[] = [];
  const motiviMarketing: string[] = [];
  const motiviOperativi: string[] = [];
  let spam = 0;
  let marketing = 0;
  let operativo = 0;
  let lead = 0;
  let amministrativa = 0;
  let fornitore = 0;

  if (/\byes\b|\btrue\b/i.test(segnali.spamFlag ?? "")) {
    spam += 95;
    motiviSpam.push("il server mail l'ha marcata come spam");
  }
  if (/\byes\b|\bspam\b/i.test(segnali.spamStatus ?? "")) {
    spam += 85;
    motiviSpam.push("stato spam presente negli header");
  }
  const scoreServer = Number.parseFloat(segnali.spamScore ?? "");
  if (Number.isFinite(scoreServer) && scoreServer >= 5) {
    spam += Math.min(70, scoreServer * 8);
    motiviSpam.push(`punteggio spam del server ${scoreServer}`);
  }

  if (segnali.listUnsubscribe) {
    marketing += 45;
    motiviMarketing.push("header di disiscrizione newsletter");
  }
  if (/bulk|list|junk/i.test(segnali.precedence ?? "")) marketing += 20;
  if (include(/\b(newsletter|mailing|marketing|promo|promozioni)\b/i, mittente)) {
    marketing += 30;
    motiviMarketing.push("mittente tipico di invii promozionali");
  }
  if (
    include(
      /\b(newsletter|offert[ae] (?:di|del|speciali?|imperdibili?)|promozione|black friday|cyber monday|solo per oggi|sconti? (?:su|del|speciali?|esclusivi?)|webinar gratuito|scopri l'offerta|acquista ora)\b/i,
      `${oggetto}\n${testo.slice(0, 3000)}`
    )
  ) {
    marketing += 35;
    motiviMarketing.push("linguaggio promozionale");
  }
  if (
    include(
      /\b(unsubscribe|disiscriviti|annulla iscrizione|preferenze di comunicazione|non vuoi piu ricevere)\b/i,
      testo
    )
  ) {
    marketing += 30;
    motiviMarketing.push("link o testo di disiscrizione");
  }

  if (
    include(
      /\b(viagra|casino|scommesse|criptovalut|bitcoin giveaway|hai vinto|premio garantito|gift card|prestito immediato|conto sospeso|password scaduta)\b/i,
      insieme
    )
  ) {
    spam += 75;
    motiviSpam.push("contenuto tipico di spam o phishing");
  }
  if (include(/\b(no-?reply|do-?not-?reply|mailer-daemon)\b/i, mittente)) {
    marketing += 10;
  }

  if (input.commessaId != null) {
    operativo += 100;
    motiviOperativi.push("gia collegata a una commessa");
  } else if (input.clienteId != null) {
    operativo += 45;
    motiviOperativi.push("mittente o contenuto riconosciuto in anagrafica");
  }
  if (
    include(
      /\b(richiesta (di )?preventivo|vorrei (un )?preventivo|sopralluogo|nuovi infissi|sostituire (le )?finestre|richiesta informazioni)\b/i,
      `${oggetto}\n${testo.slice(0, 5000)}`
    )
  ) {
    lead += 70;
    operativo += 40;
    motiviOperativi.push("richiesta commerciale compatibile con un nuovo lead");
  }
  if (
    include(
      /\b(fattura|nota di credito|bonifico|pagamento|scadenza|estratto conto|quietanza)\b/i,
      `${oggetto}\n${testo.slice(0, 4000)}`
    )
  ) {
    amministrativa += 55;
    operativo += 30;
    motiviOperativi.push("contenuto amministrativo");
  }
  if (
    include(
      /\b(conferma d['’]ordine|ordine n|ddt|documento di trasporto|data consegna|merce pronta|ritiro merce|listino riservato)\b/i,
      `${oggetto}\n${testo.slice(0, 4000)}`
    )
  ) {
    fornitore += 55;
    operativo += 35;
    motiviOperativi.push("documento o aggiornamento fornitore");
  }
  if (
    (input.allegati ?? []).some(a =>
      include(
        /\b(fattura|ordine|conferma|ddt|preventivo|rilievo|misure)\b/i,
        a.nome ?? ""
      )
    )
  ) {
    operativo += 25;
    motiviOperativi.push("allegato con nome operativo");
  }

  const spamNetto = spam - Math.min(70, operativo);
  const marketingNetto = marketing - Math.min(60, operativo);
  if (spamNetto >= 70) {
    return {
      categoria: "spam",
      score: limitaScore(spamNetto),
      motivo: `Esclusa automaticamente: ${motiviSpam.join(", ")}.`,
      fonte: "regole",
    };
  }
  if (marketingNetto >= 55) {
    return {
      categoria: "offerta_marketing",
      score: limitaScore(marketingNetto),
      motivo: `Esclusa automaticamente: ${motiviMarketing.join(", ")}.`,
      fonte: "regole",
    };
  }
  if (input.commessaId != null) {
    return {
      categoria: "operativa",
      score: 100,
      motivo: "Messaggio collegato a una commessa del CRM.",
      fonte: "regole",
    };
  }
  if (lead >= 60) {
    return {
      categoria: "nuovo_lead",
      score: limitaScore(lead),
      motivo: motiviOperativi.join(", "),
      fonte: "regole",
    };
  }
  if (amministrativa >= 50) {
    return {
      categoria: "amministrativa",
      score: limitaScore(amministrativa),
      motivo: motiviOperativi.join(", "),
      fonte: "regole",
    };
  }
  if (fornitore >= 50) {
    return {
      categoria: "fornitore",
      score: limitaScore(fornitore),
      motivo: motiviOperativi.join(", "),
      fonte: "regole",
    };
  }
  if (operativo >= 45) {
    return {
      categoria: "operativa",
      score: limitaScore(operativo),
      motivo: motiviOperativi.join(", "),
      fonte: "regole",
    };
  }
  return {
    categoria: "da_classificare",
    score: limitaScore(Math.max(spam, marketing, operativo)),
    motivo:
      "Nessun segnale abbastanza forte: richiede una decisione dell'operatore o di Tars.",
    fonte: "regole",
  };
}
