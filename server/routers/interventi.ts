import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { getCommessaById } from "./commesse";
import { assertSedeScope, isDirezione } from "../_core/permissions";
import { authorizeCoreOperation } from "../authz/enforcement";

let nextId = 1;
const _interventiStore = persistedStore<any>("interventi", (loaded) => {
  // One-shot cleanup: hard-delete any legacy "annullato" records so they
  // no longer appear in the calendar. Mutates the loaded array in place,
  // then schedules a save so the DB reflects the pruned state.
  const before = loaded.length;
  for (let i = loaded.length - 1; i >= 0; i--) {
    if (loaded[i]?.stato === "annullato") loaded.splice(i, 1);
  }
  const removed = before - loaded.length;
  if (removed > 0) {
    console.log(`[interventi] pruned ${removed} legacy annullato record(s) on load`);
    // Defer save until after bootstrap so ensureSchema has completed.
    setTimeout(() => _interventiStore.save(), 0);
  }
  // Backfill sede scope → default sede (id 1) for pre-multi-sede records.
  for (const i of loaded) {
    if ((i as any).sedeId === undefined) (i as any).sedeId = 1;
  }
  nextId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
});
const interventi = _interventiStore.items;

// Exposed for the ICS calendar feed (server/routers/calendarSync.ts).
export function getInterventiStore() {
  return interventi;
}

