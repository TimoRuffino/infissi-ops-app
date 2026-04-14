import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";

// ── Types ───────────────────────────────────────────────────────────────────

type Fornitore = {
  id: number;
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
});
const fornitori = _fornitoriStore.items;

const _ordiniStore = persistedStore<OrdineFornitore>("fornitori_ordini", (loaded) => {
  nextOrdineId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
  // Recompute nextRigaId by scanning child righe[] across all ordini
  let maxRigaId = 0;
  for (const o of loaded) {
    for (const r of (o as any).righe ?? []) {
      if (r.id > maxRigaId) maxRigaId = r.id;
    }
  }
  nextRigaId = maxRigaId + 1;
});
const ordini = _ordiniStore.items;

const _listiniStore = persistedStore<Listino>("fornitori_listini", (loaded) => {
  nextListinoId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
});
const listini = _listiniStore.items;

// ── Router ──────────────────────────────────────────────────────────────────

export const fornitoriRouter = router({
  // ── Fornitori CRUD ──────────────────────────────────────────────────────
  list: publicProcedure
    .input(
      z.object({
        search: z.string().optional(),
        categoria: z.string().optional(),
        attivo: z.boolean().optional(),
      }).optional()
    )
    .query(({ input }) => {
      let result = [...fornitori];
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

  byId: publicProcedure.input(z.number()).query(({ input }) => {
    return fornitori.find((f) => f.id === input) ?? null;
  }),

  create: publicProcedure
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
    .mutation(({ input }) => {
      const now = new Date();
      const fornitore: Fornitore = {
        id: nextFornitoreId++,
        ...input,
        attivo: true,
        createdAt: now,
        updatedAt: now,
      };
      fornitori.push(fornitore);
      _fornitoriStore.save();
      return fornitore;
    }),

  update: publicProcedure
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
    .mutation(({ input }) => {
      const idx = fornitori.findIndex((f) => f.id === input.id);
      if (idx === -1) throw new Error("Fornitore non trovato");
      const { id, ...updates } = input;
      fornitori[idx] = { ...fornitori[idx], ...updates, updatedAt: new Date() };
      _fornitoriStore.save();
      return fornitori[idx];
    }),

  delete: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = fornitori.findIndex((f) => f.id === input);
    if (idx === -1) throw new Error("Fornitore non trovato");
    fornitori.splice(idx, 1);
    _fornitoriStore.save();
    return { success: true };
  }),

  stats: publicProcedure.query(() => {
    const totale = fornitori.filter((f) => f.attivo).length;
    const perCategoria = fornitori.reduce((acc, f) => {
      if (f.attivo) acc[f.categoria] = (acc[f.categoria] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const ordiniAttivi = ordini.filter((o) => !["ricevuto", "contestato"].includes(o.stato)).length;
    const importoPendente = ordini
      .filter((o) => !["ricevuto", "contestato"].includes(o.stato))
      .reduce((sum, o) => sum + (o.importoTotale ?? 0), 0);
    return { totale, perCategoria, ordiniAttivi, importoPendente };
  }),

  // ── Ordini Fornitori ────────────────────────────────────────────────────
  ordini: router({
    list: publicProcedure
      .input(
        z.object({
          fornitoreId: z.number().optional(),
          commessaId: z.number().optional(),
          stato: z.string().optional(),
        }).optional()
      )
      .query(({ input }) => {
        let result = [...ordini];
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

    byId: publicProcedure.input(z.number()).query(({ input }) => {
      const o = ordini.find((o) => o.id === input);
      if (!o) return null;
      return {
        ...o,
        fornitoreNome: fornitori.find((f) => f.id === o.fornitoreId)?.ragioneSociale ?? "?",
      };
    }),

    create: publicProcedure
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
      .mutation(({ input }) => {
        const now = new Date();
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

    updateStato: publicProcedure
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
      .mutation(({ input }) => {
        const idx = ordini.findIndex((o) => o.id === input.id);
        if (idx === -1) throw new Error("Ordine non trovato");
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

    delete: publicProcedure.input(z.number()).mutation(({ input }) => {
      const idx = ordini.findIndex((o) => o.id === input);
      if (idx === -1) throw new Error("Ordine non trovato");
      ordini.splice(idx, 1);
      _ordiniStore.save();
      return { success: true };
    }),
  }),

  // ── Listini ──────────────────────────────────────────────────────────────
  listini: router({
    list: publicProcedure
      .input(z.object({ fornitoreId: z.number().optional() }).optional())
      .query(({ input }) => {
        let result = [...listini];
        if (input?.fornitoreId) result = result.filter((l) => l.fornitoreId === input.fornitoreId);
        return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }),

    create: publicProcedure
      .input(z.object({
        fornitoreId: z.number(),
        nome: z.string().min(1),
        versione: z.string().min(1),
        dataValidita: z.string(),
        nomeFile: z.string().min(1),
        tipo: z.enum(["pdf", "excel", "altro"]),
        note: z.string().optional(),
      }))
      .mutation(({ input }) => {
        const listino: Listino = {
          id: nextListinoId++,
          ...input,
          createdAt: new Date(),
        };
        listini.push(listino);
        _listiniStore.save();
        return listino;
      }),

    delete: publicProcedure.input(z.number()).mutation(({ input }) => {
      const idx = listini.findIndex((l) => l.id === input);
      if (idx === -1) throw new Error("Listino non trovato");
      listini.splice(idx, 1);
      _listiniStore.save();
      return { success: true };
    }),
  }),
});
