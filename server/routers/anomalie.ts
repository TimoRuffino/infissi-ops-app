import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { getCommessaById } from "./commesse";
import { requireOwnershipOrDirezione, assertSedeScope } from "../_core/permissions";

let nextId = 1;
const _anomalieStore = persistedStore<any>("anomalie", (loaded) => {
  nextId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
  for (const a of loaded) {
    if ((a as any).sedeId === undefined) (a as any).sedeId = 1;
  }
});
const anomalie = _anomalieStore.items;

export const anomalieRouter = router({
  list: protectedProcedure
    .input(z.object({
      commessaId: z.number().optional(),
      stato: z.string().optional(),
    }).optional())
    .query(({ input, ctx }) => {
      let result = anomalie.filter((a) => a.sedeId === ctx.sedeId);
      if (input?.commessaId) result = result.filter((a) => a.commessaId === input.commessaId);
      if (input?.stato) result = result.filter((a) => a.stato === input.stato);
      return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }),

  create: protectedProcedure
    .input(z.object({
      commessaId: z.number(),
      aperturaId: z.number().nullable().optional(),
      interventoId: z.number().nullable().optional(),
      categoria: z.enum(["materiale_difettoso", "misura_errata", "danno_trasporto", "difetto_posa", "problema_accessorio", "non_conformita", "altro"]),
      priorita: z.enum(["bassa", "media", "alta", "critica"]).optional(),
      descrizione: z.string().min(1),
    }))
    .mutation(({ input, ctx }) => {
      const now = new Date();
      const anomalia = {
        id: nextId++,
        ...input,
        sedeId: ctx.sedeId ?? 1,
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

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      categoria: z.enum(["materiale_difettoso", "misura_errata", "danno_trasporto", "difetto_posa", "problema_accessorio", "non_conformita", "altro"]).optional(),
      priorita: z.enum(["bassa", "media", "alta", "critica"]).optional(),
      descrizione: z.string().optional(),
      stato: z.enum(["aperta", "in_gestione", "risolta", "chiusa"]).optional(),
    }))
    .mutation(({ input, ctx }) => {
      const idx = anomalie.findIndex((a) => a.id === input.id);
      if (idx === -1) throw new Error("Anomalia non trovata");
      assertSedeScope(anomalie[idx], ctx.sedeId);
      const { id, ...updates } = input;
      anomalie[idx] = { ...anomalie[idx], ...updates, updatedAt: new Date() };
      _anomalieStore.save();
      return anomalie[idx];
    }),

  delete: protectedProcedure
    .input(z.number())
    .mutation(({ input, ctx }) => {
      const idx = anomalie.findIndex((a) => a.id === input);
      if (idx === -1) throw new Error("Anomalia non trovata");
      assertSedeScope(anomalie[idx], ctx.sedeId);
      requireOwnershipOrDirezione(
        getCommessaById(anomalie[idx].commessaId),
        ctx.user
      );
      anomalie.splice(idx, 1);
      _anomalieStore.save();
      return { success: true };
    }),

  resolve: protectedProcedure
    .input(z.object({
      id: z.number(),
      risoluzione: z.string().min(1),
    }))
    .mutation(({ input, ctx }) => {
      const idx = anomalie.findIndex((a) => a.id === input.id);
      if (idx === -1) throw new Error("Anomalia non trovata");
      assertSedeScope(anomalie[idx], ctx.sedeId);
      anomalie[idx].stato = "risolta";
      anomalie[idx].risoluzione = input.risoluzione;
      anomalie[idx].risoltaAt = new Date();
      anomalie[idx].updatedAt = new Date();
      _anomalieStore.save();
      return anomalie[idx];
    }),

  stats: protectedProcedure.query(({ ctx }) => {
    const scoped = anomalie.filter((a) => a.sedeId === ctx.sedeId);
    const aperte = scoped.filter((a) => a.stato === "aperta").length;
    const inGestione = scoped.filter((a) => a.stato === "in_gestione").length;
    const risolte = scoped.filter((a) => a.stato === "risolta" || a.stato === "chiusa").length;
    const critiche = scoped.filter((a) => a.priorita === "critica" && a.stato !== "risolta" && a.stato !== "chiusa").length;
    return { aperte, inGestione, risolte, critiche, totale: scoped.length };
  }),
});
