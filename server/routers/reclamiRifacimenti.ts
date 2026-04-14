import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";

// --- Reclami (complaints) ---

let nextReclamoId = 1;
const _reclamiStore = persistedStore<any>("reclami", (loaded) => {
  nextReclamoId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
});
const reclami = _reclamiStore.items;

// --- Rifacimenti (remakes) ---

let nextRifacimentoId = 1;
const _rifacimentiStore = persistedStore<any>("rifacimenti", (loaded) => {
  nextRifacimentoId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
});
const rifacimenti = _rifacimentiStore.items;

// --- Router ---

export const reclamiRifacimentiRouter = router({
  reclami: router({
    list: publicProcedure
      .input(z.object({
        commessaId: z.number().optional(),
        stato: z.string().optional(),
      }).optional())
      .query(({ input }) => {
        let result = [...reclami];
        if (input?.commessaId) result = result.filter((r) => r.commessaId === input.commessaId);
        if (input?.stato) result = result.filter((r) => r.stato === input.stato);
        return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }),

    create: publicProcedure
      .input(z.object({
        commessaId: z.number(),
        clienteNome: z.string().min(1),
        descrizione: z.string().min(1),
        responsabile: z.string().optional(),
      }))
      .mutation(({ input }) => {
        const now = new Date();
        const reclamo = {
          id: nextReclamoId++,
          ...input,
          responsabile: input.responsabile ?? null,
          stato: "aperto" as const,
          dataApertura: now.toISOString().split("T")[0],
          dataRisoluzione: null,
          soluzione: null,
          createdAt: now,
          updatedAt: now,
        };
        reclami.push(reclamo);
        _reclamiStore.save();
        return reclamo;
      }),

    update: publicProcedure
      .input(z.object({
        id: z.number(),
        clienteNome: z.string().optional(),
        descrizione: z.string().optional(),
        responsabile: z.string().optional(),
        stato: z.enum(["aperto", "in_gestione", "risolto", "chiuso"]).optional(),
        soluzione: z.string().optional(),
      }))
      .mutation(({ input }) => {
        const idx = reclami.findIndex((r) => r.id === input.id);
        if (idx === -1) throw new Error("Reclamo non trovato");
        const { id, ...updates } = input;
        if (updates.stato === "risolto" || updates.stato === "chiuso") {
          (updates as any).dataRisoluzione = new Date().toISOString().split("T")[0];
        }
        reclami[idx] = { ...reclami[idx], ...updates, updatedAt: new Date() };
        _reclamiStore.save();
        return reclami[idx];
      }),

    delete: publicProcedure.input(z.number()).mutation(({ input }) => {
      const idx = reclami.findIndex((r) => r.id === input);
      if (idx === -1) throw new Error("Reclamo non trovato");
      reclami.splice(idx, 1);
      _reclamiStore.save();
      return { success: true };
    }),

    stats: publicProcedure.query(() => {
      const aperti = reclami.filter((r) => r.stato === "aperto").length;
      const inGestione = reclami.filter((r) => r.stato === "in_gestione").length;
      const risolti = reclami.filter((r) => r.stato === "risolto").length;
      const chiusi = reclami.filter((r) => r.stato === "chiuso").length;
      return { aperti, inGestione, risolti, chiusi, totale: reclami.length };
    }),
  }),

  rifacimenti: router({
    list: publicProcedure
      .input(z.object({
        commessaId: z.number().optional(),
        stato: z.string().optional(),
        responsabilita: z.enum(["interna", "esterna"]).optional(),
      }).optional())
      .query(({ input }) => {
        let result = [...rifacimenti];
        if (input?.commessaId) result = result.filter((r) => r.commessaId === input.commessaId);
        if (input?.stato) result = result.filter((r) => r.stato === input.stato);
        if (input?.responsabilita) result = result.filter((r) => r.responsabilita === input.responsabilita);
        return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }),

    create: publicProcedure
      .input(z.object({
        commessaId: z.number(),
        clienteNome: z.string().min(1),
        descrizione: z.string().min(1),
        elemento: z.string().min(1),
        fornitoreCoinvolto: z.string().optional(),
        ordineRifacimentoId: z.string().optional(),
        costoStimato: z.number().optional(),
        responsabilita: z.enum(["interna", "esterna"]),
        responsabile: z.string().optional(),
      }))
      .mutation(({ input }) => {
        const now = new Date();
        const rifacimento = {
          id: nextRifacimentoId++,
          ...input,
          fornitoreCoinvolto: input.fornitoreCoinvolto ?? null,
          ordineRifacimentoId: input.ordineRifacimentoId ?? null,
          costoStimato: input.costoStimato ?? null,
          responsabile: input.responsabile ?? null,
          stato: "aperto" as const,
          dataApertura: now.toISOString().split("T")[0],
          dataChiusura: null,
          createdAt: now,
          updatedAt: now,
        };
        rifacimenti.push(rifacimento);
        _rifacimentiStore.save();
        return rifacimento;
      }),

    update: publicProcedure
      .input(z.object({
        id: z.number(),
        clienteNome: z.string().optional(),
        descrizione: z.string().optional(),
        elemento: z.string().optional(),
        fornitoreCoinvolto: z.string().optional(),
        ordineRifacimentoId: z.string().optional(),
        costoStimato: z.number().optional(),
        responsabilita: z.enum(["interna", "esterna"]).optional(),
        responsabile: z.string().optional(),
        stato: z.enum(["aperto", "in_gestione", "in_produzione", "completato", "chiuso"]).optional(),
      }))
      .mutation(({ input }) => {
        const idx = rifacimenti.findIndex((r) => r.id === input.id);
        if (idx === -1) throw new Error("Rifacimento non trovato");
        const { id, ...updates } = input;
        if (updates.stato === "completato" || updates.stato === "chiuso") {
          (updates as any).dataChiusura = new Date().toISOString().split("T")[0];
        }
        rifacimenti[idx] = { ...rifacimenti[idx], ...updates, updatedAt: new Date() };
        _rifacimentiStore.save();
        return rifacimenti[idx];
      }),

    delete: publicProcedure.input(z.number()).mutation(({ input }) => {
      const idx = rifacimenti.findIndex((r) => r.id === input);
      if (idx === -1) throw new Error("Rifacimento non trovato");
      rifacimenti.splice(idx, 1);
      _rifacimentiStore.save();
      return { success: true };
    }),

    stats: publicProcedure.query(() => {
      const aperti = rifacimenti.filter((r) => r.stato === "aperto").length;
      const inGestione = rifacimenti.filter((r) => r.stato === "in_gestione").length;
      const inProduzione = rifacimenti.filter((r) => r.stato === "in_produzione").length;
      const completati = rifacimenti.filter((r) => r.stato === "completato").length;
      const chiusi = rifacimenti.filter((r) => r.stato === "chiuso").length;
      const costoTotaleStimato = rifacimenti
        .filter((r) => r.costoStimato !== null)
        .reduce((sum: number, r: any) => sum + r.costoStimato, 0);
      const interni = rifacimenti.filter((r) => r.responsabilita === "interna").length;
      const esterni = rifacimenti.filter((r) => r.responsabilita === "esterna").length;
      return { aperti, inGestione, inProduzione, completati, chiusi, costoTotaleStimato, interni, esterni, totale: rifacimenti.length };
    }),
  }),
});
