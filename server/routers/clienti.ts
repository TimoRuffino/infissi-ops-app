import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { requireOwnershipOrDirezione, assertSedeScope } from "../_core/permissions";
// NOTE: imported lazily inside the update handler to avoid a circular-
// import cycle (commesse.ts already imports from this file).

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
  // Backfill assegnatoA on legacy records — defaults to createdBy if present.
  for (const c of items) {
    if ((c as any).assegnatoA === undefined) {
      (c as any).assegnatoA = (c as any).createdBy ?? null;
    }
    // Backfill sede scope → default sede (id 1) for pre-multi-sede records.
    if ((c as any).sedeId === undefined) (c as any).sedeId = 1;
    // Soft-archive flag (ISO string when archived, else null).
    if ((c as any).archivedAt === undefined) (c as any).archivedAt = null;
  }
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

/**
 * Detach a commessa id from a cliente's `commesseIds` index. Called when a
 * commessa is re-linked to a different cliente or hard-deleted, so the old
 * cliente doesn't carry a stale reference.
 */
export function removeCommessaFromCliente(
  clienteId: number,
  commessaId: number
) {
  const idx = clienti.findIndex((c) => c.id === clienteId);
  if (idx === -1) return;
  const list: number[] = clienti[idx].commesseIds ?? [];
  if (!list.includes(commessaId)) return;
  clienti[idx].commesseIds = list.filter((id) => id !== commessaId);
  _store.save();
}

export function getClienteById(id: number) {
  return clienti.find((c) => c.id === id) ?? null;
}

const PRATICA_EDILIZIA = ["nessuna", "cil", "cila", "scia"] as const;
const TIPO_DETRAZIONE = ["ecobonus", "ristrutturazione"] as const;

