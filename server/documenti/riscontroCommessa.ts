// Il riscontro di una commessa DENTRO un documento (direzione 04/09/2026
// notte: «Tars oltre all'oggetto deve controllare sempre anche il
// riferimento all'interno della conf. ordine; alcune aziende potrebbero
// inviare più conf. ordine nella stessa mail con lo stesso oggetto»).
//
// Una conferma d'ordine entra in un fascicolo solo se il suo testo cita la
// commessa: il codice (COM-2026-096), il cliente («VS.RIFERIMENTO GIACOMAZZI
// GIUL» — anche troncato), l'indirizzo del cantiere, o un riferimento
// d'ordine che la commessa conosce già. Oggetto e mittente della mail non
// bastano. Deterministico e senza modello.

import { senzaAccenti } from "../_core/ricerca";

export type RiferimentiCommessa = {
  codice: string | null;
  cliente: string | null;
  indirizzo?: string | null;
  citta?: string | null;
  /** Numeri d'ordine già noti alla commessa (costi, magazzino, ordini fornitore, conferme). */
  riferimentiOrdine?: readonly string[];
};

export type RiscontroCommessa = {
  ok: boolean;
  /** Cosa è stato trovato, a parole («cliente: giacomazzi»). */
  prove: string[];
  motivo: string;
};

/** Parole che non identificano nessuno: ragioni sociali e titoli. */
const PAROLE_GENERICHE = new Set([
  "srl", "srls", "spa", "snc", "sas", "sapa", "scarl", "coop", "cooperativa", "societa",
  "ditta", "impresa", "azienda", "studio", "condominio", "cond", "amministrazione",
  "amministratore", "immobiliare", "costruzioni", "edile", "edilizia", "group", "gruppo",
  "holding", "italia", "sig", "sigra", "sigr", "signor", "signora", "geom", "geometra",
  "arch", "architetto", "ing", "ingegnere", "dott", "dottor", "avv", "rag", "prof",
  "eredi", "fratelli", "flli", "figli", "via", "viale", "piazza", "corso", "largo",
  "strada", "localita", "frazione", "snc", "cliente", "commessa", "lavori", "cantiere",
  "appartamento", "casa", "villa", "villetta", "nuovo", "nuova", "vecchio", "vecchia",
]);

