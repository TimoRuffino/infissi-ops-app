import { z } from "zod";
import crypto from "crypto";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { hashPassword, isHashed } from "../_core/password";
import { assertTenantScope, isDirezione } from "../_core/permissions";
import type { TrpcContext } from "../_core/context";
import { effectiveCapabilitySet } from "../authz/enforcement";
import { interruttoreAttivo } from "../platform/interruttori";
import { CAPABILITY_PROPRIETARI, MESSAGGI, RUOLO_PROPRIETARIO, TENANT_PREDEFINITO_ID } from "../tenants/costanti";
import {
  motivoRifiutoPresidio,
  presidioDi,
  proprietarioAggiunto,
  proprietarioTolto,
  ruoliDi,
  tenantDelContesto,
} from "../tenants/regole";
import { getTenantRepository } from "../tenants/repository";
import { attoreTesto } from "../tenants/tipi";
// Import ciclico innocuo: sedi.ts importa getUtentiStore, qui usiamo le sue
// funzioni solo dentro gli handler (come già fa sedi.ts con noi).
import { DEFAULT_SEDE_ID, sediDelTenant, sedePredefinita } from "./sedi";

// ── Roles (PRD Section 14) ────────────────────────────────────────────────────
const RUOLI = [
  "direzione",
  "amministrazione",
  "commerciale",
  "tecnico_rilievi",
  "squadra_posa",
  "post_vendita",
  "ordini",
  "proprietario",
] as const;
type Ruolo = (typeof RUOLI)[number];

const MAX_RUOLI = 3;

const ruoliSchema = z.array(z.enum(RUOLI)).min(1).max(MAX_RUOLI);
const passwordSchema = z
  .string()
  .min(12, "La password deve avere almeno 12 caratteri")
  .max(256, "La password è troppo lunga");

/** Ogni sede assegnata deve appartenere al tenant: altrimenti NOT_FOUND, mai un indizio. */
function assertSediDelTenant(sediIds: number[], tenantId: number): void {
  const valide = new Set(sediDelTenant(tenantId).map(s => s.id));
  for (const id of sediIds) {
    if (!valide.has(id)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Sede non trovata." });
    }
  }
}

/** Chi tocca il ruolo proprietario deve avere tenant.manage_proprietari; spento, il ruolo non si aggiunge. */
async function assertPuoNominareProprietari(ctx: TrpcContext, multi: boolean): Promise<void> {
  if (!multi) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: MESSAGGI.proprietarioRichiedeFlag });
  }
  const caps = await effectiveCapabilitySet(ctx, [CAPABILITY_PROPRIETARI]);
  if (!caps.has(CAPABILITY_PROPRIETARI)) {
    throw new TRPCError({ code: "FORBIDDEN", message: MESSAGGI.soloProprietari });
  }
}

function attoreDi(ctx: TrpcContext): string {
  return attoreTesto({ tipo: "utente", id: Number(ctx.user?.id) });
}

// A new database gets one bootstrap administrator, never a list of staff with
// shared credentials. Production must provide the password out of band;
// ephemeral local development gets a fresh one printed once in the terminal.
function bootstrapAdmin() {
  const email =
    process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() ||
    "admin@ruffinogroup.it";
  let password = process.env.BOOTSTRAP_ADMIN_PASSWORD?.trim();
  if (!password) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "BOOTSTRAP_ADMIN_PASSWORD obbligatoria al primo avvio: nessuna credenziale predefinita viene creata."
      );
    }
    password = `Dev-${crypto.randomBytes(18).toString("base64url")}!`;
    console.warn(
      `[security] database utenti vuoto; credenziali temporanee locali: ${email} / ${password}`
    );
  }
  const checked = passwordSchema.safeParse(password);
  if (!checked.success) {
    throw new Error(
      `BOOTSTRAP_ADMIN_PASSWORD non valida: ${checked.error.issues[0]?.message}`
    );
  }
  return {
    id: 1,
    nome: process.env.BOOTSTRAP_ADMIN_NAME?.trim() || "Admin",
    cognome: process.env.BOOTSTRAP_ADMIN_SURNAME?.trim() || "Ruffino",
    email,
    telefono: "",
    ruoli: ["direzione"] as Ruolo[],
    password: hashPassword(checked.data),
    attivo: true,
  };
}

let nextId = 1;

