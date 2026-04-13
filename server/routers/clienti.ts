import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";

// ── Referenti (contacts per client) ─────────────────────────────────────────

type Referente = {
  nome: string;
  ruolo: string; // "cliente_finale" | "architetto" | "direttore_lavori" | "amministratore" | "altro"
  telefono?: string;
  email?: string;
};

// ── In-memory data ──────────────────────────────────────────────────────────

let clienti: any[] = [];

let nextId = 1;

// ── Exported store operations (used by commesse router) ─────────────────────

export function addCommessaToCliente(clienteId: number, commessaId: number) {
  const idx = clienti.findIndex((c) => c.id === clienteId);
  if (idx === -1) return;
  if (!clienti[idx].commesseIds.includes(commessaId)) {
    clienti[idx].commesseIds = [...clienti[idx].commesseIds, commessaId];
  }
}

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
            c.ragioneSociale.toLowerCase().includes(q) ||
            c.citta?.toLowerCase().includes(q) ||
            c.email?.toLowerCase().includes(q)
        );
      }
      return result.sort((a, b) => a.ragioneSociale.localeCompare(b.ragioneSociale));
    }),

  byId: publicProcedure.input(z.number()).query(({ input }) => {
    return clienti.find((c) => c.id === input) ?? null;
  }),

  create: publicProcedure
    .input(
      z.object({
        ragioneSociale: z.string().min(1),
        tipo: z.enum(["privato", "azienda", "condominio", "ente_pubblico"]),
        codiceFiscale: z.string().optional(),
        partitaIva: z.string().optional(),
        indirizzo: z.string().optional(),
        citta: z.string().optional(),
        cap: z.string().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
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
      const now = new Date();
      const cliente = {
        id: nextId++,
        ...input,
        referenti: input.referenti ?? [],
        commesseIds: [] as number[],
        createdAt: now,
        updatedAt: now,
      };
      clienti.push(cliente);
      return cliente;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        ragioneSociale: z.string().optional(),
        tipo: z.enum(["privato", "azienda", "condominio", "ente_pubblico"]).optional(),
        codiceFiscale: z.string().optional(),
        partitaIva: z.string().optional(),
        indirizzo: z.string().optional(),
        citta: z.string().optional(),
        cap: z.string().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
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
      return clienti[idx];
    }),

  delete: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = clienti.findIndex((c) => c.id === input);
    if (idx === -1) throw new Error("Cliente non trovato");
    clienti.splice(idx, 1);
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
