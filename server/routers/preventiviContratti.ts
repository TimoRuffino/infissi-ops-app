import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { getCommessaById, getCommesseStore } from "./commesse";
import { STATI_COMMESSA } from "../commesse/transizioni";
import { DEFAULT_SEDE_ID } from "./sedi";
import {
  requireDirezioneOAmministrazione,
  requireOwnershipOrDirezione,
} from "../_core/permissions";
import { Readable } from "stream";
import {
  deleteFileQuiet,
  getFile,
  openFileReadStream,
  putFile,
} from "../_core/fileStorage";
import { registerMigratableCollection } from "../_core/fileStorageMigrate";
import {
  COMMESSA_UPLOAD_INLINE_FALLBACK_MAX_BYTES,
  erroreUploadCommessa,
} from "@shared/commessaUpload";
import {
  rimuoviCostoDelDocumento,
  spostaCostoDelDocumento,
} from "../commesse/costiRegistro";
import type { LetturaCostoDocumento } from "../commesse/letturaCostoTipi";
import type { AnteprimeDocumento } from "../documenti/anteprime";
import {
  prodottiDelDocumento,
  rimuoviProdottiDelDocumento,
  spostaProdottiDelDocumento,
} from "./magazzino";
import { getUtentiStore } from "./utenti";

/**
 * Chi ha messo il documento nel fascicolo: serve al registro delle conferme
 * (direzione 03/09 sera: «crea un registro delle conf. ordine archiviate
 * automaticamente»).
 */
export const ORIGINI_DOCUMENTO = [
  "upload", // dalla scheda commessa
  "mail", // a mano dalla pagina Messaggi
  "tars", // Tars su richiesta di un utente
  "smistamento", // lo smistamento di Tars, in fondo
  "automatico", // la regola delle conferme certe, in fondo
  "fic", // PDF scaricato da Fatture in Cloud
] as const;
export type OrigineDocumento = (typeof ORIGINI_DOCUMENTO)[number];

// ── Types ───────────────────────────────────────────────────────────────────

// Extended tipo enum — one slot per board state so each transition can be
// gated by the right artefact. "foto" and "altro" remain for miscellaneous
// uploads that do not satisfy any gate.
// I tipi che il fascicolo sa nominare. I primi dieci hanno un ruolo nel doc
// gate; gli altri esistono perché una commessa raccoglie anche documenti che
// non fanno avanzare niente — un documento d'identità, una visura, una
// planimetria — e "Altro" li rendeva tutti indistinguibili al momento di
// ritrovarli.
// La lista vive in /shared: server e client ne usano una sola.
import { DOC_TIPI, DOC_TIPO_LABEL, type DocTipo } from "@shared/docTipi";
export { DOC_TIPI, DOC_TIPO_LABEL };
export type { DocTipo };

export type Documento = {
  id: number;
  commessaId: number;
  nome: string;
  tipo: DocTipo;
  mimeType: string;
  size: number;
  // Legacy: base64 bytes inline in the JSONB blob. New uploads go to the
  // fileStorage driver instead (storageKey) so collection saves stay small.
  // A record has exactly one of the two; reads fall back to dataBase64.
  dataBase64?: string;
  storageKey?: string | null;
  checksum?: string | null; // sha256 hex of the raw bytes
  note: string | null;
  statoAtUpload: string | null; // commessa.stato at time of upload (for gates)
  createdBy: number | null;
  createdAt: Date;
  // "crm": prodotto dal CRM stesso (il PDF della fattura emessa dal
  // ciclo di fatturazione), non importato né caricato a mano.
  source?: "fic" | "comunicazione" | "crm";
  sourceRef?: string;
  /**
   * Cosa ha dato la lettura del documento come conferma d'ordine (il costo
   * del margine, 03/09/2026). Null finché nessuno l'ha letto: il worker
   * passa a leggere le conferme senza esito.
   */
  letturaCosto?: LetturaCostoDocumento | null;
  /** Chi lo ha messo nel fascicolo (backfill dalle note per i vecchi). */
  origine?: OrigineDocumento;
  /**
   * Una persona ha confermato che questa conferma è di questa commessa
   * anche se il testo non la cita: da qui costo e merce possono nascere.
   */
  riscontroConfermato?: boolean;
  /**
   * Le pagine rese per le anteprime delle evidenze (06/09/2026): metadato
   * piccolo, le immagini stanno nello storage. Null finché nessuno le ha
   * rese; si rifanno se cambiano versione o impronta.
   */
  anteprime?: AnteprimeDocumento | null;
};

// ── In-memory data ──────────────────────────────────────────────────────────

let nextId = 1;
/**
 * Tipi accorpati: la chiave sparisce dall'elenco, ma i documenti già
 * archiviati sotto quel nome restano leggibili solo se li si riporta al tipo
 * che sopravvive. Idempotente: su uno store già migrato risponde `false` e
 * non fa riscrivere il blob a ogni avvio.
 */
const TIPI_ACCORPATI: Record<string, DocTipo> = {
  // Ordine fornitore e conferma d'ordine erano due voci per lo stesso
  // foglio (richiesta del 03/09/2026).
  ordine: "conferma_ordine",
};

export function migraTipiDocumento(caricati: Documento[]): boolean {
  let cambiato = false;
  for (const documento of caricati) {
    const accorpato = TIPI_ACCORPATI[documento.tipo as string];
    if (!accorpato) continue;
    documento.tipo = accorpato;
    cambiato = true;
  }
  return cambiato;
}

const _documentiStore = persistedStore<Documento>(
  "preventivi_documenti",
  loaded => {
    nextId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
    if (migraTipiDocumento(loaded)) {
      setTimeout(() => _documentiStore.save(), 0);
    }
    // Backfill statoAtUpload on legacy docs: default to "preventivo" so the
    // first transition still works for existing commesse.
    for (const d of loaded) {
      if ((d as any).statoAtUpload === undefined) {
        (d as any).statoAtUpload = "preventivo";
      }
      // Conferme archiviate prima della regola del costo: da leggere.
      if ((d as any).letturaCosto === undefined) (d as any).letturaCosto = null;
      if ((d as any).origine === undefined) (d as any).origine = origineDaRecord(d);
      // Anteprime delle evidenze: nessuna finché qualcuno non le rende.
      if ((d as any).anteprime === undefined) (d as any).anteprime = null;
    }
  }
);

/** Per i documenti nati prima del campo: l'origine si legge da fonte e note. */
export function origineDaRecord(d: Documento): OrigineDocumento {
  if (d.source === "fic") return "fic";
  if (d.source === "comunicazione") {
    const note = d.note ?? "";
    if (/smistamento/i.test(note)) return "smistamento";
    if (/automatic/i.test(note)) return "automatico";
    if (/tars/i.test(note)) return "tars";
    return "mail";
  }
  return "upload";
}
const documenti = _documentiStore.items;

