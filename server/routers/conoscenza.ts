// Conoscenza aziendale: fornitori, processi, terminologia, convenzioni.
//
// Viveva dentro il router Tars perché era nata per alimentarne il prompt, ma
// non è il cervello: è una scheda che le persone scrivono e rileggono, con la
// sua pagina `/conoscenza`. Quando Tars è stato rimosso questa è rimasta,
// perché buttarla avrebbe cancellato lavoro fatto a mano che non c'entrava
// niente con l'agente.

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { persistedStore } from "../_core/persistence";
import { requireDirezione } from "../_core/permissions";
import { protectedProcedure, router } from "../_core/trpc";
import { DEFAULT_SEDE_ID } from "./sedi";

export const CATEGORIE_CONOSCENZA = [
  "fornitori",
  "processo",
  "clienti",
  "terminologia",
  "convenzioni",
  "preferenze_comunicazione",
] as const;
export type CategoriaConoscenza = (typeof CATEGORIE_CONOSCENZA)[number];

export type VoceConoscenza = {
  id: number;
  sedeId: number;
  categoria: CategoriaConoscenza;
  titolo: string;
  contenuto: string;
  attiva: boolean;
  aggiornatoDa: string | null;
  aggiornatoAt: Date;
  createdAt: Date;
};

let nextVoceId = 1;
const _conoscenzaStore = persistedStore<VoceConoscenza>(
  "conoscenza_aziendale",
  items => {
    nextVoceId = items.length ? Math.max(...items.map(v => v.id)) + 1 : 1;
  }
);
export const conoscenza = _conoscenzaStore.items;
export const saveConoscenza = () => _conoscenzaStore.save();

/** Una voce di un'altra sede non esiste: NOT_FOUND, mai un errore parlante. */
function trova(id: number, sedeId: number | null): VoceConoscenza {
  const voce = conoscenza.find(
    v => v.id === id && v.sedeId === (sedeId ?? DEFAULT_SEDE_ID)
  );
  if (!voce) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Voce non trovata." });
  }
  return voce;
}

export const conoscenzaRouter = router({
  list: protectedProcedure.query(({ ctx }) => {
    requireDirezione(ctx.user);
    return conoscenza
      .filter(v => v.sedeId === (ctx.sedeId ?? DEFAULT_SEDE_ID))
      .sort((a, b) => a.categoria.localeCompare(b.categoria) || a.id - b.id);
  }),

  create: protectedProcedure
    .input(
      z.object({
        categoria: z.enum(CATEGORIE_CONOSCENZA),
        titolo: z.string().min(1).max(200),
        contenuto: z.string().min(1).max(2000),
      })
    )
    .mutation(({ input, ctx }) => {
      requireDirezione(ctx.user);
      const voce: VoceConoscenza = {
        id: nextVoceId++,
        sedeId: ctx.sedeId ?? DEFAULT_SEDE_ID,
        categoria: input.categoria,
        titolo: input.titolo.trim(),
        contenuto: input.contenuto.trim(),
        attiva: true,
        aggiornatoDa: ctx.user?.name ?? null,
        aggiornatoAt: new Date(),
        createdAt: new Date(),
      };
      conoscenza.push(voce);
      saveConoscenza();
      return voce;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        categoria: z.enum(CATEGORIE_CONOSCENZA).optional(),
        titolo: z.string().min(1).max(200).optional(),
        contenuto: z.string().min(1).max(2000).optional(),
        attiva: z.boolean().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      requireDirezione(ctx.user);
      const voce = trova(input.id, ctx.sedeId);
      if (input.categoria !== undefined) voce.categoria = input.categoria;
      if (input.titolo !== undefined) voce.titolo = input.titolo.trim();
      if (input.contenuto !== undefined) voce.contenuto = input.contenuto.trim();
      if (input.attiva !== undefined) voce.attiva = input.attiva;
      voce.aggiornatoDa = ctx.user?.name ?? null;
      voce.aggiornatoAt = new Date();
      saveConoscenza();
      return voce;
    }),

  delete: protectedProcedure.input(z.number()).mutation(({ input, ctx }) => {
    requireDirezione(ctx.user);
    const voce = trova(input, ctx.sedeId);
    conoscenza.splice(conoscenza.indexOf(voce), 1);
    saveConoscenza();
    return { success: true } as const;
  }),
});
