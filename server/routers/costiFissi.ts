// Le voci di costo fisso che Fatture in Cloud non può conoscere.
//
// Il registro dei costi fissi dell'azienda ha due sorgenti, e questa è la
// seconda. La prima sono le fatture d'acquisto FiC classificate `fisso` nella
// scheda Acquisti: FiC fa fede, e quella classificazione basta da sola —
// nessuna seconda registrazione, nessuna conferma da ridare.
//
// Qui vive solo ciò che in FiC non passa e non passerà: stipendi, contributi,
// tasse, affitti pagati con bonifico senza fattura passiva. Senza queste voci
// il pareggio girava su €9.313 al mese quando l'azienda ne costa molti di
// più.
//
// La somma delle due sorgenti sta in `_core/costiFissiAzienda.ts`, che è
// anche il punto in cui si evita di contarle due volte: una voce dichiarata
// che nomina un fornitore già fisso in FiC lo rimpiazza.

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { persistedStore } from "../_core/persistence";
import { requireDirezioneOAmministrazione } from "../_core/permissions";
import { protectedProcedure, router } from "../_core/trpc";
import { DEFAULT_SEDE_ID } from "./sedi";
import { ficCosti } from "./ficCosti";
import {
  calcolaCostiFissiAzienda,
  periodoBase,
  type CostiFissiAzienda,
} from "../_core/costiFissiAzienda";

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
 * Il registro completo: FiC classificato `fisso` + voci dichiarate a mano.
 *
 * È l'unica risposta alla domanda "quanto costa tenere aperta l'azienda ogni
 * mese". Prima ce n'erano due — la classificazione FiC e questo store — e non
 * si parlavano: classificare venti fornitori come fissi lasciava il totale a
 * zero.
 */
export function costiFissiAzienda(
  sedeId: number,
  riferimento?: { anno: number; mese: number }
): CostiFissiAzienda {
  const { periodoDa, periodoA } = periodoBase(riferimento);
  return calcolaCostiFissiAzienda({
    costiFic: ficCosti,
    dichiarati: costiFissiManualiPerSede(sedeId).map(voce => ({
      id: voce.id,
      descrizione: voce.descrizione,
      fornitore: voce.fornitore,
      importo: voce.importo,
      mensile: voce.mensile,
      cadenza: voce.cadenza,
      categoria: voce.categoria,
      dal: voce.dal,
      al: voce.al,
      note: voce.note,
    })),
    sedeId,
    periodoDa,
    periodoA,
  });
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
  list: protectedProcedure
    .input(
      z
        .object({ anno: z.number().int(), mese: z.number().int().min(1).max(12) })
        .optional()
    )
    .query(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
      const registro = costiFissiAzienda(sedeId, input ?? undefined);
      return {
        ...registro,
        // Le voci dichiarate servono anche nude, per il form che le modifica:
        // il registro le mostra fuse con quelle FiC e senza le voci scadute.
        voci: costiFissiManualiPerSede(sedeId),
        totaleMensile: registro.totaleMensile,
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