registerMigratableCollection({
  key: "preventivi_documenti",
  parentIdOf: (d: Documento) => d.commessaId,
  store: _documentiStore,
  items: documenti,
});

// Il limite storico resta per allegati importati da comunicazioni e FiC.
// L'upload manuale della scheda commessa usa il contratto dedicato da 250 MB.
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

// Allowlist of mimeTypes accepted for upload. Deliberately excludes
// text/html and image/svg+xml: both can carry executable script, and the
// client previews uploads inside an <iframe> via a blob: URL that inherits
// the app origin — an html/svg upload would become stored XSS. Anything not
// on this list is rejected outright.
const ALLOWED_MIME_TYPES = new Set<string>([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // Niente XML: l'XML FatturaPA del piano 2 vive nello storage
  // `fatture_xml` e si scarica da `fatture.documento`, non entra nel
  // fascicolo (Ruling R37).
]);

export function validaAllegatoFascicolo(
  buffer: Buffer,
  mimeType: string
): void {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new Error(`Tipo di file non consentito: ${mimeType}`);
  }
  if (buffer.length > MAX_SIZE_BYTES) {
    throw new Error("L'allegato supera il limite di 10MB del fascicolo.");
  }
}

export function validaUploadManualeFascicolo(
  actualBytes: number,
  mimeType: string
): void {
  const errore = erroreUploadCommessa(actualBytes, mimeType);
  if (errore) throw new Error(errore);
}

// Decodifica stretta: Buffer.from(base64) da solo è permissivo e accetterebbe
// anche payload come "=", producendo byte vuoti e metadati con size errata.
export function decodificaBase64Upload(b64: string): Buffer {
  const len = b64.length;
  if (len === 0 || len % 4 !== 0) {
    throw new Error("Payload base64 non valido.");
  }
  let padding = 0;
  if (b64.endsWith("==")) padding = 2;
  else if (b64.endsWith("=")) padding = 1;

  const payloadEnd = len - padding;
  for (let i = 0; i < payloadEnd; i++) {
    const code = b64.charCodeAt(i);
    const valido =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 43 ||
      code === 47;
    if (!valido) throw new Error("Payload base64 non valido.");
  }
  for (let i = payloadEnd; i < len; i++) {
    if (b64.charCodeAt(i) !== 61) {
      throw new Error("Payload base64 non valido.");
    }
  }

  const buffer = Buffer.from(b64, "base64");
  const expectedBytes = (len / 4) * 3 - padding;
  if (buffer.length !== expectedBytes) {
    throw new Error("Payload base64 non valido.");
  }
  return buffer;
}

