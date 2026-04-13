import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";

// ── Roles (PRD Section 14) ────────────────────────────────────────────────────
const RUOLI = [
  "direzione",
  "amministrazione",
  "commerciale",
  "tecnico_rilievi",
  "squadra_posa",
  "post_vendita",
] as const;
type Ruolo = typeof RUOLI[number];

// In-memory store (replace with Drizzle queries when DB is available)
let utenti: any[] = [
  {
    id: 1,
    nome: "Admin",
    cognome: "Ruffino",
    email: "admin@ruffinogroup.it",
    telefono: "",
    ruolo: "direzione" as Ruolo,
    password: "Tars0520@",
    attivo: true,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
  },
  {
    id: 2,
    nome: "Lucia",
    cognome: "Saltarella",
    email: "l.saltarella@ruffinogroup.com",
    telefono: "",
    ruolo: "amministrazione" as Ruolo,
    password: "Ruffino2026@",
    attivo: true,
    createdAt: new Date("2026-04-13"),
    updatedAt: new Date("2026-04-13"),
  },
  {
    id: 3,
    nome: "Andrea",
    cognome: "Facci",
    email: "a.facci@ruffinogroup.com",
    telefono: "",
    ruolo: "commerciale" as Ruolo,
    password: "Ruffino2026@",
    attivo: true,
    createdAt: new Date("2026-04-13"),
    updatedAt: new Date("2026-04-13"),
  },
  {
    id: 4,
    nome: "Simone",
    cognome: "Lenzo",
    email: "s.lenzo@ruffinogroup.com",
    telefono: "",
    ruolo: "commerciale" as Ruolo,
    password: "Ruffino2026@",
    attivo: true,
    createdAt: new Date("2026-04-13"),
    updatedAt: new Date("2026-04-13"),
  },
  {
    id: 5,
    nome: "Nicolò",
    cognome: "Ruffino",
    email: "n.ruffino@ruffinogroup.com",
    telefono: "",
    ruolo: "amministrazione" as Ruolo,
    password: "Ruffino2026@",
    attivo: true,
    createdAt: new Date("2026-04-13"),
    updatedAt: new Date("2026-04-13"),
  },
  {
    id: 6,
    nome: "Marco",
    cognome: "Ruffino",
    email: "m.ruffino@ruffinogroup.com",
    telefono: "",
    ruolo: "tecnico_rilievi" as Ruolo,
    password: "Ruffino2026@",
    attivo: true,
    createdAt: new Date("2026-04-13"),
    updatedAt: new Date("2026-04-13"),
  },
  {
    id: 7,
    nome: "Francesco",
    cognome: "Ruffino",
    email: "f.ruffino@ruffinogroup.com",
    telefono: "",
    ruolo: "direzione" as Ruolo,
    password: "Ruffino2026@",
    attivo: true,
    createdAt: new Date("2026-04-13"),
    updatedAt: new Date("2026-04-13"),
  },
];

let nextId = 8;

// Export for local auth access
export function getUtentiStore() {
  return utenti;
}

export const utentiRouter = router({
  list: publicProcedure
    .input(
      z.object({
        ruolo: z.enum(RUOLI).optional(),
        search: z.string().optional(),
      }).optional()
    )
    .query(({ input }) => {
      let result = [...utenti];
      if (input?.ruolo) {
        result = result.filter((u) => u.ruolo === input.ruolo);
      }
      if (input?.search) {
        const q = input.search.toLowerCase();
        result = result.filter(
          (u) =>
            u.nome.toLowerCase().includes(q) ||
            u.cognome.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q)
        );
      }
      // Strip password from response, add hasPassword flag
      return result
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(({ password, ...rest }) => ({ ...rest, hasPassword: !!password }));
    }),

  byId: publicProcedure.input(z.number()).query(({ input }) => {
    const u = utenti.find((u) => u.id === input);
    if (!u) return null;
    const { password, ...rest } = u;
    return { ...rest, hasPassword: !!password };
  }),

  create: publicProcedure
    .input(
      z.object({
        nome: z.string().min(1),
        cognome: z.string().min(1),
        email: z.string().email(),
        telefono: z.string().optional(),
        ruolo: z.enum(RUOLI),
        password: z.string().min(4),
        attivo: z.boolean().optional(),
      })
    )
    .mutation(({ input }) => {
      // Check email uniqueness
      if (utenti.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) {
        throw new Error("Email già in uso");
      }
      const now = new Date();
      const id = nextId++;
      const utente = {
        id,
        ...input,
        telefono: input.telefono ?? null,
        attivo: input.attivo ?? true,
        createdAt: now,
        updatedAt: now,
      };
      utenti.push(utente);
      const { password, ...rest } = utente;
      return { ...rest, hasPassword: true };
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        nome: z.string().min(1).optional(),
        cognome: z.string().min(1).optional(),
        email: z.string().email().optional(),
        telefono: z.string().optional(),
        ruolo: z.enum(RUOLI).optional(),
        password: z.string().min(4).optional(),
        attivo: z.boolean().optional(),
      })
    )
    .mutation(({ input }) => {
      const idx = utenti.findIndex((u) => u.id === input.id);
      if (idx === -1) throw new Error("Utente non trovato");
      const { id, ...updates } = input;
      // Only update password if provided (non-empty)
      if (!updates.password) delete updates.password;
      utenti[idx] = { ...utenti[idx], ...updates, updatedAt: new Date() };
      const { password, ...rest } = utenti[idx];
      return { ...rest, hasPassword: !!password };
    }),

  delete: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = utenti.findIndex((u) => u.id === input);
    if (idx === -1) throw new Error("Utente non trovato");
    utenti.splice(idx, 1);
    return { success: true };
  }),

  stats: publicProcedure.query(() => {
    const total = utenti.length;
    const attivi = utenti.filter((u) => u.attivo).length;
    const perRuolo = RUOLI.reduce((acc, ruolo) => {
      acc[ruolo] = utenti.filter((u) => u.ruolo === ruolo).length;
      return acc;
    }, {} as Record<string, number>);
    return { total, attivi, perRuolo };
  }),
});
