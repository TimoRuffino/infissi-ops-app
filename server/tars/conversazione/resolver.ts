import { getCommesseStore } from "../../routers/commesse";
import { estraiCodiceCommessa } from "../../comunicazioni/match";
import type {
  CandidatoResolverCommessa,
  EsitoResolverCommessa,
} from "./types";
import { domandaChiarificazioneCommessa } from "./types";

const STOPWORD = new Set([
  "agisci", "alla", "alle", "anche", "caso", "commessa", "commesse",
  "controlla", "cosa", "della", "delle", "dello", "dimmi", "documenti",
  "eval", "fare", "fatto", "lavora", "manca", "parliamo", "per", "posso",
  "proposta", "prova", "puoi", "questa", "questo", "sulla", "sulle",
  "verifica", "srl", "spa", "sapa", "sas", "snc", "societa", "azienda",
  "ditta", "gruppo", "cooperativa",
]);

function normalizza(valore: unknown): string {
  return String(valore ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenSignificativi(riferimento: string): string[] {
  return normalizza(riferimento)
    .split(" ")
    .filter(token => token.length >= 3 && !STOPWORD.has(token));
}

function candidato(commessa: any, riferimento: string): CandidatoResolverCommessa | null {
  const ref = normalizza(riferimento);
  const codice = normalizza(commessa.codice);
  const cliente = normalizza(commessa.cliente);
  const indirizzo = normalizza(`${commessa.indirizzo ?? ""} ${commessa.citta ?? ""}`);
  const email = normalizza(commessa.email);
  const telefono = normalizza(commessa.telefono);
  const evidenze: string[] = [];
  let punteggio = 0;

  if (ref === codice) {
    punteggio += 1_000;
    evidenze.push("codice esatto");
  } else if (ref.includes(codice) && codice.length >= 5) {
    punteggio += 900;
    evidenze.push("codice citato");
  }

  const token = tokenSignificativi(riferimento);
  const paroleCliente = cliente.split(" ").filter(Boolean);
  const paroleIndirizzo = indirizzo.split(" ").filter(Boolean);
  const paroleEmail = email.split(" ").filter(Boolean);
  const paroleTelefono = telefono.split(" ").filter(Boolean);
  for (const parola of token) {
    if (paroleCliente.includes(parola)) {
      punteggio += 120;
      evidenze.push(`cliente: ${parola}`);
    } else if (
      parola.length >= 4 &&
      paroleCliente.some(voce => voce.startsWith(parola))
    ) {
      punteggio += 80;
      evidenze.push(`cliente parziale: ${parola}`);
    }
    if (paroleIndirizzo.includes(parola)) {
      punteggio += 30;
      evidenze.push(`indirizzo: ${parola}`);
    }
    if (paroleEmail.includes(parola) || paroleTelefono.includes(parola)) {
      punteggio += 60;
      evidenze.push(`contatto: ${parola}`);
    }
  }
  if (punteggio < 80) return null;
  return {
    commessaId: Number(commessa.id),
    codice: String(commessa.codice ?? `#${commessa.id}`),
    cliente: String(commessa.cliente ?? "Cliente non indicato"),
    punteggio,
    evidenze: [...new Set(evidenze)],
  };
}

/** Matching puro e sede-scoped. Non legge capability e non autorizza azioni. */
export function risolviCommessa(input: {
  sedeId: number;
  riferimento: string;
}): EsitoResolverCommessa {
  const riferimento = input.riferimento.trim();
  if (!riferimento) return { stato: "non_trovato", candidati: [] };

  const codiceEsplicito = estraiCodiceCommessa(riferimento);
  const base = (getCommesseStore() as any[]).filter(
    c => c.sedeId === input.sedeId && !c.archivedAt
  );
  const candidati = base
    .map(c => candidato(c, codiceEsplicito ?? riferimento))
    .filter((c): c is CandidatoResolverCommessa => c != null)
    .sort((a, b) => b.punteggio - a.punteggio || a.codice.localeCompare(b.codice));

  if (candidati.length === 0) return { stato: "non_trovato", candidati: [] };
  const primo = candidati[0];
  const secondo = candidati[1];
  if (!secondo || primo.punteggio >= 900 || primo.punteggio - secondo.punteggio >= 100) {
    return { stato: "unico", candidato: primo };
  }
  const plausibili = candidati.filter(c => primo.punteggio - c.punteggio < 100);
  return {
    stato: "ambiguo",
    candidati: plausibili,
    domanda: domandaChiarificazioneCommessa(plausibili),
  };
}
