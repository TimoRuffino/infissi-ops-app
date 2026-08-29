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

export const ESTRATTORE_CONFERMA_VERSIONE = "1.0.0";

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
  dataDocumento: CampoEstratto<string> | null; // ISO YYYY-MM-DD
  dateConsegna: Array<CampoEstratto<string>>; // ISO, in ordine di apparizione
  settimaneConsegna: Array<CampoEstratto<number>>; // settimana ISO dichiarata
  totaleDocumento: CampoEstratto<number> | null;
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
  return `${a}-${String(m).padStart(2, "0")}-${String(g).padStart(2, "0")}`;
}

const DATA_RE = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/g;

function parseImporto(grezzo: string): number | null {
  const testo = grezzo.trim();
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
  const [primo] = cercaSuPagine(
    pagine,
    new RegExp(
      `(?<![A-Za-z0-9])${escapeRegex(pulito)}(?![A-Za-z0-9])`,
      "gi"
    )
  );
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
    dataDocumento: null,
    dateConsegna: [],
    settimaneConsegna: [],
    totaleDocumento: null,
    righe: [],
  };

  // ── Riferimento certo al NOSTRO ordine ─────────────────────────────────
  if (contesto.codiceOrdine) {
    const re = new RegExp(escapeRegex(contesto.codiceOrdine), "gi");
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
    const re = new RegExp(escapeRegex(contesto.fornitoreNome.trim()), "gi");
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
    const primo = trovati.find(({ match }) => /\d/.test(match[1] ?? ""));
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

  // ── Date: documento e consegna ─────────────────────────────────────────
  const PAROLE_CONSEGNA =
    /(consegna|spedizione|delivery|liefer|prevista|settimana|kw)/i;
  for (const { pagina, match } of cercaSuPagine(pagine, DATA_RE)) {
    const iso = normalizzaData(match[1], match[2], match[3]);
    if (!iso) continue;
    const contorno = pagine[pagina].slice(
      Math.max(0, match.index - 70),
      match.index + match[0].length + 30
    );
    const ev = evidenza(
      pagine,
      pagina,
      match.index,
      match[0].length,
      "pattern_testo",
      PAROLE_CONSEGNA.test(contorno) ? "media" : "bassa"
    );
    if (PAROLE_CONSEGNA.test(contorno)) {
      if (!risultato.dateConsegna.some(d => d.valore === iso)) {
        risultato.dateConsegna.push({ valore: iso, evidenza: ev });
      }
    } else if (!risultato.dataDocumento) {
      risultato.dataDocumento = { valore: iso, evidenza: ev };
    }
  }

  // ── Settimana di consegna dichiarata (sett. 37, KW 37) ─────────────────
  for (const { pagina, match } of cercaSuPagine(
    pagine,
    /\b(?:settimana|sett\.?|KW)\s*(\d{1,2})\b/gi
  )) {
    const settimana = Number(match[1]);
    if (!(settimana >= 1 && settimana <= 53)) continue;
    if (risultato.settimaneConsegna.some(s => s.valore === settimana)) continue;
    risultato.settimaneConsegna.push({
      valore: settimana,
      evidenza: evidenza(
        pagine,
        pagina,
        match.index,
        match[0].length,
        "pattern_testo",
        "media"
      ),
    });
  }

  // ── Totale del documento ───────────────────────────────────────────────
  // Con più «totale» nello stesso documento (parziali, imponibile, totale
  // documento) si presenta il MAGGIORE come lettura principale — è il totale
  // documento nella quasi totalità dei layout — e le altre restano come
  // interpretazioni alternative dichiarate (PRD §54.6).
  {
    const re =
      /\btotale(?:\s+(?:documento|ordine|conferma|imponibile|netto))?\b[^\d€]{0,20}(?:€|EUR)?\s*([\d.,]+)/gi;
    const candidati: Array<{ valore: number; ev: Evidenza }> = [];
    for (const { pagina, match } of cercaSuPagine(pagine, re)) {
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
      candidati.sort((a, b) => b.valore - a.valore);
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
    const re = new RegExp(
      `(?<![A-Za-z0-9])${escapeRegex(codice)}(?![A-Za-z0-9])`,
      "gi"
    );
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

  return risultato;
}

function escapeRegexTemp(value: string): RegExp {
  return new RegExp(escapeRegex(value), "gi");
}