export const interventiRouter = router({
  list: protectedProcedure
    .input(z.object({
      commessaId: z.number().optional(),
      stato: z.string().optional(),
      tipo: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    }).optional())
    .query(({ input, ctx }) => {
      let result = interventi.filter((i) => i.sedeId === ctx.sedeId);
      if (input?.commessaId) result = result.filter((i) => i.commessaId === input.commessaId);
      if (input?.stato) result = result.filter((i) => i.stato === input.stato);
      if (input?.tipo) result = result.filter((i) => i.tipo === input.tipo);
      if (input?.from) result = result.filter((i) => i.dataPianificata >= input.from!);
      if (input?.to) result = result.filter((i) => i.dataPianificata <= input.to!);
      return result.sort((a, b) => (a.dataPianificata ?? "").localeCompare(b.dataPianificata ?? ""));
    }),

  byId: protectedProcedure.input(z.number()).query(({ input, ctx }) => {
    const i = interventi.find((i) => i.id === input);
    if (!i || i.sedeId !== ctx.sedeId) return null;
    return i;
  }),

  create: protectedProcedure
    .input(z.object({
      commessaId: z.number().nullable().optional(),
      squadraId: z.number().nullable().optional(),
      tipo: z.enum(["rilievo", "posa", "assistenza", "altro"]),
      dataPianificata: z.string().optional(),
      oraInizio: z.string().nullable().optional(), // "HH:MM"
      oraFine: z.string().nullable().optional(),   // "HH:MM"
      indirizzo: z.string().optional(),
      note: z.string().optional(),
      ticketId: z.number().nullable().optional(),
      reclamoId: z.number().nullable().optional(),
      rifacimentoId: z.number().nullable().optional(),
      // Migrazione calendario (T4/D2): chiave dell'evento esterno di
      // origine (`google:<sorgente>:<uid>:<data>`) — la dedupe del
      // reimport vive su questo campo.
      origineEsterna: z.string().max(200).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await authorizeCoreOperation({
        ctx,
        endpoint: "interventi.create",
        capability: "intervento.plan",
        resourceType: "intervento",
      });
      if (input.squadraId !== undefined) {
        await authorizeCoreOperation({
          ctx,
          endpoint: "interventi.assign",
          capability: "intervento.assign",
          resourceType: "intervento",
        });
      }
      if (input.commessaId != null) {
        assertSedeScope(getCommessaById(input.commessaId), ctx.sedeId);
      }
      const now = new Date();
      const intervento = {
        id: nextId++,
        ...input,
        sedeId: ctx.sedeId ?? 1,
        commessaId: input.commessaId ?? null,
        squadraId: input.squadraId ?? null,
        ticketId: input.ticketId ?? null,
        reclamoId: input.reclamoId ?? null,
        rifacimentoId: input.rifacimentoId ?? null,
        origineEsterna: input.origineEsterna ?? null,
        oraInizio: input.oraInizio ?? null,
        oraFine: input.oraFine ?? null,
        stato: "pianificato" as const,
        dataInizio: null,
        dataFine: null,
        createdBy: ctx.user?.id ?? null,
        createdAt: now,
        updatedAt: now,
      };
      interventi.push(intervento);
      _interventiStore.save();
      return intervento;
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      squadraId: z.number().nullable().optional(),
      tipo: z.enum(["rilievo", "posa", "assistenza", "altro"]).optional(),
      dataPianificata: z.string().optional(),
      oraInizio: z.string().nullable().optional(),
      oraFine: z.string().nullable().optional(),
      indirizzo: z.string().optional(),
      note: z.string().optional(),
      ticketId: z.number().nullable().optional(),
      reclamoId: z.number().nullable().optional(),
      rifacimentoId: z.number().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const idx = interventi.findIndex((i) => i.id === input.id);
      if (idx === -1) throw new Error("Intervento non trovato");
      assertSedeScope(interventi[idx], ctx.sedeId);
      const parent = interventi[idx].commessaId == null
        ? null
        : getCommessaById(interventi[idx].commessaId);
      const policyResource = {
        ...interventi[idx],
        createdBy: interventi[idx].createdBy ?? parent?.createdBy ?? null,
        assegnatoA: parent?.assegnatoA ?? null,
      };
      await authorizeCoreOperation({
        ctx,
        endpoint: "interventi.update",
        capability: "intervento.plan",
        resourceType: "intervento",
        resource: policyResource,
      });
      if (input.squadraId !== undefined) {
        await authorizeCoreOperation({
          ctx,
          endpoint: "interventi.assign",
          capability: "intervento.assign",
          resourceType: "intervento",
          resource: policyResource,
        });
      }
      const { id, ...updates } = input;
      interventi[idx] = { ...interventi[idx], ...updates, updatedAt: new Date() };
      _interventiStore.save();
      return interventi[idx];
    }),

  delete: protectedProcedure
    .input(z.number())
    .mutation(async ({ input, ctx }) => {
      const idx = interventi.findIndex((i) => i.id === input);
      if (idx === -1) throw new Error("Intervento non trovato");
      assertSedeScope(interventi[idx], ctx.sedeId);
      const parent = interventi[idx].commessaId == null
        ? null
        : getCommessaById(interventi[idx].commessaId);
      const uid = ctx.user?.id ?? null;
      await authorizeCoreOperation({
        ctx,
        endpoint: "interventi.delete",
        capability: "intervento.delete",
        resourceType: "intervento",
        resource: {
          ...interventi[idx],
          createdBy: interventi[idx].createdBy ?? parent?.createdBy ?? null,
          assegnatoA: parent?.assegnatoA ?? null,
        },
        legacyAllowed:
          parent == null ||
          isDirezione(ctx.user) ||
          (uid != null && (parent.createdBy === uid || parent.assegnatoA === uid)),
      });
      interventi.splice(idx, 1);
      _interventiStore.save();
      return { success: true };
    }),

  updateStato: protectedProcedure
    .input(z.object({
      id: z.number(),
      // "annullato" intentionally NOT in the enum: cancellations go through
      // the hard `delete` endpoint. Legacy `annullato` rows are purged on
      // load (see _interventiStore.onLoad above) and the UI hides them.
      stato: z.enum(["pianificato", "in_corso", "completato", "sospeso"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const idx = interventi.findIndex((i) => i.id === input.id);
      if (idx === -1) throw new Error("Intervento non trovato");
      assertSedeScope(interventi[idx], ctx.sedeId);
      const parent = interventi[idx].commessaId == null
        ? null
        : getCommessaById(interventi[idx].commessaId);
      await authorizeCoreOperation({
        ctx,
        endpoint: "interventi.updateState",
        capability: "intervento.plan",
        resourceType: "intervento",
        resource: {
          ...interventi[idx],
          createdBy: interventi[idx].createdBy ?? parent?.createdBy ?? null,
          assegnatoA: parent?.assegnatoA ?? null,
        },
      });
      interventi[idx].stato = input.stato;
      if (input.stato === "in_corso") interventi[idx].dataInizio = new Date();
      if (input.stato === "completato") interventi[idx].dataFine = new Date();
      interventi[idx].updatedAt = new Date();
      _interventiStore.save();
      return interventi[idx];
    }),
});
