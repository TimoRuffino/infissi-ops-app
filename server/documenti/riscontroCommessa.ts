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
  /** Il cognome dall'anagrafica cliente, quando c'è: è la parola che identifica. */
  cognome?: string | null;
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
  // Località, enti e parole di ragione sociale che stanno nel nome di molti
  // clienti («Comune della Spezia», «Marina di Lerici», «Hotel Riviera») e in
  // ogni conferma (04/09/2026: «spezia» faceva riscontrare tre enti a ogni
  // PDF). Da sole non identificano nessuno.
  "spezia", "sarzana", "lerici", "genova", "massa", "carrara", "lucca", "pisa", "livorno",
  "liguria", "toscana", "italia", "levante", "riviera", "marina", "porto", "centro",
  "comune", "provincia", "regione", "stato", "polizia", "scuola", "istituto", "ospedale",
  "parrocchia", "hotel", "albergo", "ristorante", "bar", "residence", "residenza",
  // Articoli e preposizioni lunghi abbastanza da passare il filtro («Case
  // delle Rose» → «delle» non è nessuno).
  "delle", "della", "dello", "degli", "dell", "sulla", "sulle", "nella", "nelle",
]);

/**
 * Cognomi fra i più diffusi: da soli sono di tutti (un agente, un tecnico
 * del fornitore); valgono con il nome accanto sulla stessa riga.
 */
