// Aggancio fattura FiC → commessa.
//
// La regola operativa è quella dettata dalla direzione: se anche UNO SOLO
// fra telefono, nome, cognome, indirizzo o email della fattura coincide con
// la commessa, la fattura le va allegata. Deterministico e spiegabile, come
// `tars/match.ts` per le comunicazioni: nessun modello qui dentro.
//
// Ma "un segnale basta" vale solo finché nessun ALTRO dato dice il
// contrario. Dal 27/08/2026 il matcher guarda anche le contraddizioni:
// due intestatari con partita IVA diversa, o due nomi diversi, non sono la
// stessa persona nemmeno quando condividono il civico. È il caso dei
// condomini e delle palazzine — stesso indirizzo, clienti diversi — che
// portava due fatture di due clienti sulla stessa commessa, e quindi un
// pattuito che sommava i soldi di due lavori.
//
// Tre esiti, non due:
//   - certo    → si collega da solo
//   - incerto  → si mostra il candidato ma NON si collega: decide un umano
//   - escluso  → contraddizione forte, la commessa non è nemmeno candidata
//
// L'incertezza è un'informazione da dire, non da nascondere dietro una
// scelta a caso: attribuire i soldi di un cliente a un altro è peggio che
// lasciare una fattura in coda un giorno in più.

import { stessoNumero } from "@shared/telefono";

export type SegnaleMatch =
  | "codice_commessa"
  | "identita_fiscale"
  | "email"
  | "telefono"
  | "cognome_nome"
  | "indirizzo";

/** Dati che si contraddicono fra fattura e commessa. */
export type Contraddizione = "identita_fiscale" | "cognome_nome" | "cliente_crm";

// Peso di ciascun segnale. Non è una soglia da superare: serve a ordinare i
// candidati quando più commesse combaciano, e a scrivere il motivo.
const PESO: Record<SegnaleMatch, number> = {
  codice_commessa: 100,
  identita_fiscale: 50,
  email: 30,
  telefono: 30,
  cognome_nome: 20,
  indirizzo: 12,
};

// Sotto questa forza il collegamento resta una proposta.
//
// L'unico segnale che non la raggiunge da solo è l'indirizzo (12): un
// indirizzo è il posto, non l'intestatario. In una palazzina o in un
// condominio combacia per clienti che non c'entrano niente fra loro, ed è
// esattamente da lì che nascevano i doppi collegamenti.
export const FORZA_MINIMA_AUTOMATICA = 20;

const ETICHETTA: Record<SegnaleMatch, string> = {
  codice_commessa: "codice commessa citato nella fattura",
  identita_fiscale: "partita IVA o codice fiscale",
  email: "email",
  telefono: "telefono",
  cognome_nome: "nome e cognome",
  indirizzo: "indirizzo",
};

const ETICHETTA_CONTRARIA: Record<Contraddizione, string> = {
  identita_fiscale: "partita IVA / codice fiscale diversi",
  cognome_nome: "intestatario diverso",
  cliente_crm: "cliente in anagrafica diverso",
};

export type FatturaPerMatch = {
  id: number;
  numero: string;
  clienteNome: string;
  clienteVat: string | null;
  clienteCf: string | null;
  clienteEmail: string | null;
  clienteTelefono: string | null;
  clienteIndirizzo: string | null;
  clienteCitta: string | null;
  descrizione: string | null;
  clienteId: number | null;
};

export type CommessaPerMatch = {
  id: number;
  codice: string;
  clienteId: number | null;
  cliente: string | null;
  email: string | null;
  telefono: string | null;
  indirizzo: string | null;
  citta: string | null;
};

export type ClientePerMatch = {
  id: number;
  nome: string | null;
  cognome: string | null;
  email: string | null;
  telefono: string | null;
  indirizzo: string | null;
  citta: string | null;
  partitaIva: string | null;
  codiceFiscale: string | null;
};

export type CandidatoMatch = {
  commessaId: number;
  codice: string;
  punteggio: number;
  segnali: SegnaleMatch[];
  contraddizioni: Contraddizione[];
  /** Combacia, ma non abbastanza da collegarsi da solo. */
  incerto: boolean;
  /** Perché non basta: testo già pronto per l'operatore e per Tars. */
  dubbio: string | null;
};

export type EsitoMatchFattura = {
  commessaId: number | null;
  segnali: SegnaleMatch[];
  motivo: string;
  candidati: CandidatoMatch[];
  ambiguo: boolean;
  /** C'è un candidato, ma serve una conferma umana. */
  incerto: boolean;
};

const CODICE_RE = /\bCOM[\s\-–_]?(\d{4})[\s\-–_]?(\d{1,4})\b/i;

