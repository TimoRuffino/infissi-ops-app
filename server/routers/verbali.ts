import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";

let verbali: any[] = [];

let nextId = 1;

export const verbaliRouter = router({
  byIntervento: publicProcedure.input(z.number()).query(({ input }) => {
    return verbali.find((v) => v.interventoId === input) ?? null;
  }),

  list: publicProcedure
    .input(z.object({ commessaId: z.number().optional() }).optional())
    .query(({ input }) => {
      let result = [...verbali];
      if (input?.commessaId) result = result.filter((v) => v.commessaId === input.commessaId);
      return result.sort((a, b) => b.data.localeCompare(a.data));
    }),

  create: publicProcedure
    .input(
      z.object({
        interventoId: z.number(),
        commessaId: z.number(),
        tipo: z.enum(["chiusura_lavori", "sopralluogo", "consegna"]).default("chiusura_lavori"),
        noteCliente: z.string().optional(),
        noteTecnico: z.string().optional(),
        firmaClienteData: z.string().optional(),
        firmaTecnicoData: z.string().optional(),
        apertureCompletate: z.number().default(0),
        apertureTotali: z.number().default(0),
        anomalieRiscontrate: z.number().default(0),
      })
    )
    .mutation(({ input }) => {
      const now = new Date();
      const verbale = {
        id: nextId++,
        ...input,
        data: now.toISOString().split("T")[0],
        firmaCliente: !!input.firmaClienteData,
        firmaTecnico: !!input.firmaTecnicoData,
        stato: input.firmaClienteData && input.firmaTecnicoData ? "firmato" : "bozza",
        createdAt: now,
        updatedAt: now,
      };
      verbali.push(verbale);
      return verbale;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        noteCliente: z.string().optional(),
        noteTecnico: z.string().optional(),
        firmaClienteData: z.string().optional(),
        firmaTecnicoData: z.string().optional(),
        apertureCompletate: z.number().optional(),
        anomalieRiscontrate: z.number().optional(),
      })
    )
    .mutation(({ input }) => {
      const idx = verbali.findIndex((v) => v.id === input.id);
      if (idx === -1) throw new Error("Verbale non trovato");
      const { id, ...updates } = input;
      verbali[idx] = { ...verbali[idx], ...updates, updatedAt: new Date() };
      if (updates.firmaClienteData) verbali[idx].firmaCliente = true;
      if (updates.firmaTecnicoData) verbali[idx].firmaTecnico = true;
      if (verbali[idx].firmaCliente && verbali[idx].firmaTecnico) {
        verbali[idx].stato = "firmato";
      }
      return verbali[idx];
    }),
});
