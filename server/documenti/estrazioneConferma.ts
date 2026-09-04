// Estrattore deterministico delle conferme d'ordine fornitore (D7, slice 1).
//
// Funzione pura: pagine di testo + contesto CRM (ordine, fornitore, codici
// noti) → campi tipizzati, ognuno con la sua EVIDENZA: pagina, frammento,
// metodo, confidenza. Un'informazione senza evidenza non esiste (PRD §54.6):
// i campi non trovati restano `null`, dichiarati, mai inventati.
//
// Nessun modello: solo riferimenti certi (codice ordine, codice commessa,
// codici articolo) e pattern espliciti (date, totali, numeri di conferma).
// Il testo resta un dato inerte: un "ignora le istruzioni" dentro il PDF è
// un frammento come un altro.

import { estraiCodiceCommessa } from "../routers/ficMatch";
import { celleDiRiga } from "./testoPdf";

// 1.1.0 (04/09/2026): righe a celle dalla geometria del PDF, imponibile per
// aritmetica dell'IVA, fornitore dall'intestazione senza scambiarlo con
// l'agente o la banca, «vs. riferimento» che non prende l'etichetta accanto.
export const ESTRATTORE_CONFERMA_VERSIONE = "1.1.0";

export type Evidenza = {
  pagina: number; // 1-based
  frammento: string;
  metodo: "riferimento_certo" | "pattern_testo";
  confidenza: "alta" | "media" | "bassa";
};

export type CampoEstratto<T> = {
  valore: T;
  evidenza: Evidenza;
  alternative?: Array<{ valore: T; evidenza: Evidenza }>;
};

export type RigaOrdinePerConfronto = {
  id: number;
  descrizione: string;
  codiceArticolo?: string | null;
  quantita: number;
};

export type ContestoEstrazione = {
  codiceOrdine: string | null;
  fornitoreNome: string | null;
  righeOrdine: readonly RigaOrdinePerConfronto[];
  /** Nomi da non scambiare per il fornitore nell'intestazione (default: la nostra azienda). */
  escludiNomi?: readonly string[];
};

export type RigaRiscontrata = {
  rigaOrdineId: number;
  codiceArticolo: string;
  trovata: boolean;
  quantitaDocumento: CampoEstratto<number> | null;
};

export type EstrazioneConferma = {
  riferimentoOrdine: CampoEstratto<string> | null;
  codiciCommessaCitati: Array<CampoEstratto<string>>;
  fornitoreCitato: CampoEstratto<string> | null;
  numeroConferma: CampoEstratto<string> | null;
  /**
   * Il NOSTRO riferimento come lo riporta il fornitore («VS.RIFERIMENTO
   * GIACOMAZZI GIUL»): è il nome del cliente o della commessa scritto da
   * noi nell'ordine, ed è il primo riscontro che una persona cerca.
   */
  riferimentoCliente?: CampoEstratto<string> | null;
  dataDocumento: CampoEstratto<string> | null; // ISO YYYY-MM-DD
  dateConsegna: Array<CampoEstratto<string>>; // ISO, in ordine di apparizione
  settimaneConsegna: Array<CampoEstratto<number>>; // settimana ISO dichiarata
  /**
   * Settimana di APPRONTAMENTO (Alias: «Approntamento [1] … 2026 Settimana
   * 21»): la merce è pronta dal fornitore, non consegnata. Direzione
   * 04/09/2026: «alcune aziende usano la settimana di approntamento».
   */
  settimaneApprontamento?: Array<CampoEstratto<number> & { anno: number | null }>;
  /** Totale del documento: di norma IVA INCLUSA. */
  totaleDocumento: CampoEstratto<number> | null;
  /**
   * Imponibile (IVA esclusa): è questo il costo che alimenta il margine
   * (direzione 03/09/2026: «imponibile fattura meno imponibile ordine
   * fornitore»). Letto da un'etichetta esplicita, oppure ricavato per
   * differenza quando il documento dichiara totale e IVA. Null quando il
   * documento non lo dice: non si scorpora un'aliquota indovinata.
   */
  imponibileDocumento: CampoEstratto<number> | null;
  righe: RigaRiscontrata[];
};

const LUNGHEZZA_FRAMMENTO = 160;

function frammentoIntorno(testo: string, indice: number, lunghezzaMatch: number): string {
  const inizio = Math.max(0, indice - 60);
  const fine = Math.min(testo.length, indice + lunghezzaMatch + 60);
  return testo
    .slice(inizio, fine)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LUNGHEZZA_FRAMMENTO);
}

function evidenza(
  pagine: readonly string[],
  pagina: number,
  indice: number,
  lunghezzaMatch: number,
  metodo: Evidenza["metodo"],
  confidenza: Evidenza["confidenza"]
): Evidenza {
  return {
    pagina: pagina + 1,
    frammento: frammentoIntorno(pagine[pagina], indice, lunghezzaMatch),
    metodo,
    confidenza,
  };
}

function normalizzaData(giorno: string, mese: string, anno: string): string | null {
  const g = Number(giorno);
  const m = Number(mese);
  let a = Number(anno);
  if (a < 100) a += 2000;
  if (!(g >= 1 && g <= 31) || !(m >= 1 && m <= 12) || a < 2000 || a > 2100) {
    return null;
  }
  // Validazione di CALENDARIO: un 31/02 (tipico errore OCR) non deve mai
  // diventare una data proposta e poi scritta sull'ordine (revisione).
  const prova = new Date(Date.UTC(a, m - 1, g));
  if (
    prova.getUTCFullYear() !== a ||
    prova.getUTCMonth() !== m - 1 ||
    prova.getUTCDate() !== g
  ) {
    return null;
  }
  return `${a}-${String(m).padStart(2, "0")}-${String(g).padStart(2, "0")}`;
}

// Né la testa né la coda sono `\b`: nei PDF a colonne l'etichetta si incolla
// alla data da entrambi i lati («23/02/2026del» Alias, «ARANCIONE20/04/26»
// BT Glass) e con `\b` la data spariva. Basta che non sia un pezzo di un
// numero o di un'altra data.
const DATA_RE = /(?<![\d\/.\-])(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?!\d)/g;

// ── Aritmetica dell'IVA ──────────────────────────────────────────────────
// Quando le etichette non aiutano (riquadro totali a colonne, OCR che le
// stacca dai numeri, layout mai visti), l'identità imponibile + IVA = totale
// con un'aliquota italiana è la prova più solida che un documento offra:
// 6.362,50 + 1.399,75 (22 %) = 7.762,25 non succede per caso. Si accetta
// solo se il totale è l'importo più alto della pagina, oppure se anche
// l'imponibile compare scritto.
const IMPORTO_RE = /(?<![\d,.])(\d{1,3}(?:\.\d{3})+,\d{2}|\d{1,6},\d{2})(?![\d,])/g;
const ALIQUOTE_IVA = [22, 10, 4, 5] as const;
const MASSIMO_IMPORTI_PAGINA = 160;

type TernaIva = {
  imponibile: number;
  iva: number;
  totale: number;
  aliquota: number;
  imponibileScritto: boolean;
  pagina: number;
  indice: number;
  lunghezza: number;
};

