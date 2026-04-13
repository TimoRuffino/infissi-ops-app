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

let clienti: any[] = [
  {
    id: 1,
    ragioneSociale: "Condominio Via Roma 15",
    tipo: "condominio",
    codiceFiscale: "90012345678",
    partitaIva: null,
    indirizzo: "Via Roma 15",
    citta: "Palermo",
    cap: "90133",
    telefono: "091 123 4567",
    email: "admin@condominioroma15.it",
    referenti: [
      { nome: "Ing. Giuseppe Ferrara", ruolo: "amministratore", telefono: "091 123 4567", email: "admin@condominioroma15.it" },
      { nome: "Arch. Maria Rossi", ruolo: "architetto", telefono: "335 111 2222", email: "m.rossi@studio.it" },
    ] as Referente[],
    note: "Condominio 12 unità abitative, blocco A e B",
    commesseIds: [1],
    createdAt: new Date("2026-01-15"),
    updatedAt: new Date("2026-04-01"),
  },
  {
    id: 2,
    ragioneSociale: "Ferrara Giovanni",
    tipo: "privato",
    codiceFiscale: "FRRGNN70A01G273K",
    partitaIva: null,
    indirizzo: "Via dei Giardini 42",
    citta: "Palermo",
    cap: "90141",
    telefono: "091 987 6543",
    email: "ferrara@gmail.com",
    referenti: [
      { nome: "Giovanni Ferrara", ruolo: "cliente_finale", telefono: "091 987 6543", email: "ferrara@gmail.com" },
    ] as Referente[],
    note: "Villa unifamiliare, ristrutturazione completa",
    commesseIds: [2],
    createdAt: new Date("2026-03-10"),
    updatedAt: new Date("2026-03-20"),
  },
  {
    id: 3,
    ragioneSociale: "Moretti S.r.l.",
    tipo: "azienda",
    codiceFiscale: null,
    partitaIva: "01234567890",
    indirizzo: "Viale della Libertà 88",
    citta: "Palermo",
    cap: "90139",
    telefono: "091 555 1234",
    email: "info@moretti.it",
    referenti: [
      { nome: "Dott. Andrea Moretti", ruolo: "cliente_finale", telefono: "091 555 1234", email: "a.moretti@moretti.it" },
      { nome: "Geom. Luca Ferretti", ruolo: "direttore_lavori", telefono: "335 444 5555", email: "l.ferretti@moretti.it" },
    ] as Referente[],
    note: "Uffici piano 3, sostituzione vetrate",
    commesseIds: [3],
    createdAt: new Date("2026-04-01"),
    updatedAt: new Date("2026-04-05"),
  },
  {
    id: 4,
    ragioneSociale: "Istituto Comprensivo Pirandello",
    tipo: "ente_pubblico",
    codiceFiscale: "80012345678",
    partitaIva: null,
    indirizzo: "Via Maqueda 200",
    citta: "Palermo",
    cap: "90134",
    telefono: "091 333 7890",
    email: "segreteria@scuolapirandello.edu.it",
    referenti: [
      { nome: "Dott.ssa Anna Ferretti", ruolo: "cliente_finale", telefono: "091 333 7890", email: "segreteria@scuolapirandello.edu.it" },
      { nome: "Ing. Paolo Marino", ruolo: "direttore_lavori", telefono: "335 666 7777", email: "p.marino@ingegneria.it" },
    ] as Referente[],
    note: "Lavori completati con anticipo - cliente soddisfatto",
    commesseIds: [4],
    createdAt: new Date("2025-10-15"),
    updatedAt: new Date("2026-01-12"),
  },
  {
    id: 5,
    ragioneSociale: "Residence Blu Mare S.p.A.",
    tipo: "azienda",
    codiceFiscale: null,
    partitaIva: "09876543210",
    indirizzo: "Lungomare Cristoforo Colombo 12",
    citta: "Palermo",
    cap: "90149",
    telefono: "091 444 5678",
    email: "direz@blumare.it",
    referenti: [
      { nome: "Dott. Salvatore Ferrara", ruolo: "cliente_finale", telefono: "091 444 5678", email: "direz@blumare.it" },
      { nome: "Arch. Elena Ferretti", ruolo: "architetto", telefono: "335 888 9999", email: "e.ferretti@archstudio.it" },
      { nome: "Geom. Marco Ferretti", ruolo: "direttore_lavori", telefono: "335 000 1111", email: "m.ferretti@blumare.it" },
    ] as Referente[],
    note: "120 aperture - scorrevoli e portefinestre fronte mare",
    commesseIds: [5],
    createdAt: new Date("2026-02-20"),
    updatedAt: new Date("2026-04-08"),
  },
];

let nextId = 6;

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
