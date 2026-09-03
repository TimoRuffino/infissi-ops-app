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

const DATA_RE = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/g;

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
  // Fra più date candidate, quelle nel contesto di CONSEGNA vera battono
  // quelle di sola spedizione: dateConsegna[0] alimenta confronto e
  // proposte, e una data di spedizione non deve scavalcarla (revisione).
  const PAROLE_CONSEGNA_FORTI = /(consegna|delivery|liefer)/i;
  // Una data etichettata come data del DOCUMENTO («del 01/09/2026», «Data:
  // 01/09/2026») non diventa una consegna solo perché la riga dopo parla di
  // consegna: la finestra di contesto attraversa le righe, l'etichetta no.
  const ETICHETTA_DATA_DOCUMENTO =
    /(?:\bdel|\bdata(?:\s+(?:documento|conferma|ordine))?|\bdate|\bemess[ao]\s+il|\bdocumento|\bin\s+data)\s*[:.]?\s*$/i;
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
    const etichettaDocumento = ETICHETTA_DATA_DOCUMENTO.test(
      testoPagina.slice(Math.max(0, match.index - 25), match.index)
    );
    const contestoConsegna =
      PAROLE_CONSEGNA.test(riga) ||
      (!etichettaDocumento && PAROLE_CONSEGNA.test(contorno));
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
    const reImponibile =
      /\b(?:totale\s+)?(?:imponibile|netto\s+merce|base\s+imponibile)\b[^\d€]{0,20}(?:€|EUR)?\s*([\d.,]+)/gi;
    const candidati: Array<{ valore: number; ev: Evidenza }> = [];
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
      const reIva = /\bi\.?v\.?a\.?\b(?:\s*\d{1,2}\s*%)?[^\d€]{0,20}(?:€|EUR)?\s*([\d.,]+)/gi;
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

  return risultato;
}

function escapeRegexTemp(value: string): RegExp {
  return new RegExp(escapeRegex(value), "gi");
}
