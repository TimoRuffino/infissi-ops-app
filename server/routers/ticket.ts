import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { deleteAllegatiByTicket } from "./ticketAllegati";
import { getCommessaById } from "./commesse";
import {
  requireOwnershipOrDirezione,
  requireDirezione,
  assertSedeScope,
} from "../_core/permissions";
import { publishAssignmentEvent } from "../events/publish";

// Linear workflow. Used for both forward advance and rollback.
// "risolto" was retired: between risolto and chiuso nothing actually
// changed in practice, so the flow ends at chiuso directly.
const TICKET_STATI = [
  "aperto",
  "assegnato",
  "in_lavorazione",
  "chiuso",
] as const;
type TicketStato = (typeof TICKET_STATI)[number];

let nextId = 1;

const _store = persistedStore<any>("tickets", (items) => {
  nextId = items.length ? Math.max(...items.map((x: any) => x.id)) + 1 : 1;
  let changed = false;
  for (const t of items) {
    if ((t as any).sedeId === undefined) (t as any).sedeId = 1;
    // Migration: collapse the retired "risolto" state into "chiuso".
    if ((t as any).stato === "risolto") {
      (t as any).stato = "chiuso";
      changed = true;
    }
    // Solleciti register — one entry per reminder sent to fornitore/squadra.
    if (!Array.isArray((t as any).solleciti)) (t as any).solleciti = [];
    // Ticket senza commessa: si può agganciare un cliente esistente oppure
    // lasciare solo un contatto libero (chi chiama non è ancora a sistema).
    if ((t as any).clienteId === undefined) (t as any).clienteId = null;
    if ((t as any).contatto === undefined) (t as any).contatto = null;
  }
  if (changed) setTimeout(() => _store.save(), 0);
});
const tickets = _store.items;

// Exposed for child routers (ticketAllegati) that need the parent ticket's
// sede to enforce cross-sede isolation.
export function getTicketById(id: number): any | null {
  return tickets.find((t) => t.id === id) ?? null;
}

// Read-only view for the notification engine.
export function getTicketStore() {
  return tickets;
}

