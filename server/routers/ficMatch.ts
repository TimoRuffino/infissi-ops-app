// Aggancio fattura FiC → commessa.
//
// La regola operativa è quella dettata dalla direzione: se anche UNO SOLO
// fra telefono, nome, cognome, indirizzo o email della fattura coincide con
// la commessa, la fattura le va allegata. Deterministico e spiegabile, come
// `tars/match.ts` per le comunicazioni: nessun modello qui dentro.
//
// L'unico caso in cui non si decide è la parità: due o più commesse che
// combaciano con la stessa forza. Lì non si indovina — la fattura resta in
// coda e Tars (o l'operatore) sceglie. Scegliere a caso fra due clienti
// omonimi significa attribuire i soldi di uno all'altro.

import { stessoNumero } from "@shared/telefono";

export type SegnaleMatch =
  | "codice_commessa"
  | "identita_fiscale"
  | "email"
  | "telefono"
  | "cognome_nome"
  | "indirizzo";

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

const ETICHETTA: Record<SegnaleMatch, string> = {
  codice_commessa: "codice commessa citato nella fattura",
  identita_fiscale: "partita IVA o codice fiscale",
  email: "email",
  telefono: "telefono",
  cognome_nome: "nome e cognome",
  indirizzo: "indirizzo",
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
};

export type EsitoMatchFattura = {
  commessaId: number | null;
  segnali: SegnaleMatch[];
  motivo: string;
  candidati: CandidatoMatch[];
  ambiguo: boolean;
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
    const nomiCrm = [
      chiaveNome(commessa.cliente),
      cliente ? chiaveNome(`${cliente.cognome ?? ""} ${cliente.nome ?? ""}`) : "",
    ];
    if (nomiCrm.some(valore => valore && valore === nomeFattura)) {
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

function punteggio(segnali: readonly SegnaleMatch[]): number {
  return segnali.reduce((somma, segnale) => somma + PESO[segnale], 0);
}

/**
 * Trova la commessa di una fattura.
 *
 * Un solo segnale basta per allegare — è la regola voluta. Il freno è
 * l'ambiguità: se due commesse raccolgono lo stesso punteggio massimo, si
 * restituisce `commessaId: null` con entrambe fra i candidati.
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
  for (const commessa of commesse) {
    const cliente =
      commessa.clienteId != null
        ? clientiPerId.get(commessa.clienteId) ?? null
        : null;
    const segnali = segnaliPerCommessa(fattura, commessa, cliente, codiceCitato);
    if (segnali.length === 0) continue;
    candidati.push({
      commessaId: commessa.id,
      codice: commessa.codice,
      punteggio: punteggio(segnali),
      segnali,
    });
  }

  if (candidati.length === 0) {
    return {
      commessaId: null,
      segnali: [],
      motivo:
        "Nessuna commessa condivide telefono, email, nome, indirizzo o identità fiscale con questa fattura.",
      candidati: [],
      ambiguo: false,
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
  };
}
