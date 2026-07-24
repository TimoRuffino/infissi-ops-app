import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { getTicketById } from "./ticket";
import { isDirezione } from "../_core/permissions";
import { TRPCError } from "@trpc/server";
import { deleteFileQuiet, getFile, putFile } from "../_core/fileStorage";
import { registerMigratableCollection } from "../_core/fileStorageMigrate";

// Per-ticket file attachments. Same shape as preventiviContratti Documento but
// without the stato gate, since tickets do not participate in the board state
// machine. Files are stored base64 in the JSON persistedStore for now; when
// the NAS storage plan lands these will move to a blob layer with path refs.

type TicketAllegato = {
  id: number;
  ticketId: number;
  nome: string;
  mimeType: string;
  size: number;
  // Legacy inline bytes OR storageKey into the fileStorage driver — see
  // preventiviContratti.Documento for the same dual-mode scheme.
  dataBase64?: string;
  storageKey?: string | null;
  checksum?: string | null;
  note: string | null;
  createdBy: number | null;
  createdAt: Date;
};

let nextId = 1;
const _store = persistedStore<TicketAllegato>("ticket_allegati", (loaded) => {
  nextId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
});
const allegati = _store.items;

registerMigratableCollection({
  key: "ticket_allegati",
  parentIdOf: (a: TicketAllegato) => a.ticketId,
  store: _store,
  items: allegati,
});

// Cap per-file size: ~10MB base64 = ~7.5MB raw (same as preventiviContratti).
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

// Allowlist of mimeTypes accepted for upload. Excludes text/html and
// image/svg+xml — both can carry script and would become stored XSS when
// previewed in an iframe via a same-origin blob: URL.
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

// Actual decoded byte length of a base64 payload — client-supplied `size`
// is not trusted for the cap check.
function base64ByteLength(b64: string): number {
  const len = b64.length;
  if (len === 0) return 0;
  let padding = 0;
  if (b64.endsWith("==")) padding = 2;
  else if (b64.endsWith("=")) padding = 1;
  return Math.floor((len * 3) / 4) - padding;
}

export function deleteAllegatiByTicket(ticketId: number) {
  for (let i = allegati.length - 1; i >= 0; i--) {
    if (allegati[i].ticketId === ticketId) {
      deleteFileQuiet(allegati[i].storageKey);
      allegati.splice(i, 1);
    }
  }
  _store.save();
}

// Cross-sede guard: an allegato belongs to a ticket; only visible/mutable
// when that ticket is in the active sede.
function ticketInSede(ticketId: number, sedeId: number | null) {
  const t = getTicketById(ticketId);
  if (!t) return null;
  if (sedeId != null && (t as any).sedeId !== sedeId) return null;
  return t;
}

export const ticketAllegatiRouter = router({
  byTicket: protectedProcedure.input(z.number()).query(({ input, ctx }) => {
    if (!ticketInSede(input, ctx.sedeId)) return [];
    return allegati
      .filter((a) => a.ticketId === input)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      // Strip heavy payload from list — client fetches full bytes via byId only
      // when it really needs them (preview/download).
      .map(({ dataBase64, ...rest }) => ({
        ...rest,
        hasData: !!dataBase64 || !!rest.storageKey,
      }));
  }),

  byId: protectedProcedure.input(z.number()).query(async ({ input, ctx }) => {
    const a = allegati.find((x) => x.id === input);
    if (!a) return null;
    if (!ticketInSede(a.ticketId, ctx.sedeId)) return null;
    if (a.dataBase64) return a;
    if (a.storageKey) {
      const buf = await getFile(a.storageKey);
      if (!buf) throw new Error("File non disponibile nello storage.");
      return { ...a, dataBase64: buf.toString("base64") };
    }
    return a;
  }),

  upload: protectedProcedure
    .input(
      z.object({
        ticketId: z.number(),
        nome: z.string().min(1),
        mimeType: z.string().min(1),
        size: z.number().int().min(0),
        dataBase64: z.string().min(1),
        note: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ticketInSede(input.ticketId, ctx.sedeId)) {
        throw new Error("Ticket non trovato");
      }
      if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
        throw new Error(`Tipo di file non consentito: ${input.mimeType}`);
      }
      const actualBytes = base64ByteLength(input.dataBase64);
      if (actualBytes > MAX_SIZE_BYTES) {
        throw new Error(
          `File troppo grande (max ${MAX_SIZE_BYTES / (1024 * 1024)}MB)`
        );
      }
      const a: TicketAllegato = {
        id: nextId++,
        ticketId: input.ticketId,
        nome: input.nome,
        mimeType: input.mimeType,
        size: actualBytes,
        note: input.note ?? null,
        createdBy: ctx.user?.id ?? null,
        createdAt: new Date(),
      };
      // Bytes to storage; inline base64 only as infrastructure fallback.
      try {
        const buffer = Buffer.from(input.dataBase64, "base64");
        const stored = await putFile(
          "ticket_allegati",
          input.ticketId,
          a.id,
          input.nome,
          buffer,
          input.mimeType
        );
        a.storageKey = stored.storageKey;
        a.checksum = stored.checksum;
      } catch (e) {
        console.warn(
          "[ticketAllegati] storage put fallito, fallback base64 inline:",
          e
        );
        a.dataBase64 = input.dataBase64;
      }
      allegati.push(a);
      _store.save();
      const { dataBase64, ...rest } = a;
      return { ...rest, hasData: true };
    }),

  delete: protectedProcedure
    .input(z.number())
    .mutation(({ input, ctx }) => {
      const idx = allegati.findIndex((a) => a.id === input);
      if (idx === -1) throw new Error("Allegato non trovato");
      if (!ticketInSede(allegati[idx].ticketId, ctx.sedeId)) {
        throw new Error("Allegato non trovato");
      }
      // Uploader or direzione only — non-uploaders shouldn't be able to
      // remove someone else's evidence.
      const uid = ctx.user?.id ?? null;
      if (
        !isDirezione(ctx.user) &&
        !(uid != null && allegati[idx].createdBy === uid)
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Solo chi ha caricato l'allegato (o la direzione) può rimuoverlo.",
        });
      }
      const [removed] = allegati.splice(idx, 1);
      _store.save();
      deleteFileQuiet(removed?.storageKey);
      return { success: true };
    }),
});
