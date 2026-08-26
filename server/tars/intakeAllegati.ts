// Pre-analisi degli allegati in arrivo.
//
// "misure Rossi.pdf" dice già due cose: che tipo di documento è, e di chi.
// Farlo capire a un modello costa un giro di strumenti e qualche migliaio di
// token; farlo qui costa una regex e non sbaglia. Quando il nome parla, Tars
// riceve la lettura già fatta e deve solo verificarla.
//
// Quando NON parla — "IMG_4821.jpg", "scan0003.pdf", "documento.pdf" — la
// pre-analisi lo dichiara esplicitamente: è il segnale che il contenuto va
// aperto con `leggi_allegato` invece di essere indovinato dal nome.
//
// Nome file e oggetto restano dati esterni non fidati: qui si estraggono
// indizi, non si decide niente. La decisione resta la proposta, che passa
// dalla verifica con i registri interni.

import { DOC_TIPI, type DocTipo } from "../routers/preventiviContratti";

/** Parole che denunciano il tipo di documento, in ordine di specificità. */
const PAROLE_TIPO: Array<{ tipo: DocTipo; parole: string[] }> = [
  { tipo: "conferma_ordine", parole: ["conferma ordine", "conferma d ordine", "ordine confermato"] },
  { tipo: "ddt_posa", parole: ["ddt posa", "ddt di posa", "bolla posa"] },
  { tipo: "ddt_finale", parole: ["ddt finale", "ddt fine lavori"] },
  { tipo: "ddt_consegna", parole: ["ddt", "ddt consegna", "bolla", "bolla di consegna", "documento di trasporto"] },
  { tipo: "misure", parole: ["misure", "misura", "rilievo", "misure esecutive", "quotature", "quote"] },
  { tipo: "preventivo", parole: ["preventivo", "offerta", "quotazione", "stima"] },
  { tipo: "contratto", parole: ["contratto", "capitolato", "accordo", "scrittura privata"] },
  { tipo: "fattura", parole: ["fattura", "ft", "nota di credito", "fattura proforma", "proforma"] },
  { tipo: "saldo", parole: ["saldo", "ricevuta", "quietanza", "pagamento saldo"] },
  { tipo: "ordine", parole: ["ordine", "rda", "richiesta di acquisto"] },
  { tipo: "documento_identita", parole: ["carta d identita", "carta identita", "documento identita", "patente", "passaporto", "codice fiscale", "tessera sanitaria", "doc identita"] },
  { tipo: "visura", parole: ["visura", "camerale", "visura catastale"] },
  { tipo: "planimetria", parole: ["planimetria", "pianta", "prospetto", "sezione", "disegno tecnico", "dwg"] },
  { tipo: "certificazione", parole: ["certificazione", "certificato", "dichiarazione di conformita", "conformita", "ce", "ape", "attestato"] },
  { tipo: "foto", parole: ["foto", "immagine", "cantiere", "fotografie"] },
];

/** Nomi che non dicono niente: la macchina fotografica, lo scanner, il fax. */
const NOMI_MUTI = [
  /^img[\s_-]?\d+$/,
  /^dsc[\s_-]?\d+$/,
  /^photo[\s_-]?\d*$/,
  /^foto[\s_-]?\d+$/,
  /^image[\s_-]?\d*$/,
  /^scan[\s_-]?\d*$/,
  /^scansione[\s_-]?\d*$/,
  /^documento[\s_-]?\d*$/,
  /^doc[\s_-]?\d*$/,
  /^file[\s_-]?\d*$/,
  /^allegato[\s_-]?\d*$/,
  /^whatsapp (image|video|document)/,
  /^\d{6,}$/,
  /^[0-9a-f-]{20,}$/,
];

// Parole che non sono mai un nome di cliente: tipi documento, mesi, formati.
const PAROLE_NON_NOME = new Set([
  ...PAROLE_TIPO.flatMap(voce => voce.parole.flatMap(p => p.split(" "))),
  "pdf", "jpg", "jpeg", "png", "heic", "doc", "docx", "xls", "xlsx", "dwg",
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio",
  "agosto", "settembre", "ottobre", "novembre", "dicembre",
  "def", "definitivo", "finale", "rev", "revisione", "copia", "nuovo", "nuova",
  "signor", "signora", "sig", "sig.ra", "ditta", "spett", "spettabile",
  "per", "del", "della", "di", "da", "il", "la", "lo", "in", "con", "su",
  "cliente", "commessa", "cantiere", "lavori", "casa", "villa", "appartamento",
]);

const CODICE_RE = /\bCOM[\s\-–_]?(\d{4})[\s\-–_]?(\d{1,4})\b/i;

