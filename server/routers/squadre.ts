import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { assertSedeScope } from "../_core/permissions";

let nextId = 1;
const _squadreStore = persistedStore<any>("squadre", (loaded) => {
  nextId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
  for (const s of loaded) {
    if ((s as any).sedeId === undefined) (s as any).sedeId = 1;
  }
});
const squadre = _squadreStore.items;

// L'agenda di Tars (T4) mette il NOME della squadra accanto all'intervento.
export function getSquadreStore() {
  return squadre;
}

export const squadreRouter = router({
  list: protectedProcedure.query(({ ctx }) => {
    return squadre
      .filter((s) => s.attiva && s.sedeId === ctx.sedeId)
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }),

  byId: protectedProcedure.input(z.number()).query(({ input, ctx }) => {
    const s = squadre.find((s) => s.id === input);
    if (!s || s.sedeId !== ctx.sedeId) return null;
    return s;
  }),

  create: adminProcedure
    .input(z.object({
      nome: z.string().min(1),
      caposquadra: z.string().optional(),
      telefono: z.string().optional(),
      note: z.string().optional(),
    }))
    .mutation(({ input, ctx }) => {
      const now = new Date();
      const squadra = { id: nextId++, ...input, sedeId: ctx.sedeId ?? 1, attiva: true, createdAt: now, updatedAt: now };
      squadre.push(squadra);
      _squadreStore.save();
      return squadra;
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      nome: z.string().optional(),
      caposquadra: z.string().optional(),
      telefono: z.string().optional(),
      note: z.string().optional(),
      attiva: z.boolean().optional(),
    }))
    .mutation(({ input, ctx }) => {
      const idx = squadre.findIndex((s) => s.id === input.id);
      if (idx === -1) throw new Error("Squadra non trovata");
      assertSedeScope(squadre[idx], ctx.sedeId);
      const { id, ...updates } = input;
      squadre[idx] = { ...squadre[idx], ...updates, updatedAt: new Date() };
      _squadreStore.save();
      return squadre[idx];
    }),

  delete: adminProcedure.input(z.number()).mutation(({ input, ctx }) => {
    const idx = squadre.findIndex((s) => s.id === input);
    if (idx === -1) throw new Error("Squadra non trovata");
    assertSedeScope(squadre[idx], ctx.sedeId);
    squadre.splice(idx, 1);
    _squadreStore.save();
    return { success: true };
  }),
});
