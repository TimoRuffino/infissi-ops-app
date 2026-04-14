import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";

let nextId = 1;

const _store = persistedStore<any>("tickets", (items) => {
  nextId = items.length ? Math.max(...items.map((x: any) => x.id)) + 1 : 1;
});
const tickets = _store.items;

export const ticketRouter = router({
  list: publicProcedure
    .input(z.object({
      commessaId: z.number().optional(),
      stato: z.string().optional(),
    }).optional())
    .query(({ input }) => {
      let result = [...tickets];
      if (input?.commessaId) result = result.filter((t) => t.commessaId === input.commessaId);
      if (input?.stato) result = result.filter((t) => t.stato === input.stato);
      return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }),

  create: publicProcedure
    .input(z.object({
      commessaId: z.number(),
      aperturaId: z.number().nullable().optional(),
      oggetto: z.string().min(1),
      descrizione: z.string().optional(),
      categoria: z.enum(["difetto_prodotto", "difetto_posa", "regolazione", "sostituzione", "garanzia", "altro"]),
      priorita: z.enum(["bassa", "media", "alta", "urgente"]).optional(),
    }))
    .mutation(({ input }) => {
      const now = new Date();
      const t = {
        id: nextId++,
        ...input,
        aperturaId: input.aperturaId ?? null,
        priorita: input.priorita ?? "media",
        stato: "aperto" as const,
        assegnatoA: null,
        dataRisoluzione: null,
        esitoIntervento: null,
        apertoBy: null,
        createdAt: now,
        updatedAt: now,
      };
      tickets.push(t);
      _store.save();
      return t;
    }),

  update: publicProcedure
    .input(z.object({
      id: z.number(),
      oggetto: z.string().optional(),
      descrizione: z.string().optional(),
      categoria: z.enum(["difetto_prodotto", "difetto_posa", "regolazione", "sostituzione", "garanzia", "altro"]).optional(),
      priorita: z.enum(["bassa", "media", "alta", "urgente"]).optional(),
    }))
    .mutation(({ input }) => {
      const idx = tickets.findIndex((t) => t.id === input.id);
      if (idx === -1) throw new Error("Ticket non trovato");
      const { id, ...updates } = input;
      tickets[idx] = { ...tickets[idx], ...updates, updatedAt: new Date() };
      _store.save();
      return tickets[idx];
    }),

  delete: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = tickets.findIndex((t) => t.id === input);
    if (idx === -1) throw new Error("Ticket non trovato");
    tickets.splice(idx, 1);
    _store.save();
    return { success: true };
  }),

  updateStato: publicProcedure
    .input(z.object({
      id: z.number(),
      stato: z.enum(["aperto", "assegnato", "in_lavorazione", "risolto", "chiuso"]),
      esitoIntervento: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const idx = tickets.findIndex((t) => t.id === input.id);
      if (idx === -1) throw new Error("Ticket non trovato");
      tickets[idx].stato = input.stato;
      if (input.esitoIntervento) tickets[idx].esitoIntervento = input.esitoIntervento;
      if (input.stato === "risolto" || input.stato === "chiuso") tickets[idx].dataRisoluzione = new Date();
      tickets[idx].updatedAt = new Date();
      _store.save();
      return tickets[idx];
    }),

  stats: publicProcedure.query(() => {
    const aperti = tickets.filter((t) => t.stato === "aperto").length;
    const assegnati = tickets.filter((t) => t.stato === "assegnato").length;
    const inLavorazione = tickets.filter((t) => t.stato === "in_lavorazione").length;
    const risolti = tickets.filter((t) => t.stato === "risolto" || t.stato === "chiuso").length;
    return { aperti, assegnati, inLavorazione, risolti, totale: tickets.length };
  }),
});
