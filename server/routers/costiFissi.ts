// Costi fissi aggiunti a mano.
//
// Il break-even legge `costiFissi` dalle fatture d'acquisto FiC classificate
// `fisso`: sui dati veri sono €9.313 al mese, su 37 fornitori. Dentro non c'è
// una riga di stipendi, né contributi, né tasse, né un affitto pagato con
// bonifico senza fattura passiva — niente di tutto ciò passa da Fatture in
// Cloud. Il pareggio calcolato su quel numero è quindi molto più basso del
// vero, e non c'era modo di correggerlo: non esisteva un posto dove scrivere
// un costo fisso che FiC non conosce.
//
// Questo store è quel posto. Voci dichiarate da una persona, con una cadenza
// e un periodo di validità, che entrano nel break-even accanto a quelle
// lette da FiC.

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { persistedStore } from "../_core/persistence";
import { requireDirezioneOAmministrazione } from "../_core/permissions";
import { protectedProcedure, router } from "../_core/trpc";
import { DEFAULT_SEDE_ID } from "./sedi";

export type CadenzaCostoFisso =
  | "mensile"
  | "bimestrale"
  | "trimestrale"
  | "quadrimestrale"
  | "semestrale"
  | "annuale";

/** Quanti mesi copre una singola occorrenza. */
export const MESI_PER_CADENZA: Record<CadenzaCostoFisso, number> = {
  mensile: 1,
  bimestrale: 2,
  trimestrale: 3,
  quadrimestrale: 4,
  semestrale: 6,
  annuale: 12,
};

export const CATEGORIE_COSTO_FISSO = [
  "personale",
  "immobili",
  "veicoli",
  "servizi",
  "finanziari",
  "tasse",
  "altro",
] as const;

export type CategoriaCostoFisso = (typeof CATEGORIE_COSTO_FISSO)[number];

export type CostoFissoManuale = {
  id: number;
  sedeId: number;
  descrizione: string;
  fornitore: string | null;
  /** Importo di UNA occorrenza, non il mensilizzato. */
  importo: number;
  cadenza: CadenzaCostoFisso;
  /** "YYYY-MM" inclusi. `al` a null significa ancora in corso. */
  dal: string;
  al: string | null;
  categoria: CategoriaCostoFisso;
  note: string | null;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date | null;
};

const _store = persistedStore<CostoFissoManuale>("costi_fissi_manuali", items => {
  for (const voce of items as any[]) {
    if (voce.sedeId === undefined) voce.sedeId = DEFAULT_SEDE_ID;
    if (voce.cadenza === undefined) voce.cadenza = "mensile";
    if (voce.categoria === undefined) voce.categoria = "altro";
    if (voce.al === undefined) voce.al = null;
    if (voce.note === undefined) voce.note = null;
    if (voce.fornitore === undefined) voce.fornitore = null;
    if (voce.createdBy === undefined) voce.createdBy = null;
    if (!(voce.createdAt instanceof Date)) voce.createdAt = new Date(voce.createdAt);
    if (voce.updatedAt != null && !(voce.updatedAt instanceof Date)) {
      voce.updatedAt = new Date(voce.updatedAt);
    }
  }
});

export const costiFissiManuali = _store.items;
export const saveCostiFissiManuali = () => _store.save();

/** Quanto pesa al mese: una cadenza annuale non è un costo di gennaio. */
export function importoMensile(voce: {
  importo: number;
  cadenza: CadenzaCostoFisso;
}): number {
  return (
    Math.round((voce.importo / MESI_PER_CADENZA[voce.cadenza]) * 100) / 100
  );
}

const MESE_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function indiceMese(mese: string): number {
  const [anno, numero] = mese.split("-").map(Number);
  return anno * 12 + (numero - 1);
}

/**
 * Quanti mesi della voce cadono dentro il periodo indicato.
 *
 * Serve al break-even: un costo aggiunto a marzo non deve pesare sui dodici
 * mesi precedenti, e uno chiuso a giugno non deve pesare su luglio.
 */
export function mesiNelPeriodo(
  voce: { dal: string; al: string | null },
  periodoDa: string,
  periodoA: string
): number {
  const da = Math.max(indiceMese(voce.dal), indiceMese(periodoDa.slice(0, 7)));
  const a = Math.min(
    voce.al ? indiceMese(voce.al) : Number.MAX_SAFE_INTEGER,
    indiceMese(periodoA.slice(0, 7))
  );
  return Math.max(0, a - da + 1);
}

