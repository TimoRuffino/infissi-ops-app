import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { persistedStore } from "../_core/persistence";
import { requireDirezioneOAmministrazione } from "../_core/permissions";
import { protectedProcedure, router } from "../_core/trpc";
import type { ClassificazioneCostoEconomico } from "../_core/economiaFic";
import type { RataFic } from "./ficFatture";
import { DEFAULT_SEDE_ID } from "./sedi";
import {
  chiaveFornitore,
  rilevaCostiRicorrenti,
} from "../_core/costiRicorrenti";
import type { GruppoRicorrente } from "../_core/costiRicorrenti";

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
  // Legacy field: mantenuto per leggere record storici, ma non alimenta più
  // né API né marginalità e non viene scritto dai nuovi acquisti.
  commessaId?: number | null;
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

/**
 * I fornitori che una persona ha dichiarato NON fissi.
 *
 * Serve a fermare l'aritmetica della ricorrenza: un trasportatore che
 * fattura la stessa cifra per cinque mesi sembra un canone ma e' manodopera
 * di commessa, e senza questo freno la decisione dell'operatore veniva
 * ribaltata al sync successivo.
 */
export function fornitoriNonFissi(sedeId: number): Set<string> {
  const esclusi = new Set<string>();
  // Si parte SEMPRE dal nome come FiC lo scrive, mai da una chiave gia'
  // normalizzata.
  //
  // La versione precedente prendeva `regola.fornitoreNormalizzato` — passato
  // per `normalizzaRegola`, che trasforma i punti in spazi — e gli applicava
  // la chiave larga, che sa togliere "srl" attaccato ma non "s r l"
  // spaziato. Risultato: "ALD Automotive Italia S.r.l." dava
  // "ald automotive italia" dal candidato e "ald automotive italia s r l"
  // dalla regola. Le due chiavi non combaciavano, l'esclusione non
  // agganciava, e il candidato classificato restava in coda. Toccava quasi
  // tutti i fornitori veri, perche' le ragioni sociali si scrivono col punto.
  for (const costo of ficCosti) {
    if (costo.sedeId !== sedeId) continue;
    const decisoDaPersona =
      costo.fonteClassificazione === "utente" &&
      costo.classificazione !== "fisso";
    const daRegola = classificaConRegole(costo);
    if (decisoDaPersona || (daRegola != null && daRegola !== "fisso")) {
      esclusi.add(chiaveFornitore(costo.fornitoreNome));
    }
  }
  return esclusi;
}

