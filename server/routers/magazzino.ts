import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { EvidenzaLetta } from "@shared/documenti/evidenze";
import { protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { getCommessaById } from "./commesse";
import { STATI_COMMESSA } from "../commesse/transizioni";
import { assertSedeScope } from "../_core/permissions";

// ── Magazzino ────────────────────────────────────────────────────────────────
// Le consegne attese da una commessa, ognuna con la sua data prevista e il
// suo «ricevuto». Le commesse da «da ordinare» in poi possono averne: la
// merce ordinata è già in viaggio. La scheda del board le mostra così la
// posa si pianifica sugli arrivi veri.
//
// Dal 03/09/2026 le righe nascono anche da sole dalla conferma d'ordine che
// entra nel fascicolo (`documentoId` la lega al documento). Dal 05/09/2026
// («la gestione del magazzino è un casino») UNA CONFERMA = UNA CONSEGNA: gli
// articoli del PDF (porta, kit, falso telaio, coprifili…) stanno dentro la
// consegna come dettaglio (`articoli`), non come otto consegne a quantità 1.
// Le righe a mano restano quello che erano: un prodotto, una quantità.

export type ArticoloConsegna = {
  nome: string;
  quantita: number;
  /** Dove sta la riga nella conferma (anteprime «Dove l'ho letto»). */
  evidenza?: EvidenzaLetta | null;
};

export type Prodotto = {
  id: number;
  sedeId: number;
  commessaId: number;
  nome: string;
  quantita: number;
  fornitore: string | null;
  numeroOrdine: string | null; // supplier order reference
  dataOrdine: string | null;   // ISO date the order was placed
  dataConsegna: string | null; // ISO date the goods arrive/arrived
  arrivato: boolean;
  note: string | null;
  /** La conferma d'ordine del fascicolo da cui la riga è nata (null = a mano). */
  documentoId: number | null;
  /**
   * Dove, nella conferma, sta la riga da cui questa è nata (06/09/2026,
   * anteprime delle evidenze): pagina, frammento e area. Null a mano o per
   * le righe lette prima di questo campo.
   */
  evidenza?: EvidenzaLetta | null;
  /** Gli articoli letti nella conferma (null = riga a mano, o lettura vecchia). */
  articoli: ArticoloConsegna[] | null;
  /** Merce pronta dal fornitore da questa data (settimana di approntamento): non è la consegna. */
  prontaDal: string | null;
  createdAt: Date;
  updatedAt: Date;
};

let nextId = 1;
const _store = persistedStore<Prodotto>("magazzino_prodotti", (loaded) => {
  nextId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
  for (const p of loaded) {
    if ((p as any).numeroOrdine === undefined) (p as any).numeroOrdine = null;
    if ((p as any).dataOrdine === undefined) (p as any).dataOrdine = null;
    if ((p as any).documentoId === undefined) (p as any).documentoId = null;
    if ((p as any).evidenza === undefined) (p as any).evidenza = null;
    if ((p as any).articoli === undefined) (p as any).articoli = null;
    if ((p as any).prontaDal === undefined) (p as any).prontaDal = null;
  }
});
const prodotti = _store.items;

// A commessa can hold warehouse products from "da_ordinare" onwards: that is
// the state in which the order leaves, and the confirmation that comes back
// is what fills the warehouse (03/09/2026; before it was "produzione").
// Computed at call time, not at module load: this module now sits in an
// import cycle (fascicolo → magazzino → commesse) and a top-level constant
// would read the list before it exists.
export function isCommessaEligibleForMagazzino(stato: string): boolean {
  const idx = STATI_COMMESSA.indexOf(stato as any);
  return idx >= STATI_COMMESSA.indexOf("da_ordinare") && stato !== "archiviata";
}

export function getMagazzinoStore(): readonly Prodotto[] {
  return prodotti;
}

export function prodottiDelDocumento(documentoId: number): Prodotto[] {
  return prodotti.filter((p) => p.documentoId === documentoId);
}

const ARTICOLI_MASSIMI = 40;

function articoliPuliti(
  righe: ReadonlyArray<{ nome: string; quantita: number; evidenza?: EvidenzaLetta | null }>
): ArticoloConsegna[] {
  const puliti: ArticoloConsegna[] = [];
  for (const r of righe) {
    const nome = String(r.nome ?? "").trim().slice(0, 160);
    if (!nome) continue;
    puliti.push({
      nome,
      quantita: Math.max(1, Math.round(Number(r.quantita) || 1)),
      ...(r.evidenza ? { evidenza: r.evidenza } : {}),
    });
    if (puliti.length >= ARTICOLI_MASSIMI) break;
  }
  return puliti;
}

/**
 * LA consegna che una conferma d'ordine promette: una riga sola per
 * documento, con gli articoli dentro. Idempotente per documento: se la riga
 * esiste già la restituisce. Nessuna autorizzazione qui: chi chiama è la
 * regola di dominio del fascicolo.
 */
export function creaConsegnaDaConferma(input: {
  commessaId: number;
  sedeId: number;
  documentoId: number;
  nome: string;
  articoli: ReadonlyArray<{ nome: string; quantita: number }>;
  /** Dove sta l'articolo principale nella conferma (anteprime «Dove l'ho letto»). */
  evidenza?: EvidenzaLetta | null;
  fornitore: string | null;
  numeroOrdine: string | null;
  dataOrdine: string | null;
  dataConsegna: string | null;
  prontaDal: string | null;
  note: string | null;
  /** Stato ereditato da righe precedenti dello stesso documento (rigenerazione). */
  arrivato?: boolean;
}): Prodotto {
  const esistente = prodottiDelDocumento(input.documentoId)[0];
  if (esistente) return esistente;
  const now = new Date();
  const articoli = articoliPuliti(input.articoli);
  const row: Prodotto = {
    id: nextId++,
    sedeId: input.sedeId,
    commessaId: input.commessaId,
    nome: (input.nome.trim() || "Merce conferma d'ordine").slice(0, 160),
    quantita: 1,
    fornitore: input.fornitore?.trim() || null,
    numeroOrdine: input.numeroOrdine?.trim() || null,
    dataOrdine: input.dataOrdine,
    dataConsegna: input.dataConsegna,
    arrivato: input.arrivato === true,
    note: input.note,
    documentoId: input.documentoId,
    articoli: articoli.length > 0 ? articoli : null,
    evidenza: input.evidenza ?? null,
    prontaDal: input.prontaDal,
    createdAt: now,
    updatedAt: now,
  };
  prodotti.push(row);
  _store.save();
  return row;
}

/** Il documento esce dal fascicolo (o non è più una conferma): la sua merce non è più attesa. */
export function rimuoviProdottiDelDocumento(documentoId: number): number {
  let rimossi = 0;
  for (let i = prodotti.length - 1; i >= 0; i--) {
    if (prodotti[i].documentoId === documentoId) {
      prodotti.splice(i, 1);
      rimossi += 1;
    }
  }
  if (rimossi > 0) _store.save();
  return rimossi;
}

/** Il documento cambia fascicolo: la merce lo segue. */
export function spostaProdottiDelDocumento(documentoId: number, commessaId: number): number {
  let spostati = 0;
  for (const p of prodotti) {
    if (p.documentoId !== documentoId || p.commessaId === commessaId) continue;
    p.commessaId = commessaId;
    p.updatedAt = new Date();
    spostati += 1;
  }
  if (spostati > 0) _store.save();
  return spostati;
}

function requireEligibleCommessa(commessaId: number, sedeId: number | null) {
  const c = getCommessaById(commessaId);
  if (!c) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Commessa non trovata" });
  }
  assertSedeScope(c, sedeId);
  if ((c as any).archivedAt) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Commessa archiviata",
    });
  }
  if (!isCommessaEligibleForMagazzino(c.stato)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "I prodotti a magazzino si aggiungono solo dallo stato Da ordinare in poi",
    });
  }
  return c;
}

