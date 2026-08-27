// Registro dei costi fissi confermati.
//
// Il break-even legge `costiFissi` dalle fatture d'acquisto FiC classificate
// `fisso`: sui dati veri sono €9.313 al mese, su 37 fornitori. Dentro non c'è
// una riga di stipendi, né contributi, né tasse, né un affitto pagato con
// bonifico senza fattura passiva — niente di tutto ciò passa da Fatture in
// Cloud. Il pareggio calcolato su quel numero è quindi molto più basso del
// vero, e non c'era modo di correggerlo: non esisteva un posto dove scrivere
// un costo fisso che FiC non conosce.
//
// Questo store è quel posto. Le voci possono essere dichiarate a mano o
// confermare un candidato FiC, ma entrano nel break-even solo dopo la
// registrazione esplicita di una persona.

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { persistedStore } from "../_core/persistence";
import { requireDirezioneOAmministrazione } from "../_core/permissions";
import { protectedProcedure, router } from "../_core/trpc";
import { DEFAULT_SEDE_ID } from "./sedi";
import { candidatiFissiPerSede } from "./ficCosti";

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
  origine: "manuale" | "fic";
  ficChiaveRicorrenza: string | null;
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
    if (voce.origine === undefined) voce.origine = "manuale";
    if (voce.ficChiaveRicorrenza === undefined) voce.ficChiaveRicorrenza = null;
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

/**
 * Come si vuole calcolare il punto di pareggio, per sede.
 *
 * Due leve, entrambe nate da un dubbio legittimo sull'automatismo:
 *
 * - `margineManuale`: il margine di contribuzione viene calcolato sugli
 *   ultimi dodici mesi, ma se in quel periodo centinaia di costi erano ancora
 *   da classificare la percentuale non descrive l'azienda. Poterla fissare a
 *   mano vale piu' di un numero preciso ma sbagliato.
 * - `includiStraordinari`: sui dati veri gli straordinari sono €110.963 in un
 *   anno, piu' dei costi fissi, e non entrano ne' fra i fissi ne' fra i
 *   variabili — spariscono dal pareggio. Per alcune aziende sono davvero una
 *   tantum; per altre sono struttura sotto un altro nome. Lo decide chi
 *   conosce l'azienda, non il codice.
 *
 * L'impostazione e' della SEDE, non dell'utente: due persone che guardano lo
 * stesso obiettivo devono leggere lo stesso numero.
 */
export type ImpostazioniPareggio = {
  sedeId: number;
  /** 0–1, oppure null per usare quello calcolato dai documenti. */
  margineManuale: number | null;
  includiStraordinari: boolean;
  updatedBy: number | null;
  updatedAt: Date | null;
};

const _impostazioniStore = persistedStore<ImpostazioniPareggio>(
  "impostazioni_pareggio",
  items => {
    for (const voce of items as any[]) {
      if (voce.sedeId === undefined) voce.sedeId = DEFAULT_SEDE_ID;
      if (voce.margineManuale === undefined) voce.margineManuale = null;
      if (voce.includiStraordinari === undefined) voce.includiStraordinari = false;
      if (voce.updatedBy === undefined) voce.updatedBy = null;
      if (voce.updatedAt != null && !(voce.updatedAt instanceof Date)) {
        voce.updatedAt = new Date(voce.updatedAt);
      }
    }
  }
);

export function impostazioniPareggio(sedeId: number): ImpostazioniPareggio {
  return (
    _impostazioniStore.items.find(voce => voce.sedeId === sedeId) ?? {
      sedeId,
      margineManuale: null,
      includiStraordinari: false,
      updatedBy: null,
      updatedAt: null,
    }
  );
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

  impostazioni: protectedProcedure.query(({ ctx }) => {
    requireDirezioneOAmministrazione(ctx.user);
    return impostazioniPareggio(ctx.sedeId ?? DEFAULT_SEDE_ID);
  }),

  salvaImpostazioni: protectedProcedure
    .input(
      z.object({
        // Un margine di contribuzione a zero o negativo renderebbe
        // l'obiettivo infinito: si rifiuta prima di scriverlo.
        margineManuale: z.number().gt(0).lte(1).nullable(),
        includiStraordinari: z.boolean(),
      })
    )
    .mutation(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
      let voce = _impostazioniStore.items.find(item => item.sedeId === sedeId);
      if (!voce) {
        voce = {
          sedeId,
          margineManuale: null,
          includiStraordinari: false,
          updatedBy: null,
          updatedAt: null,
        };
        _impostazioniStore.items.push(voce);
      }
      voce.margineManuale = input.margineManuale;
      voce.includiStraordinari = input.includiStraordinari;
      voce.updatedBy = ctx.user?.id ?? null;
      voce.updatedAt = new Date();
      _impostazioniStore.save();
      return voce;
    }),

  confermaDaFic: protectedProcedure
    .input(
      z.object({
        chiave: z.string().trim().min(1),
        descrizione: z.string().trim().min(1).max(200),
        cadenza: cadenzaSchema,
        dal: meseSchema,
        categoria: categoriaSchema,
      })
    )
    .mutation(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
      const candidato = candidatiFissiPerSede(sedeId).find(
        item => item.chiave === input.chiave
      );
      if (!candidato) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Candidato FiC non trovato.",
        });
      }
      const esistente = costiFissiManuali.find(
        item =>
          item.sedeId === sedeId && item.ficChiaveRicorrenza === candidato.chiave
      );
      if (esistente) return { ...esistente, mensile: importoMensile(esistente) };

      const voce: CostoFissoManuale = {
        id: costiFissiManuali.reduce((max, item) => Math.max(max, item.id), 0) + 1,
        sedeId,
        origine: "fic",
        ficChiaveRicorrenza: candidato.chiave,
        descrizione: input.descrizione,
        fornitore: candidato.fornitore,
        importo: Math.round(candidato.importo * 100) / 100,
        cadenza: input.cadenza,
        dal: input.dal,
        al: null,
        categoria: input.categoria,
        note: null,
        createdBy: ctx.user?.id ?? null,
        createdAt: new Date(),
        updatedAt: null,
      };
      costiFissiManuali.push(voce);
      saveCostiFissiManuali();
      return { ...voce, mensile: importoMensile(voce) };
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
        origine: "manuale",
        ficChiaveRicorrenza: null,
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
