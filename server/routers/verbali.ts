import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { assertSedeScope } from "../_core/permissions";

let nextId = 1;
const _verbaliStore = persistedStore<any>("verbali", (loaded) => {
  nextId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
  for (const v of loaded) {
    if ((v as any).sedeId === undefined) (v as any).sedeId = 1;
  }
});
const verbali = _verbaliStore.items;

export const verbaliRouter = router({
  byIntervento: protectedProcedure.input(z.number()).query(({ input, ctx }) => {
    const v = verbali.find((v) => v.interventoId === input);
    if (!v || v.sedeId !== ctx.sedeId) return null;
    return v;
  }),

  list: protectedProcedure
    .input(z.object({ commessaId: z.number().optional() }).optional())
    .query(({ input, ctx }) => {
      let result = verbali.filter((v) => v.sedeId === ctx.sedeId);
      if (input?.commessaId) result = result.filter((v) => v.commessaId === input.commessaId);
      return result.sort((a, b) => b.data.localeCompare(a.data));
    }),

  create: protectedProcedure
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
    .mutation(({ input, ctx }) => {
      const now = new Date();
      const verbale = {
        id: nextId++,
        ...input,
        sedeId: ctx.sedeId ?? 1,
        data: now.toISOString().split("T")[0],
        firmaCliente: !!input.firmaClienteData,
        firmaTecnico: !!input.firmaTecnicoData,
        stato: input.firmaClienteData && input.firmaTecnicoData ? "firmato" : "bozza",
        createdAt: now,
        updatedAt: now,
      };
      verbali.push(verbale);
      _verbaliStore.save();
      return verbale;
    }),

  update: protectedProcedure
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
    .mutation(({ input, ctx }) => {
      const idx = verbali.findIndex((v) => v.id === input.id);
      if (idx === -1) throw new Error("Verbale non trovato");
      assertSedeScope(verbali[idx], ctx.sedeId);
      const { id, ...updates } = input;
      verbali[idx] = { ...verbali[idx], ...updates, updatedAt: new Date() };
      if (updates.firmaClienteData) verbali[idx].firmaCliente = true;
      if (updates.firmaTecnicoData) verbali[idx].firmaTecnico = true;
      if (verbali[idx].firmaCliente && verbali[idx].firmaTecnico) {
        verbali[idx].stato = "firmato";
      }
      _verbaliStore.save();
      return verbali[idx];
    }),
});
