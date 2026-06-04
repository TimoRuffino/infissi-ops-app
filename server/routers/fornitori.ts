import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { assertSedeScope } from "../_core/permissions";

// ── Types ───────────────────────────────────────────────────────────────────

type Fornitore = {
  id: number;
  sedeId?: number;
  ragioneSociale: string;
  partitaIva: string;
  indirizzo?: string;
  citta?: string;
  telefono?: string;
  email?: string;
  categoria: "pvc" | "alluminio" | "vetro" | "ferramenta" | "persiane" | "blindati" | "accessori" | "guarnizioni" | "altro";
  referenteCommerciale?: string;
  scontistica?: number; // % sconto
  note?: string;
  attivo: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type OrdineFornitore = {
  id: number;
  sedeId?: number;
  fornitoreId: number;
  commessaId: number;
  codiceOrdine: string;
  stato: "bozza" | "inviato" | "confermato" | "in_transito" | "ricevuto_parziale" | "ricevuto" | "contestato";
  dataOrdine: string;
  dataConsegnaPrevista?: string;
  dataConsegnaEffettiva?: string;
  righe: RigaOrdine[];
  noteOrdine?: string;
  noteRicevimento?: string;
  importoTotale?: number;
  createdAt: Date;
  updatedAt: Date;
};

type RigaOrdine = {
  id: number;
  descrizione: string;
  codiceArticolo?: string;
  quantita: number;
  quantitaRicevuta: number;
  unitaMisura: string;
  prezzoUnitario?: number;
  lotto?: string;
  conforme?: boolean;
  noteDifetto?: string;
};

type Listino = {
  id: number;
  sedeId?: number;
  fornitoreId: number;
  nome: string;
  versione: string;
  dataValidita: string;
  nomeFile: string;
  tipo: "pdf" | "excel" | "altro";
  note?: string;
  createdAt: Date;
};

// ── In-memory data ──────────────────────────────────────────────────────────

let nextFornitoreId = 1;
let nextOrdineId = 1;
let nextRigaId = 1;
let nextListinoId = 1;

const _fornitoriStore = persistedStore<Fornitore>("fornitori", (loaded) => {
  nextFornitoreId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
  for (const f of loaded) {
    if ((f as any).sedeId === undefined) (f as any).sedeId = 1;
  }
});
const fornitori = _fornitoriStore.items;

const _ordiniStore = persistedStore<OrdineFornitore>("fornitori_ordini", (loaded) => {
  nextOrdineId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
  // Recompute nextRigaId by scanning child righe[] across all ordini
  let maxRigaId = 0;
  for (const o of loaded) {
    if ((o as any).sedeId === undefined) (o as any).sedeId = 1;
    for (const r of (o as any).righe ?? []) {
      if (r.id > maxRigaId) maxRigaId = r.id;
    }
  }
  nextRigaId = maxRigaId + 1;
});
const ordini = _ordiniStore.items;

const _listiniStore = persistedStore<Listino>("fornitori_listini", (loaded) => {
  nextListinoId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
  for (const l of loaded) {
    if ((l as any).sedeId === undefined) (l as any).sedeId = 1;
  }
});
const listini = _listiniStore.items;

// ── Router ──────────────────────────────────────────────────────────────────

export const fornitoriRouter = router({
  // ── Fornitori CRUD ──────────────────────────────────────────────────────
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        categoria: z.string().optional(),
        attivo: z.boolean().optional(),
      }).optional()
    )
    .query(({ input, ctx }) => {
      let result = fornitori.filter((f) => (f as any).sedeId === ctx.sedeId);
      if (input?.categoria) result = result.filter((f) => f.categoria === input.categoria);
      if (input?.attivo !== undefined) result = result.filter((f) => f.attivo === input.attivo);
      if (input?.search) {
        const q = input.search.toLowerCase();
        result = result.filter(
          (f) =>
            f.ragioneSociale.toLowerCase().includes(q) ||
            f.citta?.toLowerCase().includes(q) ||
            f.email?.toLowerCase().includes(q)
        );
      }
      return result.sort((a, b) => a.ragioneSociale.localeCompare(b.ragioneSociale));
    }),

  byId: protectedProcedure.input(z.number()).query(({ input, ctx }) => {
    const f = fornitori.find((f) => f.id === input);
    if (!f || (f as any).sedeId !== ctx.sedeId) return null;
    return f;
  }),

  create: adminProcedure
    .input(
      z.object({
        ragioneSociale: z.string().min(1),
        partitaIva: z.string().min(1),
        indirizzo: z.string().optional(),
        citta: z.string().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
        categoria: z.enum(["pvc", "alluminio", "vetro", "ferramenta", "persiane", "blindati", "accessori", "guarnizioni", "altro"]),
        referenteCommerciale: z.string().optional(),
        scontistica: z.number().optional(),
        note: z.string().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const now = new Date();
      const fornitore: Fornitore = {
        id: nextFornitoreId++,
        ...input,
        sedeId: ctx.sedeId ?? 1,
        attivo: true,
        createdAt: now,
        updatedAt: now,
      } as any;
      fornitori.push(fornitore);
      _fornitoriStore.save();
      return fornitore;
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        ragioneSociale: z.string().optional(),
        partitaIva: z.string().optional(),
        indirizzo: z.string().optional(),
        citta: z.string().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
        categoria: z.enum(["pvc", "alluminio", "vetro", "ferramenta", "persiane", "blindati", "accessori", "guarnizioni", "altro"]).optional(),
        referenteCommerciale: z.string().optional(),
        scontistica: z.number().optional(),
        note: z.string().optional(),
        attivo: z.boolean().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const idx = fornitori.findIndex((f) => f.id === input.id);
      if (idx === -1) throw new Error("Fornitore non trovato");
      assertSedeScope(fornitori[idx] as any, ctx.sedeId);
      const { id, ...updates } = input;
      fornitori[idx] = { ...fornitori[idx], ...updates, updatedAt: new Date() };
      _fornitoriStore.save();
      return fornitori[idx];
    }),

  delete: adminProcedure.input(z.number()).mutation(({ input, ctx }) => {
    const idx = fornitori.findIndex((f) => f.id === input);
    if (idx === -1) throw new Error("Fornitore non trovato");
    assertSedeScope(fornitori[idx] as any, ctx.sedeId);
    fornitori.splice(idx, 1);
    _fornitoriStore.save();
    return { success: true };
  }),

  stats: protectedProcedure.query(({ ctx }) => {
    const scopedF = fornitori.filter((f) => (f as any).sedeId === ctx.sedeId);
    const scopedO = ordini.filter((o) => (o as any).sedeId === ctx.sedeId);
    const totale = scopedF.filter((f) => f.attivo).length;
    const perCategoria = scopedF.reduce((acc, f) => {
      if (f.attivo) acc[f.categoria] = (acc[f.categoria] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const ordiniAttivi = scopedO.filter((o) => !["ricevuto", "contestato"].includes(o.stato)).length;
    const importoPendente = scopedO
      .filter((o) => !["ricevuto", "contestato"].includes(o.stato))
      .reduce((sum, o) => sum + (o.importoTotale ?? 0), 0);
    return { totale, perCategoria, ordiniAttivi, importoPendente };
  }),

  // ── Ordini Fornitori ────────────────────────────────────────────────────
  ordini: router({
    list: protectedProcedure
      .input(
        z.object({
          fornitoreId: z.number().optional(),
          commessaId: z.number().optional(),
          stato: z.string().optional(),
        }).optional()
      )
      .query(({ input, ctx }) => {
        let result = ordini.filter((o) => (o as any).sedeId === ctx.sedeId);
        if (input?.fornitoreId) result = result.filter((o) => o.fornitoreId === input.fornitoreId);
        if (input?.commessaId) result = result.filter((o) => o.commessaId === input.commessaId);
        if (input?.stato) result = result.filter((o) => o.stato === input.stato);
        // Enrich w/ fornitore name
        return result
          .map((o) => ({
            ...o,
            fornitoreNome: fornitori.find((f) => f.id === o.fornitoreId)?.ragioneSociale ?? "?",
          }))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }),

    byId: protectedProcedure.input(z.number()).query(({ input, ctx }) => {
      const o = ordini.find((o) => o.id === input);
      if (!o || (o as any).sedeId !== ctx.sedeId) return null;
      return {
        ...o,
        fornitoreNome: fornitori.find((f) => f.id === o.fornitoreId)?.ragioneSociale ?? "?",
      };
    }),

    create: adminProcedure
      .input(
        z.object({
          fornitoreId: z.number(),
          commessaId: z.number(),
          codiceOrdine: z.string().min(1),
          dataConsegnaPrevista: z.string().optional(),
          righe: z.array(
            z.object({
              descrizione: z.string().min(1),
              codiceArticolo: z.string().optional(),
              quantita: z.number().min(1),
              unitaMisura: z.string(),
              prezzoUnitario: z.number().optional(),
            })
          ),
          noteOrdine: z.string().optional(),
        })
      )
      .mutation(({ input, ctx }) => {
        const now = new Date();
        const sedeId = ctx.sedeId ?? 1;
        const righe: RigaOrdine[] = input.righe.map((r) => ({
          id: nextRigaId++,
          ...r,
          quantitaRicevuta: 0,
        }));
        const importoTotale = righe.reduce(
          (sum, r) => sum + (r.prezzoUnitario ?? 0) * r.quantita,
          0
        );
        const ordine: OrdineFornitore = {
          id: nextOrdineId++,
          sedeId,
          fornitoreId: input.fornitoreId,
          commessaId: input.commessaId,
          codiceOrdine: input.codiceOrdine,
          stato: "bozza",
          dataOrdine: now.toISOString().split("T")[0],
          dataConsegnaPrevista: input.dataConsegnaPrevista,
          righe,
          noteOrdine: input.noteOrdine,
          importoTotale,
          createdAt: now,
          updatedAt: now,
        };
        ordini.push(ordine);
        _ordiniStore.save();
        return ordine;
      }),

    updateStato: adminProcedure
      .input(
        z.object({
          id: z.number(),
          stato: z.enum(["bozza", "inviato", "confermato", "in_transito", "ricevuto_parziale", "ricevuto", "contestato"]),
          noteRicevimento: z.string().optional(),
          dataConsegnaEffettiva: z.string().optional(),
          righeAggiornate: z
            .array(
              z.object({
                id: z.number(),
                quantitaRicevuta: z.number(),
                lotto: z.string().optional(),
                conforme: z.boolean().optional(),
                noteDifetto: z.string().optional(),
              })
            )
            .optional(),
        })
      )
      .mutation(({ input, ctx }) => {
        const idx = ordini.findIndex((o) => o.id === input.id);
        if (idx === -1) throw new Error("Ordine non trovato");
        assertSedeScope(ordini[idx] as any, ctx.sedeId);
        ordini[idx].stato = input.stato;
        ordini[idx].updatedAt = new Date();
        if (input.noteRicevimento) ordini[idx].noteRicevimento = input.noteRicevimento;
        if (input.dataConsegnaEffettiva) ordini[idx].dataConsegnaEffettiva = input.dataConsegnaEffettiva;
        if (input.righeAggiornate) {
          for (const ra of input.righeAggiornate) {
            const rigaIdx = ordini[idx].righe.findIndex((r) => r.id === ra.id);
            if (rigaIdx !== -1) {
              ordini[idx].righe[rigaIdx] = { ...ordini[idx].righe[rigaIdx], ...ra };
            }
          }
        }
        _ordiniStore.save();
        return ordini[idx];
      }),

    delete: adminProcedure.input(z.number()).mutation(({ input, ctx }) => {
      const idx = ordini.findIndex((o) => o.id === input);
      if (idx === -1) throw new Error("Ordine non trovato");
      assertSedeScope(ordini[idx] as any, ctx.sedeId);
      ordini.splice(idx, 1);
      _ordiniStore.save();
      return { success: true };
    }),
  }),

  // ── Listini ──────────────────────────────────────────────────────────────
  listini: router({
    list: protectedProcedure
      .input(z.object({ fornitoreId: z.number().optional() }).optional())
      .query(({ input, ctx }) => {
        let result = listini.filter((l) => (l as any).sedeId === ctx.sedeId);
        if (input?.fornitoreId) result = result.filter((l) => l.fornitoreId === input.fornitoreId);
        return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }),

    create: adminProcedure
      .input(z.object({
        fornitoreId: z.number(),
        nome: z.string().min(1),
        versione: z.string().min(1),
        dataValidita: z.string(),
        nomeFile: z.string().min(1),
        tipo: z.enum(["pdf", "excel", "altro"]),
        note: z.string().optional(),
      }))
      .mutation(({ input, ctx }) => {
        const listino: Listino = {
          id: nextListinoId++,
          sedeId: ctx.sedeId ?? 1,
          ...input,
          createdAt: new Date(),
        };
        listini.push(listino);
        _listiniStore.save();
        return listino;
      }),

    delete: adminProcedure.input(z.number()).mutation(({ input, ctx }) => {
      const idx = listini.findIndex((l) => l.id === input);
      if (idx === -1) throw new Error("Listino non trovato");
      assertSedeScope(listini[idx] as any, ctx.sedeId);
      listini.splice(idx, 1);
      _listiniStore.save();
      return { success: true };
    }),
  }),
});
