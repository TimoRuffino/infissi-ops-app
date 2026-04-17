import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { deleteAllegatiByTicket } from "./ticketAllegati";

// Linear workflow. Used for both forward advance and rollback.
const TICKET_STATI = [
  "aperto",
  "assegnato",
  "in_lavorazione",
  "risolto",
  "chiuso",
] as const;
type TicketStato = (typeof TICKET_STATI)[number];

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
    // Cascade: also drop any attachments bound to the ticket, otherwise they
    // leak in the store with no parent.
    deleteAllegatiByTicket(input);
    _store.save();
    return { success: true };
  }),

  updateStato: publicProcedure
    .input(z.object({
      id: z.number(),
      stato: z.enum(TICKET_STATI),
      esitoIntervento: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const idx = tickets.findIndex((t) => t.id === input.id);
      if (idx === -1) throw new Error("Ticket non trovato");
      tickets[idx].stato = input.stato;
      if (input.esitoIntervento) tickets[idx].esitoIntervento = input.esitoIntervento;
      if (input.stato === "risolto" || input.stato === "chiuso") {
        tickets[idx].dataRisoluzione = new Date();
      }
      tickets[idx].updatedAt = new Date();
      _store.save();
      return tickets[idx];
    }),

  // Single-step rollback to the previous stato in TICKET_STATI. Clears
  // dataRisoluzione when leaving risolto/chiuso so the ticket is "open" again
  // for reporting. If already at "aperto" (first state) throws.
  rollbackStato: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(({ input }) => {
      const idx = tickets.findIndex((t) => t.id === input.id);
      if (idx === -1) throw new Error("Ticket non trovato");
      const currentIdx = TICKET_STATI.indexOf(tickets[idx].stato as TicketStato);
      if (currentIdx <= 0) {
        throw new Error("Il ticket è già al primo stato");
      }
      const prev = TICKET_STATI[currentIdx - 1];
      tickets[idx].stato = prev;
      if (prev !== "risolto" && prev !== "chiuso") {
        tickets[idx].dataRisoluzione = null;
      }
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