// Build the stored filename from the chosen document TYPE (not the board
// stato): "{Tipo label} {cliente}.{ext}". Preserves the original extension.
function buildNomeFromTipo(
  originalName: string,
  tipo: DocTipo,
  cliente?: string | null
): string {
  const dotIdx = originalName.lastIndexOf(".");
  const ext = dotIdx > 0 ? originalName.slice(dotIdx) : "";
  const label = DOC_TIPO_LABEL[tipo] ?? "Documento";
  const who = (cliente ?? "").trim();
  const stem = who ? `${label} ${who}` : label;
  // Strip characters that are awkward in filenames.
  const safe = stem
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${safe}${ext}`;
}

// If `name` already exists among the commessa's documenti, return it with a
// numeric suffix before the extension ("foo.pdf" → "foo (2).pdf") that makes
// it unique. Otherwise returns `name` unchanged.
function dedupeName(
  name: string,
  commessaId: number,
  excludeId?: number
): string {
  const taken = new Set(
    documenti
      .filter(d => d.commessaId === commessaId && d.id !== excludeId)
      .map(d => d.nome)
  );
  if (!taken.has(name)) return name;
  const dotIdx = name.lastIndexOf(".");
  const hasExt = dotIdx > 0 && dotIdx < name.length - 1;
  const stem = hasExt ? name.slice(0, dotIdx) : name;
  const ext = hasExt ? name.slice(dotIdx) : ""; // includes the dot
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return name; // pathological fallback
}

// ── State-gate config ─────────────────────────────────────────────────────
// For each stato, lists the doc tipi that count as "mandatory output". The
// commessa cannot leave the stato until at least one doc with one of these
// tipi has been uploaded WHILE the commessa was in that stato.
export const REQUIRED_DOC_TIPI_PER_STATO: Record<string, DocTipo[]> = {
  preventivo: ["preventivo", "contratto"],
  misure_esecutive: ["misure"],
  aggiornamento_contratto: ["contratto"],
  fatture_pagamento: ["fattura"],
  da_ordinare: ["conferma_ordine"],
  produzione: [], // gated by dataConsegnaConfermata elsewhere
  ordini_ultimazione: ["saldo", "fattura"],
  attesa_posa: ["ddt_consegna"],
  finiture_saldo: ["ddt_posa"],
  interventi_regolazioni: ["ddt_finale"],
  archiviata: [],
};

// Convenience label map used by the UI and error messages.


// Tipi il cui nome non va riscritto automaticamente all'upload.
//
// L'auto-rename "{Tipo} {cliente}.pdf" è utile sui documenti di commessa, che
// sono uno per tipo. Su un documento d'identità è dannoso: in una commessa
// ce ne sono due o tre — intestatario, coniuge, delegato — e schiacciarli
// tutti su "Documento d'identità Rossi Mario" li rende indistinguibili, con
// un " (2)" appiccicato a decidere chi è chi.
export const DOC_TIPI_NOME_ORIGINALE: readonly DocTipo[] = [
  "documento_identita",
  "visura",
  "planimetria",
  "certificazione",
  "foto",
  "altro",
];

// Cascade for commesse.delete — removes the documents AND their storage
// bytes when the parent commessa is hard-deleted.
export function deleteDocumentiByCommessa(commessaId: number) {
  for (let i = documenti.length - 1; i >= 0; i--) {
    if (documenti[i].commessaId === commessaId) {
      deleteFileQuiet(documenti[i].storageKey);
      documenti.splice(i, 1);
    }
  }
  _documentiStore.save();
}

function ficSourceRef(sedeId: number, ficId: number): string {
  return `fic:${sedeId}:${ficId}`;
}

function legacyFicSourceRef(sedeId: number, ficId: number): string {
  return `${sedeId}:${ficId}`;
}

/** L'id FIC dentro un sourceRef, nelle due forme storiche. */
export function ficIdDaSourceRef(
  sourceRef: string | null | undefined,
  sedeId: number
): number | null {
  if (!sourceRef) return null;
  const parti = sourceRef.split(":");
  const attese =
    parti.length === 3 && parti[0] === "fic"
      ? parti.slice(1)
      : parti.length === 2
        ? parti
        : null;
  if (!attese) return null;
  const [sede, fic] = attese.map(Number);
  if (!Number.isSafeInteger(sede) || !Number.isSafeInteger(fic)) return null;
  return sede === sedeId ? fic : null;
}

function comunicazioneSourceRef(
  sedeId: number,
  comunicazioneId: number,
  allegatoIndex: number
): string {
  return `${sedeId}:${comunicazioneId}:${allegatoIndex}`;
}

const archivioComunicazioneCode = new Map<string, Promise<void>>();

export class StorageAllegatoTemporaneamenteNonDisponibile extends Error {
  constructor() {
    super(
      "Riprova tra poco: lo storage documenti non è disponibile e nessun allegato è stato archiviato."
    );
    this.name = "StorageAllegatoTemporaneamenteNonDisponibile";
  }
}

async function serializzaArchivioComunicazione<T>(
  sourceRef: string,
  operation: () => Promise<T>
): Promise<T> {
  const precedente =
    archivioComunicazioneCode.get(sourceRef) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const corrente = precedente.catch(() => undefined).then(() => gate);
  archivioComunicazioneCode.set(sourceRef, corrente);

  await precedente.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (archivioComunicazioneCode.get(sourceRef) === corrente) {
      archivioComunicazioneCode.delete(sourceRef);
    }
  }
}

/** Nome senza il suffisso « (n)» che dedupeName aggiunge ai file omonimi. */
function nomeSenzaProgressivo(nome: string): string {
  return nome.replace(/ \(\d+\)(\.[^.]+)?$/, "$1").toLowerCase();
}

/**
 * Lo stesso file è già nel fascicolo della commessa: byte identici
 * (checksum SHA-256) oppure, per i documenti legacy senza checksum, stesso
 * nome e stessa dimensione.
 */
export function trovaDuplicatoNelFascicolo(
  commessaId: number,
  file: { checksum: string; nome: string; size: number }
): Documento | null {
  const nome = nomeSenzaProgressivo(file.nome);
  return (
    documenti.find(
      d =>
        d.commessaId === commessaId &&
        (d.checksum
          ? d.checksum === file.checksum
          : d.size === file.size && nomeSenzaProgressivo(d.nome) === nome)
    ) ??
    // Byte diversi ma stesso file RIMANDATO: il portale del fornitore
    // riesporta la stessa conferma e il client la salva come «… (2).pdf»
    // («Ordini_di_Vendi_1602923(1).pdf», 110,7 KB, poi «… (1) (2).pdf»,
    // 110,5 KB). Solo con il progressivo nel nome in arrivo, stesso nome
    // base e dimensione entro il 2 % — direzione 04/09/2026: «spesso Tars
    // mette dei duplicati». Un file con lo stesso nome e byte diversi senza
    // progressivo resta un documento nuovo (contratto del dedup).
    (/ \(\d+\)(\.[^.]+)?$/.test(file.nome)
      ? documenti.find(
          d =>
            d.commessaId === commessaId &&
            nomeSenzaProgressivo(d.nome) === nome &&
            d.size > 0 &&
            Math.abs(d.size - file.size) <= Math.max(2048, d.size * 0.02)
        )
      : null) ??
    null
  );
}

/** Documento del fascicolo già creato da questo allegato di comunicazione. */
export function findDocumentoComunicazione(
  sedeId: number,
  comunicazioneId: number,
  allegatoIndex: number
): Documento | null {
  const sourceRef = comunicazioneSourceRef(
    sedeId,
    comunicazioneId,
    allegatoIndex
  );
  return (
    documenti.find(
      documento =>
        documento.source === "comunicazione" &&
        documento.sourceRef === sourceRef
    ) ?? null
  );
}

/** Archivia un allegato di comunicazione approvato senza duplicare i retry. */
export async function archiviaAllegatoComunicazione(args: {
  sedeId: number;
  comunicazioneId: number;
  allegatoIndex: number;
  commessaId: number;
  nome: string;
  tipo: DocTipo;
  note?: string;
  mimeType: string;
  /**
   * Byte già letti, oppure una rilettura eseguita DENTRO la sezione
   * serializzata: chi deve garantire che i byte archiviati coincidano con
   * una fonte verificata passa la funzione, che può rifiutare l'effetto.
   */
  buffer: Buffer | (() => Promise<Buffer>);
  createdBy: number | null;
  /**
   * Un sourceRef già archiviato su un'ALTRA commessa blocca l'operazione
   * (`SOURCE_REF_OCCUPATO`) invece di spostare il documento. Il flusso
   * manuale del router mail conserva lo spostamento storico.
   */
  vietaRiassegnazione?: boolean;
  /** Chi archivia: a mano dai Messaggi (default), Tars, lo smistamento, la regola automatica. */
  origine?: OrigineDocumento;
}): Promise<Documento> {
  if (Buffer.isBuffer(args.buffer)) {
    validaAllegatoFascicolo(args.buffer, args.mimeType);
  }
  const commessa = commessaInSede(args.commessaId, args.sedeId);
  if (!commessa) throw new Error("Commessa non trovata");

  const sourceRef = comunicazioneSourceRef(
    args.sedeId,
    args.comunicazioneId,
    args.allegatoIndex
  );
  const archiviato = await serializzaArchivioComunicazione(sourceRef, async () => {
    const existing = documenti.find(
      documento =>
        documento.source === "comunicazione" &&
        documento.sourceRef === sourceRef
    );
    if (existing?.commessaId === args.commessaId) return existing;
    if (existing && args.vietaRiassegnazione) {
      throw new Error(
        "SOURCE_REF_OCCUPATO: allegato già archiviato su un'altra commessa."
      );
    }
    const bytes = Buffer.isBuffer(args.buffer)
      ? args.buffer
      : await args.buffer();
    validaAllegatoFascicolo(bytes, args.mimeType);

    // Stesso file già nel fascicolo (altra mail, inoltro, upload a mano):
    // non si duplica. Mandato direzione 02/09/2026: «deve stare attento a
    // non collegarli se sono già presenti».
    if (!existing) {
      const duplicato = trovaDuplicatoNelFascicolo(args.commessaId, {
        checksum: createHash("sha256").update(bytes).digest("hex"),
        nome: args.nome,
        size: bytes.length,
      });
      if (duplicato) return duplicato;
    }

    const id = existing?.id ?? nextId++;
    const nome = dedupeName(args.nome, args.commessaId, existing?.id);
    const oldStorageKey = existing?.storageKey;
    const documento: Documento = existing
      ? { ...existing }
      : {
          id,
          commessaId: args.commessaId,
          nome,
          tipo: args.tipo,
          mimeType: args.mimeType,
          size: bytes.length,
          note: null,
          statoAtUpload: commessa.stato ?? null,
          createdBy: args.createdBy,
          createdAt: new Date(),
        };

    documento.commessaId = args.commessaId;
    documento.nome = nome;
    documento.tipo = args.tipo;
    documento.mimeType = args.mimeType;
    documento.size = bytes.length;
    documento.note =
      args.note ?? "Archiviato manualmente da un allegato di comunicazione.";
    documento.statoAtUpload = commessa.stato ?? null;
    documento.source = "comunicazione";
    documento.sourceRef = sourceRef;
    documento.origine = args.origine ?? "mail";

    try {
      const stored = await putFile(
        "preventivi_documenti",
        args.commessaId,
        documento.id,
        nome,
        bytes,
        args.mimeType
      );
      documento.storageKey = stored.storageKey;
      documento.checksum = stored.checksum;
      delete documento.dataBase64;
    } catch {
      throw new StorageAllegatoTemporaneamenteNonDisponibile();
    }

    if (existing) Object.assign(existing, documento);
    else documenti.push(documento);
    _documentiStore.save();
    if (oldStorageKey && oldStorageKey !== documento.storageKey) {
      deleteFileQuiet(oldStorageKey);
    }
    return documento;
  });
  // Fuori dalla sezione serializzata: leggere il PDF non deve tenere il
  // lucchetto dell'allegato.
  await agganciaCostoDaConferma(archiviato, "archiviazione");
  return archiviato;
}

/** Crea o sposta il documento FIC senza duplicarlo nei ricollegamenti. */
export async function upsertDocumentoFic(args: {
  sedeId: number;
  ficId: number;
  commessaId: number;
  numero: string;
  data: string;
  pdf: Buffer;
  createdBy: number | null;
}): Promise<Documento> {
  validaAllegatoFascicolo(args.pdf, "application/pdf");
  const commessa = commessaInSede(args.commessaId, args.sedeId);
  if (!commessa) throw new Error("Commessa non trovata");

  const sourceRef = ficSourceRef(args.sedeId, args.ficId);
  const existing = findDocumentoFic(args.sedeId, args.ficId);
  const id = existing?.id ?? nextId++;
  const numeroSicuro = args.numero
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const nome = dedupeName(
    `Fattura ${numeroSicuro || args.ficId}.pdf`,
    args.commessaId,
    existing?.id
  );
  const oldStorageKey = existing?.storageKey;
  const doc: Documento = existing
    ? { ...existing }
    : {
        id,
        commessaId: args.commessaId,
        nome,
        tipo: "fattura",
        mimeType: "application/pdf",
        size: args.pdf.length,
        note: null,
        statoAtUpload: commessa.stato ?? null,
        createdBy: args.createdBy,
        createdAt: new Date(),
      };

  doc.commessaId = args.commessaId;
  doc.nome = nome;
  doc.tipo = "fattura";
  doc.mimeType = "application/pdf";
  doc.size = args.pdf.length;
  doc.note = `Importata automaticamente da Fatture in Cloud · ${args.data}`;
  doc.statoAtUpload = commessa.stato ?? null;
  doc.source = "fic";
  doc.sourceRef = sourceRef;

  try {
    const stored = await putFile(
      "preventivi_documenti",
      args.commessaId,
      doc.id,
      nome,
      args.pdf,
      "application/pdf"
    );
    doc.storageKey = stored.storageKey;
    doc.checksum = stored.checksum;
    delete doc.dataBase64;
  } catch {
    throw new StorageAllegatoTemporaneamenteNonDisponibile();
  }

  if (existing) Object.assign(existing, doc);
  else documenti.push(doc);
  _documentiStore.save();
  if (oldStorageKey && oldStorageKey !== doc.storageKey) {
    deleteFileQuiet(oldStorageKey);
  }
  return doc;
}

/** Il riferimento del PDF di una fattura emessa dal CRM (ciclo fatturazione). */
function crmFatturaSourceRef(fatturaId: number): string {
  return `crm:fattura:${fatturaId}`;
}

/**
 * Il PDF della fattura emessa dal CRM entra nel fascicolo della commessa:
 * è il documento che soddisfa il gate «fattura» di `fatture_pagamento`.
 * Upsert per `sourceRef`, come `upsertDocumentoFic`: una ripresa
 * dell'emissione non deve produrre un secondo file. A differenza di
 * quella funzione, se lo storage non risponde il PDF resta inline
 * (fallback base64 di `caricaDocumentoCommessaDaBuffer`): il gate vale più
 * di un byte fuori posto, e l'alternativa sarebbe una fattura emessa
 * davvero e una commessa bloccata.
 */
export async function registraDocumentoFatturaCrm(args: {
  sedeId: number;
  commessaId: number;
  fatturaId: number;
  numero: string;
  tipo: "fattura" | "nota_credito";
  pdf: Buffer;
  createdBy: number | null;
}): Promise<Documento> {
  validaAllegatoFascicolo(args.pdf, "application/pdf");
  const commessa = commessaInSede(args.commessaId, args.sedeId);
  if (!commessa) throw new Error("Commessa non trovata");

  const sourceRef = crmFatturaSourceRef(args.fatturaId);
  const existing =
    documenti.find(d => d.source === "crm" && d.sourceRef === sourceRef) ?? null;
  const numeroSicuro = args.numero
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const etichetta = args.tipo === "nota_credito" ? "Nota di credito" : "Fattura";
  const nome = dedupeName(
    `${etichetta} ${numeroSicuro || args.fatturaId}.pdf`,
    args.commessaId,
    existing?.id
  );
  const oldStorageKey = existing?.storageKey;
  const doc: Documento = existing
    ? { ...existing }
    : {
        id: nextId++,
        commessaId: args.commessaId,
        nome,
        tipo: args.tipo,
        mimeType: "application/pdf",
        size: args.pdf.length,
        note: null,
        statoAtUpload: commessa.stato ?? null,
        createdBy: args.createdBy,
        createdAt: new Date(),
      };

  doc.commessaId = args.commessaId;
  doc.nome = nome;
  doc.tipo = args.tipo;
  doc.mimeType = "application/pdf";
  doc.size = args.pdf.length;
  doc.note = `Emessa dal CRM · ${etichetta} ${numeroSicuro}`.trim();
  doc.statoAtUpload = commessa.stato ?? null;
  doc.source = "crm";
  doc.sourceRef = sourceRef;
  doc.origine = "automatico";

  try {
    const stored = await putFile(
      "preventivi_documenti",
      args.commessaId,
      doc.id,
      nome,
      args.pdf,
      "application/pdf"
    );
    doc.storageKey = stored.storageKey;
    doc.checksum = stored.checksum;
    delete doc.dataBase64;
  } catch (e) {
    if (args.pdf.length > COMMESSA_UPLOAD_INLINE_FALLBACK_MAX_BYTES) {
      throw new StorageAllegatoTemporaneamenteNonDisponibile();
    }
    console.warn(
      "[preventiviContratti] storage put fallito per la fattura, fallback base64 inline:",
      e
    );
    // Un record ha esattamente una delle due forme: se i byte tornano
    // inline, la chiave (e il checksum) del giro precedente non devono
    // restare a indicare un file che non è più quello del record.
    doc.storageKey = null;
    doc.checksum = null;
    doc.dataBase64 = args.pdf.toString("base64");
  }

  if (existing) Object.assign(existing, doc);
  else documenti.push(doc);
  _documentiStore.save();
  if (oldStorageKey && oldStorageKey !== doc.storageKey) {
    deleteFileQuiet(oldStorageKey);
  }
  return doc;
}

export function findDocumentoFic(
  sedeId: number,
  ficId: number
): Documento | null {
  const refs = new Set([
    ficSourceRef(sedeId, ficId),
    legacyFicSourceRef(sedeId, ficId),
  ]);
  const documento = documenti.find(
    d => d.source === "fic" && d.sourceRef != null && refs.has(d.sourceRef)
  );
  if (!documento || !commessaInSede(documento.commessaId, sedeId)) return null;
  return documento;
}

/** Rimuove solo il file importato da FIC, senza toccare upload manuali. */
export function deleteDocumentoFic(sedeId: number, ficId: number): void {
  const documento = findDocumentoFic(sedeId, ficId);
  const idx = documento ? documenti.findIndex(d => d.id === documento.id) : -1;
  if (idx === -1) return;
  const [doc] = documenti.splice(idx, 1);
  _documentiStore.save();
  deleteFileQuiet(doc.storageKey);
}

/** Verifica idempotente usata dal sync FIC per riparare i fascicoli storici. */
export function hasDocumentoFic(sedeId: number, ficId: number): boolean {
  const documento = findDocumentoFic(sedeId, ficId);
  return !!documento && (!!documento.storageKey || !!documento.dataBase64);
}

// Legacy helper kept for backward compat.
export function hasPreventivoOrContratto(commessaId: number): boolean {
  return documenti.some(
    d =>
      d.commessaId === commessaId &&
      (d.tipo === "preventivo" || d.tipo === "contratto")
  );
}

/**
 * Da quale punto della lavorazione in poi un documento di questo tipo vale
 * per il gate di `stato`. L'indice è quello di STATI_COMMESSA.
 *
 * Di norma da sempre: una fattura è una fattura anche se è arrivata con
 * settimane di anticipo, e quella importata da Fatture in Cloud entra quando
 * gira la sincronizzazione, non quando la commessa raggiunge lo stato che la
 * chiede. Pretendere che fosse caricata proprio in quella finestra faceva
 * dire «Manca: Fattura» con la fattura lì nel fascicolo.
 *
 * Fanno eccezione i tipi che la lavorazione chiede due volte — `contratto`
 * (preventivo, poi aggiornamento_contratto) e `fattura` (fatture_pagamento,
 * poi ordini_ultimazione): la seconda richiesta vuole un documento nuovo,
 * altrimenti sarebbe già soddisfatta in partenza e non chiederebbe mai
 * niente. Lì contano solo i documenti arrivati dopo la richiesta precedente.
 */
function primoStatoUtilePerGate(tipo: DocTipo, stato: string): number {
  const idxStato = (STATI_COMMESSA as readonly string[]).indexOf(stato);
  if (idxStato < 0) return 0;
  for (let i = idxStato - 1; i >= 0; i--) {
    if ((REQUIRED_DOC_TIPI_PER_STATO[STATI_COMMESSA[i]] ?? []).includes(tipo)) {
      return i + 1;
    }
  }
  return 0;
}

/** Esiste sulla commessa un documento di `tipo` che copre il gate di `stato`? */
export function tipoSoddisfaGate(
  commessaId: number,
  tipo: DocTipo,
  stato: string
): boolean {
  const soglia = primoStatoUtilePerGate(tipo, stato);
  return documenti.some(d => {
    if (d.commessaId !== commessaId || d.tipo !== tipo) return false;
    // Documenti senza finestra registrata: si accettano, com'è sempre stato.
    if (d.statoAtUpload == null) return true;
    const idxDoc = (STATI_COMMESSA as readonly string[]).indexOf(
      d.statoAtUpload
    );
    // Uno stato uscito dall'elenco non è colpa del documento.
    if (idxDoc < 0) return true;
    return idxDoc >= soglia;
  });
}

// Does the commessa have at least one doc satisfying the gate for `stato`?
export function statoHasRequiredDoc(
  commessaId: number,
  stato: string
): boolean {
  const required = REQUIRED_DOC_TIPI_PER_STATO[stato] ?? [];
  if (required.length === 0) return true;
  return required.some(tipo => tipoSoddisfaGate(commessaId, tipo, stato));
}

// Cross-sede guard for documents: a document is only visible/mutable when its
// parent commessa belongs to the active sede. Returns the commessa when in
// scope, else null.
function commessaInSede(commessaId: number, sedeId: number | null) {
  const c = getCommessaById(commessaId);
  if (!c) return null;
  if (sedeId != null && (c as any).sedeId !== sedeId) return null;
  return c;
}

// Analisi documentale (D7): il record del documento con i suoi metadati
// (storageKey/dataBase64 inclusi), senza passare dal router. Chi chiama
// applica lo scope di sede tramite la commessa del documento.
export function getDocumentoRecordById(id: number): Documento | null {
  return documenti.find(d => d.id === id) ?? null;
}

export function getDocumentoCommessaById(
  id: number,
  sedeId: number | null
): Documento | null {
  const documento = documenti.find(d => d.id === id) ?? null;
  if (!documento) return null;
  return commessaInSede(documento.commessaId, sedeId) ? documento : null;
}

// Registro versioni di Tars (T3, revisione): la lista dei documenti di
// una commessa serve a invalidare fascicoli e cache quando il gate
// documentale cambia. Sola lettura; lo scope di sede lo applica chi
// chiama tramite la commessa.
/**
 * Tutti i documenti dei fascicoli di una sede: serve alle ricerche di Tars
 * («dov'è finito quel DDT?») senza esporre le altre sedi.
 */
export function documentiDiSede(sedeId: number): Documento[] {
  const commesse = new Set(
    getCommesseStore()
      .filter((c: any) => (c.sedeId ?? DEFAULT_SEDE_ID) === sedeId)
      .map((c: any) => c.id as number)
  );
  return documenti.filter(d => commesse.has(d.commessaId));
}

/**
 * Sposta un documento nel fascicolo di un'altra commessa della stessa
 * sede: correzione di archiviazione, non una copia. Il gate documentale
 * segue il documento — `statoAtUpload` diventa lo stato in cui si trova la
 * commessa di destinazione, esattamente come se il file fosse stato
 * caricato lì (03/09/2026: «Tars non riesce a spostare i documenti»).
 */
export function spostaDocumentoDiCommessa(input: {
  documentoId: number;
  commessaId: number;
  sedeId: number | null;
  note?: string | null;
}): { documento: Documento; da: number; a: number } {
  const documento = documenti.find(d => d.id === input.documentoId);
  if (!documento) throw new Error("Documento non trovato");
  const origine = commessaInSede(documento.commessaId, input.sedeId);
  if (!origine) throw new Error("Documento non trovato");
  const destinazione: any = commessaInSede(input.commessaId, input.sedeId);
  if (!destinazione) throw new Error("Commessa di destinazione non trovata");
  if (destinazione.archivedAt) {
    throw new Error("La commessa di destinazione è archiviata: ripristinala prima.");
  }
  if (documento.commessaId === input.commessaId) {
    throw new Error("Il documento è già in questa commessa");
  }
  const da = documento.commessaId;
  documento.commessaId = input.commessaId;
  documento.nome = dedupeName(documento.nome, input.commessaId, documento.id);
  documento.statoAtUpload = destinazione.stato ?? documento.statoAtUpload ?? null;
  if (input.note !== undefined) documento.note = input.note?.trim() || null;
  _documentiStore.save();
  // Costo e merce nati dalla conferma seguono il documento nel nuovo fascicolo.
  spostaCostoDelDocumento(documento.id, da, input.commessaId);
  spostaProdottiDelDocumento(documento.id, input.commessaId);
  return { documento, da, a: input.commessaId };
}

export function getDocumentiDiCommessa(commessaId: number): Documento[] {
  return documenti.filter(d => d.commessaId === commessaId);
}

/** Tutte le conferme d'ordine dei fascicoli: il worker del costo le legge a lotti. */
export function documentiConfermaOrdine(): Documento[] {
  return documenti.filter(d => d.tipo === "conferma_ordine");
}

/** La memoria del documento sul costo che ne è nato: la scrive solo il servizio. */
export function salvaLetturaCostoDocumento(
  documentoId: number,
  lettura: LetturaCostoDocumento | null
): void {
  const documento = documenti.find(d => d.id === documentoId);
  if (!documento) return;
  documento.letturaCosto = lettura;
  _documentiStore.save();
}

/** Il metadato delle pagine rese (anteprime delle evidenze): lo scrive solo il servizio delle anteprime. */
export function salvaAnteprimeDocumento(
  documentoId: number,
  anteprime: AnteprimeDocumento | null
): void {
  const documento = documenti.find(d => d.id === documentoId);
  if (!documento) return;
  documento.anteprime = anteprime;
  _documentiStore.save();
}

/**
 * La regola del 03/09/2026: una conferma d'ordine che entra nel fascicolo
 * porta il suo costo imponibile sulla commessa. Senza OCR (il percorso della
 * richiesta resta rapido; le scansioni le riprende il worker) e senza mai
 * far fallire l'archiviazione: il documento è salvo, il costo si ritenta.
 */
export async function agganciaCostoDaConferma(
  documento: Documento,
  origine: "upload" | "archiviazione" | "riclassificazione"
): Promise<void> {
  if (documento.tipo !== "conferma_ordine") return;
  try {
    const { registraCostoDaConferma } = await import("../commesse/costoDaConferma");
    const esito = await registraCostoDaConferma({ documentoId: documento.id, ocr: false });
    if (esito.esito === "registrato" || esito.esito === "collegato") {
      console.info("[costo-da-conferma]", {
        origine,
        documentoId: documento.id,
        commessaId: documento.commessaId,
        esito: esito.esito,
        imponibile: esito.imponibile,
      });
    }
  } catch (errore) {
    console.error("[costo-da-conferma] aggancio fallito", {
      origine,
      documentoId: documento.id,
      message: errore instanceof Error ? errore.message : "unknown",
    });
  }
}

export async function apriDocumentoCommessaDaStorage(
  id: number,
  sedeId: number | null,
  range?: { start: number; end: number }
): Promise<{
  documento: Documento;
  stream: Readable;
  totalBytes: number;
  contentLength: number;
} | null> {
  const documento = getDocumentoCommessaById(id, sedeId);
  if (!documento) return null;
  if (documento.dataBase64) {
    const buffer = Buffer.from(documento.dataBase64, "base64");
    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, buffer.length - 1);
    if (start > end || end >= buffer.length) return null;
    const chunk = buffer.subarray(start, end + 1);
    return {
      documento,
      stream: Readable.from(chunk),
      totalBytes: buffer.length,
      contentLength: chunk.length,
    };
  }
  if (documento.storageKey) {
    const opened = await openFileReadStream(documento.storageKey, range);
    if (!opened) return null;
    return { documento, ...opened };
  }
  return null;
}

export async function caricaDocumentoCommessaDaBuffer(input: {
  commessaId: number;
  nome: string;
  tipo: DocTipo;
  mimeType: string;
  buffer: Buffer;
  note?: string;
  keepNome?: boolean;
  sedeId: number | null;
  createdBy: number | null;
  dataBase64Fallback?: string;
}) {
  const commessa = commessaInSede(input.commessaId, input.sedeId);
  if (!commessa) throw new Error("Commessa non trovata");

  validaUploadManualeFascicolo(input.buffer.length, input.mimeType);
  const baseNome =
    input.keepNome || DOC_TIPI_NOME_ORIGINALE.includes(input.tipo)
      ? input.nome
      : buildNomeFromTipo(input.nome, input.tipo, commessa.cliente);
  const nome = dedupeName(baseNome, input.commessaId);
  const doc: Documento = {
    id: nextId++,
    commessaId: input.commessaId,
    nome,
    tipo: input.tipo,
    mimeType: input.mimeType,
    size: input.buffer.length,
    note: input.note ?? null,
    statoAtUpload: commessa.stato ?? null,
    createdBy: input.createdBy,
    createdAt: new Date(),
    origine: "upload",
  };

  try {
    const stored = await putFile(
      "preventivi_documenti",
      input.commessaId,
      doc.id,
      nome,
      input.buffer,
      input.mimeType
    );
    doc.storageKey = stored.storageKey;
    doc.checksum = stored.checksum;
  } catch (e) {
    if (input.buffer.length > COMMESSA_UPLOAD_INLINE_FALLBACK_MAX_BYTES) {
      throw new StorageAllegatoTemporaneamenteNonDisponibile();
    }
    console.warn(
      "[preventiviContratti] storage put fallito, fallback base64 inline:",
      e
    );
    doc.dataBase64 =
      input.dataBase64Fallback ?? input.buffer.toString("base64");
  }

  documenti.push(doc);
  _documentiStore.save();
  await agganciaCostoDaConferma(doc, "upload");
  const { dataBase64, ...rest } = doc;
  return { ...rest, hasData: true };
}

export async function leggiDocumentoCommessaDaStorage(
  id: number,
  sedeId: number | null
): Promise<{ documento: Documento; buffer: Buffer } | null> {
  const documento = documenti.find(d => d.id === id);
  if (!documento || !commessaInSede(documento.commessaId, sedeId)) return null;

  if (documento.dataBase64) {
    return {
      documento,
      buffer: Buffer.from(documento.dataBase64, "base64"),
    };
  }
  if (documento.storageKey) {
    const buffer = await getFile(documento.storageKey);
    return buffer ? { documento, buffer } : null;
  }
  return null;
}

export const preventiviContrattiRouter = router({
  byCommessa: protectedProcedure.input(z.number()).query(({ input, ctx }) => {
    // Don't leak another sede's documents.
    if (!commessaInSede(input, ctx.sedeId)) return [];
    return (
      documenti
        .filter(d => d.commessaId === input)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        // Strip heavy payload from list
        .map(({ dataBase64, ...rest }) => ({
          ...rest,
          hasData: !!dataBase64 || !!rest.storageKey,
        }))
    );
  }),

  byId: protectedProcedure.input(z.number()).query(async ({ input, ctx }) => {
    const doc = documenti.find(d => d.id === input);
    if (!doc) return null;
    if (!commessaInSede(doc.commessaId, ctx.sedeId)) return null;
    // Legacy records: bytes still inline. New records: hydrate from storage
    // so the client keeps receiving dataBase64 exactly as before.
    if (doc.dataBase64) return doc;
    if (doc.storageKey) {
      const buf = await getFile(doc.storageKey);
      if (!buf) throw new Error("File non disponibile nello storage.");
      return { ...doc, dataBase64: buf.toString("base64") };
    }
    return doc;
  }),

  upload: protectedProcedure
    .input(
      z.object({
        commessaId: z.number(),
        nome: z.string().min(1),
        tipo: z.enum(DOC_TIPI),
        mimeType: z.string().min(1),
        size: z.number().int().min(0),
        dataBase64: z.string().min(1),
        note: z.string().optional(),
        // When the caller already built a fully-qualified filename (e.g. the
        // Preventivatore Fivizzanese saves as "Preventivo {cliente} -
        // Fivizzanese.pdf") skip the {stato label} {cliente}.{ext} auto-
        // rename so the custom name survives. Dedup-suffix still applies.
        keepNome: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!commessaInSede(input.commessaId, ctx.sedeId)) {
        throw new Error("Commessa non trovata");
      }
      const buffer = decodificaBase64Upload(input.dataBase64);
      return caricaDocumentoCommessaDaBuffer({
        commessaId: input.commessaId,
        nome: input.nome,
        tipo: input.tipo,
        mimeType: input.mimeType,
        buffer,
        note: input.note,
        keepNome: input.keepNome,
        sedeId: ctx.sedeId,
        createdBy: ctx.user?.id ?? null,
        dataBase64Fallback: input.dataBase64,
      });
    }),

  // Rinomina e/o riclassifica un documento esistente. Il tipo conta per il
  // doc gate: un documento caricato come "altro" che è in realtà una
  // conferma d'ordine blocca un avanzamento legittimo. Non tocca i byte né
  // statoAtUpload (la finestra temporale del gate resta quella originale).
  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        nome: z.string().min(1).optional(),
        tipo: z.enum(DOC_TIPI).optional(),
        note: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const doc = documenti.find(d => d.id === input.id);
      if (!doc) throw new Error("Documento non trovato");
      if (!commessaInSede(doc.commessaId, ctx.sedeId)) {
        throw new Error("Documento non trovato");
      }
      const tipoPrima = doc.tipo;
      if (input.nome !== undefined) doc.nome = input.nome.trim();
      if (input.tipo !== undefined) doc.tipo = input.tipo;
      if (input.note !== undefined) doc.note = input.note?.trim() || null;
      _documentiStore.save();
      // Riclassificare È far entrare (o uscire) una conferma dal fascicolo:
      // il costo nasce o sparisce con il tipo.
      if (input.tipo !== undefined && input.tipo !== tipoPrima) {
        if (input.tipo === "conferma_ordine") {
          await agganciaCostoDaConferma(doc, "riclassificazione");
        } else if (tipoPrima === "conferma_ordine") {
          rimuoviCostoDelDocumento(doc.id, doc.commessaId);
          rimuoviProdottiDelDocumento(doc.id);
          doc.letturaCosto = null;
          _documentiStore.save();
        }
      }
      const { dataBase64, ...rest } = doc;
      return { ...rest, hasData: !!dataBase64 || !!doc.storageKey };
    }),

  delete: protectedProcedure.input(z.number()).mutation(async ({ input, ctx }) => {
    const idx = documenti.findIndex(d => d.id === input);
    if (idx === -1) throw new Error("Documento non trovato");
    // Allow delete when the user is the doc uploader OR owns the parent
    // commessa (createdBy/assegnatoA) OR is direzione. Try uploader first
    // — it's the most common legitimate case.
    const doc = documenti[idx];
    const commessa = commessaInSede(doc.commessaId, ctx.sedeId);
    if (!commessa) throw new Error("Documento non trovato");
    const uid = ctx.user?.id ?? null;
    if (uid != null && doc.createdBy === uid) {
      // owner of the upload
    } else {
      requireOwnershipOrDirezione(commessa, ctx.user);
    }
    documenti.splice(idx, 1);
    _documentiStore.save();
    deleteFileQuiet(doc.storageKey);
    // Le pagine rese per le anteprime sono derivate: spariscono con il file.
    for (const chiave of doc.anteprime?.chiavi ?? []) deleteFileQuiet(chiave);
    // Costo e merce nati da questa conferma se ne vanno con lei.
    rimuoviCostoDelDocumento(doc.id, doc.commessaId);
    rimuoviProdottiDelDocumento(doc.id);

    // Togliere il PDF di una fattura dal fascicolo E' scollegare la fattura.
    // Finora era solo la cancellazione di un file: la fattura restava
    // agganciata, il pattuito continuava a contarla e il sync successivo
    // riscaricava lo stesso PDF nello stesso fascicolo.
    if (doc.source === "fic") {
      const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
      const ficId = ficIdDaSourceRef(doc.sourceRef, sedeId);
      if (ficId != null) {
        const { ficFatture, scollegaFatturaDaCommessa } = await import(
          "./ficFatture"
        );
        const fattura = ficFatture.find(
          f => f.id === ficId && f.sedeId === sedeId
        );
        if (fattura && fattura.commessaId === doc.commessaId) {
          await scollegaFatturaDaCommessa({
            fattura,
            sedeId,
            eliminaAllegato: false,
          });
        }
      }
    }
    return { success: true };
  }),

  // «È di questa commessa»: una persona conferma una conferma d'ordine
  // archiviata da un automatismo il cui testo non cita la commessa. Da qui
  // costo e merce nascono come per le altre (04/09/2026 notte).
  confermaRiscontroConferma: protectedProcedure
    .input(z.object({ documentoId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const doc = documenti.find(d => d.id === input.documentoId);
      if (!doc || !commessaInSede(doc.commessaId, ctx.sedeId)) {
        throw new Error("Documento non trovato");
      }
      if (doc.tipo !== "conferma_ordine") {
        throw new Error("Il documento non è una conferma d'ordine");
      }
      doc.riscontroConfermato = true;
      doc.note = `${doc.note ? `${doc.note} ` : ""}Confermata come conferma di questa commessa da ${
        ctx.user?.name ?? `utente ${ctx.user?.id ?? "?"}`
      }.`.slice(0, 300);
      _documentiStore.save();
      const { registraCostoDaConferma } = await import("../commesse/costoDaConferma");
      const esito = await registraCostoDaConferma({
        documentoId: doc.id,
        ocr: false,
        forza: true,
      });
      return { esito: esito.esito, imponibile: esito.imponibile, merce: esito.merce, motivo: esito.motivo };
    }),

  /**
   * Le evidenze localizzate di una lettura (anteprime «Dove l'ho letto»,
   * 06/09/2026): dove, nella conferma, sono stati letti imponibile,
   * fornitore, numero, date e prove del riscontro. Stessa guardia del file:
   * chi può aprire il PDF vede già tutti i numeri della pagina.
   */
  evidenzeDocumento: protectedProcedure
    .input(z.object({ documentoId: z.number().int().positive() }))
    .query(({ input, ctx }) => {
      const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
      const documento = documenti.find(d => d.id === input.documentoId);
      if (!documento || !commessaInSede(documento.commessaId, sedeId)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Documento non trovato" });
      }
      const lettura = documento.letturaCosto ?? null;
      return {
        documentoId: documento.id,
        nome: documento.nome,
        mimeType: documento.mimeType,
        fonteTesto: lettura?.fonteTesto ?? null,
        evidenze: lettura?.evidenze ?? null,
        valori: {
          imponibile: lettura?.imponibile ?? null,
          fornitore: lettura?.fornitore ?? null,
          numeroOrdine: lettura?.numeroOrdine ?? null,
          dataDocumento: lettura?.dataDocumento ?? null,
        },
        anteprime: documento.anteprime
          ? { pagine: documento.anteprime.pagine, formato: documento.anteprime.formato }
          : null,
      };
    }),

  // Il registro delle conferme d'ordine della sede: chi le ha messe nel
  // fascicolo (a mano, Tars, smistamento, regola automatica) e cosa ne è
  // nato — costo del margine e merce a magazzino (03/09/2026 sera).
  registroConferme: protectedProcedure
    .input(
      z
        .object({
          origine: z.enum(["tutte", "automatiche", "manuali"]).default("tutte"),
          limite: z.number().int().min(1).max(500).default(200),
        })
        .optional()
    )
    .query(({ input, ctx }) => {
      const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
      const filtro = input?.origine ?? "tutte";
      const utenti = getUtentiStore() as any[];
      const nomeUtente = (id: number | null): string | null => {
        if (id == null) return null;
        const u = utenti.find(x => x.id === id);
        return u ? `${u.nome ?? ""} ${u.cognome ?? ""}`.trim() || null : null;
      };
      return documentiDiSede(sedeId)
        .filter(d => d.tipo === "conferma_ordine")
        .map(d => ({ d, origine: d.origine ?? origineDaRecord(d) }))
        .filter(({ origine }) =>
          filtro === "tutte"
            ? true
            : filtro === "automatiche"
              ? origine === "automatico" || origine === "smistamento"
              : origine !== "automatico" && origine !== "smistamento"
        )
        .sort((a, b) => new Date(b.d.createdAt).getTime() - new Date(a.d.createdAt).getTime())
        .slice(0, input?.limite ?? 200)
        .map(({ d, origine }) => {
          const commessa: any = getCommessaById(d.commessaId);
          const costo = (commessa?.costi ?? []).find((c: any) => c.documentoId === d.id) ?? null;
          const merce = prodottiDelDocumento(d.id);
          const lettura = d.letturaCosto ?? null;
          return {
            documentoId: d.id,
            nome: d.nome,
            mimeType: d.mimeType,
            createdAt: d.createdAt,
            origine,
            archiviatoDa: nomeUtente(d.createdBy),
            commessa: commessa
              ? {
                  id: commessa.id,
                  codice: commessa.codice ?? null,
                  cliente: commessa.cliente ?? null,
                  stato: String(commessa.stato ?? ""),
                }
              : null,
            costo: costo
              ? { stato: "registrato" as const, importo: Number(costo.importo), costoId: costo.id }
              : {
                  stato: (lettura
                    ? lettura.esito === "registrato" || lettura.esito === "collegato"
                      ? "rimosso_a_mano"
                      : lettura.esito
                    : "in_attesa") as string,
                  importo: null,
                  costoId: null,
                },
            merce: {
              righe: merce.length,
              dataConsegna: merce[0]?.dataConsegna ?? null,
              arrivate: merce.filter(p => p.arrivato).length,
            },
            fonteTesto: lettura?.fonteTesto ?? null,
            /** Il testo cita la commessa? (solo per le archiviazioni automatiche) */
            riscontro: lettura?.riscontro ?? null,
            riscontroConfermato: d.riscontroConfermato === true,
            duplicatoDi: lettura?.duplicatoDi ?? null,
            motivo: lettura?.motivo ?? null,
            link: `/api/documenti/${d.id}/file`,
          };
        });
    }),

  // UI helper: list of doc tipi + whether each is satisfied for the current
  // stato gate. Lets the CommessaDetail page render a neat required/done
  // indicator.
  statoGate: protectedProcedure.input(z.number()).query(({ input, ctx }) => {
    const commessa = commessaInSede(input, ctx.sedeId);
    if (!commessa) return null;
    const required = REQUIRED_DOC_TIPI_PER_STATO[commessa.stato] ?? [];
    // Stessa regola dell'enforcement, non una copia: la rail diceva «Manca»
    // e il pulsante avanzava, o viceversa, ogni volta che le due
    // divergevano.
    return {
      stato: commessa.stato,
      required: required.map(tipo => ({
        tipo,
        label: DOC_TIPO_LABEL[tipo],
        satisfied: tipoSoddisfaGate(input, tipo, commessa.stato),
      })),
      canAdvance: statoHasRequiredDoc(input, commessa.stato),
    };
  }),
});
