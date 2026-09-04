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
  /**
   * Parole che NON valgono come indirizzo del cantiere: la via dell'azienda
   * stessa, che compare come destinatario in ogni conferma (04/09/2026:
   * «Via Crispi, La Spezia» faceva riscontrare quattro commesse a ogni PDF).
   */
  paroleEscluse?: readonly string[];
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

/**
 * Parole di via troppo comuni per identificare un cantiere: articoli,
 * nomi propri da toponomastica, aggettivi. «Via della Chiesa», «Via
 * Francesco Crispi», «Piano di Sopra» non si distinguono da un altro
 * indirizzo per queste parole.
 */
const PAROLE_DI_VIA_COMUNI = new Set([
  "della", "delle", "dello", "degli", "dell", "piano", "colli", "colle", "monte",
  "monti", "santa", "santo", "sant", "francesco", "giuseppe", "giovanni", "vittorio",
  "emanuele", "giacomo", "antonio", "carlo", "pietro", "paolo", "maria", "luigi",
  "umberto", "matteotti", "roma", "italia", "europa", "nuova", "nuovo", "vecchia",
  "vecchio", "sopra", "sotto", "case", "casa", "mare", "porto", "stazione", "centro",
  "nazionale", "provinciale", "comunale", "aurelia", "circonvallazione", "lungomare",
  "chiesa", "libertà", "liberta", "repubblica", "indipendenza", "unità", "unita",
  "marconi", "garibaldi", "mazzini", "cavour", "dante", "verdi", "manzoni",
]);

/** «Via», «Piazza», «Loc.»: dopo una di queste parole c'è il nome della strada. */
const MARCATORE_STRADA =
  /(?:^|[^a-z0-9])(?:via|viale|piazza|piazzale|corso|largo|vicolo|vico|salita|traversa|strada|loc|localita|frazione|borgata|lungomare)\s+/g;

function normalizza(testo: string): string {
  return senzaAccenti(String(testo ?? ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Un numero di sei o otto cifre che legge come una data (31/07/26 →
 * «310726», 01/09/2026 → «01092026») non è un numero d'ordine: le date di
 * documento coincidono fra documenti diversi e facevano riscontrare
 * commesse sbagliate (04/09/2026, Ferramenta Fivizzanese).
 */
export function sembraData(riferimento: string): boolean {
  const cifre = riferimento.replace(/\D/g, "");
  if (cifre !== riferimento) return false;
  const leggi = (gg: string, mm: string) => {
    const g = Number(gg);
    const m = Number(mm);
    return g >= 1 && g <= 31 && m >= 1 && m <= 12;
  };
  if (cifre.length === 6) {
    return leggi(cifre.slice(0, 2), cifre.slice(2, 4)) || leggi(cifre.slice(4, 6), cifre.slice(2, 4));
  }
  if (cifre.length === 8) {
    const anno = Number(cifre.slice(4, 8));
    const annoPrima = Number(cifre.slice(0, 4));
    return (
      (anno >= 1990 && anno <= 2099 && leggi(cifre.slice(0, 2), cifre.slice(2, 4))) ||
      (annoPrima >= 1990 && annoPrima <= 2099 && leggi(cifre.slice(6, 8), cifre.slice(4, 6)))
    );
  }
  return false;
}

/** Le parole (normalizzate) che seguono un marcatore di strada nel testo. */
function paroleDopoMarcatoreStrada(corpo: string): Set<string> {
  const trovate = new Set<string>();
  MARCATORE_STRADA.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARCATORE_STRADA.exec(corpo)) != null) {
    const dopo = corpo.slice(m.index + m[0].length, m.index + m[0].length + 40);
    for (const parola of dopo.split(" ").slice(0, 4)) {
      if (parola) trovate.add(parola);
    }
  }
  return trovate;
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

  // L'indirizzo del cantiere: una parola DISTINTIVA della via (almeno
  // cinque lettere, non un articolo né un nome da toponomastica, non la via
  // dell'azienda) che compare nel testo subito dopo «via», «piazza», «loc.».
  // La città da sola non prova niente (è quella di tutti), e «della» o
  // «piano» nemmeno: prima del 04/09 «Via della Chiesa, La Spezia» era un
  // riscontro per ogni conferma che citava l'azienda.
  const escluse = new Set((riferimenti.paroleEscluse ?? []).map(p => normalizza(p)));
  const viaParole = paroleUtili(riferimenti.indirizzo, 5).filter(
    p => !PAROLE_DI_VIA_COMUNI.has(p) && !escluse.has(p)
  );
  const cittaParole = paroleUtili(riferimenti.citta, 4);
  const dopoStrada = paroleDopoMarcatoreStrada(corpo);
  const viaTrovate = viaParole.filter(p => dopoStrada.has(p) || [...dopoStrada].some(d => d.length >= 5 && quasiUguali(d, p)));
  const cittaTrovata = cittaParole.some(p => contieneParola(corpo, p));
  if (viaTrovate.length >= 1) {
    prove.push(`indirizzo ${viaTrovate.join(" ")}${cittaTrovata ? ` ${cittaParole[0]}` : ""}`);
  }

  // Un riferimento d'ordine che la commessa conosce già (mai una data).
  const compatto = corpo.replace(/ /g, "");
  for (const rif of riferimenti.riferimentiOrdine ?? []) {
    const norm = normalizza(rif).replace(/ /g, "");
    if (norm.length >= 4 && !sembraData(norm) && compatto.includes(norm)) {
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
  // Una data nel nome del file («_310726», «03-08-2026-152737») non è un
  // numero d'ordine.
  for (const m of input.nomeFile.matchAll(/\d{5,}/g)) {
    if (!sembraData(m[0])) riferimenti.add(m[0]);
  }
  for (const valore of [input.riferimentoOrdine, input.numeroConferma]) {
    const norm = normalizza(valore ?? "").replace(/ /g, "");
    // Un numero nudo corto non identifica un ordine: il CAP «19124» letto
    // come numero di conferma faceva di due ordini Brianzatende un duplicato
    // (04/09/2026). Con lettere («cv003746») bastano quattro caratteri.
    if (norm.length < 4) continue;
    if (/^\d+$/.test(norm) && norm.length < 6) continue;
    if (sembraData(norm)) continue;
    riferimenti.add(norm);
  }
  return [...riferimenti];
}

/** Due documenti parlano dello stesso ordine se condividono un riferimento. */
export function stessoOrdine(a: readonly string[], b: readonly string[]): string | null {
  const insieme = new Set(a.map(x => x.toLowerCase()));
  for (const rif of b) if (insieme.has(rif.toLowerCase())) return rif;
  return null;
}