function ternaIvaNellePagine(
  pagine: readonly string[],
  totaleAtteso: number | null
): TernaIva | null {
  let migliore: TernaIva | null = null;
  pagine.forEach((testo, pagina) => {
    const trovati = new Map<number, { indice: number; lunghezza: number }>();
    const re = new RegExp(IMPORTO_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(testo)) !== null && trovati.size < MASSIMO_IMPORTI_PAGINA) {
      const valore = parseImporto(m[1]);
      if (valore == null || valore <= 0) continue;
      if (!trovati.has(valore)) trovati.set(valore, { indice: m.index, lunghezza: m[0].length });
    }
    const importi = [...trovati.keys()].sort((a, b) => b - a);
    if (importi.length < 2) return;
    const massimo = importi[0];
    for (const totale of importi) {
      if (totaleAtteso != null && Math.abs(totale - totaleAtteso) > 0.005) continue;
      for (const iva of importi) {
        if (iva >= totale || iva < 0.5) continue;
        const imponibile = Math.round((totale - iva) * 100) / 100;
        const aliquota = ALIQUOTE_IVA.find(
          a => Math.abs((imponibile * a) / 100 - iva) <= 0.011
        );
        if (!aliquota) continue;
        const imponibileScritto = trovati.has(imponibile);
        if (totale < massimo - 0.005 && !imponibileScritto) continue;
        const terna: TernaIva = {
          imponibile,
          iva,
          totale,
          aliquota,
          imponibileScritto,
          pagina,
          ...trovati.get(totale)!,
        };
        const vince =
          !migliore ||
          terna.totale > migliore.totale + 0.005 ||
          (Math.abs(terna.totale - migliore.totale) <= 0.005 &&
            imponibileScritto &&
            !migliore.imponibileScritto);
        if (vince) migliore = terna;
      }
    }
  });
  return migliore;
}

/** Un valore letto accanto a «vs. riferimento» che in realtà è un'altra etichetta. */
const ETICHETTA_NON_RIFERIMENTO =
  /^(?:approntamento|compilatore|causale|agente|n\.?\s*documento|data|divisa|valuta|pagamento|banca|porto|trasporto|consegna|vettore|sett\.?|settimana|destinazione|spett|sede|ordine|ord\.|fattura|ddt|preventivo|offerta|nostro|ns\.?|vostro|vs\.?)\b/i;

function riferimentoClientePlausibile(valore: string): boolean {
  if ((valore.match(/[a-z0-9]/gi) ?? []).length < 2) return false;
  if (/:\s*$/.test(valore)) return false;
  if (ETICHETTA_NON_RIFERIMENTO.test(valore)) return false;
  // Un riferimento è corto: una frase delle condizioni di vendita non lo è.
  if (valore.length > 45 || valore.split(/\s+/).length > 5) return false;
  return true;
}

/**
 * La cella nella riga SOTTO un'etichetta, nella stessa colonna: «VS.RIFERIMENTO»
 * ↵ «GIACOMAZZI GIUL» (Alias), «Vostro Riferimento» ↵ «GIANESIN»
 * (Gianesin, con la colonna sinistra occupata da altro).
 */
function cellaSottoEtichetta(testoPagina: string, indiceEtichetta: number): string | null {
  const inizioRiga = testoPagina.lastIndexOf("\n", indiceEtichetta) + 1;
  const fineRiga = testoPagina.indexOf("\n", indiceEtichetta);
  if (fineRiga < 0) return null;
  const colonna = indiceEtichetta - inizioRiga;
  const fineDopo = testoPagina.indexOf("\n", fineRiga + 1);
  const rigaDopo = testoPagina.slice(fineRiga + 1, fineDopo < 0 ? undefined : fineDopo);
  // La cella più vicina che comincia sotto l'etichetta o poco a destra (i
  // valori allineati a destra, Gianesin: «Vostro Riferimento» e «GIANESIN»
  // trenta colonne più in là); mai una che comincia prima.
  const vicina = celleDiRiga(rigaDopo)
    .filter(c => c.inizio >= colonna - 3 && c.inizio <= colonna + 40)
    .sort((a, b) => Math.abs(a.inizio - colonna) - Math.abs(b.inizio - colonna))[0];
  return vicina?.testo ?? null;
}

/** Importi con i decimali («1.234,56», «482,00», «3177,88») o migliaia puntate («1.234»): mai un intero nudo. */
const IMPORTO_CON_DECIMALI = "((?:\\d{1,3}(?:\\.\\d{3})+|\\d{1,7}),\\d{2}|\\d{1,3}(?:\\.\\d{3})+)(?![\\d,])";

/**
 * Lo spazio fra un'etichetta e il suo importo, sulla STESSA riga: colonne
 * larghe («TOTALE FORNITURA                    € 482,00»), rumore OCR
 * («TOTALE NETTO (iva esclusa) RU wei 135 © 2.634,54»), ma mai un'altra
 * etichetta di importo in mezzo — «Totale Iva 151,36 Totale Fattura 839,35»
 * non deve accoppiare il primo «Totale» con il secondo importo.
 */
const FINESTRA_ETICHETTA_IMPORTO =
  "(?:(?!\\btotale\\b|\\bimponibile\\b|\\bpartita\\b|\\bimposta\\b|\\biva\\s*(?:\\d|al\\b|%|:|/))[^\\n€]){0,44}?";

