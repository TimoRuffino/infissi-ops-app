import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { getCommessaById } from "./commesse";
import { requireOwnershipOrDirezione } from "../_core/permissions";
import { deleteFileQuiet, getFile, putFile } from "../_core/fileStorage";
import { registerMigratableCollection } from "../_core/fileStorageMigrate";

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

// Cap per-file size: ~10MB base64 = ~7.5MB raw.
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

// Actual decoded byte length of a base64 payload. Used to validate file
// size against MAX_SIZE_BYTES — the client-supplied `size` field is NOT
// trusted (an attacker can send size:0 with a huge payload to bypass the cap).
function base64ByteLength(b64: string): number {
  const len = b64.length;
  if (len === 0) return 0;
  let padding = 0;
  if (b64.endsWith("==")) padding = 2;
  else if (b64.endsWith("=")) padding = 1;
  return Math.floor((len * 3) / 4) - padding;
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
      if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
        throw new Error(`Tipo di file non consentito: ${input.mimeType}`);
      }
      // Validate the ACTUAL payload size — not the client-supplied `size`.
      const actualBytes = base64ByteLength(input.dataBase64);
      if (actualBytes > MAX_SIZE_BYTES) {
        throw new Error(
          `File troppo grande (max ${MAX_SIZE_BYTES / (1024 * 1024)}MB)`
        );
      }
      const commessa = commessaInSede(input.commessaId, ctx.sedeId);
      if (!commessa) throw new Error("Commessa non trovata");
      // Auto-rename: files are renamed to "{tipo scelto} {cliente}.{ext}" so
      // the download name reflects the DOCUMENT TYPE picked from the dropdown
      // (not the board stato). Opt-out via `keepNome` when the caller already
      // built a meaningful name (e.g. the preventivatori PDF export).
      const baseNome =
        input.keepNome || DOC_TIPI_NOME_ORIGINALE.includes(input.tipo)
          ? input.nome
          : buildNomeFromTipo(input.nome, input.tipo, commessa?.cliente);
      // Disambiguate duplicates within the same commessa: if the name is
      // already taken, append " (2)", " (3)", ... before the extension so the
      // browser doesn't silently overwrite on download.
      const nome = dedupeName(baseNome, input.commessaId);
      const doc: Documento = {
        id: nextId++,
        commessaId: input.commessaId,
        nome,
        tipo: input.tipo,
        mimeType: input.mimeType,
        size: actualBytes,
        note: input.note ?? null,
        statoAtUpload: commessa?.stato ?? null,
        createdBy: ctx.user?.id ?? null,
        createdAt: new Date(),
      };
      // Bytes go to the storage driver; the JSONB record keeps metadata only.
      // If storage is down, fall back to the legacy inline base64 so an
      // upload never fails for infrastructure reasons.
      try {
        const buffer = Buffer.from(input.dataBase64, "base64");
        const stored = await putFile(
          "preventivi_documenti",
          input.commessaId,
          doc.id,
          nome,
          buffer,
          input.mimeType
        );
        doc.storageKey = stored.storageKey;
        doc.checksum = stored.checksum;
      } catch (e) {
        console.warn(
          "[preventiviContratti] storage put fallito, fallback base64 inline:",
          e
        );
        doc.dataBase64 = input.dataBase64;
      }
      documenti.push(doc);
      _documentiStore.save();
      const { dataBase64, ...rest } = doc;
      return { ...rest, hasData: true };
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

  delete: protectedProcedure.input(z.number()).mutation(({ input, ctx }) => {
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
