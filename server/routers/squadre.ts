import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";

let squadre: any[] = [
  { id: 1, nome: "Squadra Alpha", caposquadra: "Marco Ferretti", telefono: "333 111 2222", note: "Specializzata in PVC e alluminio", attiva: true, createdAt: new Date("2025-06-01"), updatedAt: new Date("2025-06-01") },
  { id: 2, nome: "Squadra Beta", caposquadra: "Salvatore Amato", telefono: "333 333 4444", note: "Specializzata in grandi vetrate e scorrevoli", attiva: true, createdAt: new Date("2025-06-01"), updatedAt: new Date("2025-06-01") },
  { id: 3, nome: "Assistenza Tecnica", caposquadra: "Giuseppe Lo Presti", telefono: "333 555 6666", note: "Post-vendita e manutenzione", attiva: true, createdAt: new Date("2025-09-01"), updatedAt: new Date("2025-09-01") },
];

let nextId = 4;

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
