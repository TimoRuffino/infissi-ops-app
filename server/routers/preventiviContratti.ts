import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { getCommessaById } from "./commesse";
import { DEFAULT_SEDE_ID } from "./sedi";
import { requireOwnershipOrDirezione } from "../_core/permissions";
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

// ── Types ───────────────────────────────────────────────────────────────────

// Extended tipo enum — one slot per board state so each transition can be
// gated by the right artefact. "foto" and "altro" remain for miscellaneous
// uploads that do not satisfy any gate.
// I tipi che il fascicolo sa nominare. I primi dieci hanno un ruolo nel doc
// gate; gli altri esistono perché una commessa raccoglie anche documenti che
// non fanno avanzare niente — un documento d'identità, una visura, una
// planimetria — e "Altro" li rendeva tutti indistinguibili al momento di
// ritrovarli.
export const DOC_TIPI = [
  "preventivo",
  "contratto",
  "misure",
  "fattura",
  "ordine",
  "conferma_ordine",
  "ddt_consegna",
  "ddt_posa",
  "ddt_finale",
  "saldo",
  "foto",
  "documento_identita",
  "visura",
  "planimetria",
  "certificazione",
  "altro",
] as const;
export type DocTipo = (typeof DOC_TIPI)[number];

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
  source?: "fic" | "comunicazione";
  sourceRef?: string;
};

// ── In-memory data ──────────────────────────────────────────────────────────

let nextId = 1;
const _documentiStore = persistedStore<Documento>(
  "preventivi_documenti",
  loaded => {
    nextId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
    // Backfill statoAtUpload on legacy docs: default to "preventivo" so the
    // first transition still works for existing commesse.
    for (const d of loaded) {
      if ((d as any).statoAtUpload === undefined) {
        (d as any).statoAtUpload = "preventivo";
      }
    }
  }
);
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
  da_ordinare: ["ordine", "conferma_ordine"],
  produzione: [], // gated by dataConsegnaConfermata elsewhere
  ordini_ultimazione: ["saldo", "fattura"],
  attesa_posa: ["ddt_consegna"],
  finiture_saldo: ["ddt_posa"],
  interventi_regolazioni: ["ddt_finale"],
  archiviata: [],
};

// Convenience label map used by the UI and error messages.
export const DOC_TIPO_LABEL: Record<DocTipo, string> = {
  preventivo: "Preventivo",
  contratto: "Contratto",
  misure: "Misure esecutive",
  fattura: "Fattura",
  ordine: "Ordine fornitore",
  conferma_ordine: "Conferma ordine fornitore",
  ddt_consegna: "DDT consegna",
  ddt_posa: "DDT posa",
  ddt_finale: "DDT finale",
  saldo: "Ricevuta saldo",
  foto: "Foto",
  documento_identita: "Documento d'identità",
  visura: "Visura",
  planimetria: "Planimetria",
  certificazione: "Certificazione",
  altro: "Altro",
};

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
  buffer: Buffer;
  createdBy: number | null;
}): Promise<Documento> {
  validaAllegatoFascicolo(args.buffer, args.mimeType);
  const commessa = commessaInSede(args.commessaId, args.sedeId);
  if (!commessa) throw new Error("Commessa non trovata");

  const sourceRef = comunicazioneSourceRef(
    args.sedeId,
    args.comunicazioneId,
    args.allegatoIndex
  );
  return serializzaArchivioComunicazione(sourceRef, async () => {
    const existing = documenti.find(
      documento =>
        documento.source === "comunicazione" &&
        documento.sourceRef === sourceRef
    );
    if (existing?.commessaId === args.commessaId) return existing;

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
          size: args.buffer.length,
          note: null,
          statoAtUpload: commessa.stato ?? null,
          createdBy: args.createdBy,
          createdAt: new Date(),
        };

    documento.commessaId = args.commessaId;
    documento.nome = nome;
    documento.tipo = args.tipo;
    documento.mimeType = args.mimeType;
    documento.size = args.buffer.length;
    documento.note =
      args.note ?? "Archiviato manualmente da un allegato di comunicazione.";
    documento.statoAtUpload = commessa.stato ?? null;
    documento.source = "comunicazione";
    documento.sourceRef = sourceRef;

    try {
      const stored = await putFile(
        "preventivi_documenti",
        args.commessaId,
        documento.id,
        nome,
        args.buffer,
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

// Does the commessa have at least one doc satisfying the gate for `stato`?
export function statoHasRequiredDoc(
  commessaId: number,
  stato: string
): boolean {
  const required = REQUIRED_DOC_TIPI_PER_STATO[stato] ?? [];
  if (required.length === 0) return true;
  return documenti.some(
    d =>
      d.commessaId === commessaId &&
      required.includes(d.tipo) &&
      // Only count docs uploaded WHILE the commessa was in this stato — so
      // that an old preventivo cannot satisfy a later gate.
      (d.statoAtUpload === stato ||
        // Legacy fallback: if statoAtUpload unset and tipo matches, accept.
        d.statoAtUpload == null)
  );
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
export function getDocumentiDiCommessa(commessaId: number): Documento[] {
  return documenti.filter(d => d.commessaId === commessaId);
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
    .mutation(({ input, ctx }) => {
      const doc = documenti.find(d => d.id === input.id);
      if (!doc) throw new Error("Documento non trovato");
      if (!commessaInSede(doc.commessaId, ctx.sedeId)) {
        throw new Error("Documento non trovato");
      }
      if (input.nome !== undefined) doc.nome = input.nome.trim();
      if (input.tipo !== undefined) doc.tipo = input.tipo;
      if (input.note !== undefined) doc.note = input.note?.trim() || null;
      _documentiStore.save();
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

  // UI helper: list of doc tipi + whether each is satisfied for the current
  // stato gate. Lets the CommessaDetail page render a neat required/done
  // indicator.
  statoGate: protectedProcedure.input(z.number()).query(({ input, ctx }) => {
    const commessa = commessaInSede(input, ctx.sedeId);
    if (!commessa) return null;
    const required = REQUIRED_DOC_TIPI_PER_STATO[commessa.stato] ?? [];
    const uploaded = documenti.filter(
      d => d.commessaId === input && d.statoAtUpload === commessa.stato
    );
    return {
      stato: commessa.stato,
      required: required.map(tipo => ({
        tipo,
        label: DOC_TIPO_LABEL[tipo],
        satisfied:
          uploaded.some(u => u.tipo === tipo) ||
          // Legacy fallback across all docs on this commessa
          documenti.some(
            d =>
              d.commessaId === input &&
              d.tipo === tipo &&
              d.statoAtUpload == null
          ),
      })),
      canAdvance:
        required.length === 0 ||
        required.some(
          tipo =>
            uploaded.some(u => u.tipo === tipo) ||
            documenti.some(
              d =>
                d.commessaId === input &&
                d.tipo === tipo &&
                d.statoAtUpload == null
            )
        ),
    };
  }),
});