function normalizza(testo: string): string {
  return senzaAccenti(String(testo ?? ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function paroleUtili(valore: string | null | undefined, minimo = 4): string[] {
  return normalizza(valore ?? "")
    .split(" ")
    .filter(p => p.length >= minimo && !PAROLE_GENERICHE.has(p) && !/^\d+$/.test(p));
}

function contieneParola(testo: string, parola: string): boolean {
  return new RegExp(`(?<![a-z0-9])${parola}(?![a-z0-9])`).test(testo);
}

/** Distanza di Levenshtein limitata a 1: basta sapere se è 0, 1 o di più. */
function quasiUguali(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let differenze = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    differenze += 1;
    if (differenze > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return differenze + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Il cognome del cliente anche con un carattere sbagliato: le scansioni
 * passano dall'OCR e i fornitori scrivono a mano («Rif. POCCJ» per Pocci).
 * Solo per nomi lunghi almeno sei lettere, dove un errore non crea equivoci.
 */
function contieneParolaQuasi(paroleTesto: ReadonlySet<string>, parola: string): boolean {
  if (parola.length < 6) return false;
  for (const candidata of paroleTesto) {
    if (candidata.length >= 5 && quasiUguali(candidata, parola)) return true;
  }
  return false;
}

/** «COM-2026-096» e il testo normalizzato «com 2026 096» si cercano in entrambe le forme. */
function contieneCodice(testo: string, codice: string): boolean {
  const norm = normalizza(codice);
  if (norm.length < 5) return false;
  return contieneParola(testo, norm) || testo.replace(/ /g, "").includes(norm.replace(/ /g, ""));
}

export function riscontroCommessaNelTesto(
  testo: string | readonly string[],
  riferimenti: RiferimentiCommessa
): RiscontroCommessa {
  const corpo = normalizza(Array.isArray(testo) ? testo.join("\n") : String(testo));
  const prove: string[] = [];
  if (!corpo) {
    return { ok: false, prove, motivo: "Nessun testo leggibile nel documento." };
  }

  if (riferimenti.codice && contieneCodice(corpo, riferimenti.codice)) {
    prove.push(`codice ${riferimenti.codice}`);
  }

  // Il cliente: basta il primo nome utile (il cognome, o la ragione sociale
  // vera) se è lungo abbastanza da non essere una via o una città («Roma»),
  // oppure due parole qualsiasi del nome.
  const parole = paroleUtili(riferimenti.cliente);
  const trovate = parole.filter(p => contieneParola(corpo, p));
  if (
    trovate.length > 0 &&
    ((trovate[0] === parole[0] && parole[0].length >= 5) || trovate.length >= 2)
  ) {
    prove.push(`cliente ${trovate.join(" ")}`);
  } else {
    // Quasi uguale: un carattere di differenza sul cognome (OCR, refusi).
    const paroleTesto = new Set(corpo.split(" ").filter(p => p.length >= 5));
    const quasi = parole.find(p => contieneParolaQuasi(paroleTesto, p));
    if (quasi) prove.push(`cliente ~${quasi}`);
  }

  // L'indirizzo del cantiere: via e città insieme, o due parole della via.
  const viaParole = paroleUtili(riferimenti.indirizzo, 4);
  const cittaParole = paroleUtili(riferimenti.citta, 4);
  const viaTrovate = viaParole.filter(p => contieneParola(corpo, p));
  const cittaTrovata = cittaParole.some(p => contieneParola(corpo, p));
  if (viaTrovate.length >= 2 || (viaTrovate.length >= 1 && cittaTrovata)) {
    prove.push(`indirizzo ${viaTrovate.join(" ")}${cittaTrovata ? ` ${cittaParole[0]}` : ""}`);
  }

  // Un riferimento d'ordine che la commessa conosce già.
  const compatto = corpo.replace(/ /g, "");
  for (const rif of riferimenti.riferimentiOrdine ?? []) {
    const norm = normalizza(rif).replace(/ /g, "");
    if (norm.length >= 4 && compatto.includes(norm)) {
      prove.push(`ordine ${rif}`);
      break;
    }
  }

  return prove.length > 0
    ? { ok: true, prove, motivo: `Il documento cita ${prove.join(", ")}.` }
    : {
        ok: false,
        prove,
        motivo:
          "Il documento non cita la commessa: né il codice, né il cliente, né l'indirizzo, né un ordine noto.",
      };
}

/**
 * I riferimenti d'ordine che un documento porta con sé: i numeri lunghi
 * nel nome del file («Ordini_di_Vendi_1602923(1).pdf» → 1602923, uguale
 * nelle tre copie inviate) e quelli letti nel testo. Servono a riconoscere
 * la stessa conferma inviata più volte.
 */
export function riferimentiOrdineDocumento(input: {
  nomeFile: string;
  riferimentoOrdine?: string | null;
  numeroConferma?: string | null;
}): string[] {
  const riferimenti = new Set<string>();
  for (const m of input.nomeFile.matchAll(/\d{5,}/g)) riferimenti.add(m[0]);
  for (const valore of [input.riferimentoOrdine, input.numeroConferma]) {
    const norm = normalizza(valore ?? "").replace(/ /g, "");
    if (norm.length >= 4) riferimenti.add(norm);
  }
  return [...riferimenti];
}

/** Due documenti parlano dello stesso ordine se condividono un riferimento. */
export function stessoOrdine(a: readonly string[], b: readonly string[]): string | null {
  const insieme = new Set(a.map(x => x.toLowerCase()));
  for (const rif of b) if (insieme.has(rif.toLowerCase())) return rif;
  return null;
}
