import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";

let nextId = 1;
const _anomalieStore = persistedStore<any>("anomalie", (loaded) => {
  nextId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
});
const anomalie = _anomalieStore.items;

export const anomalieRouter = router({
  list: publicProcedure
    .input(z.object({
      commessaId: z.number().optional(),
      stato: z.string().optional(),
    }).optional())
    .query(({ input }) => {
      let result = [...anomalie];
      if (input?.commessaId) result = result.filter((a) => a.commessaId === input.commessaId);
      if (input?.stato) result = result.filter((a) => a.stato === input.stato);
      return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }),

  create: publicProcedure
    .input(z.object({
      commessaId: z.number(),
      aperturaId: z.number().nullable().optional(),
      interventoId: z.number().nullable().optional(),
      categoria: z.enum(["materiale_difettoso", "misura_errata", "danno_trasporto", "difetto_posa", "problema_accessorio", "non_conformita", "altro"]),
      priorita: z.enum(["bassa", "media", "alta", "critica"]).optional(),
      descrizione: z.string().min(1),
    }))
    .mutation(({ input }) => {
      const now = new Date();
      const anomalia = {
        id: nextId++,
        ...input,
        aperturaId: input.aperturaId ?? null,
        interventoId: input.interventoId ?? null,
        priorita: input.priorita ?? "media",
        stato: "aperta" as const,
        risoluzione: null,
        segnalataBy: null,
        risoltaBy: null,
        risoltaAt: null,
        createdAt: now,
        updatedAt: now,
      };
      anomalie.push(anomalia);
      _anomalieStore.save();
      return anomalia;
    }),

  update: publicProcedure
    .input(z.object({
      id: z.number(),
      categoria: z.enum(["materiale_difettoso", "misura_errata", "danno_trasporto", "difetto_posa", "problema_accessorio", "non_conformita", "altro"]).optional(),
      priorita: z.enum(["bassa", "media", "alta", "critica"]).optional(),
      descrizione: z.string().optional(),
      stato: z.enum(["aperta", "in_gestione", "risolta", "chiusa"]).optional(),
    }))
    .mutation(({ input }) => {
      const idx = anomalie.findIndex((a) => a.id === input.id);
      if (idx === -1) throw new Error("Anomalia non trovata");
      const { id, ...updates } = input;
      anomalie[idx] = { ...anomalie[idx], ...updates, updatedAt: new Date() };
      _anomalieStore.save();
      return anomalie[idx];
    }),

  delete: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = anomalie.findIndex((a) => a.id === input);
    if (idx === -1) throw new Error("Anomalia non trovata");
    anomalie.splice(idx, 1);
    _anomalieStore.save();
    return { success: true };
  }),

  resolve: publicProcedure
    .input(z.object({
      id: z.number(),
      risoluzione: z.string().min(1),
    }))
    .mutation(({ input }) => {
      const idx = anomalie.findIndex((a) => a.id === input.id);
      if (idx === -1) throw new Error("Anomalia non trovata");
      anomalie[idx].stato = "risolta";
      anomalie[idx].risoluzione = input.risoluzione;
      anomalie[idx].risoltaAt = new Date();
      anomalie[idx].updatedAt = new Date();
      _anomalieStore.save();
      return anomalie[idx];
    }),

  stats: publicProcedure.query(() => {
    const aperte = anomalie.filter((a) => a.stato === "aperta").length;
    const inGestione = anomalie.filter((a) => a.stato === "in_gestione").length;
    const risolte = anomalie.filter((a) => a.stato === "risolta" || a.stato === "chiusa").length;
    const critiche = anomalie.filter((a) => a.priorita === "critica" && a.stato !== "risolta" && a.stato !== "chiusa").length;
    return { aperte, inGestione, risolte, critiche, totale: anomalie.length };
  }),
});