export const clientiRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().optional(),
        tipo: z.string().optional(),
        assegnatoA: z.number().optional(),
        // exclude (default) = active only; only = archived; all = both.
        archived: z.enum(["exclude", "only", "all"]).optional(),
      }).optional()
    )
    .query(({ input, ctx }) => {
      let result = clienti.filter((c) => c.sedeId === ctx.sedeId);
      const scope = input?.archived ?? "exclude";
      if (scope === "exclude") result = result.filter((c) => !c.archivedAt);
      else if (scope === "only") result = result.filter((c) => !!c.archivedAt);
      if (input?.tipo) result = result.filter((c) => c.tipo === input.tipo);
      if (input?.assegnatoA !== undefined) {
        result = result.filter((c) => c.assegnatoA === input.assegnatoA);
      }
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

  byId: protectedProcedure.input(z.number()).query(({ input, ctx }) => {
    const c = clienti.find((c) => c.id === input);
    if (!c || c.sedeId !== ctx.sedeId) return null;
    return c;
  }),

  create: protectedProcedure
    .input(
      z.object({
        nome: z.string().min(1),
        cognome: z.string().min(1),
        tipo: z.enum(["privato", "azienda", "condominio", "ente_pubblico"]).optional(),
        codiceFiscale: z.string().optional(),
        partitaIva: z.string().optional(),
        // Legacy "indirizzo/citta/cap" → kept as RESIDENZA (used by admin
        // for fatture). New explicit fields below for work-site address.
        indirizzo: z.string().optional(),
        citta: z.string().optional(),
        cap: z.string().optional(),
        // Work-site address — what the commessa cares about. Falls back to
        // residenza when not provided.
        indirizzoLavoro: z.string().optional(),
        cittaLavoro: z.string().optional(),
        capLavoro: z.string().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
        detrazione: z.boolean().optional(),
        // Which detrazione the client wants — only meaningful when
        // detrazione === true. Null when no detrazione requested.
        tipoDetrazione: z.enum(TIPO_DETRAZIONE).nullable().optional(),
        interesseFinanziamento: z.boolean().optional(),
        praticaEdilizia: z.enum(PRATICA_EDILIZIA).optional(),
        referenti: z.array(z.object({
          nome: z.string(),
          ruolo: z.string(),
          telefono: z.string().optional(),
          email: z.string().optional(),
        })).optional(),
        note: z.string().optional(),
        assegnatoA: z.number().nullable().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const now = new Date();
      const { assegnatoA: inputAssegnato, ...rest } = input;
      const cliente = {
        id: nextId++,
        ...rest,
        // Stamp the active sede so the cliente belongs to the current showroom.
        sedeId: ctx.sedeId ?? 1,
        tipo: input.tipo ?? "privato",
        detrazione: input.detrazione ?? false,
        tipoDetrazione: input.tipoDetrazione ?? null,
        interesseFinanziamento: input.interesseFinanziamento ?? false,
        praticaEdilizia: input.praticaEdilizia ?? "nessuna",
        referenti: input.referenti ?? [],
        commesseIds: [] as number[],
        // Default owner: explicit input, else current user. Ownership binds
        // every future commessa back to the user who onboarded the cliente.
        assegnatoA: inputAssegnato !== undefined ? inputAssegnato : ctx.user?.id ?? null,
        createdBy: ctx.user?.id ?? null,
        createdAt: now,
        updatedAt: now,
      };
      clienti.push(cliente);
      _store.save();
      return cliente;
    }),

  update: protectedProcedure
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
        indirizzoLavoro: z.string().optional(),
        cittaLavoro: z.string().optional(),
        capLavoro: z.string().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
        detrazione: z.boolean().optional(),
        tipoDetrazione: z.enum(TIPO_DETRAZIONE).nullable().optional(),
        interesseFinanziamento: z.boolean().optional(),
        praticaEdilizia: z.enum(PRATICA_EDILIZIA).optional(),
        referenti: z.array(z.object({
          nome: z.string(),
          ruolo: z.string(),
          telefono: z.string().optional(),
          email: z.string().optional(),
        })).optional(),
        note: z.string().optional(),
        assegnatoA: z.number().nullable().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const idx = clienti.findIndex((c) => c.id === input.id);
      if (idx === -1) throw new Error("Cliente non trovato");
      assertSedeScope(clienti[idx], ctx.sedeId);
      const prev = { ...clienti[idx] };
      const { id, ...updates } = input;
      clienti[idx] = { ...clienti[idx], ...updates, updatedAt: new Date() };
      _store.save();

      // Cascade: propagate nome/cognome (always) and contact fields (when the
      // commessa hasn't overridden them) to every linked commessa. Lazy
      // import to break the commesse ↔ clienti circular dep.
      const { syncClienteOnCommesse } = await import("./commesse");
      syncClienteOnCommesse(
        input.id,
        {
          nome: input.nome,
          cognome: input.cognome,
          telefono: input.telefono,
          email: input.email,
          indirizzo: input.indirizzo,
          citta: input.citta,
        },
        {
          nome: prev.nome,
          cognome: prev.cognome,
          telefono: prev.telefono,
          email: prev.email,
          indirizzo: prev.indirizzo,
          citta: prev.citta,
        }
      );

      return clienti[idx];
    }),

  delete: protectedProcedure
    .input(z.number())
    .mutation(({ input, ctx }) => {
      const idx = clienti.findIndex((c) => c.id === input);
      if (idx === -1) throw new Error("Cliente non trovato");
      assertSedeScope(clienti[idx], ctx.sedeId);
      // Only the creator/owner or a direzione user can hard-delete a cliente.
      requireOwnershipOrDirezione(clienti[idx], ctx.user);
      clienti.splice(idx, 1);
      _store.save();
      return { success: true };
    }),

  stats: protectedProcedure.query(({ ctx }) => {
    const scoped = clienti.filter((c) => c.sedeId === ctx.sedeId && !c.archivedAt);
    return {
      totale: scoped.length,
      privati: scoped.filter((c) => c.tipo === "privato").length,
      aziende: scoped.filter((c) => c.tipo === "azienda").length,
      condomini: scoped.filter((c) => c.tipo === "condominio").length,
      entiPubblici: scoped.filter((c) => c.tipo === "ente_pubblico").length,
    };
  }),

  // ── Soft archive (cliente + its commesse) ──────────────────────────────────
  // Open to anyone in the sede (archive is reversible, not destructive).
  // Archiving a cliente also archives every commessa linked to it; restore
  // brings both back.
  archive: protectedProcedure.input(z.number()).mutation(async ({ input, ctx }) => {
    const idx = clienti.findIndex((c) => c.id === input);
    if (idx === -1) throw new Error("Cliente non trovato");
    assertSedeScope(clienti[idx], ctx.sedeId);
    if (!clienti[idx].archivedAt) {
      clienti[idx] = {
        ...clienti[idx],
        archivedAt: new Date().toISOString(),
        updatedAt: new Date(),
      };
      _store.save();
    }
    const { setCommesseArchivedByCliente } = await import("./commesse");
    setCommesseArchivedByCliente(input, true);
    return clienti[idx];
  }),

  restore: protectedProcedure.input(z.number()).mutation(async ({ input, ctx }) => {
    const idx = clienti.findIndex((c) => c.id === input);
    if (idx === -1) throw new Error("Cliente non trovato");
    assertSedeScope(clienti[idx], ctx.sedeId);
    if (clienti[idx].archivedAt) {
      clienti[idx] = { ...clienti[idx], archivedAt: null, updatedAt: new Date() };
      _store.save();
    }
    const { setCommesseArchivedByCliente } = await import("./commesse");
    setCommesseArchivedByCliente(input, false);
    return clienti[idx];
  }),
});
