// Pipeline di analisi delle conferme d'ordine (D7, slice 1 — PRD §54.6).
//
// Orchestrazione: legge i byte del documento DALLE FONTI ESISTENTI (storage
// durevole o base64 legacy), li trasforma in testo col registro parser,
// estrae i campi con evidenza e confronta con l'ordine fornitore. Il run è
// l'unico dato nuovo: derivato, rigenerabile, conservato per audit. NESSUNA
// scrittura su commesse, ordini, date o importi: le decisioni restano alle
// persone (le azioni proposte con approval gateway sono la slice 3 del
// piano).
//
// Idempotenza: stessa impronta byte + stesse versioni + stesso ordine →
// stesso run. `forza` rielabora creando un run NUOVO senza perdere i
// precedenti (impronta, versioni e data restano nel record).

import { createHash } from "node:crypto";
import { persistedStore } from "../_core/persistence";
import { getFile } from "../_core/fileStorage";
import {
  estraiTestoDocumento,
  type EsitoParser,
  type MetadatiOcr,
} from "./parserRegistry";
import { firmaOcrCorrente } from "./ocr";
import {
  ESTRATTORE_CONFERMA_VERSIONE,
  estraiConfermaOrdine,
  type EstrazioneConferma,
} from "./estrazioneConferma";
import {
  CONFRONTO_ORDINE_VERSIONE,
  confrontaConfermaConOrdine,
  type Differenza,
  type OrdinePerConfronto,
} from "./confrontoOrdine";

export type PassoAnalisi = {
  passo: "ricevuto" | "validato" | "estratto" | "confrontato";
  esito: string;
  at: Date;
};

export type StatoAnalisi =
  | "analizzata"
  | "scansione_senza_testo"
  | "illeggibile"
  | "non_supportato"
  | "errore";

export type AnalisiDocumento = {
  id: number;
  sedeId: number;
  documentoId: number;
  documentoNome: string;
  /** SHA-256 dei byte analizzati: l'impronta anti-duplicato del run. */
  byteChecksum: string;
  ordineId: number;
  commessaId: number | null;
  parser: string | null;
  parserVersione: string | null;
  estrattoreVersione: string;
  confrontoVersione: string;
  passi: PassoAnalisi[];
  stato: StatoAnalisi;
  motivoStato: string | null;
  avvertenze: string[];
  pagine: number | null;
  estrazione: EstrazioneConferma | null;
  differenze: Differenza[];
  /**
   * Firma della configurazione OCR rilevante per il run (slice 4):
   * "assente" quando l'OCR non poteva girare, la firma completa quando il
   * testo è arrivato dall'OCR, null per i run su testo nativo. Entra
   * nell'idempotenza: se l'OCR diventa disponibile o cambia
   * lingua/configurazione, un run `scansione_senza_testo` non viene
   * riusato.
   */
  ocrFirma: string | null;
  /** Metadati OCR (lingue, confidenze) quando il testo viene dall'OCR. */
  ocr: MetadatiOcr | null;
  /**
   * Impronta del contenuto dell'ordine al momento del run (codice, data
   * consegna, totale, righe): le differenze sono calcolate CONTRO questo
   * contenuto, quindi se l'ordine cambia il run non è più riusabile
   * (revisione). null nei run precedenti = jolly, si riusano come prima.
   */
  ordineFirma: string | null;
  /** Confidenza OCR insufficiente: revisione umana obbligatoria. */
  daVerificare: boolean;
  createdBy: number | null;
  createdAt: Date;
};

let nextAnalisiId = 1;
const _analisiStore = persistedStore<AnalisiDocumento>(
  "documenti_analisi",
  items => {
    nextAnalisiId = items.length
      ? Math.max(...items.map(item => item.id)) + 1
      : 1;
    // Backfill slice 4: i run precedenti all'OCR non hanno i campi nuovi.
    // Le scansioni ferme senza OCR valgono "assente", così diventano
    // rianalizzabili appena l'OCR è disponibile.
    for (const run of items) {
      if (run.ocrFirma === undefined) {
        run.ocrFirma = run.stato === "scansione_senza_testo" ? "assente" : null;
      }
      if (run.ocr === undefined) run.ocr = null;
      if (run.daVerificare === undefined) run.daVerificare = false;
      if (run.ordineFirma === undefined) run.ordineFirma = null;
    }
  }
);
const analisi = _analisiStore.items;