/** «+ IVA», «IVA esclusa», «a vostro carico IVA»: i prezzi del documento sono imponibili. */
const IVA_ESCLUSA_RE =
  /(\+\s*iva\b|\biva\s+escl(?:usa|\.)?|\bescl(?:usa|\.)?\s+iva\b|\boltre\s+(?:l['’])?iva\b|a\s+vostro\s+carico\s+(?:l['’])?iva\b|\biva\s+a\s+vostro\s+carico|al\s+netto\s+(?:di|dell['’])\s*iva\b|\bsenza\s+iva\b|\bnetto\s+iva\b)/i;

/** Un numero di conferma non è una data né «1 / 2» di pagina. */
function numeroConfermaPlausibile(valore: string): boolean {
  const v = valore.trim();
  if (v.length < 3 || !/\d/.test(v)) return false;
  if (/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}$/.test(v)) return false;
  if (/^\d{1,3}\s*\/\s*\d{1,3}$/.test(v)) return false;
  return true;
}

/** Nomi di dominio che non identificano nessun fornitore. */
const DOMINI_GENERICI =
  /(?:gmail|libero|hotmail|outlook|yahoo|icloud|tim|alice|virgilio|tiscali|fastweb|pec|legalmail|arubapec|pecimprese|postecert|sicurezzapostale|mypec|cert)\./i;

const ETICHETTA_DI_SERVIZIO =
  /^(?:agente|agenzia|rappresentante|vettore|trasport\w*|spedizion\w*|corriere|banca|bonifico|intestat\w*|beneficiario|pagamento|iban|destinazione|consegna|committente|compilatore|c\/o)\b/i;

const MARCATORE_DESTINATARIO = /\b(?:spett(?:\.|abile)|destinatario|cliente|customer)\b/i;

const RAGIONE_SOCIALE =
  /\b(?:s\.?\s?r\.?\s?l\.?\s?s?|s\.?\s?p\.?\s?a\.?|s\.?\s?n\.?\s?c\.?|s\.?\s?a\.?\s?s\.?|s\.?\s?c\.?\s?a\.?\s?r\.?\s?l\.?|gmbh|ag|ltd|sa|sagl)\b/i;

/** Una riga fatta solo di etichette («AGENTE   Compilatore conferma   VS.RIFERIMENTO»). */
function rigaDiEtichette(celle: ReadonlyArray<{ testo: string }>): boolean {
  return (
    celle.length >= 2 &&
    celle.every(
      c =>
        c.testo.length <= 40 &&
        !/\d/.test(c.testo) &&
        c.testo.split(/\s+/).length <= 4
    )
  );
}

/**
 * Il fornitore dall'intestazione, senza anagrafica: la prima CELLA con una
 * ragione sociale che non è la nostra azienda, né il destinatario, né il
 * valore di un'etichetta di servizio («Agente DOOR DESIGN SRL» sulla stessa
 * riga, «AGENTE» ↵ «DE - DOOR DESIGN S.R.L.» nella riga sotto, «Banca:
 * INTESA SANPAOLO SPA»). Prima le prime righe, poi tutta la prima pagina
 * (la firma in calce: «Ferramenta Fivizzanese S.r.l»), infine il dominio
 * di sito o e-mail («ferramentafivizzanese.it»). Confidenza bassa, dichiarata.
 */
function fornitoreDallIntestazione(
  pagine: readonly string[],
  esclusi: readonly string[]
): CampoEstratto<string> | null {
  if (pagine.length === 0) return null;
  const righe = pagine[0].split(/\r?\n/);
  const escludi = (cella: string) =>
    esclusi.some(n => cella.toLowerCase().includes(n));
  let righeDopoDestinatario = 0;
  let colonnaDestinatario = 0;
  let etichetteSopra: Array<{ testo: string; inizio: number }> | null = null;
  for (const riga of righe) {
    const celle = celleDiRiga(riga);
    const inCoda = righeDopoDestinatario > 0;
    if (inCoda) righeDopoDestinatario -= 1;
    let dopoEtichetta = false;
    let dalMarcatore = Number.POSITIVE_INFINITY;
    for (const [indice, cella] of celle.entries()) {
      const testo = cella.testo;
      if (MARCATORE_DESTINATARIO.test(testo)) {
        // Il blocco del destinatario sta a destra («BT GLASS Srl   Spett.le»):
        // le celle a destra del marcatore, in questa riga e nelle tre sotto,
        // sono sue. Un marcatore a sinistra non blocca niente: la nostra
        // azienda è già esclusa per nome, e sotto può esserci il fornitore.
        if (indice === celle.length - 1 && cella.inizio > 20) {
          righeDopoDestinatario = 3;
          colonnaDestinatario = cella.inizio;
        }
        dalMarcatore = Math.min(dalMarcatore, cella.inizio);
        continue;
      }
      if (ETICHETTA_DI_SERVIZIO.test(testo) || /\b(?:banca|iban|bank)\b/i.test(testo)) {
        dopoEtichetta = true;
        continue;
      }
      if (dopoEtichetta || cella.inizio >= dalMarcatore) continue;
      if (inCoda && cella.inizio >= colonnaDestinatario - 2) continue;
      const etichettaSopra = etichetteSopra?.find(
        e => Math.abs(e.inizio - cella.inizio) <= 12
      );
      if (etichettaSopra && ETICHETTA_DI_SERVIZIO.test(etichettaSopra.testo)) continue;
      const pulita = testo.replace(/^[^A-Za-z0-9À-ú]+/, "").replace(/\s+/g, " ").trim();
      if (pulita.length < 5 || pulita.length > 80 || !RAGIONE_SOCIALE.test(pulita)) continue;
      // La forma societaria non apre una ragione sociale («SPA LA SPEZIA» è
      // il pezzo di una banca letto male).
      if (RAGIONE_SOCIALE.test(pulita.split(/\s+/)[0])) continue;
      if (escludi(pulita)) continue;
      const indiceTesto = pagine[0].indexOf(testo);
      return {
        valore: pulita.slice(0, 80),
        evidenza: evidenza(pagine, 0, Math.max(0, indiceTesto), testo.length, "pattern_testo", "bassa"),
      };
    }
    etichetteSopra = rigaDiEtichette(celle) ? celle : null;
  }
  // Nessuna ragione sociale: il dominio del sito o della mail.
  const dominio = /\b(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:it|com|eu|net|org|de|ch|fr|es))\b/gi;
  for (const { pagina, match } of cercaSuPagine([pagine[0]], dominio)) {
    const valore = match[1].toLowerCase();
    if (DOMINI_GENERICI.test(valore + ".") || escludi(valore)) continue;
    return {
      valore,
      evidenza: evidenza(pagine, pagina, match.index, match[0].length, "pattern_testo", "bassa"),
    };
  }
  return null;
}

/**
 * Regex di un riferimento esatto con CONFINI obbligatori: «ORD-10» non
 * deve farsi trovare dentro «ORD-100» né «FIN-100» dentro «FIN-1000»
 * (difetto scovato dall'eval e dalla revisione indipendente: vale per
 * TUTTE le ricerche di riferimento, non solo per trovaRiferimentoTesto).
 */
function regexRiferimento(testo: string): RegExp {
  return new RegExp(
    `(?<![A-Za-z0-9])${escapeRegex(testo)}(?![A-Za-z0-9])`,
    "gi"
  );
}

function parseImporto(grezzo: string): number | null {
  // La cattura può trascinarsi punteggiatura di frase («1.234,50.») che
  // renderebbe NaN il numero; e «1.234» senza decimali è la scrittura
  // italiana di milleduecentotrentaquattro, non 1,234 (revisione).
  const testo = grezzo.trim().replace(/[.,]+$/, "");
  if (/^\d{1,3}(\.\d{3})+$/.test(testo)) {
    const valore = Number(testo.replace(/\./g, ""));
    return Number.isFinite(valore) ? valore : null;
  }
  // Stessa logica di lettura "italiana" di parseEuro: ultima fra virgola e
  // punto è il decimale quando ci sono entrambi.
  const virgola = testo.lastIndexOf(",");
  const punto = testo.lastIndexOf(".");
  let normalizzato: string;
  if (virgola >= 0 && punto >= 0) {
    normalizzato =
      virgola > punto
        ? testo.replace(/\./g, "").replace(",", ".")
        : testo.replace(/,/g, "");
  } else if (virgola >= 0) {
    normalizzato = testo.replace(/\./g, "").replace(",", ".");
  } else {
    normalizzato = testo;
  }
  const valore = Number(normalizzato);
  return Number.isFinite(valore) ? Math.round(valore * 100) / 100 : null;
}

function cercaSuPagine(
  pagine: readonly string[],
  regex: RegExp
): Array<{ pagina: number; match: RegExpExecArray }> {
  const trovati: Array<{ pagina: number; match: RegExpExecArray }> = [];
  pagine.forEach((testo, pagina) => {
    const locale = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
    let match: RegExpExecArray | null;
    while ((match = locale.exec(testo)) !== null) {
      trovati.push({ pagina, match });
      if (match.index === locale.lastIndex) locale.lastIndex++;
    }
  });
  return trovati;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Cerca un riferimento testuale esatto (case-insensitive) nelle pagine e
 * restituisce l'evidenza della prima occorrenza. È il mattone del
 * collegamento assistito (slice 2): ogni segnale di un candidato deve poter
 * citare pagina e frammento, come i campi dell'estrazione.
 */
export function trovaRiferimentoTesto(
  pagine: readonly string[],
  testo: string,
  confidenza: Evidenza["confidenza"] = "alta"
): Evidenza | null {
  const pulito = testo.trim();
  if (pulito.length < 3) return null;
  // Confini obbligatori: «ORD-10» non deve farsi trovare DENTRO
  // «ORD-100» (difetto scovato dall'eval, slice 5). Un riferimento vale
  // solo se non è incollato ad altre lettere o cifre.
  const [primo] = cercaSuPagine(pagine, regexRiferimento(pulito));
  if (!primo) return null;
  return evidenza(
    pagine,
    primo.pagina,
    primo.match.index,
    primo.match[0].length,
    "riferimento_certo",
    confidenza
  );
}

export function estraiConfermaOrdine(
  pagine: readonly string[],
  contesto: ContestoEstrazione
): EstrazioneConferma {
  const risultato: EstrazioneConferma = {
    riferimentoOrdine: null,
    codiciCommessaCitati: [],
    fornitoreCitato: null,
    numeroConferma: null,
    riferimentoCliente: null,
    dataDocumento: null,
    dateConsegna: [],
    settimaneConsegna: [],
    settimaneApprontamento: [],
    totaleDocumento: null,
    imponibileDocumento: null,
    righe: [],
  };

  // ── Riferimento certo al NOSTRO ordine ─────────────────────────────────
  if (contesto.codiceOrdine) {
    const re = regexRiferimento(contesto.codiceOrdine);
    const [primo] = cercaSuPagine(pagine, re);
    if (primo) {
      risultato.riferimentoOrdine = {
        valore: contesto.codiceOrdine,
        evidenza: evidenza(
          pagine,
          primo.pagina,
          primo.match.index,
          primo.match[0].length,
          "riferimento_certo",
          "alta"
        ),
      };
    }
  }

  // ── Codici commessa citati (COM-AAAA-NNN) ──────────────────────────────
  for (const { pagina, match } of cercaSuPagine(
    pagine,
    /\bCOM[\s\-–_]?\d{4}[\s\-–_]?\d{1,4}\b/gi
  )) {
    const codice = estraiCodiceCommessa(match[0]);
    if (!codice) continue;
    if (risultato.codiciCommessaCitati.some(c => c.valore === codice)) continue;
    risultato.codiciCommessaCitati.push({
      valore: codice,
      evidenza: evidenza(
        pagine,
        pagina,
        match.index,
        match[0].length,
        "riferimento_certo",
        "alta"
      ),
    });
  }

  // ── Fornitore citato (nome noto dall'anagrafica) ───────────────────────
  if (contesto.fornitoreNome && contesto.fornitoreNome.trim().length >= 3) {
    const re = regexRiferimento(contesto.fornitoreNome.trim());
    const [primo] = cercaSuPagine(pagine, re);
    if (primo) {
      risultato.fornitoreCitato = {
        valore: contesto.fornitoreNome.trim(),
        evidenza: evidenza(
          pagine,
          primo.pagina,
          primo.match.index,
          primo.match[0].length,
          "riferimento_certo",
          "alta"
        ),
      };
    }
  }

  // ── Numero della conferma ──────────────────────────────────────────────
  {
    const re =
      /\b(?:conferma(?:\s+d['’]?ordine)?|order\s+confirmation|auftragsbest(?:ä|ae)tigung|AB)[\s:]*(?:n[°.ro]*\s*)?([A-Z0-9][A-Z0-9\/\-.]{2,20})/gi;
    const trovati = cercaSuPagine(pagine, re);
    // «Conferma d'ordine … 19124 LA SPEZIA»: cinque cifre seguite da una
    // città sono il CAP del destinatario, non il numero della conferma.
    const primo = trovati.find(({ pagina, match }) => {
      const valore = match[1] ?? "";
      if (!numeroConfermaPlausibile(valore)) return false;
      const dopo = pagine[pagina].slice(match.index + match[0].length, match.index + match[0].length + 30);
      return !(/^\d{5}$/.test(valore) && /^\s+[A-ZÀ-Ú]{2,}/.test(dopo));
    });
    if (primo) {
      risultato.numeroConferma = {
        valore: primo.match[1],
        evidenza: evidenza(
          pagine,
          primo.pagina,
          primo.match.index,
          primo.match[0].length,
          "pattern_testo",
          "media"
        ),
      };
    }
  }

  // ── Numero e data sulla stessa riga: «N. 000183 del 12/03/2026» (BT Glass)
  if (!risultato.numeroConferma) {
    const re =
      /(?:^|\s)(?:n|nr|num|numero)[°.º]?\s*[:.]?\s*([A-Z]{0,4}[\s\-]?\d{3,10}(?:[\/\-]\d{1,6})?)\s+del\s+\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}/gi;
    const [primo] = cercaSuPagine(pagine, re);
    if (primo && numeroConfermaPlausibile(primo.match[1])) {
      risultato.numeroConferma = {
        valore: primo.match[1].trim().replace(/\s+/g, " "),
        evidenza: evidenza(
          pagine,
          primo.pagina,
          primo.match.index,
          primo.match[0].length,
          "pattern_testo",
          "media"
        ),
      };
    }
  }

  // ── Numero del documento del fornitore (fallback: «N.DOCUMENTO») ───────
  // Alias scrive «2026 - CV 003746 del 23/02/2026» e SOTTO l'etichetta
  // «N.DOCUMENTO»: il valore sta nelle righe vicine, prima o dopo.
  if (!risultato.numeroConferma) {
    for (const { pagina, match } of cercaSuPagine(pagine, /\bn\.?\s*documento\b/gi)) {
      const testoPagina = pagine[pagina];
      // Prima la cella sotto l'etichetta (griglia), poi le righe vicine.
      const sotto = cellaSottoEtichetta(testoPagina, match.index) ?? "";
      const finestra =
        sotto +
        " " +
        testoPagina.slice(Math.max(0, match.index - 90), match.index + match[0].length + 90);
      const numero = /\b([A-Z]{1,4})\s?(\d{4,8})\b/.exec(finestra);
      if (!numero) continue;
      risultato.numeroConferma = {
        valore: `${numero[1]} ${numero[2]}`,
        evidenza: evidenza(
          pagine,
          pagina,
          match.index,
          match[0].length,
          "pattern_testo",
          "bassa"
        ),
      };
      break;
    }
  }

  // ── Intestazione a colonne «NUMERO   DATA   PAGINA» e sotto «VI/26/2292   19/02/2026   1/3» (Bertolotto)
  if (!risultato.numeroConferma) {
    const re =
      /\bnumero\b[^\n]{0,40}\bdata\b[^\n]*\n\s*([A-Z]{1,4}[\/\-]\d{2}[\/\-]\d{1,6}|[A-Z]{0,4}\d{4,10}(?:[\/\-]\d{1,6})?)\s+(?:\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/gi;
    const [primo] = cercaSuPagine(pagine, re);
    if (primo && numeroConfermaPlausibile(primo.match[1])) {
      risultato.numeroConferma = {
        valore: primo.match[1].trim(),
        evidenza: evidenza(
          pagine,
          primo.pagina,
          primo.match.index,
          primo.match[0].length,
          "pattern_testo",
          "media"
        ),
      };
    }
  }

  // ── «nostro riferimento n. OV-2025-WU/230417» (Primed): il numero d'ordine del fornitore
  if (!risultato.numeroConferma) {
    const re =
      /\b(?:ns\.?|nostro)\s+rif(?:erimento)?\.?\s*(?:n\.?|num\.?|numero)?\s*[:.]?\s*([A-Z0-9][A-Z0-9\/\-.]{3,24})/gi;
    for (const { pagina, match } of cercaSuPagine(pagine, re)) {
      if (!numeroConfermaPlausibile(match[1])) continue;
      risultato.numeroConferma = {
        valore: match[1],
        evidenza: evidenza(pagine, pagina, match.index, match[0].length, "pattern_testo", "bassa"),
      };
      break;
    }
  }

  // ── Fornitore dall'intestazione (fallback senza anagrafica) ────────────
  // La prima CELLA con una ragione sociale che non è la nostra azienda, né
  // il destinatario, né un'etichetta di servizio («Agente DOOR DESIGN SRL»,
  // «Banca: INTESA SANPAOLO SPA»): «BT GLASS Srl», «ALIAS Srl Porte
  // blindate». Le righe ricostruite dalla geometria mettono sulla stessa
  // riga la colonna sinistra e quella destra («BT GLASS Srl   Spett.le»): le
  // celle sono separate da tre spazi e si valutano una per una. Confidenza
  // bassa, dichiarata.
  if (!risultato.fornitoreCitato && pagine.length > 0) {
    risultato.fornitoreCitato = fornitoreDallIntestazione(
      pagine,
      (contesto.escludiNomi ?? ["ruffino"]).map(n => n.toLowerCase())
    );
  }

  // ── Il nostro riferimento riportato dal fornitore («VS.RIFERIMENTO») ───
  {
    // L'etichetta apre una cella (inizio riga o almeno due spazi prima):
    // «Vs. rif» dentro una frase delle condizioni non conta. «Rif. POCCJ»
    // nell'oggetto (Fivizzanese) è l'ultimo tentativo, il più debole.
    const re =
      /(?<=^|\n|\s{2,}|[|:;,(]\s?|\.\s)(?:vs\.?\s*rif(?:erimento)?|vostro\s+rif(?:erimento)?|rif\.?\s*(?:cliente|cli\.)|riferimento\s+cliente|your\s+ref(?:erence)?|ihr\s+zeichen|rif\.)(?![a-zà-ú])[ \t:.]*([^\n]{0,60})/i;
    for (const { pagina, match } of cercaSuPagine(pagine, new RegExp(re.source, "gim"))) {
      const testoPagina = pagine[pagina];
      // Solo la prima cella: dopo tre spazi comincia un'altra colonna.
      let valore = (match[1] ?? "").split(/\s{3,}/)[0].trim();
      // Valore nella riga sotto, nella stessa colonna: «VS.RIFERIMENTO» ↵ «GIACOMAZZI GIUL».
      if (!riferimentoClientePlausibile(valore)) {
        valore = cellaSottoEtichetta(testoPagina, match.index) ?? "";
      }
      valore = valore.replace(/\s+/g, " ").trim().slice(0, 60);
      if (!riferimentoClientePlausibile(valore)) continue;
      // «Rif.» nudo: solo se il valore è un nome, non un numero d'ordine.
      if (/^rif\.$/i.test(match[0].trim().split(/[\s:.]+/)[0] + ".") && !/^[A-Za-zÀ-ú]/.test(valore)) continue;
      risultato.riferimentoCliente = {
        valore,
        evidenza: evidenza(
          pagine,
          pagina,
          match.index,
          match[0].length,
          "pattern_testo",
          "media"
        ),
      };
      break;
    }
  }

  // ── Date: documento e consegna ─────────────────────────────────────────
  const PAROLE_CONSEGNA =
    /(consegna|spedizione|delivery|liefer|prevista|settimana|kw)/i;
  // Fra più date candidate, quelle nel contesto di CONSEGNA vera battono
  // quelle di sola spedizione: dateConsegna[0] alimenta confronto e
  // proposte, e una data di spedizione non deve scavalcarla (revisione).
  const PAROLE_CONSEGNA_FORTI = /(consegna|delivery|liefer)/i;
  // Una data etichettata come data del DOCUMENTO («del 01/09/2026», «Data:
  // 01/09/2026») non diventa una consegna solo perché la riga dopo parla di
  // consegna: la finestra di contesto attraversa le righe, l'etichetta no.
  const ETICHETTA_DATA_DOCUMENTO =
    /(?:\bdel|\bdata(?:\s+(?:documento|conferma|ordine))?|\bdate|\bemess[ao]\s+il|\bdocumento|\bin\s+data)\s*[:.]?\s*$/i;
  // La colonna «Consegna» di una tabella (Gianesin: «… Importo   IVA   Consegna»
  // e sotto «477,00 22 11/02/26»): una data in quella colonna, sotto
  // l'intestazione, è una consegna anche senza la parola sulla sua riga.
  const colonneConsegna = pagine.map(testoPagina => {
    const colonne: Array<{ indice: number; colonna: number }> = [];
    for (const riga of testoPagina.matchAll(/^.*\bconsegna\b.*$/gim)) {
      if (!/\b(?:codice|descrizione|quantit|articolo|importo|prezzo)\b/i.test(riga[0])) continue;
      const posizione = riga[0].search(/\bconsegna\b/i);
      colonne.push({ indice: (riga.index ?? 0) + posizione, colonna: posizione });
    }
    return colonne;
  });
  for (const { pagina, match } of cercaSuPagine(pagine, DATA_RE)) {
    const iso = normalizzaData(match[1], match[2], match[3]);
    if (!iso) continue;
    const testoPagina = pagine[pagina];
    const contorno = testoPagina.slice(
      Math.max(0, match.index - 70),
      match.index + match[0].length + 30
    );
    const inizioRiga = testoPagina.lastIndexOf("\n", match.index) + 1;
    const fineRiga = testoPagina.indexOf("\n", match.index);
    const riga = testoPagina.slice(inizioRiga, fineRiga === -1 ? undefined : fineRiga);
    const finestraPrima = testoPagina.slice(Math.max(0, match.index - 25), match.index);
    // «del 12/03/2026», «Data: 01/09/2026»: è la data del documento anche se
    // sulla stessa riga c'è «Settimana 21» (Alias mette N.DOCUMENTO e
    // Approntamento sulla stessa riga). «consegna del 20/04» resta consegna.
    const etichettaDocumento =
      ETICHETTA_DATA_DOCUMENTO.test(finestraPrima) &&
      !PAROLE_CONSEGNA_FORTI.test(finestraPrima);
    const colonnaData = match.index - inizioRiga;
    const sottoColonnaConsegna = colonneConsegna[pagina].some(
      c => match.index > c.indice && Math.abs(c.colonna - colonnaData) <= 10
    );
    const contestoConsegna =
      !etichettaDocumento &&
      (PAROLE_CONSEGNA.test(riga) || PAROLE_CONSEGNA.test(contorno) || sottoColonnaConsegna);
    const ev = evidenza(
      pagine,
      pagina,
      match.index,
      match[0].length,
      "pattern_testo",
      contestoConsegna ? "media" : "bassa"
    );
    if (contestoConsegna) {
      if (!risultato.dateConsegna.some(d => d.valore === iso)) {
        risultato.dateConsegna.push({ valore: iso, evidenza: ev });
        (risultato.dateConsegna.at(-1) as any).__forte =
          PAROLE_CONSEGNA_FORTI.test(contorno);
      }
    } else if (!risultato.dataDocumento) {
      risultato.dataDocumento = { valore: iso, evidenza: ev };
    }
  }
  // Ordinamento stabile: prima le date con contesto di consegna forte.
  risultato.dateConsegna.sort(
    (a: any, b: any) => Number(b.__forte ?? false) - Number(a.__forte ?? false)
  );
  for (const data of risultato.dateConsegna) delete (data as any).__forte;

  // ── Settimana di consegna dichiarata (sett. 37, KW 37) ─────────────────
  // Se nelle righe prima si parla di APPRONTAMENTO (merce pronta dal
  // fornitore), la settimana non è una consegna: va in
  // settimaneApprontamento, con l'anno se dichiarato («2026 Settimana 21»).
  const PAROLE_APPRONTAMENTO = /(approntament|merce\s+pronta|pront[ae]\s+(?:per|dal|il)|disponibilit|ready\s+(?:for|by)|fertigstellung)/i;
  for (const { pagina, match } of cercaSuPagine(
    pagine,
    /(?:\b(\d{4})\s+)?\b(?:settimana|sett\.?|KW)\s*(\d{1,2})\b/gi
  )) {
    const settimana = Number(match[2]);
    if (!(settimana >= 1 && settimana <= 53)) continue;
    const anno = match[1] ? Number(match[1]) : null;
    const prima = pagine[pagina].slice(Math.max(0, match.index - 120), match.index);
    const ev = evidenza(
      pagine,
      pagina,
      match.index,
      match[0].length,
      "pattern_testo",
      "media"
    );
    if (PAROLE_APPRONTAMENTO.test(prima)) {
      risultato.settimaneApprontamento ??= [];
      if (risultato.settimaneApprontamento.some(s => s.valore === settimana)) continue;
      risultato.settimaneApprontamento.push({
        valore: settimana,
        anno: anno != null && anno >= 2000 && anno <= 2100 ? anno : null,
        evidenza: ev,
      });
      continue;
    }
    if (risultato.settimaneConsegna.some(s => s.valore === settimana)) continue;
    risultato.settimaneConsegna.push({ valore: settimana, evidenza: ev });
  }

  // ── Totale del documento ───────────────────────────────────────────────
  // Con più «totale» nello stesso documento (parziali, imponibile, totale
  // documento) si presenta il MAGGIORE come lettura principale — è il totale
  // documento nella quasi totalità dei layout — e le altre restano come
  // interpretazioni alternative dichiarate (PRD §54.6).
  const imponibiliEspliciti: Array<{ valore: number; ev: Evidenza }> = [];
  {
    // «Totale documento», «Tot. Ordine» (Alias), «Totale»: il maggiore vince.
    // Solo importi con i decimali: «Totale Iva   Consegna 3» (intestazione di
    // tabella) e una partita IVA non sono totali.
    const re = new RegExp(
      `\\b(?:totale|tot\\.?)(?:\\s+(?:documento|ordine|conferma|imponibile|netto|merce|imposta|spese|fornitura|generale|fattura|righe))?\\b${FINESTRA_ETICHETTA_IMPORTO}(?:€|EUR)?\\s*${IMPORTO_CON_DECIMALI}`,
      "gi"
    );
    const candidati: Array<{ valore: number; ev: Evidenza; grado: number }> = [];
    for (const { pagina, match } of cercaSuPagine(pagine, re)) {
      const valore = parseImporto(match[1]);
      if (valore == null || valore <= 0) continue;
      const ev = evidenza(pagine, pagina, match.index, match[0].length, "pattern_testo", "media");
      // «Totale (iva esclusa) €3.299,70» (Erreci), «Totale netto»: è un imponibile.
      if (/(?:iva\s+escl|escl\w*\s+iva|\+\s*iva|\bnetto\b)/i.test(match[0])) {
        imponibiliEspliciti.push({ valore, ev });
        continue;
      }
      // Il totale del DOCUMENTO batte i parziali anche se più piccolo:
      // «TOT. MERCE 12612,01» (listino prima dello sconto, Bertolotto) non è
      // il totale dell'ordine, che sta in «TOTALE ORDINE 5.954,80».
      const etichetta = match[0].toLowerCase();
      const grado = /documento|ordine|fattura|generale|fornitura|conferma/.test(etichetta)
        ? 2
        : /merce|righe|imposta|spese|imponibile/.test(etichetta)
          ? 0
          : 1;
      candidati.push({ valore, ev, grado });
    }
    if (candidati.length > 0) {
      candidati.sort((a, b) => b.grado - a.grado || b.valore - a.valore);
      const [principale, ...altri] = candidati;
      risultato.totaleDocumento = {
        valore: principale.valore,
        evidenza: principale.ev,
        ...(altri.length > 0
          ? {
              alternative: altri.map(item => ({
                valore: item.valore,
                evidenza: item.ev,
              })),
            }
          : {}),
      };
    }
  }

  // ── Righe: riscontro dei codici articolo dell'ordine ───────────────────
  for (const riga of contesto.righeOrdine) {
    const codice = (riga.codiceArticolo ?? "").trim();
    if (codice.length < 3) continue;
    // Stessi confini del riferimento ordine: FIN-100 non è «citato» se il
    // documento parla di FIN-1000 (difetto scovato dall'eval, slice 5).
    const re = regexRiferimento(codice);
    const [primo] = cercaSuPagine(pagine, re);
    if (!primo) {
      risultato.righe.push({
        rigaOrdineId: riga.id,
        codiceArticolo: codice,
        trovata: false,
        quantitaDocumento: null,
      });
      continue;
    }
    // Quantità vicina al codice: primo intero "n" o "n pz/pezzi" entro la
    // stessa riga di testo. Best effort dichiarato: confidenza bassa.
    const testoPagina = pagine[primo.pagina];
    const fineRiga = testoPagina.indexOf("\n", primo.match.index);
    const rigaTesto = testoPagina.slice(
      Math.max(0, testoPagina.lastIndexOf("\n", primo.match.index) + 1),
      fineRiga === -1 ? testoPagina.length : fineRiga
    );
    const quantitaMatch =
      /(?:^|\s)(?:n\.?\s*|q\.?t[àa]\.?\s*[:.]?\s*)?(\d{1,4})\s*(?:pz|pezzi|st(?:k|ück)?)\b/i.exec(
        rigaTesto
      ) ?? /(?:^|\s)(\d{1,4})(?:\s|$)/.exec(rigaTesto.replace(escapeRegexTemp(codice), " "));
    risultato.righe.push({
      rigaOrdineId: riga.id,
      codiceArticolo: codice,
      trovata: true,
      quantitaDocumento: quantitaMatch
        ? {
            valore: Number(quantitaMatch[1]),
            evidenza: {
              pagina: primo.pagina + 1,
              frammento: rigaTesto.replace(/\s+/g, " ").trim().slice(0, LUNGHEZZA_FRAMMENTO),
              metodo: "pattern_testo",
              confidenza: "bassa",
            },
          }
        : null,
    });
  }

  // ── Imponibile (base del margine) ──────────────────────────────────────
  // Prima l'etichetta esplicita; poi, se il documento dichiara l'IVA, la
  // differenza dal totale. Mai un'aliquota presunta.
  {
    const reImponibile = new RegExp(
      `\\b(?:totale\\s+)?(?:imponibile|netto\\s+merce|base\\s+imponibile)\\b${FINESTRA_ETICHETTA_IMPORTO}(?:€|EUR)?\\s*${IMPORTO_CON_DECIMALI}`,
      "gi"
    );
    const candidati: Array<{ valore: number; ev: Evidenza }> = [...imponibiliEspliciti];
    for (const { pagina, match } of cercaSuPagine(pagine, reImponibile)) {
      const valore = parseImporto(match[1]);
      if (valore == null || valore <= 0) continue;
      candidati.push({
        valore,
        ev: evidenza(
          pagine,
          pagina,
          match.index,
          match[0].length,
          "pattern_testo",
          "media"
        ),
      });
    }
    if (candidati.length > 0) {
      // Con più imponibili (per aliquota) vale il maggiore: è il totale
      // imponibile del documento nei layout usuali.
      candidati.sort((a, b) => b.valore - a.valore);
      risultato.imponibileDocumento = {
        valore: candidati[0].valore,
        evidenza: candidati[0].ev,
      };
    } else if (risultato.totaleDocumento) {
      // «IVA 22% 1.399,75», «Imposta 1.399,75» (BT Glass), «Tot. Imposta 208,72».
      const reIva = new RegExp(
        `\\b(?:i\\.?v\\.?a\\.?|imposta)\\b(?:\\s*\\(?\\d{1,2}\\s*%\\)?)?${FINESTRA_ETICHETTA_IMPORTO}(?:€|EUR)?\\s*${IMPORTO_CON_DECIMALI}`,
        "gi"
      );
      let iva: { valore: number; ev: Evidenza } | null = null;
      for (const { pagina, match } of cercaSuPagine(pagine, reIva)) {
        const valore = parseImporto(match[1]);
        if (valore == null || valore <= 0) continue;
        // L'IVA non può superare il totale: un match del genere è un falso
        // positivo (numero d'ordine, partita IVA…).
        if (valore >= risultato.totaleDocumento.valore) continue;
        if (!iva || valore > iva.valore) {
          iva = {
            valore,
            ev: evidenza(
              pagine,
              pagina,
              match.index,
              match[0].length,
              "pattern_testo",
              "bassa"
            ),
          };
        }
      }
      if (iva) {
        const differenza =
          Math.round((risultato.totaleDocumento.valore - iva.valore) * 100) / 100;
        if (differenza > 0) {
          risultato.imponibileDocumento = {
            valore: differenza,
            evidenza: iva.ev,
          };
        }
      }
    }
  }

  // ── Imponibile per aritmetica dell'IVA ────────────────────────────────
  // Nessuna etichetta utile: si cerca fra gli importi del documento la terna
  // imponibile + IVA = totale con un'aliquota italiana. Prima con il totale
  // già letto; se non torna, libera. Il totale trovato così vale anche come
  // totale del documento quando manca.
  // Se il documento dichiara i prezzi IVA esclusa, il «totale» letto È
  // l'imponibile (Fivizzanese: «TOTALE FORNITURA € 482,00 … A vostro carico IVA»).
  if (!risultato.imponibileDocumento && risultato.totaleDocumento) {
    const [ivaEsclusa] = cercaSuPagine(pagine, new RegExp(IVA_ESCLUSA_RE.source, "gi"));
    if (ivaEsclusa) {
      risultato.imponibileDocumento = {
        valore: risultato.totaleDocumento.valore,
        evidenza: evidenza(
          pagine,
          ivaEsclusa.pagina,
          ivaEsclusa.match.index,
          ivaEsclusa.match[0].length,
          "pattern_testo",
          "media"
        ),
      };
      risultato.totaleDocumento = null;
    }
  }

  if (!risultato.imponibileDocumento) {
    const terna =
      ternaIvaNellePagine(pagine, risultato.totaleDocumento?.valore ?? null) ??
      (risultato.totaleDocumento ? ternaIvaNellePagine(pagine, null) : null);
    if (terna) {
      const ev = evidenza(
        pagine,
        terna.pagina,
        terna.indice,
        terna.lunghezza,
        "pattern_testo",
        "media"
      );
      risultato.imponibileDocumento = {
        valore: terna.imponibile,
        evidenza: {
          ...ev,
          frammento: `${terna.imponibile.toFixed(2)} + IVA ${terna.aliquota}% ${terna.iva.toFixed(2)} = ${terna.totale.toFixed(2)} · ${ev.frammento}`.slice(0, 220),
        },
      };
      if (
        !risultato.totaleDocumento ||
        Math.abs(risultato.totaleDocumento.valore - terna.totale) > 0.005
      ) {
        const precedente = risultato.totaleDocumento;
        risultato.totaleDocumento = {
          valore: terna.totale,
          evidenza: ev,
          ...(precedente
            ? {
                alternative: [
                  { valore: precedente.valore, evidenza: precedente.evidenza },
                  ...(precedente.alternative ?? []),
                ],
              }
            : {}),
        };
      }
    }
  }

  return risultato;
}

function escapeRegexTemp(value: string): RegExp {
  return new RegExp(escapeRegex(value), "gi");
}

// ── Più conferme nello stesso file ────────────────────────────────────────
// «Conferme Bertolotto 19-02-2026.pdf» (04/09/2026): otto pagine, tre ordini
// diversi, ognuno con il suo riquadro totali. Letto come un documento solo,
// il totale più alto di uno vinceva sull'imponibile di un altro. Il file si
// divide in SEZIONI: ogni pagina con un riquadro totali chiude la sua, e
// ogni sezione si legge da sola.

/** Una pagina che chiude una conferma: porta il totale o l'imponibile del documento. */
const CHIUSURA_SEZIONE =
  /\b(?:tot(?:ale|\.)\s*(?:imponibile|documento|ordine|fattura|generale|fornitura)|totale\s+netto\s*\(iva\s+esclusa\))\b/i;

/** Le sezioni [da, a] (indici di pagina, inclusivi) di un file con più conferme; una sola se non se ne riconoscono. */
export function sezioniConferma(pagine: readonly string[]): Array<{ da: number; a: number }> {
  const sezioni: Array<{ da: number; a: number }> = [];
  let da = 0;
  pagine.forEach((testo, indice) => {
    if (CHIUSURA_SEZIONE.test(testo)) {
      sezioni.push({ da, a: indice });
      da = indice + 1;
    }
  });
  if (sezioni.length === 0) return [{ da: 0, a: Math.max(0, pagine.length - 1) }];
  // Le pagine dopo l'ultimo riquadro (allegati, condizioni) restano con l'ultima sezione.
  if (da < pagine.length) sezioni[sezioni.length - 1].a = pagine.length - 1;
  return sezioni;
}

export type SezioneConferma = {
  /** Indici di pagina inclusivi, 0-based. */
  da: number;
  a: number;
  estrazione: EstrazioneConferma;
};

export type EstrazioneDocumento = {
  /** La lettura da usare: il documento intero se ha una conferma sola, la somma delle sezioni altrimenti. */
  estrazione: EstrazioneConferma;
  sezioni: SezioneConferma[];
  /** Perché la somma non c'è (una sezione senza imponibile), altrimenti null. */
  motivoSomma: string | null;
};

function spostaPagine<T>(campo: CampoEstratto<T> | null | undefined, di: number): CampoEstratto<T> | null {
  if (!campo) return null;
  return {
    ...campo,
    evidenza: { ...campo.evidenza, pagina: campo.evidenza.pagina + di },
    ...(campo.alternative
      ? { alternative: campo.alternative.map(a => ({ ...a, evidenza: { ...a.evidenza, pagina: a.evidenza.pagina + di } })) }
      : {}),
  };
}

/**
 * Legge un file che può contenere più conferme. Con una sezione sola è la
 * lettura di sempre. Con più sezioni la lettura «principale» somma gli
 * imponibili (e i totali) SOLO se ogni sezione ha il suo: altrimenti niente
 * imponibile e il motivo lo dice — una somma parziale sarebbe un costo
 * sbagliato con l'aria di quello giusto.
 */
export function estraiConfermeNelDocumento(
  pagine: readonly string[],
  contesto: ContestoEstrazione
): EstrazioneDocumento {
  const intervalli = sezioniConferma(pagine);
  if (intervalli.length <= 1) {
    const estrazione = estraiConfermaOrdine(pagine, contesto);
    return { estrazione, sezioni: [{ da: 0, a: Math.max(0, pagine.length - 1), estrazione }], motivoSomma: null };
  }
  const sezioni: SezioneConferma[] = intervalli.map(({ da, a }) => {
    const locale = estraiConfermaOrdine(pagine.slice(da, a + 1), contesto);
    const estrazione: EstrazioneConferma = {
      ...locale,
      riferimentoOrdine: spostaPagine(locale.riferimentoOrdine, da),
      fornitoreCitato: spostaPagine(locale.fornitoreCitato, da),
      numeroConferma: spostaPagine(locale.numeroConferma, da),
      riferimentoCliente: spostaPagine(locale.riferimentoCliente, da),
      dataDocumento: spostaPagine(locale.dataDocumento, da),
      totaleDocumento: spostaPagine(locale.totaleDocumento, da),
      imponibileDocumento: spostaPagine(locale.imponibileDocumento, da),
      codiciCommessaCitati: locale.codiciCommessaCitati.map(c => spostaPagine(c, da)!),
      dateConsegna: locale.dateConsegna.map(c => spostaPagine(c, da)!),
      settimaneConsegna: locale.settimaneConsegna.map(c => spostaPagine(c, da)!),
      settimaneApprontamento: (locale.settimaneApprontamento ?? []).map(s => ({ ...spostaPagine(s, da)!, anno: s.anno })),
    };
    return { da, a, estrazione };
  });

  const prima = sezioni[0].estrazione;
  const senzaImponibile = sezioni.filter(s => s.estrazione.imponibileDocumento == null);
  const sommaImponibile =
    senzaImponibile.length === 0
      ? Math.round(sezioni.reduce((s, x) => s + (x.estrazione.imponibileDocumento?.valore ?? 0), 0) * 100) / 100
      : null;
  const senzaTotale = sezioni.filter(s => s.estrazione.totaleDocumento == null);
  const sommaTotale =
    senzaTotale.length === 0
      ? Math.round(sezioni.reduce((s, x) => s + (x.estrazione.totaleDocumento?.valore ?? 0), 0) * 100) / 100
      : null;
  const primoCon = <K extends keyof EstrazioneConferma>(campo: K): EstrazioneConferma[K] =>
    (sezioni.find(s => s.estrazione[campo] != null)?.estrazione[campo] ?? null) as EstrazioneConferma[K];
  const numeri = sezioni.map(s => s.estrazione.numeroConferma?.valore).filter((v): v is string => !!v);
  const unione = <T extends { valore: unknown }>(campo: (e: EstrazioneConferma) => T[]): T[] => {
    const visti = new Set<string>();
    const tutti: T[] = [];
    for (const s of sezioni) {
      for (const v of campo(s.estrazione)) {
        const chiave = String(v.valore);
        if (visti.has(chiave)) continue;
        visti.add(chiave);
        tutti.push(v);
      }
    }
    return tutti;
  };
  const evidenzaSomma = (campo: "imponibileDocumento" | "totaleDocumento"): Evidenza => ({
    pagina: sezioni[sezioni.length - 1].estrazione[campo]?.evidenza.pagina ?? 1,
    frammento: `somma di ${sezioni.length} conferme nel file: ${sezioni
      .map(s => s.estrazione[campo]?.valore?.toFixed(2) ?? "?")
      .join(" + ")}`,
    metodo: "pattern_testo",
    confidenza: "media",
  });

  const estrazione: EstrazioneConferma = {
    riferimentoOrdine: primoCon("riferimentoOrdine"),
    codiciCommessaCitati: unione(e => e.codiciCommessaCitati),
    fornitoreCitato: primoCon("fornitoreCitato") ?? prima.fornitoreCitato,
    numeroConferma:
      numeri.length > 0
        ? { valore: numeri.join(" + "), evidenza: primoCon("numeroConferma")!.evidenza }
        : null,
    riferimentoCliente: primoCon("riferimentoCliente"),
    dataDocumento: primoCon("dataDocumento"),
    dateConsegna: unione(e => e.dateConsegna),
    settimaneConsegna: unione(e => e.settimaneConsegna),
    settimaneApprontamento: unione(e => e.settimaneApprontamento ?? []),
    totaleDocumento: sommaTotale != null ? { valore: sommaTotale, evidenza: evidenzaSomma("totaleDocumento") } : null,
    imponibileDocumento:
      sommaImponibile != null ? { valore: sommaImponibile, evidenza: evidenzaSomma("imponibileDocumento") } : null,
    righe: sezioni.flatMap(s => s.estrazione.righe),
  };
  const motivoSomma =
    senzaImponibile.length > 0
      ? `Il file contiene ${sezioni.length} conferme e ${senzaImponibile.length === 1 ? "una" : senzaImponibile.length} (pagine ${senzaImponibile
          .map(s => `${s.da + 1}-${s.a + 1}`)
          .join(", ")}) non ha un imponibile leggibile: la somma non si fa.`
      : null;
  return { estrazione, sezioni, motivoSomma };
}
