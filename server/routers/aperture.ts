import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { getCommessaById } from "./commesse";
import { oppureNotFound, requireOwnershipOrDirezione } from "../_core/permissions";

const _apertureStore = persistedStore<any>("aperture", () => {});
const aperture = _apertureStore.items;

// Cross-sede guard: an apertura is only visible/mutable when its parent
// commessa belongs to the active sede.
function commessaInSede(commessaId: number, sedeId: number | null) {
  const c = getCommessaById(commessaId);
  if (!c) return null;
  if (sedeId != null && (c as any).sedeId !== sedeId) return null;
  return c;
}

export const apertureRouter = router({
  byCommessa: protectedProcedure.input(z.number()).query(({ input, ctx }) => {
    if (!commessaInSede(input, ctx.sedeId)) return [];
    return aperture
      .filter((a) => a.commessaId === input)
      .sort((a, b) => a.codice.localeCompare(b.codice));
  }),

  byId: protectedProcedure.input(z.number()).query(({ input, ctx }) => {
    const a = aperture.find((x) => x.id === input);
    if (!a) return null;
    if (!commessaInSede(a.commessaId, ctx.sedeId)) return null;
    return a;
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
    .mutation(({ input, ctx }) => {
      oppureNotFound(commessaInSede(input.commessaId, ctx.sedeId));
      const now = new Date();
      const apertura = {
        id: _apertureStore.prossimoId(),
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
    .mutation(({ input, ctx }) => {
      const idx = aperture.findIndex((a) => a.id === input.id);
      oppureNotFound(idx === -1 ? undefined : aperture[idx]);
      oppureNotFound(commessaInSede(aperture[idx].commessaId, ctx.sedeId));
      const { id, ...updates } = input;
      aperture[idx] = { ...aperture[idx], ...updates, updatedAt: new Date() };
      _apertureStore.save();
      return aperture[idx];
    }),

  delete: protectedProcedure
    .input(z.number())
    .mutation(({ input, ctx }) => {
      const idx = aperture.findIndex((a) => a.id === input);
      oppureNotFound(idx === -1 ? undefined : aperture[idx]);
      const commessa = oppureNotFound(commessaInSede(aperture[idx].commessaId, ctx.sedeId));
      // Ownership inherited from the parent commessa: only its owner or
      // a direzione user can delete child aperture.
      requireOwnershipOrDirezione(commessa, ctx.user);
      aperture.splice(idx, 1);
      _apertureStore.save();
      return { success: true };
    }),
});