/** Ricorrenze proposte dalla FiC: solo una conferma crea un costo fisso. */
export function candidatiFissiPerSede(sedeId: number): GruppoRicorrente[] {
  const esclusi = fornitoriNonFissi(sedeId);
  return rilevaCostiRicorrenti(ficCosti, sedeId).filter(
    gruppo => !esclusi.has(chiaveFornitore(gruppo.fornitore))
  );
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
): {
  nuovi: number;
  aggiornati: number;
  idsDaClassificare: number[];
  fissiPerRicorrenza: number;
} {
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
  return { nuovi, aggiornati, idsDaClassificare, fissiPerRicorrenza: 0 };
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
  // I canoni rilevati dalla FiC: sono candidati, non costi già confermati.
  ricorrenti: protectedProcedure.query(({ ctx }) => {
    requireDirezioneOAmministrazione(ctx.user);
    const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
    const gruppi = candidatiFissiPerSede(sedeId);
    return {
      gruppi,
      totaleMensilePotenziale:
        Math.round(
          gruppi.reduce((somma, gruppo) => somma + gruppo.importo, 0) * 100
        ) / 100,
    };
  }),

  /**
   * I costi fissi che il break-even sta DAVVERO usando, per fornitore.
   *
   * La scheda «Costi fissi» mostrava i gruppi ricorrenti rilevati
   * dall'aritmetica: 26 gruppi. Il break-even somma invece tutti i documenti
   * classificati `fisso`, che sui dati veri sono 37 fornitori. Due insiemi
   * diversi, due numeri che si somigliavano per caso — e un elenco che non
   * spiegava la cifra sotto cui si decide se l'anno regge.
   *
   * Qui l'elenco E' la cifra: stesso periodo base del pareggio, stessa
   * selezione, stesso segno sulle note di credito.
   */
  fissiPerFornitore: protectedProcedure.query(({ ctx }) => {
    requireDirezioneOAmministrazione(ctx.user);
    const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
    const oggi = new Date();
    const fine = new Date(Date.UTC(oggi.getUTCFullYear(), oggi.getUTCMonth(), 0));
    const inizio = new Date(
      Date.UTC(fine.getUTCFullYear(), fine.getUTCMonth() - 11, 1)
    );
    const periodoDa = inizio.toISOString().slice(0, 10);
    const periodoA = fine.toISOString().slice(0, 10);

    // Perche' questo fornitore risulta fisso. "regola" da solo non lo diceva:
    // significava sia l'aritmetica della ricorrenza sia una regola creata da
    // una persona, e la motivazione veniva riscritta a ogni sync — TIM aveva
    // otto motivazioni diverse sui suoi 72 documenti.
    const gruppi = new Map<
      string,
      {
        fornitore: string;
        documenti: number;
        totale: number;
        mesi: Set<string>;
        origini: { ricorrenza: number; regola: number; persona: number; tars: number };
        spiegazioni: Set<string>;
        righe: Array<{ id: number; data: string; importo: number; descrizione: string | null }>;
      }
    >();
    const mesiConDati = new Set<string>();
    for (const costo of ficCosti) {
      if (costo.sedeId !== sedeId || !costo.presenteInFic) continue;
      if (costo.data < periodoDa || costo.data > periodoA) continue;
      if (costo.classificazione !== "dubbio") mesiConDati.add(costo.data.slice(0, 7));
      if (costo.classificazione !== "fisso") continue;
      const chiave = chiaveFornitore(costo.fornitoreNome) || costo.fornitoreNome;
      const gruppo = gruppi.get(chiave) ?? {
        fornitore: costo.fornitoreNome,
        documenti: 0,
        totale: 0,
        mesi: new Set<string>(),
        origini: { ricorrenza: 0, regola: 0, persona: 0, tars: 0 },
        spiegazioni: new Set<string>(),
        righe: [],
      };
      gruppo.documenti++;
      gruppo.totale +=
        (costo.tipo === "passive_credit_note" ? -1 : 1) * costo.importoNetto;
      gruppo.mesi.add(costo.data.slice(0, 7));
      const daRicorrenza =
        costo.fonteClassificazione === "regola" &&
        (costo.motivazione ?? "").startsWith("Stesso importo");
      if (costo.fonteClassificazione === "utente") gruppo.origini.persona++;
      else if (costo.fonteClassificazione === "tars") gruppo.origini.tars++;
      else if (daRicorrenza) gruppo.origini.ricorrenza++;
      else gruppo.origini.regola++;
      if (costo.motivazione && gruppo.spiegazioni.size < 3) {
        gruppo.spiegazioni.add(costo.motivazione);
      }
      gruppo.righe.push({
        id: costo.id,
        data: costo.data,
        importo:
          (costo.tipo === "passive_credit_note" ? -1 : 1) * costo.importoNetto,
        descrizione: costo.descrizione ?? costo.categoriaFic,
      });
      gruppi.set(chiave, gruppo);
    }

    const mesiCoperti = Math.max(1, mesiConDati.size);
    const righe = Array.from(gruppi.values())
      .map(gruppo => ({
        fornitore: gruppo.fornitore,
        documenti: gruppo.documenti,
        totale: Math.round(gruppo.totale * 100) / 100,
        mensile: Math.round((gruppo.totale / mesiCoperti) * 100) / 100,
        mesi: gruppo.mesi.size,
        origini: gruppo.origini,
        spiegazioni: Array.from(gruppo.spiegazioni),
        righe: gruppo.righe.sort((a, b) => b.data.localeCompare(a.data)),
      }))
      .sort((a, b) => b.totale - a.totale);

    return {
      periodoDa,
      periodoA,
      mesiCoperti,
      gruppi: righe,
      totale: Math.round(righe.reduce((s, r) => s + r.totale, 0) * 100) / 100,
      totaleMensile:
        Math.round(righe.reduce((s, r) => s + r.mensile, 0) * 100) / 100,
    };
  }),

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
      const righe = ficCosti
        .filter(
          costo =>
            costo.sedeId === sedeId &&
            costo.presenteInFic &&
            costo.data.startsWith(String(anno)) &&
            (!input?.classificazione ||
              costo.classificazione === input.classificazione)
        )
        .sort((a, b) => b.data.localeCompare(a.data));
      return righe;
    }),

  /**
   * Quanto lavoro arretrato c'e', anno per anno.
   *
   * La pagina apre sempre sull'anno corrente, quindi 265 documenti del 2025
   * erano invisibili: nessun badge, nessun conteggio, nessun motivo di
   * cambiare l'anno. Un arretrato che non si vede non viene smaltito.
   */
  arretrati: protectedProcedure.query(({ ctx }) => {
    requireDirezioneOAmministrazione(ctx.user);
    const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
    const perAnno = new Map<number, { daClassificare: number }>();
    for (const costo of ficCosti) {
      if (costo.sedeId !== sedeId || !costo.presenteInFic) continue;
      const anno = Number(costo.data.slice(0, 4));
      if (!Number.isFinite(anno)) continue;
      const voce = perAnno.get(anno) ?? { daClassificare: 0 };
      if (costo.classificazione === "dubbio") voce.daClassificare++;
      perAnno.set(anno, voce);
    }
    return Array.from(perAnno.entries())
      .map(([anno, voce]) => ({ anno, ...voce }))
      .filter(voce => voce.daClassificare > 0)
      .sort((a, b) => b.anno - a.anno);
  }),

  /**
   * I documenti da classificare raggruppati per fornitore.
   *
   * Un fornitore ha quasi sempre una natura sola, e classificare 265 righe
   * una per una quando i fornitori distinti sono 140 significa fare il doppio
   * del lavoro necessario. Qui la decisione si prende una volta per fornitore
   * e vale per tutti i suoi documenti.
   */
  daClassificarePerFornitore: protectedProcedure
    .input(z.object({ anno: z.number().int().optional() }).optional())
    .query(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
      const anno = input?.anno;
      const gruppi = new Map<
        string,
        {
          fornitore: string;
          ids: number[];
          totale: number;
          dal: string;
          al: string;
          esempi: string[];
        }
      >();
      for (const costo of ficCosti) {
        if (costo.sedeId !== sedeId || !costo.presenteInFic) continue;
        if (costo.classificazione !== "dubbio") continue;
        if (anno != null && !costo.data.startsWith(String(anno))) continue;
        const chiave = chiaveFornitore(costo.fornitoreNome) || costo.fornitoreNome;
        const gruppo = gruppi.get(chiave) ?? {
          fornitore: costo.fornitoreNome,
          ids: [],
          totale: 0,
          dal: costo.data,
          al: costo.data,
          esempi: [],
        };
        gruppo.ids.push(costo.id);
        gruppo.totale += costo.importoNetto;
        if (costo.data < gruppo.dal) gruppo.dal = costo.data;
        if (costo.data > gruppo.al) gruppo.al = costo.data;
        const etichetta = costo.descrizione ?? costo.categoriaFic;
        if (etichetta && gruppo.esempi.length < 3 && !gruppo.esempi.includes(etichetta)) {
          gruppo.esempi.push(etichetta);
        }
        gruppi.set(chiave, gruppo);
      }
      return Array.from(gruppi.values())
        .map(gruppo => ({
          ...gruppo,
          totale: Math.round(gruppo.totale * 100) / 100,
          documenti: gruppo.ids.length,
        }))
        .sort((a, b) => b.documenti - a.documenti || b.totale - a.totale);
    }),

  /**
   * Classifica piu' documenti in un colpo solo.
   *
   * Serve per il resto: 82 fornitori con un documento solo, che come gruppo
   * non esistono ma come selezione si chiudono insieme — i pranzi di lavoro
   * sono tutti straordinari, e sono tutti di trattorie diverse.
   */
  riclassificaMolti: protectedProcedure
    .input(
      z.object({
        ids: z.array(z.number().int()).min(1).max(500),
        classificazione: classificazioneSchema.exclude(["dubbio"]),
      })
    )
    .mutation(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
      const richiesti = new Set(input.ids);
      let aggiornati = 0;
      for (const costo of ficCosti) {
        if (costo.sedeId !== sedeId || !richiesti.has(costo.id)) continue;
        costo.classificazione = input.classificazione;
        costo.fonteClassificazione = "utente";
        costo.confidenza = 1;
        costo.motivazione = "Classificato in blocco dall'operatore.";
        costo.aggiornatoAt = new Date();
        aggiornati++;
      }
      if (aggiornati > 0) saveFicCosti();
      return { aggiornati };
    }),

  /**
   * Sposta TUTTI i documenti di un fornitore in una classificazione, e
   * aggiorna la regola perche' i prossimi ci nascano.
   *
   * Diverso da `riclassificaFornitore`, che tocca solo i `dubbio`: quello
   * serve a smaltire la coda senza travolgere decisioni gia' prese. Questo
   * serve al caso opposto — un fornitore finito fra i costi fissi che fisso
   * non e'. TIM ha 72 documenti, SCIACCA 11: senza un'azione unica l'unico
   * modo di tirarli fuori era aprirli uno per uno.
   *
   * Aggiorna la regola per OGNI forma scritta del nome trovata nel gruppo:
   * "Brianzatende SRL" e "BRIANZATENDE S.R.L." sono lo stesso fornitore per
   * il raggruppamento ma due chiavi diverse per le regole, e lasciarne una
   * indietro avrebbe fatto rientrare i documenti nuovi.
   */
  spostaFornitore: protectedProcedure
    .input(
      z.object({
        fornitore: z.string().trim().min(1),
        classificazione: classificazioneSchema.exclude(["dubbio"]),
      })
    )
    .mutation(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
      const chiave = chiaveFornitore(input.fornitore);
      if (!chiave) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Nome fornitore non utilizzabile.",
        });
      }

      let aggiornati = 0;
      const formeScritte = new Set<string>();
      for (const costo of ficCosti) {
        if (costo.sedeId !== sedeId || !costo.presenteInFic) continue;
        if (chiaveFornitore(costo.fornitoreNome) !== chiave) continue;
        formeScritte.add(costo.fornitoreNome);
        if (costo.classificazione === input.classificazione) continue;
        costo.classificazione = input.classificazione;
        costo.fonteClassificazione = "utente";
        costo.confidenza = 1;
        costo.motivazione = `Spostato dall'operatore: tutti i documenti di ${input.fornitore}.`;
        costo.aggiornatoAt = new Date();
        aggiornati++;
      }

      for (const forma of Array.from(formeScritte)) {
        const fornitoreNormalizzato = normalizzaRegola(forma);
        const regola = ficRegoleCosti.find(
          item =>
            item.sedeId === sedeId &&
            item.fornitoreNormalizzato === fornitoreNormalizzato &&
            item.categoriaNormalizzata == null
        );
        if (regola) {
          regola.classificazione = input.classificazione;
          regola.attiva = true;
        } else {
          ficRegoleCosti.push({
            id:
              ficRegoleCosti.reduce((max, item) => Math.max(max, item.id), 0) + 1,
            sedeId,
            fornitoreNormalizzato,
            categoriaNormalizzata: null,
            classificazione: input.classificazione,
            createdBy: ctx.user!.id,
            createdAt: new Date(),
            attiva: true,
          });
        }
      }
      saveFicRegoleCosti();
      saveFicCosti();
      return {
        aggiornati,
        fornitore: input.fornitore,
        formeScritte: formeScritte.size,
      };
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

  /**
   * Applica una classificazione a TUTTI i costi ancora dubbi dello stesso
   * fornitore, e registra la regola per quelli futuri.
   *
   * Un fornitore ha quasi sempre una natura sola: l'affitto e' affitto ogni
   * mese. Riclassificarlo riga per riga era la parte piu' lenta della
   * revisione, e la regola valeva solo per i documenti successivi — quelli
   * gia' in coda restavano da toccare a mano uno per uno.
   *
   * Tocca solo i `dubbio`: una classificazione gia' decisa da una persona su
   * un singolo documento non viene travolta dall'azione di massa.
   */
  riclassificaFornitore: protectedProcedure
    .input(
      z.object({
        id: z.number().int(),
        classificazione: classificazioneSchema.exclude(["dubbio"]),
      })
    )
    .mutation(({ input, ctx }) => {
      requireDirezioneOAmministrazione(ctx.user);
      const riferimento = trovaCosto(input.id, ctx.sedeId);
      const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
      const fornitoreNormalizzato = normalizzaRegola(riferimento.fornitoreNome);
      // I documenti si scelgono con la chiave larga — quella che ignora
      // "SRL" e "S.r.l." — perche' e' la stessa con cui l'elenco raggruppa:
      // un bottone che dice ×9 deve toccarne nove. La regola per il futuro
      // resta invece sulla forma scritta, com'era, per non invalidare quelle
      // gia' salvate.
      const chiave = chiaveFornitore(riferimento.fornitoreNome);

      let aggiornati = 0;
      for (const costo of ficCosti) {
        if (costo.sedeId !== sedeId || !costo.presenteInFic) continue;
        if (chiaveFornitore(costo.fornitoreNome) !== chiave) continue;
        if (costo.id !== input.id && costo.classificazione !== "dubbio") continue;
        costo.classificazione = input.classificazione;
        costo.fonteClassificazione = "utente";
        costo.confidenza = 1;
        costo.motivazione = `Classificazione applicata a tutti i documenti di ${riferimento.fornitoreNome}.`;
        costo.aggiornatoAt = new Date();
        aggiornati++;
      }

      // La regola vale per il futuro. Senza categoria: l'azione parla del
      // fornitore nel suo insieme, non di una sua singola voce.
      let regola = ficRegoleCosti.find(
        item =>
          item.sedeId === sedeId &&
          item.fornitoreNormalizzato === fornitoreNormalizzato &&
          item.categoriaNormalizzata == null
      );
      if (!regola) {
        ficRegoleCosti.push({
          id:
            ficRegoleCosti.reduce((max, item) => Math.max(max, item.id), 0) + 1,
          sedeId,
          fornitoreNormalizzato,
          categoriaNormalizzata: null,
          classificazione: input.classificazione,
          createdBy: ctx.user!.id,
          createdAt: new Date(),
          attiva: true,
        });
      } else {
        regola.classificazione = input.classificazione;
        regola.attiva = true;
      }
      saveFicRegoleCosti();
      saveFicCosti();
      return { aggiornati, fornitore: riferimento.fornitoreNome };
    }),

  regole: protectedProcedure.query(({ ctx }) => {
    requireDirezioneOAmministrazione(ctx.user);
    const sedeId = ctx.sedeId ?? DEFAULT_SEDE_ID;
    return ficRegoleCosti.filter(regola => regola.sedeId === sedeId);
  }),
});
