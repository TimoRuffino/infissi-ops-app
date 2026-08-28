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
} from "./parserRegistry";
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

async function leggiByteDocumento(
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

export async function eseguiAnalisiConferma(input: {
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
  if (!input.forza) {
    const esistente = analisi.find(
      run =>
        run.sedeId === input.sedeId &&
        run.documentoId === input.documento.id &&
        run.ordineId === input.ordine.id &&
        run.byteChecksum === byteChecksum &&
        run.estrattoreVersione === ESTRATTORE_CONFERMA_VERSIONE &&
        run.confrontoVersione === CONFRONTO_ORDINE_VERSIONE
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
    createdBy: input.createdBy,
    createdAt: new Date(),
  };

  const esitoParser: EsitoParser = await estraiTestoDocumento(
    bytes,
    input.documento.mimeType,
    input.documento.nome
  );

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
          ? "PDF senza testo estraibile: probabilmente una scansione. Serve l'OCR (non ancora disponibile) o una verifica manuale del documento."
          : "motivo" in esitoParser
            ? esitoParser.motivo
            : null,
      avvertenze: [],
      pagine: null,
      estrazione: null,
      differenze: [],
    };
    analisi.push(run);
    _analisiStore.save();
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
  };
  analisi.push(run);
  _analisiStore.save();
  return { run, riusata: false };
}