const _store = persistedStore<any>("utenti", (items, { firstBoot }) => {
  // Seed ONLY when the DB row is genuinely absent. Previously this keyed
  // off `items.length === 0`, which meant every failed/empty load (including
  // DNS flakes during Railway cold boot, or a deliberate "delete all users"
  // by the admin) would re-apply the seed and clobber real data on the
  // next save.
  if (firstBoot && items.length === 0) {
    const now = new Date();
    items.push({
      ...bootstrapAdmin(),
      sediIds: [1],
      tenantId: TENANT_PREDEFINITO_ID,
      createdAt: now,
      updatedAt: now,
    });
    // Persist seed after bootstrap by scheduling save.
    setTimeout(() => _store.save(), 0);
  }
  // Defensive migration: if a legacy DB row still holds a plaintext password,
  // upgrade it to a hash on load so plaintext never lingers at rest.
  let migrated = false;
  for (const u of items) {
    if (u.password && !isHashed(u.password)) {
      u.password = hashPassword(u.password);
      migrated = true;
    }
    // Backfill sede assignment for legacy users → default sede (id 1).
    if (!Array.isArray((u as any).sediIds) || (u as any).sediIds.length === 0) {
      (u as any).sediIds = [1];
      migrated = true;
    }
    // Backfill WS1: ogni utente legacy appartiene a Ruffino Group (tenant 1).
    if (typeof (u as any).tenantId !== "number") {
      (u as any).tenantId = TENANT_PREDEFINITO_ID;
      migrated = true;
    }
  }
  if (migrated) setTimeout(() => _store.save(), 0);
  nextId = items.length ? Math.max(...items.map((x: any) => x.id)) + 1 : 1;
});
const utenti = _store.items;

// Export for local auth access
export function getUtentiStore() {
  return utenti;
}

export function getUtentiPersistedStore() {
  return _store;
}

export type NuovoUtenteInterno = {
  tenantId: number;
  nome: string;
  cognome: string;
  email: string;
  telefono?: string | null;
  ruoli: string[];
  sediIds: number[];
  passwordHash: string;
  attivo?: boolean;
};

/**
 * Crea l'utente nell'array e lo restituisce (con la password hashata dentro).
 * Chi chiama salva o committa. L'email è unica su tutta l'installazione: il
 * login è per sola email e non distingue i tenant.
 */
export function creaUtenteInterno(input: NuovoUtenteInterno) {
  if (utenti.some(u => u.email.toLowerCase() === input.email.toLowerCase())) {
    throw new Error("Email già in uso");
  }
  const now = new Date();
  const utente = {
    id: nextId++,
    tenantId: input.tenantId,
    nome: input.nome,
    cognome: input.cognome,
    email: input.email,
    telefono: input.telefono ?? null,
    ruoli: input.ruoli,
    sediIds: input.sediIds,
    attivo: input.attivo ?? true,
    password: input.passwordHash,
    createdAt: now,
    updatedAt: now,
  };
  utenti.push(utente);
  return utente;
}

const scopeInputSchema = z.object({ adminScope: z.boolean().optional() });

function scopedUtenti(
  ctx: { user: any; sedeId: number | null; tenantId: number | null },
  adminScope = false
) {
  const delTenant = interruttoreAttivo("multiAzienda")
    ? utenti.filter(u => presidioDi(u).tenantId === tenantDelContesto(ctx))
    : utenti;
  if (adminScope) {
    if (!isDirezione(ctx.user)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Solo la direzione puo consultare tutte le sedi.",
      });
    }
    return [...delTenant];
  }
  if (ctx.sedeId == null) return [];
  return delTenant.filter(
    user => Array.isArray(user.sediIds) && user.sediIds.includes(ctx.sedeId)
  );
}

function publicUtente(user: any) {
  const { password, ...rest } = user;
  return { ...rest, hasPassword: !!password };
}

