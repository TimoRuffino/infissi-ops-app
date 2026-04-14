import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";

let nextId = 1;
const _interventiStore = persistedStore<any>("interventi", (loaded) => {
  nextId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
});
const interventi = _interventiStore.items;

export const interventiRouter = router({
  list: publicProcedure
    .input(z.object({
      commessaId: z.number().optional(),
      stato: z.string().optional(),
      tipo: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    }).optional())
    .query(({ input }) => {
      let result = [...interventi];
      if (input?.commessaId) result = result.filter((i) => i.commessaId === input.commessaId);
      if (input?.stato) result = result.filter((i) => i.stato === input.stato);
      if (input?.tipo) result = result.filter((i) => i.tipo === input.tipo);
      if (input?.from) result = result.filter((i) => i.dataPianificata >= input.from!);
      if (input?.to) result = result.filter((i) => i.dataPianificata <= input.to!);
      return result.sort((a, b) => (a.dataPianificata ?? "").localeCompare(b.dataPianificata ?? ""));
    }),

  byId: publicProcedure.input(z.number()).query(({ input }) => {
    return interventi.find((i) => i.id === input) ?? null;
  }),

  create: publicProcedure
    .input(z.object({
      commessaId: z.number(),
      squadraId: z.number().nullable().optional(),
      tipo: z.enum(["rilievo", "posa", "assistenza", "sopralluogo", "altro"]),
      dataPianificata: z.string().optional(),
      indirizzo: z.string().optional(),
      note: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const now = new Date();
      const intervento = {
        id: nextId++,
        ...input,
        squadraId: input.squadraId ?? null,
        stato: "pianificato" as const,
        dataInizio: null,
        dataFine: null,
        createdAt: now,
        updatedAt: now,
      };
      interventi.push(intervento);
      _interventiStore.save();
      return intervento;
    }),

  update: publicProcedure
    .input(z.object({
      id: z.number(),
      squadraId: z.number().nullable().optional(),
      tipo: z.enum(["rilievo", "posa", "assistenza", "sopralluogo", "altro"]).optional(),
      dataPianificata: z.string().optional(),
      indirizzo: z.string().optional(),
      note: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const idx = interventi.findIndex((i) => i.id === input.id);
      if (idx === -1) throw new Error("Intervento non trovato");
      const { id, ...updates } = input;
      interventi[idx] = { ...interventi[idx], ...updates, updatedAt: new Date() };
      _interventiStore.save();
      return interventi[idx];
    }),

  delete: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = interventi.findIndex((i) => i.id === input);
    if (idx === -1) throw new Error("Intervento non trovato");
    interventi.splice(idx, 1);
    _interventiStore.save();
    return { success: true };
  }),

  updateStato: publicProcedure
    .input(z.object({
      id: z.number(),
      stato: z.enum(["pianificato", "in_corso", "completato", "sospeso", "annullato"]),
    }))
    .mutation(({ input }) => {
      const idx = interventi.findIndex((i) => i.id === input.id);
      if (idx === -1) throw new Error("Intervento non trovato");
      interventi[idx].stato = input.stato;
      if (input.stato === "in_corso") interventi[idx].dataInizio = new Date();
      if (input.stato === "completato") interventi[idx].dataFine = new Date();
      interventi[idx].updatedAt = new Date();
      _interventiStore.save();
      return interventi[idx];
    }),
});
