import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";

let aperture: any[] = [];

let nextId = 1;

export const apertureRouter = router({
  byCommessa: publicProcedure.input(z.number()).query(({ input }) => {
    return aperture
      .filter((a) => a.commessaId === input)
      .sort((a, b) => a.codice.localeCompare(b.codice));
  }),

  byId: publicProcedure.input(z.number()).query(({ input }) => {
    return aperture.find((a) => a.id === input) ?? null;
  }),

  create: publicProcedure
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
      return apertura;
    }),

  update: publicProcedure
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
      return aperture[idx];
    }),

  delete: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = aperture.findIndex((a) => a.id === input);
    if (idx === -1) throw new Error("Apertura non trovata");
    aperture.splice(idx, 1);
    return { success: true };
  }),
});
