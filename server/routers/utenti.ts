import { z } from "zod";
import crypto from "crypto";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { hashPassword, isHashed } from "../_core/password";

// ── Roles (PRD Section 14) ────────────────────────────────────────────────────
const RUOLI = [
  "direzione",
  "amministrazione",
  "commerciale",
  "tecnico_rilievi",
  "squadra_posa",
  "post_vendita",
  "ordini",
] as const;
type Ruolo = (typeof RUOLI)[number];

const MAX_RUOLI = 3;

const ruoliSchema = z.array(z.enum(RUOLI)).min(1).max(MAX_RUOLI);
const passwordSchema = z
  .string()
  .min(12, "La password deve avere almeno 12 caratteri")
  .max(256, "La password è troppo lunga");

// Helpers for the "last attivo direzione user" guard. We refuse to delete or
// downgrade the very last admin so the app can never lock itself out.
function isDirezioneAttivo(u: any): boolean {
  return (
    !!u && u.attivo && Array.isArray(u.ruoli) && u.ruoli.includes("direzione")
  );
}
function countDirezioneAttivi(): number {
  return utenti.filter(isDirezioneAttivo).length;
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
  }
  if (migrated) setTimeout(() => _store.save(), 0);
  nextId = items.length ? Math.max(...items.map((x: any) => x.id)) + 1 : 1;
});
const utenti = _store.items;

// Export for local auth access
export function getUtentiStore() {
  return utenti;
}

export const utentiRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          ruolo: z.enum(RUOLI).optional(),
          search: z.string().optional(),
        })
        .optional()
    )
    .query(({ input }) => {
      let result = [...utenti];
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
        .map(({ password, ...rest }) => ({ ...rest, hasPassword: !!password }));
    }),

  byId: protectedProcedure.input(z.number()).query(({ input }) => {
    const u = utenti.find(u => u.id === input);
    if (!u) return null;
    const { password, ...rest } = u;
    return { ...rest, hasPassword: !!password };
  }),

  create: adminProcedure
    .input(
      z.object({
        nome: z.string().min(1),
        cognome: z.string().min(1),
        email: z.string().email(),
        telefono: z.string().optional(),
        ruoli: ruoliSchema,
        // Sedi (showroom) assigned to the user. Defaults to the default sede.
        sediIds: z.array(z.number()).optional(),
        password: passwordSchema,
        attivo: z.boolean().optional(),
      })
    )
    .mutation(({ input }) => {
      // Check email uniqueness
      if (
        utenti.some(u => u.email.toLowerCase() === input.email.toLowerCase())
      ) {
        throw new Error("Email già in uso");
      }
      const now = new Date();
      const id = nextId++;
      const utente = {
        id,
        ...input,
        telefono: input.telefono ?? null,
        sediIds:
          input.sediIds && input.sediIds.length > 0 ? input.sediIds : [1],
        attivo: input.attivo ?? true,
        // Never store the plaintext password.
        password: hashPassword(input.password),
        createdAt: now,
        updatedAt: now,
      };
      utenti.push(utente);
      _store.save();
      const { password, ...rest } = utente;
      return { ...rest, hasPassword: true };
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
    .mutation(({ input }) => {
      const idx = utenti.findIndex(u => u.id === input.id);
      if (idx === -1) throw new Error("Utente non trovato");
      const { id, ...updates } = input;
      // Never persist an empty sedi list — fall back to default sede.
      if (updates.sediIds && updates.sediIds.length === 0) {
        updates.sediIds = [1];
      }
      // Only update password if provided (non-empty) — and hash it.
      if (!updates.password) delete updates.password;
      else updates.password = hashPassword(updates.password);
      // Last-admin guard: refuse the change if it would leave zero attivo
      // direzione users in the system (deactivation OR removing direzione
      // from the only remaining admin).
      const before = utenti[idx];
      const after = { ...before, ...updates };
      if (
        isDirezioneAttivo(before) &&
        !isDirezioneAttivo(after) &&
        countDirezioneAttivi() <= 1
      ) {
        throw new Error(
          "Impossibile: questo è l'ultimo utente direzione attivo. Promuovi un altro utente prima di disattivarlo o togliergli il ruolo."
        );
      }
      utenti[idx] = { ...before, ...updates, updatedAt: new Date() };
      _store.save();
      const { password, ...rest } = utenti[idx];
      return { ...rest, hasPassword: !!password };
    }),

  delete: adminProcedure.input(z.number()).mutation(({ input }) => {
    const idx = utenti.findIndex(u => u.id === input);
    if (idx === -1) throw new Error("Utente non trovato");
    // Last-admin guard: refuse to delete the only attivo direzione user.
    if (isDirezioneAttivo(utenti[idx]) && countDirezioneAttivi() <= 1) {
      throw new Error(
        "Impossibile: questo è l'ultimo utente direzione attivo. Promuovi un altro utente prima di eliminarlo."
      );
    }
    utenti.splice(idx, 1);
    _store.save();
    return { success: true };
  }),

  stats: protectedProcedure.query(() => {
    const total = utenti.length;
    const attivi = utenti.filter(u => u.attivo).length;
    const perRuolo = RUOLI.reduce(
      (acc, ruolo) => {
        acc[ruolo] = utenti.filter(u => (u.ruoli ?? []).includes(ruolo)).length;
        return acc;
      },
      {} as Record<string, number>
    );
    return { total, attivi, perRuolo };
  }),
});