export const ticketRouter = router({
  list: protectedProcedure
    .input(z.object({
      commessaId: z.number().optional(),
      clienteId: z.number().optional(),
      stato: z.string().optional(),
    }).optional())
    .query(({ input, ctx }) => {
      let result = tickets.filter((t) => t.sedeId === ctx.sedeId);
      if (input?.commessaId) result = result.filter((t) => t.commessaId === input.commessaId);
      if (input?.clienteId) result = result.filter((t) => t.clienteId === input.clienteId);
      if (input?.stato) result = result.filter((t) => t.stato === input.stato);
      return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }),

  create: protectedProcedure
    .input(z.object({
      // Nessuno dei tre è obbligatorio: una chiamata di assistenza arriva
      // spesso prima che esista una commessa (o perfino il cliente).
      commessaId: z.number().nullable().optional(),
      clienteId: z.number().nullable().optional(),
      contatto: z.string().nullable().optional(),
      aperturaId: z.number().nullable().optional(),
      oggetto: z.string().min(1),
      descrizione: z.string().optional(),
      categoria: z.enum(["difetto_prodotto", "difetto_posa", "regolazione", "sostituzione", "garanzia", "altro"]),
      priorita: z.enum(["bassa", "media", "alta", "urgente"]).optional(),
      assegnatoA: z.number().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const now = new Date();
      const t = {
        id: nextId++,
        ...input,
        sedeId: ctx.sedeId ?? 1,
        commessaId: input.commessaId ?? null,
        clienteId: input.clienteId ?? null,
        contatto: input.contatto?.trim() || null,
        aperturaId: input.aperturaId ?? null,
        priorita: input.priorita ?? "media",
        stato: input.assegnatoA != null ? ("assegnato" as const) : ("aperto" as const),
        assegnatoA: input.assegnatoA ?? null,
        dataRisoluzione: null,
        esitoIntervento: null,
        solleciti: [],
        apertoBy: ctx.user?.id ?? null,
        createdAt: now,
        updatedAt: now,
      };
      tickets.push(t);
      _store.save();
      await publishAssignmentEvent({
        sedeId: t.sedeId,
        entityType: "ticket",
        entityId: t.id,
        previousAssigneeId: null,
        assigneeId: t.assegnatoA,
        actorUserId: ctx.user?.id ?? null,
        updatedAt: now,
        link: `/post-vendita?ticket=${t.id}`,
      });
      return t;
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      oggetto: z.string().optional(),
      descrizione: z.string().optional(),
      categoria: z.enum(["difetto_prodotto", "difetto_posa", "regolazione", "sostituzione", "garanzia", "altro"]).optional(),
      priorita: z.enum(["bassa", "media", "alta", "urgente"]).optional(),
      // Un ticket aperto al volo si aggancia dopo, quando si scopre a quale
      // commessa/cliente appartiene.
      commessaId: z.number().nullable().optional(),
      clienteId: z.number().nullable().optional(),
      contatto: z.string().nullable().optional(),
      assegnatoA: z.number().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const idx = tickets.findIndex((t) => t.id === input.id);
      if (idx === -1) throw new Error("Ticket non trovato");
      assertSedeScope(tickets[idx], ctx.sedeId);
      const previousAssigneeId = tickets[idx].assegnatoA ?? null;
      const { id, ...updates } = input;
      tickets[idx] = { ...tickets[idx], ...updates, updatedAt: new Date() };
      if (input.assegnatoA != null && tickets[idx].stato === "aperto") {
        tickets[idx].stato = "assegnato";
      }
      _store.save();
      if (input.assegnatoA !== undefined) {
        await publishAssignmentEvent({
          sedeId: tickets[idx].sedeId,
          entityType: "ticket",
          entityId: tickets[idx].id,
          previousAssigneeId,
          assigneeId: tickets[idx].assegnatoA ?? null,
          actorUserId: ctx.user?.id ?? null,
          updatedAt: tickets[idx].updatedAt,
          link: `/post-vendita?ticket=${tickets[idx].id}`,
        });
      }
      return tickets[idx];
    }),

  delete: protectedProcedure
    .input(z.number())
    .mutation(({ input, ctx }) => {
      const idx = tickets.findIndex((t) => t.id === input);
      if (idx === -1) throw new Error("Ticket non trovato");
      assertSedeScope(tickets[idx], ctx.sedeId);
      // Chi può eliminare: direzione, chi ha aperto il ticket, o chi possiede
      // la commessa collegata. Se la commessa non esiste più (cancellata), il
      // ticket resta comunque eliminabile da direzione o dall'autore —
      // altrimenti requireOwnershipOrDirezione(null) lanciava NOT_FOUND e il
      // ticket diventava indistruttibile.
      const uid = ctx.user?.id ?? null;
      const commessa = tickets[idx].commessaId
        ? getCommessaById(tickets[idx].commessaId)
        : null;
      const isAutore = uid != null && tickets[idx].apertoBy === uid;
      if (!isAutore) {
        if (commessa) {
          requireOwnershipOrDirezione(commessa, ctx.user);
        } else {
          requireDirezione(ctx.user);
        }
      }
      tickets.splice(idx, 1);
      // Cascade: also drop any attachments bound to the ticket, otherwise they
      // leak in the store with no parent.
      deleteAllegatiByTicket(input);
      _store.save();
      return { success: true };
    }),

  updateStato: protectedProcedure
    .input(z.object({
      id: z.number(),
      // Legacy "risolto" still accepted from older clients → folded to chiuso.
      stato: z.enum([...TICKET_STATI, "risolto"] as const),
      esitoIntervento: z.string().optional(),
    }))
    .mutation(({ input, ctx }) => {
      const idx = tickets.findIndex((t) => t.id === input.id);
      if (idx === -1) throw new Error("Ticket non trovato");
      assertSedeScope(tickets[idx], ctx.sedeId);
      const stato = input.stato === "risolto" ? "chiuso" : input.stato;
      tickets[idx].stato = stato;
      if (input.esitoIntervento) tickets[idx].esitoIntervento = input.esitoIntervento;
      if (stato === "chiuso") {
        tickets[idx].dataRisoluzione = new Date();
      }
      tickets[idx].updatedAt = new Date();
      _store.save();
      return tickets[idx];
    }),

  // Single-step rollback to the previous stato in TICKET_STATI. Clears
  // dataRisoluzione when leaving chiuso so the ticket is "open" again
  // for reporting. If already at "aperto" (first state) throws.
  rollbackStato: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(({ input, ctx }) => {
      const idx = tickets.findIndex((t) => t.id === input.id);
      if (idx === -1) throw new Error("Ticket non trovato");
      assertSedeScope(tickets[idx], ctx.sedeId);
      const currentIdx = TICKET_STATI.indexOf(tickets[idx].stato as TicketStato);
      if (currentIdx <= 0) {
        throw new Error("Il ticket è già al primo stato");
      }
      const prev = TICKET_STATI[currentIdx - 1];
      tickets[idx].stato = prev;
      if (prev !== "chiuso") {
        tickets[idx].dataRisoluzione = null;
      }
      tickets[idx].updatedAt = new Date();
      _store.save();
      return tickets[idx];
    }),

  // Sollecito: registra un promemoria inviato (a fornitore, squadra, o
  // interno) sul ticket. Il registro alimenta il badge "N solleciti · ultimo
  // il gg/mm" in lista — così si vede subito da quanto un ticket è fermo
  // nonostante i solleciti.
  sollecita: protectedProcedure
    .input(z.object({
      id: z.number(),
      nota: z.string().optional(),
    }))
    .mutation(({ input, ctx }) => {
      const idx = tickets.findIndex((t) => t.id === input.id);
      if (idx === -1) throw new Error("Ticket non trovato");
      assertSedeScope(tickets[idx], ctx.sedeId);
      if (tickets[idx].stato === "chiuso") {
        throw new Error("Il ticket è chiuso: riaprilo prima di sollecitare.");
      }
      if (!Array.isArray(tickets[idx].solleciti)) tickets[idx].solleciti = [];
      tickets[idx].solleciti.push({
        data: new Date(),
        nota: input.nota?.trim() || null,
        utenteId: ctx.user?.id ?? null,
      });
      tickets[idx].updatedAt = new Date();
      _store.save();
      return tickets[idx];
    }),

  stats: protectedProcedure.query(({ ctx }) => {
    const scoped = tickets.filter((t) => t.sedeId === ctx.sedeId);
    const aperti = scoped.filter((t) => t.stato === "aperto").length;
    const assegnati = scoped.filter((t) => t.stato === "assegnato").length;
    const inLavorazione = scoped.filter((t) => t.stato === "in_lavorazione").length;
    const chiusi = scoped.filter((t) => t.stato === "chiuso").length;
    return { aperti, assegnati, inLavorazione, risolti: chiusi, chiusi, totale: scoped.length };
  }),
});
