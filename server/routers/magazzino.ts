import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { getCommessaById, STATI_COMMESSA } from "./commesse";
import { assertSedeScope } from "../_core/permissions";

// ── Magazzino ────────────────────────────────────────────────────────────────
// Products sitting in the warehouse for a commessa, each with its own
// expected/actual delivery date. Only commesse PAST "aggiornamento_contratto"
// can receive products (before that nothing has been ordered yet). The board
// card surfaces them so posa can be planned around real material arrivals.

type Prodotto = {
  id: number;
  sedeId: number;
  commessaId: number;
  nome: string;
  quantita: number;
  fornitore: string | null;
  dataConsegna: string | null; // ISO date the goods arrive/arrived
  arrivato: boolean;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

let nextId = 1;
const _store = persistedStore<Prodotto>("magazzino_prodotti", (loaded) => {
  nextId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
});
const prodotti = _store.items;

// A commessa can hold warehouse products only after the contract has been
// finalized (stato strictly past "aggiornamento_contratto", archiviata
// excluded).
const CONTRATTO_IDX = STATI_COMMESSA.indexOf("aggiornamento_contratto");

export function isCommessaEligibleForMagazzino(stato: string): boolean {
  const idx = STATI_COMMESSA.indexOf(stato as any);
  return idx > CONTRATTO_IDX && stato !== "archiviata";
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
        "I prodotti a magazzino si aggiungono solo dopo l'Aggiornamento Contratto",
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
        dataConsegna: input.dataConsegna || null,
        arrivato: false,
        note: input.note?.trim() || null,
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
      if (input.dataConsegna !== undefined)
        row.dataConsegna = input.dataConsegna || null;
      if (input.arrivato !== undefined) row.arrivato = input.arrivato;
      if (input.note !== undefined) row.note = input.note?.trim() || null;
      row.updatedAt = new Date();
      _store.save();
      return row;
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
