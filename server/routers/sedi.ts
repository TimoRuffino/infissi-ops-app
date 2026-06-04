import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { getSessionCookieOptions } from "../_core/cookies";
import { SEDE_COOKIE } from "@shared/const";
import { getUtentiStore } from "./utenti";

// ── Sedi (showrooms / locations) ─────────────────────────────────────────────
//
// Each sede is a fully isolated tenant: its own commesse, clienti, interventi,
// ecc. Data isolation is enforced by a `sedeId` stamp on every scoped record
// plus per-request filtering on `ctx.sedeId` (resolved in _core/context.ts).
//
// The default sede (id = 1, "La Spezia") is seeded on first boot and is the
// backfill target for every pre-existing record, so nothing disappears when
// the multi-sede feature is introduced.

export type Sede = {
  id: number;
  nome: string;
  citta: string | null;
  indirizzo: string | null;
  attiva: boolean;
  createdAt: Date;
  updatedAt: Date;
};

// Default sede id used everywhere as the backfill target. MUST stay 1.
export const DEFAULT_SEDE_ID = 1;

let nextId = 2; // 1 is reserved for the default sede

const _store = persistedStore<Sede>("sedi", (items, { firstBoot }) => {
  if (firstBoot && items.length === 0) {
    const now = new Date();
    items.push({
      id: DEFAULT_SEDE_ID,
      nome: "La Spezia",
      citta: "La Spezia",
      indirizzo: null,
      attiva: true,
      createdAt: now,
      updatedAt: now,
    });
    setTimeout(() => _store.save(), 0);
  }
  nextId = items.length ? Math.max(...items.map((x) => x.id)) + 1 : 2;
});
const sedi = _store.items;

// ── Exports used by context + scoped routers ────────────────────────────────

export function getSediStore(): Sede[] {
  return sedi;
}

export function getSedeById(id: number): Sede | null {
  return sedi.find((s) => s.id === id) ?? null;
}

/** All active sede ids — used to grant direzione access to every sede. */
export function allSedeIds(): number[] {
  return sedi.filter((s) => s.attiva).map((s) => s.id);
}

/**
 * The set of sede ids a user may access. Direzione sees every sede; everyone
 * else only the sedi explicitly assigned to them (`utente.sediIds`). Falls
 * back to the default sede so a freshly-seeded user is never locked out.
 */
export function allowedSediForUser(user: any): number[] {
  if (!user) return [];
  const ruoli: string[] = Array.isArray(user.ruoli)
    ? user.ruoli
    : user.ruolo
    ? [user.ruolo]
    : [];
  if (ruoli.includes("direzione")) {
    const all = allSedeIds();
    return all.length ? all : [DEFAULT_SEDE_ID];
  }
  // Look up the full utente record to read sediIds (the JWT-derived user may
  // not carry it).
  const utente = getUtentiStore().find((u: any) => u.id === user.id);
  const ids: number[] = Array.isArray(utente?.sediIds) ? utente!.sediIds : [];
  return ids.length ? ids : [DEFAULT_SEDE_ID];
}

// ── Router ──────────────────────────────────────────────────────────────────

export const sediRouter = router({
  // Sedi the current user can switch between.
  list: protectedProcedure.query(({ ctx }) => {
    const allowed = new Set(allowedSediForUser(ctx.user));
    return sedi
      .filter((s) => allowed.has(s.id))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }),

  // Every sede, for direzione management.
  listAll: adminProcedure.query(() => {
    return [...sedi].sort((a, b) => a.nome.localeCompare(b.nome));
  }),

  // The active sede for this request (resolved in context).
  active: protectedProcedure.query(({ ctx }) => {
    const id = ctx.sedeId ?? DEFAULT_SEDE_ID;
    return getSedeById(id);
  }),

  create: adminProcedure
    .input(
      z.object({
        nome: z.string().min(1),
        citta: z.string().optional(),
        indirizzo: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      const now = new Date();
      const sede: Sede = {
        id: nextId++,
        nome: input.nome,
        citta: input.citta ?? null,
        indirizzo: input.indirizzo ?? null,
        attiva: true,
        createdAt: now,
        updatedAt: now,
      };
      sedi.push(sede);
      _store.save();
      return sede;
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        nome: z.string().min(1).optional(),
        citta: z.string().nullable().optional(),
        indirizzo: z.string().nullable().optional(),
        attiva: z.boolean().optional(),
      })
    )
    .mutation(({ input }) => {
      const idx = sedi.findIndex((s) => s.id === input.id);
      if (idx === -1) throw new Error("Sede non trovata");
      const { id, ...updates } = input;
      sedi[idx] = { ...sedi[idx], ...updates, updatedAt: new Date() };
      _store.save();
      return sedi[idx];
    }),

  // Switch the active sede. Validates that the user is assigned to it, then
  // writes the `active_sede` cookie so subsequent requests are scoped to it.
  switch: protectedProcedure
    .input(z.object({ sedeId: z.number() }))
    .mutation(({ input, ctx }) => {
      const allowed = new Set(allowedSediForUser(ctx.user));
      if (!allowed.has(input.sedeId)) {
        throw new Error("Non sei assegnato a questa sede");
      }
      const sede = getSedeById(input.sedeId);
      if (!sede) throw new Error("Sede non trovata");
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(SEDE_COOKIE, String(input.sedeId), {
        ...cookieOptions,
        // Not httpOnly-sensitive, but keep it httpOnly anyway; the client
        // never needs to read it directly (it asks sedi.active).
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      return sede;
    }),
});
