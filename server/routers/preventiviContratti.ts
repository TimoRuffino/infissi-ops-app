import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";

// ── Types ───────────────────────────────────────────────────────────────────

type Documento = {
  id: number;
  commessaId: number;
  nome: string;
  tipo: "preventivo" | "contratto" | "foto" | "altro";
  mimeType: string;
  size: number;
  dataBase64: string; // base64-encoded file content
  note: string | null;
  createdBy: number | null;
  createdAt: Date;
};

// ── In-memory data ──────────────────────────────────────────────────────────

let nextId = 1;
const _documentiStore = persistedStore<Documento>("preventivi_documenti", (loaded) => {
  nextId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
});
const documenti = _documentiStore.items;

// Cap per-file size: ~10MB base64 = ~7.5MB raw. Reasonable for MVP.
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

// Gate helper used by commesse state-machine: transitions out of "preventivo"
// require at least one uploaded document of type "preventivo" or "contratto".
export function hasPreventivoOrContratto(commessaId: number): boolean {
  return documenti.some(
    (d) =>
      d.commessaId === commessaId &&
      (d.tipo === "preventivo" || d.tipo === "contratto")
  );
}

export const preventiviContrattiRouter = router({
  byCommessa: publicProcedure.input(z.number()).query(({ input }) => {
    return documenti
      .filter((d) => d.commessaId === input)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      // Strip heavy payload from list
      .map(({ dataBase64, ...rest }) => ({ ...rest, hasData: !!dataBase64 }));
  }),

  byId: publicProcedure.input(z.number()).query(({ input }) => {
    return documenti.find((d) => d.id === input) ?? null;
  }),

  upload: publicProcedure
    .input(
      z.object({
        commessaId: z.number(),
        nome: z.string().min(1),
        tipo: z.enum(["preventivo", "contratto", "foto", "altro"]),
        mimeType: z.string().min(1),
        size: z.number().int().min(0),
        dataBase64: z.string().min(1),
        note: z.string().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      if (input.size > MAX_SIZE_BYTES) {
        throw new Error(`File troppo grande (max ${MAX_SIZE_BYTES / (1024 * 1024)}MB)`);
      }
      const doc: Documento = {
        id: nextId++,
        commessaId: input.commessaId,
        nome: input.nome,
        tipo: input.tipo,
        mimeType: input.mimeType,
        size: input.size,
        dataBase64: input.dataBase64,
        note: input.note ?? null,
        createdBy: ctx.user?.id ?? null,
        createdAt: new Date(),
      };
      documenti.push(doc);
      _documentiStore.save();
      const { dataBase64, ...rest } = doc;
      return { ...rest, hasData: true };
    }),

  delete: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = documenti.findIndex((d) => d.id === input);
    if (idx === -1) throw new Error("Documento non trovato");
    documenti.splice(idx, 1);
    _documentiStore.save();
    return { success: true };
  }),
});
