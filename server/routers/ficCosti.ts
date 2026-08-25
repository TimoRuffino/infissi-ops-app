import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { persistedStore } from "../_core/persistence";
import { requireDirezioneOAmministrazione } from "../_core/permissions";
import { protectedProcedure, router } from "../_core/trpc";
import type { ClassificazioneCostoEconomico } from "../_core/economiaFic";
import type { RataFic } from "./ficFatture";
import { DEFAULT_SEDE_ID } from "./sedi";

export type ClassificazioneCosto = ClassificazioneCostoEconomico;
export type FonteClassificazioneCosto = "regola" | "tars" | "utente" | null;

export type CostoFic = {
  id: number;
  sedeId: number;
  tipo: "expense" | "passive_credit_note";
  data: string;
  fornitoreId: number | null;
  fornitoreNome: string;
  categoriaFic: string | null;
  descrizione: string | null;
  centro: string | null;
  numeroDocumento: string | null;
  importoNetto: number;
  importoIva: number;
  importoLordo: number;
  rate: RataFic[];
  classificazione: ClassificazioneCosto;
  fonteClassificazione: FonteClassificazioneCosto;
  confidenza: number | null;
  motivazione: string | null;
  commessaId: number | null;
  presenteInFic: boolean;
  ultimoSyncId: string | null;
  ultimoVistoAt: Date | null;
  aggiornatoAt: Date;
};

export type RegolaCostoFic = {
  id: number;
  sedeId: number;
  fornitoreNormalizzato: string | null;
  categoriaNormalizzata: string | null;
  classificazione: Exclude<ClassificazioneCosto, "dubbio">;
  createdBy: number;
  createdAt: Date;
  attiva: boolean;
};

const _costiStore = persistedStore<CostoFic>("fic_costi", items => {
  for (const costo of items as any[]) {
    if (costo.sedeId === undefined) costo.sedeId = DEFAULT_SEDE_ID;
    if (!costo.classificazione) costo.classificazione = "dubbio";
    if (costo.fonteClassificazione === undefined) {
      costo.fonteClassificazione = null;
    }
    if (costo.confidenza === undefined) costo.confidenza = null;
    if (costo.motivazione === undefined) costo.motivazione = null;
    if (costo.commessaId === undefined) costo.commessaId = null;
    if (costo.presenteInFic === undefined) costo.presenteInFic = true;
    if (costo.ultimoSyncId === undefined) costo.ultimoSyncId = null;
    if (costo.ultimoVistoAt === undefined) costo.ultimoVistoAt = null;
  }
});

const _regoleStore = persistedStore<RegolaCostoFic>(
  "fic_regole_costi",
  items => {
    for (const regola of items as any[]) {
      if (regola.sedeId === undefined) regola.sedeId = DEFAULT_SEDE_ID;
      if (regola.attiva === undefined) regola.attiva = true;
    }
  }
);

export const ficCosti = _costiStore.items;
export const ficRegoleCosti = _regoleStore.items;
export const saveFicCosti = () => _costiStore.save();
export const saveFicRegoleCosti = () => _regoleStore.save();

function normalizzaRegola(value: string | null | undefined): string | null {
  const normalized = value
    ?.normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return normalized || null;
}

export function classificaConRegole(
  costo: Pick<CostoFic, "sedeId" | "fornitoreNome" | "categoriaFic">
): Exclude<ClassificazioneCosto, "dubbio"> | null {
  const fornitore = normalizzaRegola(costo.fornitoreNome);
  const categoria = normalizzaRegola(costo.categoriaFic);
  const regola = ficRegoleCosti
    .filter(regola => regola.sedeId === costo.sedeId && regola.attiva)
    .sort(
      (a, b) =>
        Number(b.fornitoreNormalizzato != null) +
        Number(b.categoriaNormalizzata != null) -
        Number(a.fornitoreNormalizzato != null) -
        Number(a.categoriaNormalizzata != null)
    )
    .find(regola => {
      if (
        regola.fornitoreNormalizzato == null &&
        regola.categoriaNormalizzata == null
      ) {
        return false;
      }
      return (
        (regola.fornitoreNormalizzato == null ||
          regola.fornitoreNormalizzato === fornitore) &&
        (regola.categoriaNormalizzata == null ||
          regola.categoriaNormalizzata === categoria)
      );
    });
  return regola?.classificazione ?? null;
}

export type CostoFicInput = Omit<
  CostoFic,
  | "sedeId"
  | "classificazione"
  | "fonteClassificazione"
  | "confidenza"
  | "motivazione"
  | "commessaId"
  | "presenteInFic"
  | "ultimoSyncId"
  | "ultimoVistoAt"
  | "aggiornatoAt"
>;

