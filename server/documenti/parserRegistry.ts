// Registro dei parser documentali (D7, slice 1 — PRD §54.6).
//
// Ogni parser dichiara cosa sa leggere e restituisce TESTO PER PAGINA: le
// evidenze dell'estrazione citano pagina e frammento, quindi il testo non
// va mai appiattito. Un formato non supportato, cifrato o corrotto produce
// un esito esplicito — mai un fallimento silenzioso, mai un'eccezione che
// somiglia a un bug.
//
// Il contenuto dei file è INPUT NON FIDATO: qui viene solo trasformato in
// testo inerte. Nessun modello, nessuna esecuzione, nessun accesso oltre al
// buffer ricevuto.

import { extractText, getDocumentProxy } from "unpdf";
import { interruttoreAttivo } from "../platform/interruttori";
import {
  OCR_VERSIONE,
  configOcrDefault,
  disponibilitaOcr,
  eseguiOcrPdf,
  type ConfigOcr,
} from "./ocr";
import { pagineDaDocumento, type DocumentoPdf } from "./testoPdf";

export type MetadatiOcr = {
  lingue: string;
  lingueMancanti: string[];
  dpi: number;
  confidenzaPagine: number[];
  confidenzaMedia: number;
  daVerificare: boolean;
};

export type EsitoParser =
  | {
      esito: "estratto";
      parser: string;
      versione: string;
      pagine: string[];
      avvertenze: string[];
      /** Presente solo quando il testo arriva dall'OCR locale (slice 4). */
      ocr?: MetadatiOcr;
    }
  | {
      // Il PDF esiste ma non ha un layer testuale: è una scansione (o una
      // foto impaginata). Senza un OCR riuscito il contenuto NON viene
      // compreso: stato esplicito, richiede un umano (PRD §54.6). `motivo`
      // spiega perché l'OCR non ha aiutato (assente, fallito, timeout…).
      esito: "scansione_senza_testo";
      parser: string;
      versione: string;
      motivo?: string;
      pagineTotali?: number;
    }
  | {
      esito: "illeggibile";
      parser: string;
      versione: string;
      motivo: string;
    }
  | { esito: "non_supportato"; motivo: string };

export type ParserDocumento = {
  nome: string;
  versione: string;
  supporta: (mimeType: string, nomeFile: string) => boolean;
  estrai: (bytes: Buffer) => Promise<EsitoParser>;
};

const MAX_BYTE_ANALISI = 15 * 1024 * 1024;

/**
 * Le pagine di un PDF con testo nativo: righe ricostruite dalla geometria
 * dei frammenti (2.0.0). Se la geometria manca (frammenti senza coordinate)
 * resta il testo piatto di unpdf, nell'ordine del flusso.
 */
async function pagineNative(pdf: unknown): Promise<string[]> {
  try {
    return await pagineDaDocumento(pdf as DocumentoPdf);
  } catch {
    const { text } = await extractText(pdf as any, { mergePages: false });
    return (Array.isArray(text) ? text : [text ?? ""]).map(pagina =>
      String(pagina ?? "")
    );
  }
}

const pdfTestoNativo: ParserDocumento = {
  nome: "pdf-testo-nativo",
  // 2.0.0 (04/09/2026): righe dalla geometria, non dal flusso di contenuto —
  // etichette e valori tornano affiancati, le colonne restano celle.
  versione: "2.0.0",
  supporta: (mimeType, nomeFile) =>
    (mimeType ?? "").toLowerCase().includes("pdf") ||
    nomeFile.toLowerCase().endsWith(".pdf"),
  async estrai(bytes) {
    try {
      // verbosity 0 = solo errori: pdf.js altrimenti scrive un «Warning:»
      // per ogni font che non sa misurare (Math.sumPrecise assente in Node)
      // e il worker delle conferme ne produce decine per documento.
      const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
      // Si tolgono gli spazi in coda alle righe e le righe vuote ai bordi,
      // NON il rientro iniziale: è la colonna del frammento, e un valore
      // sotto la sua etichetta si riconosce da lì.
      const pagine = (await pagineNative(pdf)).map(pagina =>
        pagina.replace(/[ \t]+\n/g, "\n").replace(/^\n+/, "").replace(/\s+$/, "")
      );
      const totale = pagine.reduce((somma, p) => somma + p.length, 0);
      if (totale === 0) {
        return {
          esito: "scansione_senza_testo",
          parser: this.nome,
          versione: this.versione,
          pagineTotali: pagine.length,
        };
      }
      const avvertenze: string[] = [];
      if (pagine.some(p => p.length === 0)) {
        avvertenze.push(
          "Alcune pagine non hanno testo estraibile (probabili scansioni)."
        );
      }
      return {
        esito: "estratto",
        parser: this.nome,
        versione: this.versione,
        pagine,
        avvertenze,
      };
    } catch (errore: any) {
      // PDF cifrato, troncato o corrotto: unpdf lancia. È un esito, non un
      // crash: il documento richiede assistenza umana.
      return {
        esito: "illeggibile",
        parser: this.nome,
        versione: this.versione,
        motivo: String(errore?.message ?? errore ?? "PDF non leggibile"),
      };
    }
  },
};