/** Le voci attive di una sede, con il loro peso mensile. */
export function costiFissiManualiPerSede(sedeId: number): Array<
  CostoFissoManuale & { mensile: number }
> {
  return costiFissiManuali
    .filter(voce => voce.sedeId === sedeId)
    .map(voce => ({ ...voce, mensile: importoMensile(voce) }))
    .sort((a, b) => b.mensile - a.mensile);
}

const cadenzaSchema = z.enum([
  "mensile",
  "bimestrale",
  "trimestrale",
  "quadrimestrale",
  "semestrale",
  "annuale",
]);
const categoriaSchema = z.enum(CATEGORIE_COSTO_FISSO);
const meseSchema = z.string().regex(MESE_RE, "Formato atteso: AAAA-MM");

function trova(id: number, sedeId: number | null): CostoFissoManuale {
  const voce = costiFissiManuali.find(
    item => item.id === id && item.sedeId === (sedeId ?? DEFAULT_SEDE_ID)
  );
  if (!voce) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Costo fisso non trovato." });
  }
  return voce;
}

export const costiFissiRouter = router({
  list: protectedProcedure.query(({ ctx }) => {
    requireDirezioneOAmministrazione(ctx.user);
    const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
    const voci = costiFissiManualiPerSede(sedeId);
    return {
      voci,
      totaleMensile:
        Math.round(voci.reduce((somma, voce) => somma + voce.mensile, 0) * 100) /
        100,
    };
  }),

  create: protectedProcedure
    .input(
      z.object({
        descrizione: z.string().trim().min(1).max(200),
        fornitore: z.string().trim().max(200).nullable().optional(),
        importo: z.number().positive(),
        cadenza: cadenzaSchema,
        dal: meseSchema,
        al: meseSchema.nullable().optional(),
        categoria: categoriaSchema,
        note: z.string().trim().max(1000).nullable().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      if (input.al && input.al < input.dal) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La fine non può precedere l'inizio.",
        });
      }
      const voce: CostoFissoManuale = {
        id: costiFissiManuali.reduce((max, item) => Math.max(max, item.id), 0) + 1,
        sedeId: ctx.sedeId ?? DEFAULT_SEDE_ID,
        descrizione: input.descrizione,
        fornitore: input.fornitore?.trim() || null,
        importo: Math.round(input.importo * 100) / 100,
        cadenza: input.cadenza,
        dal: input.dal,
        al: input.al ?? null,
        categoria: input.categoria,
        note: input.note?.trim() || null,
        createdBy: ctx.user?.id ?? null,
        createdAt: new Date(),
        updatedAt: null,
      };
      costiFissiManuali.push(voce);
      saveCostiFissiManuali();
      return { ...voce, mensile: importoMensile(voce) };
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int(),
        descrizione: z.string().trim().min(1).max(200).optional(),
        fornitore: z.string().trim().max(200).nullable().optional(),
        importo: z.number().positive().optional(),
        cadenza: cadenzaSchema.optional(),
        dal: meseSchema.optional(),
        al: meseSchema.nullable().optional(),
        categoria: categoriaSchema.optional(),
        note: z.string().trim().max(1000).nullable().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const voce = trova(input.id, ctx.sedeId);
      if (input.descrizione !== undefined) voce.descrizione = input.descrizione;
      if (input.fornitore !== undefined) {
        voce.fornitore = input.fornitore?.trim() || null;
      }
      if (input.importo !== undefined) {
        voce.importo = Math.round(input.importo * 100) / 100;
      }
      if (input.cadenza !== undefined) voce.cadenza = input.cadenza;
      if (input.dal !== undefined) voce.dal = input.dal;
      if (input.al !== undefined) voce.al = input.al;
      if (input.categoria !== undefined) voce.categoria = input.categoria;
      if (input.note !== undefined) voce.note = input.note?.trim() || null;
      if (voce.al && voce.al < voce.dal) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La fine non può precedere l'inizio.",
        });
      }
      voce.updatedAt = new Date();
      saveCostiFissiManuali();
      return { ...voce, mensile: importoMensile(voce) };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const voce = trova(input.id, ctx.sedeId);
      costiFissiManuali.splice(costiFissiManuali.indexOf(voce), 1);
      saveCostiFissiManuali();
      return { success: true as const };
    }),
});