export function upsertCostiFic(
  rows: CostoFicInput[],
  sedeId: number,
  syncId: string
): { nuovi: number; aggiornati: number; idsDaClassificare: number[] } {
  let nuovi = 0;
  let aggiornati = 0;
  const idsDaClassificare: number[] = [];
  for (const row of rows) {
    const esistente = ficCosti.find(
      costo => costo.id === row.id && costo.sedeId === sedeId
    );
    if (esistente) {
      const firmaPrima = JSON.stringify({
        tipo: esistente.tipo,
        data: esistente.data,
        fornitore: esistente.fornitoreNome,
        categoria: esistente.categoriaFic,
        descrizione: esistente.descrizione,
        netto: esistente.importoNetto,
      });
      Object.assign(esistente, row, {
        presenteInFic: true,
        ultimoSyncId: syncId,
        ultimoVistoAt: new Date(),
        aggiornatoAt: new Date(),
      });
      const regola = classificaConRegole(esistente);
      if (esistente.fonteClassificazione !== "utente" && regola) {
        esistente.classificazione = regola;
        esistente.fonteClassificazione = "regola";
        esistente.confidenza = 1;
        esistente.motivazione = "Regola confermata dall'operatore.";
      }
      const firmaDopo = JSON.stringify({
        tipo: esistente.tipo,
        data: esistente.data,
        fornitore: esistente.fornitoreNome,
        categoria: esistente.categoriaFic,
        descrizione: esistente.descrizione,
        netto: esistente.importoNetto,
      });
      if (
        firmaPrima !== firmaDopo &&
        esistente.fonteClassificazione !== "utente" &&
        esistente.fonteClassificazione !== "regola"
      ) {
        esistente.classificazione = "dubbio";
        esistente.fonteClassificazione = null;
        esistente.confidenza = null;
        esistente.motivazione = null;
        idsDaClassificare.push(row.id);
      }
      if (
        esistente.fonteClassificazione == null &&
        !idsDaClassificare.includes(row.id)
      ) {
        idsDaClassificare.push(row.id);
      }
      aggiornati++;
      continue;
    }

    const nuovo: CostoFic = {
      ...row,
      sedeId,
      classificazione: "dubbio",
      fonteClassificazione: null,
      confidenza: null,
      motivazione: null,
      commessaId: null,
      presenteInFic: true,
      ultimoSyncId: syncId,
      ultimoVistoAt: new Date(),
      aggiornatoAt: new Date(),
    };
    const regola = classificaConRegole(nuovo);
    if (regola) {
      nuovo.classificazione = regola;
      nuovo.fonteClassificazione = "regola";
      nuovo.confidenza = 1;
      nuovo.motivazione = "Regola confermata dall'operatore.";
    } else {
      idsDaClassificare.push(row.id);
    }
    ficCosti.push(nuovo);
    nuovi++;
  }
  if (rows.length > 0) saveFicCosti();
  return { nuovi, aggiornati, idsDaClassificare };
}

export function finalizzaSnapshotCosti(args: {
  sedeId: number;
  tipo: CostoFic["tipo"];
  periodoDa: string;
  periodoA: string;
  syncId: string;
  completo: boolean;
}): number {
  if (!args.completo) return 0;
  let rimossi = 0;
  for (const costo of ficCosti) {
    if (
      costo.sedeId !== args.sedeId ||
      costo.tipo !== args.tipo ||
      costo.data < args.periodoDa ||
      costo.data > args.periodoA ||
      costo.ultimoSyncId === args.syncId ||
      !costo.presenteInFic
    ) {
      continue;
    }
    costo.presenteInFic = false;
    costo.aggiornatoAt = new Date();
    rimossi++;
  }
  if (rimossi > 0) saveFicCosti();
  return rimossi;
}

const classificazioneSchema = z.enum([
  "fisso",
  "variabile_commessa",
  "straordinario",
  "dubbio",
]);

function trovaCosto(id: number, sedeId: number | null): CostoFic {
  const costo = ficCosti.find(
    row => row.id === id && row.sedeId === (sedeId ?? DEFAULT_SEDE_ID)
  );
  if (!costo) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Costo FiC non trovato.",
    });
  }
  return costo;
}

export const ficCostiRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          anno: z.number().int().optional(),
          classificazione: classificazioneSchema.optional(),
        })
        .optional()
    )
    .query(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
      const anno = input?.anno ?? new Date().getFullYear();
      return ficCosti
        .filter(
          costo =>
            costo.sedeId === sedeId &&
            costo.presenteInFic &&
            costo.data.startsWith(String(anno)) &&
            (!input?.classificazione ||
              costo.classificazione === input.classificazione)
        )
        .sort((a, b) => b.data.localeCompare(a.data));
    }),

  riclassifica: protectedProcedure
    .input(
      z.object({
        id: z.number().int(),
        classificazione: classificazioneSchema,
        ricorda: z.boolean(),
      })
    )
    .mutation(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const costo = trovaCosto(input.id, ctx.sedeId);
      costo.classificazione = input.classificazione;
      costo.fonteClassificazione = "utente";
      costo.confidenza = 1;
      costo.motivazione = "Classificazione confermata dall'operatore.";
      costo.aggiornatoAt = new Date();

      if (input.ricorda && input.classificazione !== "dubbio") {
        const fornitoreNormalizzato = normalizzaRegola(costo.fornitoreNome);
        const categoriaNormalizzata = normalizzaRegola(costo.categoriaFic);
        const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
        let regola = ficRegoleCosti.find(
          item =>
            item.sedeId === sedeId &&
            item.fornitoreNormalizzato === fornitoreNormalizzato &&
            item.categoriaNormalizzata === categoriaNormalizzata
        );
        if (!regola) {
          regola = {
            id:
              ficRegoleCosti.reduce((max, item) => Math.max(max, item.id), 0) +
              1,
            sedeId,
            fornitoreNormalizzato,
            categoriaNormalizzata,
            classificazione: input.classificazione,
            createdBy: ctx.user!.id,
            createdAt: new Date(),
            attiva: true,
          };
          ficRegoleCosti.push(regola);
        } else {
          regola.classificazione = input.classificazione;
          regola.attiva = true;
        }
        saveFicRegoleCosti();
      }
      saveFicCosti();
      return { success: true as const };
    }),

  regole: protectedProcedure.query(({ ctx }) => {
    requireDirezioneOAmministrazione(ctx.user);
    const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
    return ficRegoleCosti.filter(regola => regola.sedeId === sedeId);
  }),
});
