import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";

let anomalie: any[] = [
  { id: 1, commessaId: 1, aperturaId: 2, interventoId: 1, categoria: "misura_errata", priorita: "alta", stato: "aperta", descrizione: "Soglia portafinestra non combaciante, differenza di 5mm sul lato sinistro", risoluzione: null, segnalataBy: null, risoltaBy: null, risoltaAt: null, createdAt: new Date("2026-04-09T10:30:00"), updatedAt: new Date("2026-04-09T10:30:00") },
  { id: 2, commessaId: 1, aperturaId: 1, interventoId: 4, categoria: "problema_accessorio", priorita: "bassa", stato: "risolta", descrizione: "Maniglia finestra soggiorno leggermente disallineata", risoluzione: "Regolata e lubrificata in sede", segnalataBy: null, risoltaBy: null, risoltaAt: new Date("2026-03-28T16:00:00"), createdAt: new Date("2026-03-28T14:00:00"), updatedAt: new Date("2026-03-28T16:00:00") },
  { id: 3, commessaId: 5, aperturaId: 6, interventoId: null, categoria: "danno_trasporto", priorita: "critica", stato: "in_gestione", descrizione: "Vetro scorrevole panoramico incrinato in basso a destra - danno da trasporto", risoluzione: null, segnalataBy: null, risoltaBy: null, risoltaAt: null, createdAt: new Date("2026-04-08T09:00:00"), updatedAt: new Date("2026-04-08T14:00:00") },
];

let nextId = 4;

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
      return anomalie[idx];
    }),

  delete: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = anomalie.findIndex((a) => a.id === input);
    if (idx === -1) throw new Error("Anomalia non trovata");
    anomalie.splice(idx, 1);
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