// Ordine di registrazione = priorità. `pdf-ocr` non è in lista: è il
// FALLBACK esplicito del nativo dentro `estraiTestoDocumento`, mai una
// scelta silenziosa. Slot futuri (piano §4): `immagine`, `xlsx-csv`,
// `xml`, `zip`, parser proprietari per fornitore.
const PARSER_REGISTRATI: readonly ParserDocumento[] = [pdfTestoNativo];

/**
 * Fallback OCR (slice 4): parte SOLO quando il testo nativo è assente.
 * Successo → `estratto` con parser `pdf-ocr`, avvertenze e confidenze;
 * qualunque problema (binario mancante, lingua mancante, timeout, OCR
 * fallito) → il documento resta `scansione_senza_testo` con il motivo
 * esplicito: senza testo riconosciuto il contenuto NON è compreso.
 */
async function tentaOcr(
  bytes: Buffer,
  scansione: Extract<EsitoParser, { esito: "scansione_senza_testo" }>,
  config?: Partial<ConfigOcr>
): Promise<EsitoParser> {
  if (!interruttoreAttivo("ocr")) {
    return {
      ...scansione,
      motivo:
        "OCR disattivato dalla configurazione (FLAG_OCR): senza OCR il contenuto non viene compreso.",
    };
  }
  const disponibilita = await disponibilitaOcr(
    { ...configOcrDefault().binari, ...config?.binari }
  );
  if (!disponibilita.disponibile) {
    return {
      ...scansione,
      motivo: `Senza OCR il contenuto non viene compreso. ${disponibilita.motivo ?? ""}`.trim(),
    };
  }
  const esitoOcr = await eseguiOcrPdf(bytes, {
    numeroPagine: scansione.pagineTotali ?? null,
    config,
  });
  if (esitoOcr.esito !== "ocr_completato") {
    return { ...scansione, motivo: esitoOcr.motivo };
  }
  const testoTotale = esitoOcr.pagine.reduce(
    (somma, pagina) => somma + pagina.testo.length,
    0
  );
  if (testoTotale === 0) {
    return {
      ...scansione,
      motivo:
        "OCR eseguito ma nessun testo riconosciuto: il contenuto resta non compreso (immagine vuota o illeggibile).",
    };
  }
  const confidenze = esitoOcr.pagine.map(pagina => pagina.confidenza);
  const conParole = esitoOcr.pagine.filter(pagina => pagina.parole > 0);
  const confidenzaMedia = conParole.length
    ? Math.round(
        conParole.reduce((somma, pagina) => somma + pagina.confidenza, 0) /
          conParole.length
      )
    : 0;
  const avvertenze = [
    `Testo ricavato con OCR locale (lingue ${esitoOcr.lingue}, confidenza media ${confidenzaMedia}%): verificare i campi sul documento originale.`,
  ];
  if (esitoOcr.lingueMancanti.length > 0) {
    avvertenze.push(
      `Lingue richieste ma non installate: ${esitoOcr.lingueMancanti.join(", ")}.`
    );
  }
  if (esitoOcr.daVerificare) {
    avvertenze.push(
      "Confidenza OCR bassa: risultato DA VERIFICARE, non usarlo senza controllo umano."
    );
  }
  return {
    esito: "estratto",
    parser: "pdf-ocr",
    versione: OCR_VERSIONE,
    pagine: esitoOcr.pagine.map(pagina => pagina.testo),
    avvertenze,
    ocr: {
      lingue: esitoOcr.lingue,
      lingueMancanti: esitoOcr.lingueMancanti,
      dpi: esitoOcr.dpi,
      confidenzaPagine: confidenze,
      confidenzaMedia,
      daVerificare: esitoOcr.daVerificare,
    },
  };
}

export function trovaParser(
  mimeType: string,
  nomeFile: string
): ParserDocumento | null {
  return (
    PARSER_REGISTRATI.find(parser => parser.supporta(mimeType, nomeFile)) ??
    null
  );
}

export async function estraiTestoDocumento(
  bytes: Buffer,
  mimeType: string,
  nomeFile: string,
  opzioni?: {
    /** `false` disattiva il fallback OCR; un oggetto ne cambia i limiti. */
    ocr?: Partial<ConfigOcr> | false;
  }
): Promise<EsitoParser> {
  if (bytes.length === 0) {
    return { esito: "non_supportato", motivo: "File vuoto." };
  }
  if (bytes.length > MAX_BYTE_ANALISI) {
    return {
      esito: "non_supportato",
      motivo: `Il file pesa ${Math.round(bytes.length / 1024 / 1024)} MB: oltre il limite di analisi di 15 MB.`,
    };
  }
  const parser = trovaParser(mimeType, nomeFile);
  if (!parser) {
    return {
      esito: "non_supportato",
      motivo: `Nessun parser per «${mimeType || nomeFile}». Oggi so leggere PDF con testo (e scansioni via OCR locale); altri formati sono pianificati (docs/reports/d7-document-intelligence-piano.md).`,
    };
  }
  const esito = await parser.estrai(bytes);
  if (esito.esito === "scansione_senza_testo" && opzioni?.ocr !== false) {
    return tentaOcr(
      bytes,
      esito,
      opzioni?.ocr === undefined ? undefined : opzioni.ocr
    );
  }
  if (esito.esito === "scansione_senza_testo" && !esito.motivo) {
    return {
      ...esito,
      motivo:
        "PDF senza testo estraibile: senza OCR il contenuto non viene compreso.",
    };
  }
  return esito;
}