export function analisiPerOrdine(
  sedeId: number,
  ordineId: number
): AnalisiDocumento[] {
  return analisi
    .filter(run => run.sedeId === sedeId && run.ordineId === ordineId)
    .sort((a, b) => b.id - a.id);
}

export type DocumentoDaAnalizzare = {
  id: number;
  commessaId: number;
  nome: string;
  mimeType: string;
  storageKey?: string | null;
  dataBase64?: string | null;
};

export async function leggiByteDocumento(
  documento: DocumentoDaAnalizzare
): Promise<Buffer> {
  if (documento.storageKey) {
    const buffer = await getFile(documento.storageKey);
    if (!buffer) {
      throw new Error("File non disponibile nello storage.");
    }
    return buffer;
  }
  if (documento.dataBase64) {
    return Buffer.from(documento.dataBase64, "base64");
  }
  throw new Error("Il documento non ha byte leggibili (né storage né inline).");
}

function firmaOrdine(ordine: OrdinePerConfronto): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        codice: ordine.codiceOrdine,
        commessa: ordine.commessaCodice,
        consegna: ordine.dataConsegnaPrevista,
        totale: ordine.importoTotale,
        righe: ordine.righe.map(riga => [
          riga.codiceArticolo ?? "",
          riga.quantita,
        ]),
      })
    )
    .digest("hex")
    .slice(0, 16);
}

/** Quanti run conservare per coppia (documento, ordine): lo storico utile
 * senza far crescere all'infinito la riga JSONB dello store (revisione). */
const MAX_RUN_PER_COPPIA = 10;

// Due analisi concorrenti sullo stesso (sede, documento, ordine) — doppio
// click, due operatori — condividono lo stesso run invece di duplicarlo:
// il controllo d'idempotenza avviene PRIMA dell'OCR, che può durare minuti
// (revisione: TOCTOU).
const analisiInCorso = new Map<
  string,
  Promise<{ run: AnalisiDocumento; riusata: boolean }>
>();

export async function eseguiAnalisiConferma(input: {
  sedeId: number;
  documento: DocumentoDaAnalizzare;
  ordine: OrdinePerConfronto & { fornitoreNome: string | null };
  createdBy: number | null;
  forza?: boolean;
}): Promise<{ run: AnalisiDocumento; riusata: boolean }> {
  const chiaveInCorso = [
    input.sedeId,
    input.documento.id,
    input.ordine.id,
    input.forza ? "forza" : "",
  ].join("|");
  const inCorso = analisiInCorso.get(chiaveInCorso);
  if (inCorso) {
    return inCorso.then(esito => ({ run: esito.run, riusata: true }));
  }
  const esecuzione = eseguiAnalisiConfermaInterna(input);
  analisiInCorso.set(chiaveInCorso, esecuzione);
  try {
    return await esecuzione;
  } finally {
    analisiInCorso.delete(chiaveInCorso);
  }
}