function stripAcc(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizzaTesto(value: unknown): string {
  return stripAcc(String(value ?? ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Parole del nome, ordinate: "Rossi Mario" e "Mario Rossi" collidono. */
function chiaveNome(value: unknown): string {
  return normalizzaTesto(value).split(" ").filter(Boolean).sort().join(" ");
}

function normalizzaEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizzaFiscale(value: unknown, togliPrefissoIt = false): string {
  const normalizzato = String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return togliPrefissoIt && normalizzato.startsWith("IT")
    ? normalizzato.slice(2)
    : normalizzato;
}

/**
 * Un indirizzo utile è più di un civico. "Via Roma" da sola combacia con
 * mezza provincia: sotto le due parole significative non vale come segnale.
 */
function chiaveIndirizzo(via: unknown, citta: unknown): string | null {
  const parole = normalizzaTesto(via)
    .split(" ")
    .filter(
      parola =>
        parola.length > 2 &&
        !["via", "viale", "piazza", "corso", "vicolo", "loc", "localita",
          "str", "strada", "largo", "n", "snc", "int"].includes(parola)
    );
  if (parole.length === 0) return null;
  const cittaChiave = normalizzaTesto(citta);
  const chiave = [...parole].sort().join(" ");
  // Un solo token distintivo è accettato solo se accompagnato dalla città.
  if (parole.length < 2 && !cittaChiave) return null;
  return cittaChiave ? `${chiave}|${cittaChiave}` : chiave;
}

export function estraiCodiceCommessa(testo: string): string | null {
  const trovato = CODICE_RE.exec(testo);
  if (!trovato) return null;
  return `COM-${trovato[1]}-${trovato[2].padStart(3, "0")}`;
}

/**
 * Segnali in comune fra la fattura e UNA commessa. I contatti della commessa
 * (il cantiere) valgono quanto quelli del cliente in anagrafica: capita che
 * la fattura riporti il riferimento di cantiere e non quello dell'intestatario.
 */
function segnaliPerCommessa(
  fattura: FatturaPerMatch,
  commessa: CommessaPerMatch,
  cliente: ClientePerMatch | null,
  codiceCitato: string | null
): SegnaleMatch[] {
  const segnali: SegnaleMatch[] = [];

  if (codiceCitato && commessa.codice.toUpperCase() === codiceCitato) {
    segnali.push("codice_commessa");
  }

  if (cliente) {
    const vatFattura = normalizzaFiscale(fattura.clienteVat, true);
    const cfFattura = normalizzaFiscale(fattura.clienteCf);
    const vatCliente = normalizzaFiscale(cliente.partitaIva, true);
    const cfCliente = normalizzaFiscale(cliente.codiceFiscale);
    if (
      (vatFattura && vatFattura === vatCliente) ||
      (cfFattura && cfFattura === cfCliente)
    ) {
      segnali.push("identita_fiscale");
    }
  }

  const emailFattura = normalizzaEmail(fattura.clienteEmail);
  if (emailFattura) {
    const emailCrm = [commessa.email, cliente?.email].map(normalizzaEmail);
    if (emailCrm.some(valore => valore && valore === emailFattura)) {
      segnali.push("email");
    }
  }

  if (fattura.clienteTelefono) {
    const telefoniCrm = [commessa.telefono, cliente?.telefono];
    if (
      telefoniCrm.some(valore => stessoNumero(valore, fattura.clienteTelefono))
    ) {
      segnali.push("telefono");
    }
  }

  const nomeFattura = chiaveNome(fattura.clienteNome);
  if (nomeFattura) {
    const nomiCrm = nomiCommessa(commessa, cliente);
    if (nomiCrm.some(valore => valore === nomeFattura)) {
      segnali.push("cognome_nome");
    }
  }

  const indirizzoFattura = chiaveIndirizzo(
    fattura.clienteIndirizzo,
    fattura.clienteCitta
  );
  if (indirizzoFattura) {
    const indirizziCrm = [
      chiaveIndirizzo(commessa.indirizzo, commessa.citta),
      cliente ? chiaveIndirizzo(cliente.indirizzo, cliente.citta) : null,
    ];
    if (indirizziCrm.some(valore => valore && valore === indirizzoFattura)) {
      segnali.push("indirizzo");
    }
  }

  return segnali;
}

/** I nomi con cui il CRM conosce l'intestatario di questa commessa. */
function nomiCommessa(
  commessa: CommessaPerMatch,
  cliente: ClientePerMatch | null
): string[] {
  return [
    chiaveNome(commessa.cliente),
    cliente ? chiaveNome(`${cliente.cognome ?? ""} ${cliente.nome ?? ""}`) : "",
  ].filter(Boolean);
}

/**
 * Dati che dicono il contrario. Non "assenti" — presenti su entrambi i lati
 * e diversi. È la differenza fra "non lo so" e "non è lui".
 */
function contraddizioniPerCommessa(
  fattura: FatturaPerMatch,
  commessa: CommessaPerMatch,
  cliente: ClientePerMatch | null
): Contraddizione[] {
  const contrarie: Contraddizione[] = [];

  if (cliente) {
    const vatFattura = normalizzaFiscale(fattura.clienteVat, true);
    const cfFattura = normalizzaFiscale(fattura.clienteCf);
    const vatCliente = normalizzaFiscale(cliente.partitaIva, true);
    const cfCliente = normalizzaFiscale(cliente.codiceFiscale);
    if (
      (vatFattura && vatCliente && vatFattura !== vatCliente) ||
      (cfFattura && cfCliente && cfFattura !== cfCliente)
    ) {
      contrarie.push("identita_fiscale");
    }
  }

  // La fattura è già stata attribuita a un cliente in anagrafica e la
  // commessa è di un altro: due schede diverse, due fascicoli diversi.
  if (
    fattura.clienteId != null &&
    commessa.clienteId != null &&
    fattura.clienteId !== commessa.clienteId
  ) {
    contrarie.push("cliente_crm");
  }

  const nomeFattura = chiaveNome(fattura.clienteNome);
  const nomiCrm = nomiCommessa(commessa, cliente);
  if (nomeFattura && nomiCrm.length > 0 && !nomiCrm.includes(nomeFattura)) {
    contrarie.push("cognome_nome");
  }

  return contrarie;
}

/**
 * Un collegamento GIA' fatto regge ancora?
 *
 * Le regole nuove valgono per i collegamenti futuri: quelli sbagliati prima
 * restano dove sono, con il loro pattuito gonfiato, e nessuno se ne accorge
 * finche' non torna il conto a fine anno. Questa funzione li rende visibili
 * senza toccarli — scollegare resta una decisione umana.
 */
export function verificaCollegamento(input: {
  fattura: FatturaPerMatch;
  commessa: CommessaPerMatch;
  cliente: ClientePerMatch | null;
}): { contraddizioni: Contraddizione[]; avviso: string | null } {
  const codiceCitato = estraiCodiceCommessa(
    `${input.fattura.descrizione ?? ""} ${input.fattura.numero}`
  );
  if (codiceCitato && input.commessa.codice.toUpperCase() === codiceCitato) {
    return { contraddizioni: [], avviso: null };
  }
  const segnali = segnaliPerCommessa(
    input.fattura,
    input.commessa,
    input.cliente,
    codiceCitato
  );
  const contraddizioni = contraddizioniPerCommessa(
    input.fattura,
    input.commessa,
    input.cliente
  );
  // Stessa indulgenza del match: il codice fiscale copre una ragione sociale
  // riscritta.
  const daSegnalare = segnali.includes("identita_fiscale")
    ? contraddizioni.filter(c => c !== "cognome_nome")
    : contraddizioni;
  if (daSegnalare.length === 0) return { contraddizioni: [], avviso: null };
  return {
    contraddizioni: daSegnalare,
    avviso: daSegnalare.map(c => ETICHETTA_CONTRARIA[c]).join(", "),
  };
}

function punteggio(segnali: readonly SegnaleMatch[]): number {
  return segnali.reduce((somma, segnale) => somma + PESO[segnale], 0);
}

/**
 * Come pesare le contraddizioni.
 *
 * - il codice commessa scritto in fattura è volontà umana esplicita: vince
 *   su qualsiasi contraddizione;
 * - la stessa partita IVA / codice fiscale copre un nome diverso — le
 *   ragioni sociali cambiano, i codici no;
 * - tutto il resto: identità o cliente in conflitto ESCLUDONO la commessa,
 *   un nome in conflitto la lascia candidata ma incerta.
 */
function valuta(
  segnali: readonly SegnaleMatch[],
  contraddizioni: readonly Contraddizione[]
): { escluso: boolean; incerto: boolean; dubbio: string | null } {
  if (segnali.includes("codice_commessa")) {
    return { escluso: false, incerto: false, dubbio: null };
  }
  const fiscaleConferma = segnali.includes("identita_fiscale");
  const gravi = contraddizioni.filter(c => c !== "cognome_nome");
  if (gravi.length > 0) {
    return {
      escluso: true,
      incerto: true,
      dubbio: gravi.map(c => ETICHETTA_CONTRARIA[c]).join(", "),
    };
  }
  if (contraddizioni.includes("cognome_nome") && !fiscaleConferma) {
    return {
      escluso: false,
      incerto: true,
      dubbio: ETICHETTA_CONTRARIA.cognome_nome,
    };
  }
  if (punteggio(segnali) < FORZA_MINIMA_AUTOMATICA) {
    return {
      escluso: false,
      incerto: true,
      dubbio: `solo ${segnali.map(s => ETICHETTA[s]).join(", ")}`,
    };
  }
  return { escluso: false, incerto: false, dubbio: null };
}

/**
 * Trova la commessa di una fattura.
 *
 * Un solo segnale basta per allegare — è la regola voluta — purché nulla la
 * contraddica e valga almeno `FORZA_MINIMA_AUTOMATICA`. I freni sono tre:
 * la contraddizione (commessa scartata), l'incertezza (candidata, non
 * collegata) e la parità fra due commesse (`ambiguo`). In tutti e tre i casi
 * si restituisce `commessaId: null` con i candidati e il motivo scritto:
 * scegliere a caso fra due clienti significa attribuire i soldi di uno
 * all'altro.
 */
export function trovaCommessaPerFattura(input: {
  fattura: FatturaPerMatch;
  commesse: readonly CommessaPerMatch[];
  clienti: readonly ClientePerMatch[];
}): EsitoMatchFattura {
  const { fattura, commesse } = input;
  const clientiPerId = new Map(input.clienti.map(c => [c.id, c]));
  const codiceCitato = estraiCodiceCommessa(
    `${fattura.descrizione ?? ""} ${fattura.numero}`
  );

  const candidati: CandidatoMatch[] = [];
  const esclusi: CandidatoMatch[] = [];
  for (const commessa of commesse) {
    const cliente =
      commessa.clienteId != null
        ? clientiPerId.get(commessa.clienteId) ?? null
        : null;
    const segnali = segnaliPerCommessa(fattura, commessa, cliente, codiceCitato);
    if (segnali.length === 0) continue;
    const contraddizioni = contraddizioniPerCommessa(fattura, commessa, cliente);
    const giudizio = valuta(segnali, contraddizioni);
    const candidato: CandidatoMatch = {
      commessaId: commessa.id,
      codice: commessa.codice,
      punteggio: punteggio(segnali),
      segnali,
      contraddizioni,
      incerto: giudizio.incerto,
      dubbio: giudizio.dubbio,
    };
    if (giudizio.escluso) esclusi.push(candidato);
    else candidati.push(candidato);
  }

  if (candidati.length === 0) {
    // Una commessa scartata per contraddizione non è "nessuna traccia": è una
    // pista sbagliata, e dirlo evita che l'operatore la rifaccia a mano.
    if (esclusi.length > 0) {
      const scartata = esclusi[0];
      return {
        commessaId: null,
        segnali: [],
        motivo: `Scartata ${scartata.codice}: combacia su ${scartata.segnali
          .map(segnale => ETICHETTA[segnale])
          .join(", ")} ma ${scartata.dubbio}. Se la fattura è di un cliente nuovo, va creata la commessa.`,
        candidati: [],
        ambiguo: false,
        incerto: false,
      };
    }
    return {
      commessaId: null,
      segnali: [],
      motivo:
        "Nessuna commessa condivide telefono, email, nome, indirizzo o identità fiscale con questa fattura.",
      candidati: [],
      ambiguo: false,
      incerto: false,
    };
  }

  candidati.sort(
    (a, b) => b.punteggio - a.punteggio || a.commessaId - b.commessaId
  );
  const migliore = candidati[0];
  const pari = candidati.filter(c => c.punteggio === migliore.punteggio);

  if (pari.length > 1) {
    return {
      commessaId: null,
      segnali: migliore.segnali,
      motivo: `Più commesse combaciano con la stessa forza (${pari
        .map(c => c.codice)
        .join(", ")}): serve una scelta.`,
      candidati,
      ambiguo: true,
      incerto: true,
    };
  }

  if (migliore.incerto) {
    return {
      commessaId: null,
      segnali: migliore.segnali,
      motivo: `${migliore.codice} è possibile ma non certa: ${migliore.dubbio}. Serve una conferma, oppure la fattura è di una commessa che non esiste ancora.`,
      candidati,
      ambiguo: false,
      incerto: true,
    };
  }

  return {
    commessaId: migliore.commessaId,
    segnali: migliore.segnali,
    motivo: `Corrispondenza su ${migliore.segnali
      .map(segnale => ETICHETTA[segnale])
      .join(", ")} con ${migliore.codice}.`,
    candidati,
    ambiguo: false,
    incerto: false,
  };
}
