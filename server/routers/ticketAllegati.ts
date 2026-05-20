import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";

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
  dataBase64: string;
  note: string | null;
  createdBy: number | null;
  createdAt: Date;
};

let nextId = 1;
const _store = persistedStore<TicketAllegato>("ticket_allegati", (loaded) => {
  nextId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
});
const allegati = _store.items;

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
    if (allegati[i].ticketId === ticketId) allegati.splice(i, 1);
  }
  _store.save();
}

export const ticketAllegatiRouter = router({
  byTicket: protectedProcedure.input(z.number()).query(({ input }) => {
    return allegati
      .filter((a) => a.ticketId === input)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      // Strip heavy payload from list — client fetches full bytes via byId only
      // when it really needs them (preview/download).
      .map(({ dataBase64, ...rest }) => ({ ...rest, hasData: !!dataBase64 }));
  }),

  byId: protectedProcedure.input(z.number()).query(({ input }) => {
    return allegati.find((a) => a.id === input) ?? null;
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
    .mutation(({ input, ctx }) => {
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
        dataBase64: input.dataBase64,
        note: input.note ?? null,
        createdBy: ctx.user?.id ?? null,
        createdAt: new Date(),
      };
      allegati.push(a);
      _store.save();
      const { dataBase64, ...rest } = a;
      return { ...rest, hasData: true };
    }),

  delete: protectedProcedure.input(z.number()).mutation(({ input }) => {
    const idx = allegati.findIndex((a) => a.id === input);
    if (idx === -1) throw new Error("Allegato non trovato");
    allegati.splice(idx, 1);
    _store.save();
    return { success: true };
  }),
});