async function eseguiAnalisiConfermaInterna(input: {
  sedeId: number;
  documento: DocumentoDaAnalizzare;
  ordine: OrdinePerConfronto & { fornitoreNome: string | null };
  createdBy: number | null;
  forza?: boolean;
}): Promise<{ run: AnalisiDocumento; riusata: boolean }> {
  const passi: PassoAnalisi[] = [
    { passo: "ricevuto", esito: "ok", at: new Date() },
  ];

  const bytes = await leggiByteDocumento(input.documento);
  const byteChecksum = createHash("sha256").update(bytes).digest("hex");
  passi.push({ passo: "validato", esito: "ok", at: new Date() });

  // Idempotenza: lo stesso file, con le stesse versioni, sullo stesso
  // ordine, non produce un secondo run (né attività duplicate a valle).
  // La firma OCR fa parte della chiave per i run che dipendono dall'OCR
  // (slice 4): un `scansione_senza_testo` fermo per OCR assente torna
  // analizzabile quando l'OCR compare o cambia lingue/configurazione.
  const firmaOcr = await firmaOcrCorrente();
  const firmaOrdineCorrente = firmaOrdine(input.ordine);
  if (!input.forza) {
    const esistente = analisi.find(
      run =>
        run.sedeId === input.sedeId &&
        run.documentoId === input.documento.id &&
        run.ordineId === input.ordine.id &&
        run.byteChecksum === byteChecksum &&
        run.estrattoreVersione === ESTRATTORE_CONFERMA_VERSIONE &&
        run.confrontoVersione === CONFRONTO_ORDINE_VERSIONE &&
        (run.ordineFirma == null || run.ordineFirma === firmaOrdineCorrente) &&
        (run.stato === "scansione_senza_testo" || run.parser === "pdf-ocr"
          ? (run.ocrFirma ?? "assente") === firmaOcr
          : true)
    );
    if (esistente) return { run: esistente, riusata: true };
  }

  const base = {
    id: nextAnalisiId++,
    sedeId: input.sedeId,
    documentoId: input.documento.id,
    documentoNome: input.documento.nome,
    byteChecksum,
    ordineId: input.ordine.id,
    commessaId: input.documento.commessaId ?? null,
    estrattoreVersione: ESTRATTORE_CONFERMA_VERSIONE,
    confrontoVersione: CONFRONTO_ORDINE_VERSIONE,
    ordineFirma: firmaOrdineCorrente,
    createdBy: input.createdBy,
    createdAt: new Date(),
  };

  const esitoParser: EsitoParser = await estraiTestoDocumento(
    bytes,
    input.documento.mimeType,
    input.documento.nome
  );

  function registraRun(run: AnalisiDocumento) {
    analisi.push(run);
    // Storico limitato per coppia: si potano i run più vecchi oltre il cap.
    const stessi = analisi
      .filter(
        r =>
          r.sedeId === run.sedeId &&
          r.documentoId === run.documentoId &&
          r.ordineId === run.ordineId
      )
      .sort((a, b) => a.id - b.id);
    while (stessi.length > MAX_RUN_PER_COPPIA) {
      const vecchio = stessi.shift()!;
      const indice = analisi.indexOf(vecchio);
      if (indice >= 0) analisi.splice(indice, 1);
    }
    _analisiStore.save();
  }

  if (esitoParser.esito !== "estratto") {
    const run: AnalisiDocumento = {
      ...base,
      parser: "parser" in esitoParser ? esitoParser.parser : null,
      parserVersione: "versione" in esitoParser ? esitoParser.versione : null,
      passi: [
        ...passi,
        { passo: "estratto", esito: esitoParser.esito, at: new Date() },
      ],
      stato: esitoParser.esito,
      motivoStato:
        esitoParser.esito === "scansione_senza_testo"
          ? (esitoParser.motivo ??
            "PDF senza testo estraibile: probabilmente una scansione. Senza OCR il contenuto non viene compreso.")
          : "motivo" in esitoParser
            ? esitoParser.motivo
            : null,
      avvertenze: [],
      pagine: null,
      estrazione: null,
      differenze: [],
      ocrFirma:
        esitoParser.esito === "scansione_senza_testo" ? firmaOcr : null,
      ocr: null,
      daVerificare: false,
    };
    registraRun(run);
    return { run, riusata: false };
  }

  passi.push({ passo: "estratto", esito: "ok", at: new Date() });
  const estrazione = estraiConfermaOrdine(esitoParser.pagine, {
    codiceOrdine: input.ordine.codiceOrdine,
    fornitoreNome: input.ordine.fornitoreNome,
    righeOrdine: input.ordine.righe.map(riga => ({
      id: riga.id,
      descrizione: riga.descrizione,
      codiceArticolo: riga.codiceArticolo ?? null,
      quantita: riga.quantita,
    })),
  });
  const differenze = confrontaConfermaConOrdine(estrazione, input.ordine);
  passi.push({ passo: "confrontato", esito: "ok", at: new Date() });

  const run: AnalisiDocumento = {
    ...base,
    parser: esitoParser.parser,
    parserVersione: esitoParser.versione,
    passi,
    stato: "analizzata",
    motivoStato: null,
    avvertenze: esitoParser.avvertenze,
    pagine: esitoParser.pagine.length,
    estrazione,
    differenze,
    ocrFirma: esitoParser.parser === "pdf-ocr" ? firmaOcr : null,
    ocr: esitoParser.ocr ?? null,
    daVerificare: esitoParser.ocr?.daVerificare ?? false,
  };
  registraRun(run);
  return { run, riusata: false };
}