export const utentiRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          ruolo: z.enum(RUOLI).optional(),
          search: z.string().optional(),
          adminScope: z.boolean().optional(),
        })
        .optional()
    )
    .query(({ input, ctx }) => {
      let result = scopedUtenti(ctx, input?.adminScope);
      if (input?.ruolo) {
        result = result.filter(u => (u.ruoli ?? []).includes(input.ruolo));
      }
      if (input?.search) {
        const q = input.search.toLowerCase();
        result = result.filter(
          u =>
            u.nome.toLowerCase().includes(q) ||
            u.cognome.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q)
        );
      }
      // Strip password from response, add hasPassword flag
      return result
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(publicUtente);
    }),

  byId: protectedProcedure
    .input(z.union([z.number(), scopeInputSchema.extend({ id: z.number() })]))
    .query(({ input, ctx }) => {
      const id = typeof input === "number" ? input : input.id;
      const adminScope = typeof input === "number" ? false : input.adminScope;
      const u = scopedUtenti(ctx, adminScope).find(user => user.id === id);
      if (!u) return null;
      return publicUtente(u);
    }),

  create: adminProcedure
    .input(
      z.object({
        nome: z.string().min(1),
        cognome: z.string().min(1),
        email: z.string().email(),
        telefono: z.string().optional(),
        ruoli: ruoliSchema,
        // Sedi (showroom) assigned to the user. Defaults to the tenant's first active sede.
        sediIds: z.array(z.number()).optional(),
        password: passwordSchema,
        attivo: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const multi = interruttoreAttivo("multiAzienda");
      const tenantId = tenantDelContesto(ctx);
      const sediIds =
        input.sediIds && input.sediIds.length > 0
          ? input.sediIds
          : [sedePredefinita(tenantId) ?? DEFAULT_SEDE_ID];
      if (multi) assertSediDelTenant(sediIds, tenantId);
      if (input.ruoli.includes(RUOLO_PROPRIETARIO)) await assertPuoNominareProprietari(ctx, multi);
      const utente = creaUtenteInterno({
        tenantId,
        nome: input.nome,
        cognome: input.cognome,
        email: input.email,
        telefono: input.telefono ?? null,
        ruoli: input.ruoli,
        sediIds,
        passwordHash: hashPassword(input.password),
        attivo: input.attivo,
      });
      _store.save();
      if (multi && input.ruoli.includes(RUOLO_PROPRIETARIO)) {
        await getTenantRepository().registraEvento({
          tenantId,
          tipo: "proprietario_assegnato",
          attore: attoreDi(ctx),
          dettagli: { utenteId: utente.id },
        });
      }
      return publicUtente(utente);
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        nome: z.string().min(1).optional(),
        cognome: z.string().min(1).optional(),
        email: z.string().email().optional(),
        telefono: z.string().optional(),
        ruoli: ruoliSchema.optional(),
        sediIds: z.array(z.number()).optional(),
        password: passwordSchema.optional(),
        attivo: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const multi = interruttoreAttivo("multiAzienda");
      const idx = utenti.findIndex(u => u.id === input.id);
      const before = idx === -1 ? null : utenti[idx];
      if (multi) assertTenantScope(before, ctx.tenantId);
      if (!before) throw new Error("Utente non trovato");
      const tenantId = presidioDi(before).tenantId;
      const { id, ...updates } = input;
      // Never persist an empty sedi list — fall back to the tenant's first sede.
      if (updates.sediIds && updates.sediIds.length === 0) {
        updates.sediIds = [sedePredefinita(tenantId) ?? DEFAULT_SEDE_ID];
      }
      if (multi && updates.sediIds) assertSediDelTenant(updates.sediIds, tenantId);
      // Only update password if provided (non-empty) — and hash it.
      if (!updates.password) delete updates.password;
      else updates.password = hashPassword(updates.password);

      const ruoliPrima = ruoliDi(before);
      const ruoliDopo = updates.ruoli ?? ruoliPrima;
      const aggiunto = proprietarioAggiunto(ruoliPrima, ruoliDopo);
      const tolto = proprietarioTolto(ruoliPrima, ruoliDopo);
      // Aggiungere il ruolo richiede la capability (e l'interruttore); toglierlo
      // richiede la capability solo con l'interruttore acceso: spento, chi lo
      // ha lo conserva e la direzione lavora come oggi.
      if (aggiunto || (tolto && multi)) await assertPuoNominareProprietari(ctx, multi);

      const after = { ...before, ...updates };
      const motivo = motivoRifiutoPresidio(presidioDi(before), presidioDi(after), utenti.map(presidioDi));
      if (motivo) throw new TRPCError({ code: "PRECONDITION_FAILED", message: motivo });

      utenti[idx] = { ...after, updatedAt: new Date() };
      _store.save();
      if (multi && (aggiunto || tolto)) {
        await getTenantRepository().registraEvento({
          tenantId,
          tipo: aggiunto ? "proprietario_assegnato" : "proprietario_revocato",
          attore: attoreDi(ctx),
          dettagli: { utenteId: before.id },
        });
      }
      return publicUtente(utenti[idx]);
    }),

  delete: adminProcedure.input(z.number()).mutation(({ input, ctx }) => {
    const multi = interruttoreAttivo("multiAzienda");
    const idx = utenti.findIndex(u => u.id === input);
    const before = idx === -1 ? null : utenti[idx];
    if (multi) assertTenantScope(before, ctx.tenantId);
    if (!before) throw new Error("Utente non trovato");
    const motivo = motivoRifiutoPresidio(presidioDi(before), null, utenti.map(presidioDi));
    if (motivo) throw new TRPCError({ code: "PRECONDITION_FAILED", message: motivo });
    utenti.splice(idx, 1);
    _store.save();
    return { success: true };
  }),

  stats: protectedProcedure
    .input(scopeInputSchema.optional())
    .query(({ input, ctx }) => {
      const visible = scopedUtenti(ctx, input?.adminScope);
      const total = visible.length;
      const attivi = visible.filter(u => u.attivo).length;
      const perRuolo = RUOLI.reduce(
        (acc, ruolo) => {
          acc[ruolo] = visible.filter(u =>
            (u.ruoli ?? []).includes(ruolo)
          ).length;
          return acc;
        },
        {} as Record<string, number>
      );
      return { total, attivi, perRuolo };
    }),
});