const COGNOMI_DIFFUSI = new Set([
  "rossi", "russo", "ferrari", "esposito", "bianchi", "romano", "colombo", "ricci",
  "marino", "greco", "bruno", "gallo", "conti", "costa", "mancini", "rizzo", "lombardi",
  "moretti", "barbieri", "fontana", "santoro", "mariani", "rinaldi", "caruso", "ferrara",
  "galli", "martini", "leone", "longo", "gentile", "martinelli", "vitale", "lombardo",
  "serra", "coppola", "desantis", "marchetti", "parisi", "villa", "conte", "ferraro",
  "ferri", "fabbri", "bianco", "marini", "grasso", "valentini", "messina", "sala",
  "deangelis", "gatti", "pellegrini", "palumbo", "sanna", "farina", "rizzi", "monti",
  "cattaneo", "morelli", "amato", "silvestri", "mazza", "testa", "grassi", "pellegrino",
  "carbone", "giuliani", "benedetti", "barone", "rossetti", "caputo", "montanari",
  "guerra", "palmieri", "bernardi", "martino", "fiore", "derosa", "ferretti", "bellini",
  "basile", "riva", "donati", "piras", "vitali", "battaglia", "sartori", "neri",
  "costantini", "milani", "pagano", "ruggiero", "sorrentino", "damico", "orlando",
  "damico", "negri", "sorrentino", "ruffino",
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

/**
 * Nomi propri comuni: da soli non identificano un cliente. «Via Francesco
 * Crispi» (l'indirizzo dell'azienda) faceva riscontrare ogni cliente di nome
 * Francesco, e «Stefano» + «Angelo» sparsi in un ordine Pail passavano per
 * il cliente «Stefano Angelo» (04/09/2026). Un nome proprio conta solo
 * accanto al cognome.
 */
const NOMI_PROPRI_COMUNI = new Set([
  "alessandro", "alessandra", "alessia", "alessio", "alberto", "andrea", "angela", "angelo",
  "anna", "annamaria", "antonella", "antonio", "barbara", "beatrice", "bruno", "carla",
  "carlo", "carmela", "carmine", "caterina", "chiara", "claudia", "claudio", "cristina",
  "cristian", "cristiano", "daniela", "daniele", "dario", "davide", "debora", "diego",
  "domenico", "donatella", "elena", "eleonora", "elisa", "elisabetta", "emanuela", "emanuele",
  "emilio", "enrico", "enzo", "ermanno", "ettore", "fabio", "fabrizio", "federica", "federico",
  "filippo", "fiorella", "flavio", "franca", "francesca", "francesco", "franco", "gabriele",
  "gabriella", "gaetano", "gianluca", "gianni", "giacomo", "giada", "gianfranco", "gianpaolo",
  "gigi", "giorgia", "giorgio", "giovanna", "giovanni", "giulia", "giuliana", "giuliano",
  "giulio", "giuseppe", "giuseppina", "graziella", "guido", "ilaria", "irene", "isabella",
  "ivan", "ivano", "jacopo", "laura", "leonardo", "letizia", "lidia", "liliana", "lorenza",
  "lorenzo", "luca", "lucia", "luciana", "luciano", "lucio", "luigi", "luisa", "manuela",
  "marcello", "marco", "margherita", "maria", "marina", "mario", "marta", "martina",
  "massimiliano", "massimo", "matteo", "maurizio", "mauro", "michela", "michele", "milena",
  "mirko", "monica", "nadia", "nicola", "nicoletta", "nicolò", "nicolo", "orlando", "paola",
  "paolo", "patrizia", "patrizio", "piero", "pietro", "raffaele", "raffaella", "renato",
  "riccardo", "rita", "roberta", "roberto", "rocco", "romina", "rosa", "rosanna", "rosario",
  "rossana", "salvatore", "samuele", "sandra", "sandro", "sara", "sergio", "silvana", "silvia",
  "silvio", "simona", "simone", "sonia", "stefania", "stefano", "susanna", "teresa", "tiziana",
  "tiziano", "tommaso", "umberto", "valentina", "valeria", "valerio", "vanessa", "veronica",
  "vincenzo", "vittoria", "vittorio", "walter", "sergio", "elio", "ugo", "ida", "ada", "eva",
  "timothy", "timoteo", "giulietta", "mattia", "gioia", "greta", "aurora", "sofia", "noemi",
  "nicole", "erika", "erica", "denise", "jessica", "samantha", "morgan", "kevin", "manuel",
  "loris", "moreno", "omar", "italiana", "italiano",
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

/**
 * Tutte le parole del nome compaiono entro poche parole l'una dall'altra,
 * in qualunque ordine e anche con un refuso («GIACOMAZI GIULIA»).
 */
function paroleVicine(righe: readonly string[], parole: readonly string[]): boolean {
  // Sulla STESSA riga: «Agente: Stefano Bruni» e «Rif.: Angelo Pistone» su
  // due righe non sono il cliente «Stefano Angelo».
  const FINESTRA = 3;
  for (const riga of righe) {
    const paroleRiga = riga.split(" ");
    const posizioni = parole.map(p =>
      paroleRiga
        .map((w, i) => (w === p || (p.length >= 6 && w.length >= 5 && quasiUguali(w, p)) ? i : -1))
        .filter(i => i >= 0)
    );
    if (posizioni.some(lista => lista.length === 0)) continue;
    const vicine = posizioni[0].some(inizio =>
      posizioni.every(lista => lista.some(i => Math.abs(i - inizio) <= FINESTRA))
    );
    if (vicine) return true;
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
  const grezzo = Array.isArray(testo) ? testo.join("\n") : String(testo);
  const corpo = normalizza(grezzo);
  // Le righe originali, normalizzate una per una: il nome completo si cerca
  // dentro la riga, non attraverso il documento.
  const righeCorpo = grezzo
    .split(/\r?\n/)
    .map(r => normalizza(r))
    .filter(Boolean);
  const prove: string[] = [];
  if (!corpo) {
    return { ok: false, prove, motivo: "Nessun testo leggibile nel documento." };
  }

  if (riferimenti.codice && contieneCodice(corpo, riferimenti.codice)) {
    prove.push(`codice ${riferimenti.codice}`);
  }

  // Il cliente. Il nome COMPLETO vale quando le sue parole stanno vicine
  // nel testo («Vs. rif. GIACOMAZZI GIULIA», «Angelo Pistone»); da sola vale
  // la parola che identifica — il cognome dall'anagrafica, o una parola che
  // non sia un nome proprio né la via dell'azienda — se è lunga abbastanza
  // da non essere una via o una città («Roma»). Due nomi propri sparsi in
  // pagine diverse non sono nessuno.
  const escluseCliente = new Set((riferimenti.paroleEscluse ?? []).map(p => normalizza(p)));
  const parole = paroleUtili(riferimenti.cliente).filter(p => !escluseCliente.has(p));
  const cognomeAnagrafica = paroleUtili(riferimenti.cognome).filter(p => !escluseCliente.has(p));
  const identificanti = (cognomeAnagrafica.length > 0 ? cognomeAnagrafica : parole).filter(
    p => !NOMI_PROPRI_COMUNI.has(p) && !COGNOMI_DIFFUSI.has(p)
  );
  if (parole.length >= 2 && paroleVicine(righeCorpo, parole)) {
    prove.push(`cliente ${parole.join(" ")}`);
  } else {
    const trovata = identificanti.find(p => p.length >= 5 && contieneParola(corpo, p));
    if (trovata) {
      prove.push(`cliente ${trovata}`);
    } else {
      // Quasi uguale: un carattere di differenza sul cognome (OCR, refusi).
      const paroleTesto = new Set(corpo.split(" ").filter(p => p.length >= 5));
      const quasi = identificanti.find(p => contieneParolaQuasi(paroleTesto, p));
      if (quasi) prove.push(`cliente ~${quasi}`);
    }
  }

  // L'indirizzo del cantiere: una parola DISTINTIVA della via (almeno
  // cinque lettere, non un articolo né un nome da toponomastica, non la via
  // dell'azienda) che compare nel testo subito dopo «via», «piazza», «loc.».
  // La città da sola non prova niente (è quella di tutti), e «della» o
  // «piano» nemmeno: prima del 04/09 «Via della Chiesa, La Spezia» era un
  // riscontro per ogni conferma che citava l'azienda.
  const escluse = new Set((riferimenti.paroleEscluse ?? []).map(p => normalizza(p)));
  const viaParole = paroleUtili(riferimenti.indirizzo, 5).filter(
    p => !PAROLE_DI_VIA_COMUNI.has(p) && !NOMI_PROPRI_COMUNI.has(p) && !escluse.has(p)
  );
  // La città è solo di supporto (compare nella prova, non la decide): qui le
  // località non passano dallo stoplist.
  const cittaParole = normalizza(riferimenti.citta ?? "")
    .split(" ")
    .filter(p => p.length >= 4 && !/^\d+$/.test(p));
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

// ── Evidenze del riscontro (06/09/2026, anteprime «Dove l'ho letto») ──────
//
// Le prove sono parole («cliente giacomazzi giulia», «codice COM-2026-096»,
// «indirizzo crispi», «ordine 2634169»): qui si ritrovano nel testo della
// pagina, con la stessa normalizzazione del riscontro ma conservando la
// mappa verso i caratteri originali, così l'evidenza porta gli scarti veri.
// Best effort dichiarato: una prova che non si rilocalizza non produce
// un'evidenza, mai una posizione inventata.

export type EvidenzaRiscontro = {
  /** La prova come la scrive `riscontroCommessaNelTesto` («cliente rossi»). */
  prova: string;
  pagina: number; // 1-based
  frammento: string;
  posizione: { inizio: number; fine: number };
};

/**
 * Testo normalizzato come `normalizza` (senza accenti, minuscolo, ogni
 * sequenza non alfanumerica → uno spazio) e, per ogni suo carattere,
 * l'indice del carattere ORIGINALE da cui viene.
 */
function normalizzaConMappa(testo: string): { testo: string; mappa: number[] } {
  const caratteri: string[] = [];
  const mappa: number[] = [];
  let spazioPendente = false;
  for (let i = 0; i < testo.length; i += 1) {
    const normalizzato = senzaAccenti(testo[i]).replace(/[^a-z0-9]/g, "");
    if (normalizzato.length === 0) {
      spazioPendente = caratteri.length > 0;
      continue;
    }
    if (spazioPendente) {
      caratteri.push(" ");
      mappa.push(i);
      spazioPendente = false;
    }
    for (const c of normalizzato) {
      caratteri.push(c);
      mappa.push(i);
    }
  }
  return { testo: caratteri.join(""), mappa };
}

/** Prime parole (con inizio nel testo normalizzato) consecutive che combaciano con i token, anche con un refuso. */
function cercaParole(
  testoNorm: string,
  tokens: readonly string[],
  fuzzy: boolean,
  // Solo per cliente e indirizzo: una parola che identifica da sola (un
  // cognome). Mai per un codice, dove «2026» dentro una data non prova niente.
  parolaSola: boolean
): { inizio: number; fine: number } | null {
  const parole: Array<{ testo: string; inizio: number }> = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(testoNorm)) !== null) parole.push({ testo: m[0], inizio: m.index });
  const uguale = (a: string, b: string) =>
    a === b || (fuzzy && b.length >= 6 && a.length >= 5 && quasiUguali(a, b));
  // Prima tutti i token vicini (entro tre parole l'uno dall'altro, in ordine).
  for (let i = 0; i < parole.length; i += 1) {
    if (!uguale(parole[i].testo, tokens[0])) continue;
    let ultimo = i;
    let ok = true;
    for (let k = 1; k < tokens.length; k += 1) {
      const prossimo = parole
        .slice(ultimo + 1, ultimo + 4)
        .findIndex(p => uguale(p.testo, tokens[k]));
      if (prossimo < 0) {
        ok = false;
        break;
      }
      ultimo = ultimo + 1 + prossimo;
    }
    if (ok) {
      return { inizio: parole[i].inizio, fine: parole[ultimo].inizio + parole[ultimo].testo.length };
    }
  }
  // Poi la sola parola che identifica: la più lunga, senza cifre, almeno cinque lettere.
  if (!parolaSola) return null;
  const identificante = [...tokens]
    .filter(t => !/\d/.test(t) && t.length >= 5)
    .sort((a, b) => b.length - a.length)[0];
  if (!identificante) return null;
  const sola = parole.find(p => uguale(p.testo, identificante));
  return sola ? { inizio: sola.inizio, fine: sola.inizio + sola.testo.length } : null;
}

/** Il testo compatto (senza spazi) e la mappa verso il testo normalizzato. */
function cercaSenzaSpazi(
  testoNorm: string,
  compatto: string
): { inizio: number; fine: number } | null {
  const caratteri: string[] = [];
  const indici: number[] = [];
  for (let i = 0; i < testoNorm.length; i += 1) {
    if (testoNorm[i] === " ") continue;
    caratteri.push(testoNorm[i]);
    indici.push(i);
  }
  const posizione = caratteri.join("").indexOf(compatto);
  if (posizione < 0 || compatto.length === 0) return null;
  return { inizio: indici[posizione], fine: indici[posizione + compatto.length - 1] + 1 };
}

export function evidenzeDelRiscontro(
  pagine: readonly string[] | string,
  riscontro: Pick<RiscontroCommessa, "prove">
): EvidenzaRiscontro[] {
  const elenco = Array.isArray(pagine) ? pagine : [String(pagine)];
  const esiti: EvidenzaRiscontro[] = [];
  for (const prova of riscontro.prove) {
    const [tipo, ...resto] = prova.split(" ");
    const fuzzy = resto[0]?.startsWith("~") ?? false;
    const cercato = normalizza(resto.join(" ").replace(/~/g, ""));
    const tokens = cercato.split(" ").filter(Boolean);
    if (tokens.length === 0) continue;
    for (const [i, pagina] of elenco.entries()) {
      const { testo, mappa } = normalizzaConMappa(pagina);
      if (testo.length === 0) continue;
      const trovato =
        tipo === "ordine"
          ? cercaSenzaSpazi(testo, cercato.replace(/ /g, ""))
          : (cercaParole(testo, tokens, fuzzy, tipo !== "codice") ??
            (tipo === "codice" ? cercaSenzaSpazi(testo, cercato.replace(/ /g, "")) : null));
      if (!trovato) continue;
      const inizio = mappa[trovato.inizio];
      const fine = mappa[Math.max(trovato.inizio, trovato.fine - 1)] + 1;
      const frammento = pagina
        .slice(Math.max(0, inizio - 40), Math.min(pagina.length, fine + 40))
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160);
      esiti.push({ prova, pagina: i + 1, frammento, posizione: { inizio, fine } });
      break;
    }
  }
  return esiti;
}
