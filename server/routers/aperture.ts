import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { getCommessaById } from "./commesse";
import { requireOwnershipOrDirezione } from "../_core/permissions";

let nextId = 1;
const _apertureStore = persistedStore<any>("aperture", (loaded) => {
  nextId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
});
const aperture = _apertureStore.items;

export const apertureRouter = router({
  byCommessa: protectedProcedure.input(z.number()).query(({ input }) => {
    return aperture
      .filter((a) => a.commessaId === input)
      .sort((a, b) => a.codice.localeCompare(b.codice));
  }),

  byId: protectedProcedure.input(z.number()).query(({ input }) => {
    return aperture.find((a) => a.id === input) ?? null;
  }),

  create: protectedProcedure
    .input(
      z.object({
        commessaId: z.number(),
        codice: z.string().min(1),
        descrizione: z.string().optional(),
        piano: z.string().optional(),
        locale: z.string().optional(),
        tipologia: z.enum(["finestra", "portafinestra", "porta", "scorrevole", "fisso", "altro"]),
        larghezza: z.string().optional(),
        altezza: z.string().optional(),
        profondita: z.string().optional(),
        materiale: z.string().optional(),
        colore: z.string().optional(),
        vetro: z.string().optional(),
        noteRilievo: z.string().optional(),
        criticitaAccesso: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      const now = new Date();
      const apertura = {
        id: nextId++,
        ...input,
        stato: "da_rilevare" as const,
        createdAt: now,
        updatedAt: now,
      };
      aperture.push(apertura);
      _apertureStore.save();
      return apertura;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        descrizione: z.string().optional(),
        piano: z.string().optional(),
        locale: z.string().optional(),
        tipologia: z.enum(["finestra", "portafinestra", "porta", "scorrevole", "fisso", "altro"]).optional(),
        larghezza: z.string().optional(),
        altezza: z.string().optional(),
        profondita: z.string().optional(),
        materiale: z.string().optional(),
        colore: z.string().optional(),
        vetro: z.string().optional(),
        stato: z.enum(["da_rilevare", "rilevata", "ordinata", "consegnata", "in_posa", "posata", "verificata"]).optional(),
        noteRilievo: z.string().optional(),
        criticitaAccesso: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      const idx = aperture.findIndex((a) => a.id === input.id);
      if (idx === -1) throw new Error("Apertura non trovata");
      const { id, ...updates } = input;
      aperture[idx] = { ...aperture[idx], ...updates, updatedAt: new Date() };
      _apertureStore.save();
      return aperture[idx];
    }),

  delete: protectedProcedure
    .input(z.number())
    .mutation(({ input, ctx }) => {
      const idx = aperture.findIndex((a) => a.id === input);
      if (idx === -1) throw new Error("Apertura non trovata");
      // Ownership inherited from the parent commessa: only its owner or
      // a direzione user can delete child aperture.
      requireOwnershipOrDirezione(
        getCommessaById(aperture[idx].commessaId),
        ctx.user
      );
      aperture.splice(idx, 1);
      _apertureStore.save();
      return { success: true };
    }),
});
