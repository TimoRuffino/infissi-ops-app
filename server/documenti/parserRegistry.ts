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

export type EsitoParser =
  | {
      esito: "estratto";
      parser: string;
      versione: string;
      pagine: string[];
      avvertenze: string[];
    }
  | {
      // Il PDF esiste ma non ha un layer testuale: è una scansione (o una
      // foto impaginata). Servirebbe l'OCR, che oggi non è disponibile:
      // stato esplicito, richiede un umano (PRD §54.6).
      esito: "scansione_senza_testo";
      parser: string;
      versione: string;
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

const pdfTestoNativo: ParserDocumento = {
  nome: "pdf-testo-nativo",
  versione: "1.0.0",
  supporta: (mimeType, nomeFile) =>
    (mimeType ?? "").toLowerCase().includes("pdf") ||
    nomeFile.toLowerCase().endsWith(".pdf"),
  async estrai(bytes) {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractText(pdf, { mergePages: false });
      const pagine = (Array.isArray(text) ? text : [text ?? ""]).map(pagina =>
        String(pagina ?? "")
          .replace(/[ \t]+\n/g, "\n")
          .trim()
      );
      const totale = pagine.reduce((somma, p) => somma + p.length, 0);
      if (totale === 0) {
        return {
          esito: "scansione_senza_testo",
          parser: this.nome,
          versione: this.versione,
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

// Ordine di registrazione = priorità. Slot futuri (piano §4): `pdf-ocr`,
// `immagine`, `xlsx-csv`, `xml`, `zip`, parser proprietari per fornitore.
const PARSER_REGISTRATI: readonly ParserDocumento[] = [pdfTestoNativo];

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
  nomeFile: string
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
      motivo: `Nessun parser per «${mimeType || nomeFile}». Oggi so leggere PDF con testo; OCR e altri formati sono pianificati (docs/reports/d7-document-intelligence-piano.md).`,
    };
  }
  return parser.estrai(bytes);
}
