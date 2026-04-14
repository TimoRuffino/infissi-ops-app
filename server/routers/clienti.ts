import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";

// ── Referenti (contacts per client) ─────────────────────────────────────────

type Referente = {
  nome: string;
  ruolo: string; // "cliente_finale" | "architetto" | "direttore_lavori" | "amministratore" | "altro"
  telefono?: string;
  email?: string;
};

// ── In-memory data ──────────────────────────────────────────────────────────

let nextId = 1;

const _store = persistedStore<any>("clienti", (items) => {
  nextId = items.length ? Math.max(...items.map((x: any) => x.id)) + 1 : 1;
});
const clienti = _store.items;

// ── Exported store operations (used by commesse router) ─────────────────────

export function addCommessaToCliente(clienteId: number, commessaId: number) {
  const idx = clienti.findIndex((c) => c.id === clienteId);
  if (idx === -1) return;
  if (!clienti[idx].commesseIds.includes(commessaId)) {
    clienti[idx].commesseIds = [...clienti[idx].commesseIds, commessaId];
    _store.save();
  }
}

export function getClienteById(id: number) {
  return clienti.find((c) => c.id === id) ?? null;
}

const PRATICA_EDILIZIA = ["nessuna", "cil", "cila", "scia"] as const;

export const clientiRouter = router({
  list: publicProcedure
    .input(
      z.object({
        search: z.string().optional(),
        tipo: z.string().optional(),
      }).optional()
    )
    .query(({ input }) => {
      let result = [...clienti];
      if (input?.tipo) result = result.filter((c) => c.tipo === input.tipo);
      if (input?.search) {
        const q = input.search.toLowerCase();
        result = result.filter(
          (c) =>
            `${c.nome} ${c.cognome}`.toLowerCase().includes(q) ||
            c.citta?.toLowerCase().includes(q) ||
            c.email?.toLowerCase().includes(q)
        );
      }
      return result.sort((a, b) =>
        `${a.cognome} ${a.nome}`.localeCompare(`${b.cognome} ${b.nome}`)
      );
    }),

  byId: publicProcedure.input(z.number()).query(({ input }) => {
    return clienti.find((c) => c.id === input) ?? null;
  }),

  create: publicProcedure
    .input(
      z.object({
        nome: z.string().min(1),
        cognome: z.string().min(1),
        tipo: z.enum(["privato", "azienda", "condominio", "ente_pubblico"]).optional(),
        codiceFiscale: z.string().optional(),
        partitaIva: z.string().optional(),
        indirizzo: z.string().optional(),
        citta: z.string().optional(),
        cap: z.string().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
        detrazione: z.boolean().optional(),
        interesseFinanziamento: z.boolean().optional(),
        praticaEdilizia: z.enum(PRATICA_EDILIZIA).optional(),
        referenti: z.array(z.object({
          nome: z.string(),
          ruolo: z.string(),
          telefono: z.string().optional(),
          email: z.string().optional(),
        })).optional(),
        note: z.string().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const now = new Date();
      const cliente = {
        id: nextId++,
        ...input,
        tipo: input.tipo ?? "privato",
        detrazione: input.detrazione ?? false,
        interesseFinanziamento: input.interesseFinanziamento ?? false,
        praticaEdilizia: input.praticaEdilizia ?? "nessuna",
        referenti: input.referenti ?? [],
        commesseIds: [] as number[],
        createdBy: ctx.user?.id ?? null,
        createdAt: now,
        updatedAt: now,
      };
      clienti.push(cliente);
      _store.save();
      return cliente;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        nome: z.string().optional(),
        cognome: z.string().optional(),
        tipo: z.enum(["privato", "azienda", "condominio", "ente_pubblico"]).optional(),
        codiceFiscale: z.string().optional(),
        partitaIva: z.string().optional(),
        indirizzo: z.string().optional(),
        citta: z.string().optional(),
        cap: z.string().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
        detrazione: z.boolean().optional(),
        interesseFinanziamento: z.boolean().optional(),
        praticaEdilizia: z.enum(PRATICA_EDILIZIA).optional(),
        referenti: z.array(z.object({
          nome: z.string(),
          ruolo: z.string(),
          telefono: z.string().optional(),
          email: z.string().optional(),
        })).optional(),
        note: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      const idx = clienti.findIndex((c) => c.id === input.id);
      if (idx === -1) throw new Error("Cliente non trovato");
      const { id, ...updates } = input;
      clienti[idx] = { ...clienti[idx], ...updates, updatedAt: new Date() };
      _store.save();
      return clienti[idx];
    }),

  delete: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = clienti.findIndex((c) => c.id === input);
    if (idx === -1) throw new Error("Cliente non trovato");
    clienti.splice(idx, 1);
    _store.save();
    return { success: true };
  }),

  stats: publicProcedure.query(() => {
    return {
      totale: clienti.length,
      privati: clienti.filter((c) => c.tipo === "privato").length,
      aziende: clienti.filter((c) => c.tipo === "azienda").length,
      condomini: clienti.filter((c) => c.tipo === "condominio").length,
      entiPubblici: clienti.filter((c) => c.tipo === "ente_pubblico").length,
    };
  }),
});
