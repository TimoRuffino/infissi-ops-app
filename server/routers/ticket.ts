import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";

let tickets: any[] = [
  { id: 1, commessaId: 4, aperturaId: null, oggetto: "Maniglia aula 2B bloccata", descrizione: "La maniglia della finestra in aula 2B si blocca in posizione anta-ribalta", categoria: "regolazione", priorita: "media", stato: "aperto", assegnatoA: null, dataRisoluzione: null, esitoIntervento: null, apertoBy: null, createdAt: new Date("2026-04-07"), updatedAt: new Date("2026-04-07") },
  { id: 2, commessaId: 4, aperturaId: null, oggetto: "Infiltrazione aula 3A", descrizione: "Segnalata infiltrazione d'acqua in caso di pioggia intensa dalla finestra angolare aula 3A", categoria: "difetto_posa", priorita: "alta", stato: "assegnato", assegnatoA: null, dataRisoluzione: null, esitoIntervento: null, apertoBy: null, createdAt: new Date("2026-04-02"), updatedAt: new Date("2026-04-03") },
];

let nextId = 3;

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
      return tickets[idx];
    }),

  delete: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = tickets.findIndex((t) => t.id === input);
    if (idx === -1) throw new Error("Ticket non trovato");
    tickets.splice(idx, 1);
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
