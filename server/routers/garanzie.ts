import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";

let nextId = 1;
const _garanzieStore = persistedStore<any>("garanzie", (loaded) => {
  nextId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
});
const garanzie = _garanzieStore.items;

export const garanzieRouter = router({
  list: publicProcedure
    .input(
      z.object({
        commessaId: z.number().optional(),
        stato: z.string().optional(),
        tipo: z.string().optional(),
      }).optional()
    )
    .query(({ input }) => {
      let result = [...garanzie];
      if (input?.commessaId) result = result.filter((g) => g.commessaId === input.commessaId);
      if (input?.stato) result = result.filter((g) => g.stato === input.stato);
      if (input?.tipo) result = result.filter((g) => g.tipo === input.tipo);
      return result.sort((a, b) => a.dataScadenza.localeCompare(b.dataScadenza));
    }),

  create: publicProcedure
    .input(
      z.object({
        commessaId: z.number(),
        aperturaId: z.number().nullable().optional(),
        tipo: z.enum(["prodotto", "posa", "accessorio", "vetro", "altro"]),
        descrizione: z.string().min(1),
        fornitore: z.string().optional(),
        dataInizio: z.string(),
        durataMesi: z.number().min(1),
        documentoRif: z.string().optional(),
        note: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      const now = new Date();
      const start = new Date(input.dataInizio);
      const end = new Date(start);
      end.setMonth(end.getMonth() + input.durataMesi);

      const garanzia = {
        id: nextId++,
        ...input,
        aperturaId: input.aperturaId ?? null,
        dataScadenza: end.toISOString().split("T")[0],
        stato: "attiva" as const,
        createdAt: now,
        updatedAt: now,
      };
      garanzie.push(garanzia);
      _garanzieStore.save();
      return garanzia;
    }),

  update: publicProcedure
    .input(z.object({
      id: z.number(),
      tipo: z.enum(["prodotto", "posa", "accessorio", "vetro", "altro"]).optional(),
      descrizione: z.string().optional(),
      fornitore: z.string().optional(),
      stato: z.enum(["attiva", "scaduta", "sospesa", "revocata"]).optional(),
      documentoRif: z.string().optional(),
      note: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const idx = garanzie.findIndex((g) => g.id === input.id);
      if (idx === -1) throw new Error("Garanzia non trovata");
      const { id, ...updates } = input;
      garanzie[idx] = { ...garanzie[idx], ...updates, updatedAt: new Date() };
      _garanzieStore.save();
      return garanzie[idx];
    }),

  delete: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = garanzie.findIndex((g) => g.id === input);
    if (idx === -1) throw new Error("Garanzia non trovata");
    garanzie.splice(idx, 1);
    _garanzieStore.save();
    return { success: true };
  }),

  stats: publicProcedure.query(() => {
    const today = new Date().toISOString().split("T")[0];
    const in90 = new Date();
    in90.setDate(in90.getDate() + 90);
    const threshold = in90.toISOString().split("T")[0];

    const total = garanzie.length;
    const attive = garanzie.filter((g) => g.stato === "attiva").length;
    const inScadenza = garanzie.filter(
      (g) => g.stato === "attiva" && g.dataScadenza >= today && g.dataScadenza <= threshold
    ).length;
    const scadute = garanzie.filter(
      (g) => g.stato === "attiva" && g.dataScadenza < today
    ).length;
    return { total, attive, inScadenza, scadute };
  }),
});
