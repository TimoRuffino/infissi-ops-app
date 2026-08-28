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
 * I fornitori la cui natura e' gia' stata decisa.
 *
 * Serve a svuotare la coda delle ricorrenze. Prima qui uscivano solo i
 * fornitori dichiarati NON fissi, quindi un fornitore confermato come fisso
 * restava in coda per sempre: da fuori sembrava che la conferma non si
 * salvasse. Una ricorrenza e' una domanda — "questo canone e' struttura?" — e
 * una domanda con risposta non va piu' fatta, qualunque sia la risposta.
 *
 * Si parte SEMPRE dal nome come FiC lo scrive, mai da una chiave gia'
 * normalizzata. La versione precedente prendeva `regola.fornitoreNormalizzato`
 * — passato per `normalizzaRegola`, che trasforma i punti in spazi — e gli
 * applicava la chiave larga, che sa togliere "srl" attaccato ma non "s r l"
 * spaziato. "ALD Automotive Italia S.r.l." dava "ald automotive italia" dal
 * candidato e "ald automotive italia s r l" dalla regola: due chiavi diverse,
 * esclusione mai agganciata. Toccava quasi tutti i fornitori veri, perche' le
 * ragioni sociali si scrivono col punto.
 */
export function fornitoriGiaDecisi(sedeId: number): Set<string> {
  const decisi = new Set<string>();
  for (const costo of ficCosti) {
    if (costo.sedeId !== sedeId) continue;
    const decisoDaPersona =
      costo.fonteClassificazione === "utente" &&
      costo.classificazione !== "dubbio";
    if (decisoDaPersona || classificaConRegole(costo) != null) {
      decisi.add(chiaveFornitore(costo.fornitoreNome));
    }
  }
  return decisi;
}

/**
 * Ricorrenze ancora senza risposta.
 *
 * Non sono costi fissi: sono candidati. Confermarne uno significa
 * classificare il fornitore come `fisso` in Acquisti — da li' entra nel
 * registro dei costi fissi da solo, senza una seconda registrazione. Il
 * doppio passaggio precedente creava due verita' scollegate.
 */
export function candidatiFissiPerSede(sedeId: number): GruppoRicorrente[] {
  const decisi = fornitoriGiaDecisi(sedeId);
  return rilevaCostiRicorrenti(ficCosti, sedeId).filter(
    gruppo => !decisi.has(chiaveFornitore(gruppo.fornitore))
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
   * Gli acquisti raggruppati per fornitore.
   *
   * Un fornitore ha quasi sempre una natura sola, e classificare 265 righe
   * una per una quando i fornitori distinti sono 140 significa fare il doppio
   * del lavoro necessario. Qui la decisione si prende una volta per fornitore
   * e vale per tutti i suoi documenti.
   *
   * Senza `classificazione` restituisce TUTTI i fornitori dell'anno, non solo
   * quelli in coda: la scheda Acquisti mostrava esclusivamente i `dubbio`, e
   * appena si finiva di classificare la pagina si svuotava — gli acquisti
   * sparivano invece di diventare un registro consultabile.
   */
  perFornitore: protectedProcedure
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
      const anno = input?.anno;
      const gruppi = new Map<
        string,
        {
          fornitore: string;
          ids: number[];
          idsDubbi: number[];
          totale: number;
          dal: string;
          al: string;
          esempi: string[];
          classificazioni: Record<string, number>;
        }
      >();
      for (const costo of ficCosti) {
        if (costo.sedeId !== sedeId || !costo.presenteInFic) continue;
        if (
          input?.classificazione &&
          costo.classificazione !== input.classificazione
        ) {
          continue;
        }
        if (anno != null && !costo.data.startsWith(String(anno))) continue;
        const chiave = chiaveFornitore(costo.fornitoreNome) || costo.fornitoreNome;
        const gruppo = gruppi.get(chiave) ?? {
          fornitore: costo.fornitoreNome,
          ids: [],
          idsDubbi: [],
          totale: 0,
          dal: costo.data,
          al: costo.data,
          esempi: [],
          classificazioni: {},
        };
        gruppo.ids.push(costo.id);
        if (costo.classificazione === "dubbio") gruppo.idsDubbi.push(costo.id);
        gruppo.totale +=
          (costo.tipo === "passive_credit_note" ? -1 : 1) * costo.importoNetto;
        gruppo.classificazioni[costo.classificazione] =
          (gruppo.classificazioni[costo.classificazione] ?? 0) + 1;
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
          daClassificare: gruppo.idsDubbi.length,
          // La natura prevalente: serve all'elenco per dire com'è messo un
          // fornitore senza aprirlo.
          prevalente:
            Object.entries(gruppo.classificazioni).sort(
              (a, b) => b[1] - a[1]
            )[0]?.[0] ?? "dubbio",
        }))
        .sort(
          (a, b) =>
            b.daClassificare - a.daClassificare ||
            b.documenti - a.documenti ||
            b.totale - a.totale
        );
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
