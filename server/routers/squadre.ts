import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";

let squadre: any[] = [];

let nextId = 1;

export const squadreRouter = router({
  list: publicProcedure.query(() => {
    return squadre.filter((s) => s.attiva).sort((a, b) => a.nome.localeCompare(b.nome));
  }),

  byId: publicProcedure.input(z.number()).query(({ input }) => {
    return squadre.find((s) => s.id === input) ?? null;
  }),

  create: publicProcedure
    .input(z.object({
      nome: z.string().min(1),
      caposquadra: z.string().optional(),
      telefono: z.string().optional(),
      note: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const now = new Date();
      const squadra = { id: nextId++, ...input, attiva: true, createdAt: now, updatedAt: now };
      squadre.push(squadra);
      return squadra;
    }),

  update: publicProcedure
    .input(z.object({
      id: z.number(),
      nome: z.string().optional(),
      caposquadra: z.string().optional(),
      telefono: z.string().optional(),
      note: z.string().optional(),
      attiva: z.boolean().optional(),
    }))
    .mutation(({ input }) => {
      const idx = squadre.findIndex((s) => s.id === input.id);
      if (idx === -1) throw new Error("Squadra non trovata");
      const { id, ...updates } = input;
      squadre[idx] = { ...squadre[idx], ...updates, updatedAt: new Date() };
      return squadre[idx];
    }),

  delete: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = squadre.findIndex((s) => s.id === input);
    if (idx === -1) throw new Error("Squadra non trovata");
    squadre.splice(idx, 1);
    return { success: true };
  }),
});
