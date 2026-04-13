import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";

let interventi: any[] = [
  { id: 1, commessaId: 1, squadraId: 1, tipo: "posa", stato: "in_corso", dataPianificata: "2026-04-09", dataInizio: new Date("2026-04-09T08:00:00"), dataFine: null, indirizzo: "Via Roma 15, Palermo", note: "Posa appartamento 3B - finestre e portefinestre", createdAt: new Date("2026-04-01"), updatedAt: new Date("2026-04-09") },
  { id: 2, commessaId: 2, squadraId: null, tipo: "rilievo", stato: "pianificato", dataPianificata: "2026-04-11", dataInizio: null, dataFine: null, indirizzo: "Via dei Giardini 42, Palermo", note: "Rilievo completo villa - tutti i piani", createdAt: new Date("2026-04-05"), updatedAt: new Date("2026-04-05") },
  { id: 3, commessaId: 5, squadraId: 2, tipo: "sopralluogo", stato: "pianificato", dataPianificata: "2026-04-10", dataInizio: null, dataFine: null, indirizzo: "Lungomare C. Colombo 12, Palermo", note: "Verifica predisposizioni piano 3", createdAt: new Date("2026-04-07"), updatedAt: new Date("2026-04-07") },
  { id: 4, commessaId: 1, squadraId: 1, tipo: "posa", stato: "completato", dataPianificata: "2026-03-28", dataInizio: new Date("2026-03-28T07:30:00"), dataFine: new Date("2026-03-28T17:00:00"), indirizzo: "Via Roma 15, Palermo", note: "Posa appartamento 2A completata", createdAt: new Date("2026-03-20"), updatedAt: new Date("2026-03-28") },
  { id: 5, commessaId: 4, squadraId: 2, tipo: "assistenza", stato: "pianificato", dataPianificata: "2026-04-12", dataInizio: null, dataFine: null, indirizzo: "Via Maqueda 200, Palermo", note: "Regolazione maniglie aule piano 2", createdAt: new Date("2026-04-08"), updatedAt: new Date("2026-04-08") },
];

let nextId = 6;

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
      return interventi[idx];
    }),

  delete: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = interventi.findIndex((i) => i.id === input);
    if (idx === -1) throw new Error("Intervento non trovato");
    interventi.splice(idx, 1);
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
      return interventi[idx];
    }),
});