// Cascade for commesse.delete — orphan products make no sense.
export function deleteMagazzinoByCommessa(commessaId: number): void {
  for (let i = prodotti.length - 1; i >= 0; i--) {
    if (prodotti[i].commessaId === commessaId) prodotti.splice(i, 1);
  }
  _store.save();
}

export const magazzinoRouter = router({
  // Products of one commessa, or every product of the sede when no filter.
  list: protectedProcedure
    .input(z.object({ commessaId: z.number().optional() }).optional())
    .query(({ input, ctx }) => {
      let rows = prodotti.filter((p) => p.sedeId === ctx.sedeId);
      if (input?.commessaId) {
        rows = rows.filter((p) => p.commessaId === input.commessaId);
      }
      return [...rows].sort((a, b) => {
        const da = a.dataConsegna ?? "9999-12-31";
        const db = b.dataConsegna ?? "9999-12-31";
        if (da !== db) return da.localeCompare(db);
        return a.id - b.id;
      });
    }),

  create: protectedProcedure
    .input(
      z.object({
        commessaId: z.number(),
        nome: z.string().min(1),
        quantita: z.number().int().min(1).default(1),
        fornitore: z.string().optional(),
        numeroOrdine: z.string().optional(),
        dataOrdine: z.string().optional(), // "YYYY-MM-DD"
        dataConsegna: z.string().optional(), // "YYYY-MM-DD"
        note: z.string().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      requireEligibleCommessa(input.commessaId, ctx.sedeId);
      const now = new Date();
      const row: Prodotto = {
        id: nextId++,
        sedeId: ctx.sedeId ?? 1,
        commessaId: input.commessaId,
        nome: input.nome.trim(),
        quantita: input.quantita ?? 1,
        fornitore: input.fornitore?.trim() || null,
        numeroOrdine: input.numeroOrdine?.trim() || null,
        dataOrdine: input.dataOrdine || null,
        dataConsegna: input.dataConsegna || null,
        arrivato: false,
        note: input.note?.trim() || null,
        documentoId: null,
        articoli: null,
        prontaDal: null,
        createdAt: now,
        updatedAt: now,
      };
      prodotti.push(row);
      _store.save();
      return row;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        nome: z.string().min(1).optional(),
        quantita: z.number().int().min(1).optional(),
        fornitore: z.string().nullable().optional(),
        numeroOrdine: z.string().nullable().optional(),
        dataOrdine: z.string().nullable().optional(),
        dataConsegna: z.string().nullable().optional(),
        arrivato: z.boolean().optional(),
        note: z.string().nullable().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const row = prodotti.find((p) => p.id === input.id);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Prodotto non trovato" });
      }
      assertSedeScope(row, ctx.sedeId);
      if (input.nome !== undefined) row.nome = input.nome.trim();
      if (input.quantita !== undefined) row.quantita = input.quantita;
      if (input.fornitore !== undefined)
        row.fornitore = input.fornitore?.trim() || null;
      if (input.numeroOrdine !== undefined)
        row.numeroOrdine = input.numeroOrdine?.trim() || null;
      if (input.dataOrdine !== undefined)
        row.dataOrdine = input.dataOrdine || null;
      if (input.dataConsegna !== undefined)
        row.dataConsegna = input.dataConsegna || null;
      if (input.arrivato !== undefined) row.arrivato = input.arrivato;
      if (input.note !== undefined) row.note = input.note?.trim() || null;
      row.updatedAt = new Date();
      _store.save();
      return row;
    }),

  /**
   * «Ricevuto tutto»: ogni consegna della commessa non ancora ricevuta viene
   * segnata ricevuta in un colpo (direzione 05/09/2026). Reversibile riga
   * per riga con «Riapri consegna».
   */
  segnaTuttoRicevuto: protectedProcedure
    .input(z.object({ commessaId: z.number() }))
    .mutation(({ input, ctx }) => {
      const c = getCommessaById(input.commessaId);
      if (!c) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Commessa non trovata" });
      }
      assertSedeScope(c, ctx.sedeId);
      const now = new Date();
      let segnate = 0;
      for (const p of prodotti) {
        if (p.commessaId !== input.commessaId || p.sedeId !== ctx.sedeId || p.arrivato) continue;
        p.arrivato = true;
        p.updatedAt = now;
        segnate += 1;
      }
      if (segnate > 0) _store.save();
      return { segnate };
    }),

  remove: protectedProcedure
    .input(z.number())
    .mutation(({ input, ctx }) => {
      const idx = prodotti.findIndex((p) => p.id === input);
      if (idx === -1) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Prodotto non trovato" });
      }
      assertSedeScope(prodotti[idx], ctx.sedeId);
      prodotti.splice(idx, 1);
      _store.save();
      return { success: true } as const;
    }),
});
