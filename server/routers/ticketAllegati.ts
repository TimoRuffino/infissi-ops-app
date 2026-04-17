import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
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

export function deleteAllegatiByTicket(ticketId: number) {
  for (let i = allegati.length - 1; i >= 0; i--) {
    if (allegati[i].ticketId === ticketId) allegati.splice(i, 1);
  }
  _store.save();
}

export const ticketAllegatiRouter = router({
  byTicket: publicProcedure.input(z.number()).query(({ input }) => {
    return allegati
      .filter((a) => a.ticketId === input)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      // Strip heavy payload from list — client fetches full bytes via byId only
      // when it really needs them (preview/download).
      .map(({ dataBase64, ...rest }) => ({ ...rest, hasData: !!dataBase64 }));
  }),

  byId: publicProcedure.input(z.number()).query(({ input }) => {
    return allegati.find((a) => a.id === input) ?? null;
  }),

  upload: publicProcedure
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
      if (input.size > MAX_SIZE_BYTES) {
        throw new Error(
          `File troppo grande (max ${MAX_SIZE_BYTES / (1024 * 1024)}MB)`
        );
      }
      const a: TicketAllegato = {
        id: nextId++,
        ticketId: input.ticketId,
        nome: input.nome,
        mimeType: input.mimeType,
        size: input.size,
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

  delete: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = allegati.findIndex((a) => a.id === input);
    if (idx === -1) throw new Error("Allegato non trovato");
    allegati.splice(idx, 1);
    _store.save();
    return { success: true };
  }),
});
