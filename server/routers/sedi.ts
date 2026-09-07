import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { getSessionCookieOptions } from "../_core/cookies";
import { assertTenantScope } from "../_core/permissions";
import { SEDE_COOKIE } from "@shared/const";
import { interruttoreAttivo } from "../platform/interruttori";
import { getUtentiStore } from "./utenti";
import { TENANT_PREDEFINITO_ID } from "../tenants/costanti";
import { tenantDelContesto } from "../tenants/regole";
// Import ciclico innocuo: contesto.ts importa da questo file, ma sediAmmesse
// si usa solo dentro gli handler (come già fa contesto.ts con noi).
import { sediAmmesse } from "../tenants/contesto";

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
  tenantId: number;
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
      tenantId: TENANT_PREDEFINITO_ID,
      nome: "La Spezia",
      citta: "La Spezia",
      indirizzo: null,
      attiva: true,
      createdAt: now,
      updatedAt: now,
    });
    setTimeout(() => _store.save(), 0);
  }
  // Backfill WS1: ogni sede legacy appartiene a Ruffino Group (tenant 1).
  let migrate = false;
  for (const s of items) {
    if (typeof (s as any).tenantId !== "number") {
      (s as any).tenantId = TENANT_PREDEFINITO_ID;
      migrate = true;
    }
  }
  if (migrate) setTimeout(() => _store.save(), 0);
  nextId = items.length ? Math.max(...items.map((x) => x.id)) + 1 : 2;
});
const sedi = _store.items;

// ── Exports used by context + scoped routers ────────────────────────────────

export function getSediStore(): Sede[] {
  return sedi;
}

export function getSediPersistedStore() {
  return _store;
}

export function getSedeById(id: number): Sede | null {
  return sedi.find((s) => s.id === id) ?? null;
}

/** All active sede ids — used to grant direzione access to every sede. */
export function allSedeIds(): number[] {
  return sedi.filter((s) => s.attiva).map((s) => s.id);
}

export function sediDelTenant(tenantId: number): Sede[] {
  return sedi.filter((s) => s.tenantId === tenantId).sort((a, b) => a.id - b.id);
}

export function sediAttiveDelTenant(tenantId: number): Sede[] {
  return sediDelTenant(tenantId).filter((s) => s.attiva);
}

/** Prima sede attiva del tenant, per id crescente; null se non ne ha. */
export function sedePredefinita(tenantId: number): number | null {
  return sediAttiveDelTenant(tenantId)[0]?.id ?? null;
}

/** Spinge la sede nell'array e la restituisce. Chi chiama salva (o committa la transazione). */
export function creaSedeInterna(input: {
  tenantId: number;
  nome: string;
  citta?: string | null;
  indirizzo?: string | null;
}): Sede {
  const now = new Date();
  const sede: Sede = {
    id: nextId++,
    tenantId: input.tenantId,
    nome: input.nome,
    citta: input.citta ?? null,
    indirizzo: input.indirizzo ?? null,
    attiva: true,
    createdAt: now,
    updatedAt: now,
  };
  sedi.push(sede);
  return sede;
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

function ammesse(ctx: { user: any; tenantId: number | null }): Set<number> {
  return new Set(
    interruttoreAttivo("multiAzienda")
      ? sediAmmesse(ctx.user, tenantDelContesto(ctx))
      : allowedSediForUser(ctx.user)
  );
}

export const sediRouter = router({
  // Sedi the current user can switch between.
  list: protectedProcedure.query(({ ctx }) => {
    const allowed = ammesse(ctx);
    return sedi
      .filter((s) => allowed.has(s.id))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }),

  // Every sede of the tenant, for direzione management.
  listAll: adminProcedure.query(({ ctx }) => {
    const visibili = interruttoreAttivo("multiAzienda")
      ? sediDelTenant(tenantDelContesto(ctx))
      : [...sedi];
    return visibili.sort((a, b) => a.nome.localeCompare(b.nome));
  }),

  // The active sede for this request (resolved in context).
  active: protectedProcedure.query(({ ctx }) => {
    const id = ctx.sedeId ?? (interruttoreAttivo("multiAzienda") ? null : DEFAULT_SEDE_ID);
    return id == null ? null : getSedeById(id);
  }),

  create: adminProcedure
    .input(
      z.object({
        nome: z.string().min(1),
        citta: z.string().optional(),
        indirizzo: z.string().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const sede = creaSedeInterna({ tenantId: tenantDelContesto(ctx), ...input });
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
    .mutation(({ input, ctx }) => {
      const idx = sedi.findIndex((s) => s.id === input.id);
      if (interruttoreAttivo("multiAzienda")) assertTenantScope(sedi[idx] ?? null, ctx.tenantId);
      if (idx === -1) throw new Error("Sede non trovata");
      const { id, ...updates } = input;
      const sede = sedi[idx];
      // Guardia sull'ultima sede attiva (Important 2): senza, disattivarla
      // lascerebbe sedeId = null a ogni richiesta del tenant e bloccherebbe
      // l'intera azienda, riattivazione inclusa.
      if (
        interruttoreAttivo("multiAzienda") &&
        updates.attiva === false &&
        sede.attiva &&
        sediAttiveDelTenant(sede.tenantId).length <= 1
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Impossibile: è l'ultima sede attiva dell'azienda. Attiva un'altra sede prima di disattivarla.",
        });
      }
      sedi[idx] = { ...sede, ...updates, updatedAt: new Date() };
      _store.save();
      return sedi[idx];
    }),

  // Switch the active sede. Validates that the user may see it, then writes
  // the `active_sede` cookie so subsequent requests are scoped to it.
  switch: protectedProcedure
    .input(z.object({ sedeId: z.number() }))
    .mutation(({ input, ctx }) => {
      const allowed = ammesse(ctx);
      if (!allowed.has(input.sedeId)) {
        throw new Error("Non sei assegnato a questa sede");
      }
      const sede = getSedeById(input.sedeId);
      if (!sede) throw new Error("Sede non trovata");
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(SEDE_COOKIE, String(input.sedeId), {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      return sede;
    }),
});