function normalizza(valore: unknown): string {
  return String(valore ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[._\-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function senzaEstensione(nome: string): string {
  const punto = nome.lastIndexOf(".");
  return punto > 0 ? nome.slice(0, punto) : nome;
}

export type AnalisiAllegato = {
  nome: string;
  /** Tipo dedotto dal nome o dall'oggetto; null quando il nome non parla. */
  tipo: DocTipo | null;
  /** Parole del nome che sembrano un cognome o una ragione sociale. */
  nomiCandidati: string[];
  /** Codice commessa citato esplicitamente in nome od oggetto. */
  codiceCommessa: string | null;
  /**
   * Il nome non porta informazione: va aperto il contenuto. È il segnale che
   * distingue "non lo so ancora" da "non c'è niente da sapere".
   */
  richiedeLettura: boolean;
  /** Riga leggibile per il prompt e per l'operatore. */
  descrizione: string;
};

function tipoDaTesto(testo: string): DocTipo | null {
  for (const voce of PAROLE_TIPO) {
    for (const parola of voce.parole) {
      // Confine di parola su entrambi i lati: "ordine" non deve scattare
      // dentro "straordinario", né "ft" dentro "soft".
      const regex = new RegExp(`(^| )${parola.replace(/ /g, " ")}( |$)`);
      if (regex.test(testo)) return voce.tipo;
    }
  }
  return null;
}

function estraiNomi(testo: string): string[] {
  return Array.from(
    new Set(
      testo
        .split(" ")
        .filter(
          parola =>
            parola.length >= 3 &&
            !PAROLE_NON_NOME.has(parola) &&
            !/^\d+$/.test(parola)
        )
    )
  ).slice(0, 4);
}

function codiceCommessa(testo: string): string | null {
  const trovato = CODICE_RE.exec(testo);
  return trovato
    ? `COM-${trovato[1]}-${trovato[2].padStart(3, "0")}`
    : null;
}

/**
 * Legge un allegato dal solo nome (più l'oggetto della comunicazione, che
 * spesso porta il nome del cliente quando il file no).
 */
export function analizzaAllegato(input: {
  nome: string;
  oggetto?: string | null;
}): AnalisiAllegato {
  const gambo = normalizza(senzaEstensione(input.nome));
  const oggetto = normalizza(input.oggetto);
  const insieme = [gambo, oggetto].filter(Boolean).join(" ");

  const muto = gambo === "" || NOMI_MUTI.some(regex => regex.test(gambo));
  // Da un nome muto non si estrae il tipo: le sue stesse parole sono
  // rumore ("img", "scan", "doc") e leggerle come tipo produrrebbe una
  // classificazione inventata. Parla l'oggetto, o si apre il file.
  const tipo = muto
    ? tipoDaTesto(oggetto)
    : (tipoDaTesto(gambo) ?? tipoDaTesto(oggetto));
  const nomiCandidati = estraiNomi(muto ? oggetto : insieme);
  const codice = codiceCommessa(`${input.nome} ${input.oggetto ?? ""}`);

  // Serve leggere il contenuto quando il nome non parla E nemmeno l'oggetto
  // ha colmato il vuoto: senza tipo o senza un riferimento a chi riguarda,
  // qualunque proposta sarebbe un'ipotesi.
  const richiedeLettura =
    codice == null && (tipo == null || nomiCandidati.length === 0);

  const parti: string[] = [];
  if (tipo) parti.push(`tipo probabile "${tipo}"`);
  if (codice) parti.push(`codice ${codice}`);
  if (nomiCandidati.length > 0) {
    parti.push(`riferimento a ${nomiCandidati.join(" / ")}`);
  }
  if (muto) parti.push("nome file non parlante");
  const descrizione = parti.length
    ? parti.join(", ")
    : "nessun indizio nel nome";

  return {
    nome: input.nome,
    tipo,
    nomiCandidati,
    codiceCommessa: codice,
    richiedeLettura,
    descrizione: richiedeLettura
      ? `${descrizione} → apri il file con leggi_allegato`
      : descrizione,
  };
}

/** Pre-analisi di tutti gli allegati di una comunicazione, per il prompt. */
export function analizzaAllegatiComunicazione(input: {
  allegati: ReadonlyArray<{ nome: string }>;
  oggetto?: string | null;
}): AnalisiAllegato[] {
  return input.allegati.map(allegato =>
    analizzaAllegato({ nome: allegato.nome, oggetto: input.oggetto })
  );
}

/** Riga compatta da mettere nel blocco `<comunicazione>` dello smistamento. */
export function rigaAllegatiPerPrompt(analisi: readonly AnalisiAllegato[]): string {
  if (analisi.length === 0) return "nessuno";
  return analisi
    .map((a, i) => `[${i}] ${a.nome} — ${a.descrizione}`)
    .join("; ");
}

/** Guardia: i tipi noti restano allineati all'enum dei documenti. */
export function tipiRiconoscibili(): DocTipo[] {
  return PAROLE_TIPO.map(voce => voce.tipo).filter(tipo =>
    (DOC_TIPI as readonly string[]).includes(tipo)
  );
}
