import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { addCommessaToCliente, getClienteById } from "./clienti";
import {
  hasPreventivoOrContratto,
  statoHasRequiredDoc,
  REQUIRED_DOC_TIPI_PER_STATO,
  DOC_TIPO_LABEL,
} from "./preventiviContratti";
import { persistedStore } from "../_core/persistence";

// ── State machine: allowed transitions ──────────────────────────────────────
const STATI_COMMESSA = [
  "preventivo",
  "misure_esecutive",
  "aggiornamento_contratto",
  "fatture_pagamento",
  "da_ordinare",
  "produzione",
  "ordini_ultimazione",
  "attesa_posa",
  "finiture_saldo",
  "interventi_regolazioni",
  "archiviata",
] as const;
type StatoCommessa = typeof STATI_COMMESSA[number];

// Forward + backward (prev step) transitions allowed
const TRANSIZIONI_VALIDE: Record<StatoCommessa, StatoCommessa[]> = {
  preventivo:              ["misure_esecutive"],
  misure_esecutive:        ["preventivo", "aggiornamento_contratto"],
  aggiornamento_contratto: ["misure_esecutive", "fatture_pagamento"],
  fatture_pagamento:       ["aggiornamento_contratto", "da_ordinare"],
  da_ordinare:             ["fatture_pagamento", "produzione"],
  produzione:              ["da_ordinare", "ordini_ultimazione"],
  ordini_ultimazione:      ["produzione", "attesa_posa"],
  attesa_posa:             ["ordini_ultimazione", "finiture_saldo"],
  finiture_saldo:          ["attesa_posa", "interventi_regolazioni"],
  interventi_regolazioni:  ["finiture_saldo", "archiviata"],
  archiviata:              ["interventi_regolazioni"],
};

function validateTransizione(statoAttuale: string, nuovoStato: string): void {
  const allowed = TRANSIZIONI_VALIDE[statoAttuale as StatoCommessa];
  if (!allowed || !allowed.includes(nuovoStato as StatoCommessa)) {
    throw new Error(
      `Transizione non consentita: ${statoAttuale} → ${nuovoStato}. ` +
      `Transizioni valide da "${statoAttuale}": ${allowed?.join(", ") ?? "nessuna"}`
    );
  }
}

let nextId = 1;

// Per-commessa monotonic prodotto id counter (lives in memory; ids are unique
// within a single commessa.prodotti array, which is all we need).
function nextProdottoId(commessa: any): number {
  const current: any[] = Array.isArray(commessa.prodotti) ? commessa.prodotti : [];
  return current.length ? Math.max(...current.map((p) => p.id ?? 0)) + 1 : 1;
}

const _store = persistedStore<any>("commesse", (items) => {
  nextId = items.length ? Math.max(...items.map((x: any) => x.id)) + 1 : 1;
  for (const c of items) {
    // Backfill prodotti[] so the field is always an array.
    if (!Array.isArray((c as any).prodotti)) (c as any).prodotti = [];
    // Backfill assegnatoA on legacy records — falls back to createdBy if set.
    if ((c as any).assegnatoA === undefined) {
      (c as any).assegnatoA = (c as any).createdBy ?? null;
    }
    // Soft-archive flag. ISO date string (YYYY-MM-DDTHH:mm:ss.sssZ) when set.
    // Orthogonal to `stato`: archiving does NOT change stato so board position
    // and progress are preserved on restore.
    if ((c as any).archivedAt === undefined) {
      (c as any).archivedAt = null;
    }
  }
});
const commesse = _store.items;

// Auto-generate codice: COM-YYYY-NNN (zero-padded, sequential per year)
function generaCodiceCommessa(): string {
  const year = new Date().getFullYear();
  const yearCodes = commesse
    .filter((c) => typeof c.codice === "string" && c.codice.startsWith(`COM-${year}-`))
    .map((c) => parseInt(c.codice.split("-")[2] ?? "0", 10))
    .filter((n) => !isNaN(n));
  const next = (yearCodes.length ? Math.max(...yearCodes) : 0) + 1;
  return `COM-${year}-${String(next).padStart(3, "0")}`;
}

export function getCommesseStore() {
  return commesse;
}

export function getCommessaById(id: number) {
  return commesse.find((c) => c.id === id) ?? null;
}

// Called by clienti.update so the denormalized `cliente` display string on
// every commessa pointing at this clienteId stays in sync with the canonical
// nome/cognome on the cliente record. Also refreshes per-commessa copies of
// telefono/email/indirizzo/citta WHEN they still match the previous cliente
// value — that way commesse that explicitly overrode those fields (e.g. a
// cantiere address different from the home address) keep their override.
export function syncClienteOnCommesse(
  clienteId: number,
  updatedCliente: {
    nome?: string;
    cognome?: string;
    telefono?: string | null;
    email?: string | null;
    indirizzo?: string | null;
    citta?: string | null;
  },
  previousCliente: {
    nome?: string;
    cognome?: string;
    telefono?: string | null;
    email?: string | null;
    indirizzo?: string | null;
    citta?: string | null;
  }
): number {
  let touched = 0;
  const prevDisplay = `${previousCliente.nome ?? ""} ${previousCliente.cognome ?? ""}`.trim();
  const newDisplay = `${updatedCliente.nome ?? previousCliente.nome ?? ""} ${
    updatedCliente.cognome ?? previousCliente.cognome ?? ""
  }`.trim();

  for (const c of commesse) {
    if (c.clienteId !== clienteId) continue;
    let changed = false;

    // Always refresh the display name — it's derived from cliente and should
    // never drift.
    if (c.cliente !== newDisplay) {
      c.cliente = newDisplay;
      changed = true;
    }

    // For per-commessa contact fields, only overwrite if the commessa still
    // carries the exact previous cliente value (i.e. user never overrode).
    // This preserves legitimate cantiere-vs-home differences.
    const maybeSync = (
      field: "telefono" | "email" | "indirizzo" | "citta"
    ) => {
      if (updatedCliente[field] === undefined) return;
      const prev = previousCliente[field] ?? null;
      const next = updatedCliente[field] ?? null;
      if ((c as any)[field] === prev && prev !== next) {
        (c as any)[field] = next;
        changed = true;
      }
    };
    maybeSync("telefono");
    maybeSync("email");
    maybeSync("indirizzo");
    maybeSync("citta");

    if (changed) {
      c.updatedAt = new Date();
      touched++;
    }

    // Suppress unused warning when nothing changed but display also unchanged.
    void prevDisplay;
  }
  if (touched > 0) _store.save();
  return touched;
}

export const commesseRouter = router({
  list: publicProcedure
    .input(
      z.object({
        stato: z.string().optional(),
        search: z.string().optional(),
        clienteId: z.number().optional(),
        assegnatoA: z.number().optional(),
        // Archive scope:
        //   "exclude" (default) — only active commesse (archivedAt IS NULL)
        //   "only"              — only archived commesse (archivedAt IS NOT NULL)
        //   "all"               — both (used rarely, e.g. admin exports)
        archived: z.enum(["exclude", "only", "all"]).optional(),
      }).optional()
    )
    .query(({ input }) => {
      let result = [...commesse];
      const scope = input?.archived ?? "exclude";
      if (scope === "exclude") {
        result = result.filter((c) => !c.archivedAt);
      } else if (scope === "only") {
        result = result.filter((c) => !!c.archivedAt);
      }
      if (input?.stato) {
        result = result.filter((c) => c.stato === input.stato);
      }
      if (input?.clienteId) {
        result = result.filter((c) => c.clienteId === input.clienteId);
      }
      if (input?.assegnatoA !== undefined) {
        result = result.filter((c) => c.assegnatoA === input.assegnatoA);
      }
      if (input?.search) {
        const q = input.search.toLowerCase();
        result = result.filter(
          (c) =>
            c.codice.toLowerCase().includes(q) ||
            c.cliente.toLowerCase().includes(q) ||
            c.citta?.toLowerCase().includes(q)
        );
      }
      return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }),

  byId: publicProcedure.input(z.number()).query(({ input }) => {
    return commesse.find((c) => c.id === input) ?? null;
  }),

  create: publicProcedure
    .input(
      z.object({
        clienteId: z.number().optional(),
        cliente: z.string().optional(),
        indirizzo: z.string().optional(),
        citta: z.string().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
        priorita: z.enum(["bassa", "media", "alta", "urgente"]).optional(),
        note: z.string().optional(),
        consegnaIndicativa: z.enum(["30", "60", "90"]).optional(),
        assegnatoA: z.number().nullable().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const now = new Date();
      const id = nextId++;
      const { clienteId: inputClienteId, cliente: clienteName, ...rest } = input;

      // Derive cliente display name + inherit owner from cliente if linked.
      let clienteDisplay = clienteName ?? "";
      let inheritedAssegnatoA: number | null = null;
      if (inputClienteId) {
        const c = getClienteById(inputClienteId);
        if (c) {
          clienteDisplay = `${c.nome} ${c.cognome}`.trim();
          inheritedAssegnatoA = c.assegnatoA ?? null;
        }
      }
      // Owner resolution priority: explicit input > cliente's owner > current user.
      const assegnatoA =
        input.assegnatoA !== undefined
          ? input.assegnatoA
          : inheritedAssegnatoA ?? ctx.user?.id ?? null;

      const commessa = {
        id,
        codice: generaCodiceCommessa(),
        clienteId: inputClienteId ?? null,
        cliente: clienteDisplay,
        indirizzo: rest.indirizzo ?? null,
        citta: rest.citta ?? null,
        telefono: rest.telefono ?? null,
        email: rest.email ?? null,
        stato: "preventivo" as const,
        priorita: input.priorita ?? "media",
        squadraId: null,
        dataApertura: now.toISOString().split("T")[0],
        consegnaIndicativa: input.consegnaIndicativa ?? null, // "30" | "60" | "90"
        dataConsegnaConfermata: null, // set when stato=produzione
        dataChiusura: null,
        note: rest.note ?? null,
        prodotti: [] as any[],
        assegnatoA,
        createdBy: ctx.user?.id ?? null,
        createdAt: now,
        updatedAt: now,
      };
      commesse.push(commessa);
      // Link commessa back to cliente
      if (inputClienteId) {
        addCommessaToCliente(inputClienteId, id);
      }
      _store.save();
      return commessa;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        cliente: z.string().optional(),
        clienteId: z.number().nullable().optional(),
        indirizzo: z.string().optional(),
        citta: z.string().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
        stato: z.enum(STATI_COMMESSA).optional(),
        priorita: z.enum(["bassa", "media", "alta", "urgente"]).optional(),
        squadraId: z.number().nullable().optional(),
        note: z.string().optional(),
        consegnaIndicativa: z.enum(["30", "60", "90"]).nullable().optional(),
        dataConsegnaConfermata: z.string().nullable().optional(),
        assegnatoA: z.number().nullable().optional(),
      })
    )
    .mutation(({ input }) => {
      const idx = commesse.findIndex((c) => c.id === input.id);
      if (idx === -1) throw new Error("Commessa non trovata");
      // Enforce state machine on stato transitions
      if (input.stato && input.stato !== commesse[idx].stato) {
        validateTransizione(commesse[idx].stato, input.stato);
        // Gate: forward transitions require the current stato's required doc
        // to have been uploaded. Backward transitions are always allowed.
        const currentIdx = STATI_COMMESSA.indexOf(commesse[idx].stato as any);
        const nextIdx = STATI_COMMESSA.indexOf(input.stato as any);
        const isForward = nextIdx > currentIdx;
        if (isForward) {
          const required = REQUIRED_DOC_TIPI_PER_STATO[commesse[idx].stato] ?? [];
          if (required.length > 0 && !statoHasRequiredDoc(commesse[idx].id, commesse[idx].stato)) {
            const labels = required.map((t) => DOC_TIPO_LABEL[t]).join(" o ");
            throw new Error(
              `Impossibile avanzare: caricare almeno un file di tipo "${labels}" sulla commessa.`
            );
          }
        }
      }
      const { id, ...updates } = input;
      // If clienteId changes to a real id, resolve display name + link back to
      // that cliente's commesseIds so the relationship is kept consistent.
      let resolvedCliente = updates.cliente;
      if (
        updates.clienteId !== undefined &&
        updates.clienteId !== null &&
        updates.clienteId !== commesse[idx].clienteId
      ) {
        const linked = getClienteById(updates.clienteId);
        if (linked) {
          resolvedCliente = `${linked.nome} ${linked.cognome}`.trim();
          addCommessaToCliente(updates.clienteId, commesse[idx].id);
        }
      }
      commesse[idx] = {
        ...commesse[idx],
        ...updates,
        cliente: resolvedCliente ?? commesse[idx].cliente,
        updatedAt: new Date(),
      };
      if (input.stato === "archiviata") {
        commesse[idx].dataChiusura = new Date().toISOString().split("T")[0];
      }
      _store.save();
      return commesse[idx];
    }),

  // Dedicated endpoint for confirming delivery date when stato hits produzione
  confermaDataConsegna: publicProcedure
    .input(z.object({ id: z.number(), dataConsegna: z.string() }))
    .mutation(({ input }) => {
      const idx = commesse.findIndex((c) => c.id === input.id);
      if (idx === -1) throw new Error("Commessa non trovata");
      commesse[idx] = {
        ...commesse[idx],
        dataConsegnaConfermata: input.dataConsegna,
        updatedAt: new Date(),
      };
      _store.save();
      return commesse[idx];
    }),

  delete: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = commesse.findIndex((c) => c.id === input);
    if (idx === -1) throw new Error("Commessa non trovata");
    commesse.splice(idx, 1);
    _store.save();
    return { success: true };
  }),

  // ── Prodotti desiderati (embedded list on commessa) ────────────────────────
  addProdotto: publicProcedure
    .input(z.object({
      commessaId: z.number(),
      nome: z.string().min(1),
      tipologia: z.string().optional(),
      quantita: z.number().int().min(1).default(1),
      dimensioni: z.string().optional(),
      note: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const idx = commesse.findIndex((c) => c.id === input.commessaId);
      if (idx === -1) throw new Error("Commessa non trovata");
      if (!Array.isArray(commesse[idx].prodotti)) commesse[idx].prodotti = [];
      const prodotto = {
        id: nextProdottoId(commesse[idx]),
        nome: input.nome,
        tipologia: input.tipologia ?? null,
        quantita: input.quantita ?? 1,
        dimensioni: input.dimensioni ?? null,
        note: input.note ?? null,
        createdAt: new Date(),
      };
      commesse[idx].prodotti.push(prodotto);
      commesse[idx].updatedAt = new Date();
      _store.save();
      return prodotto;
    }),

  updateProdotto: publicProcedure
    .input(z.object({
      commessaId: z.number(),
      prodottoId: z.number(),
      nome: z.string().optional(),
      tipologia: z.string().nullable().optional(),
      quantita: z.number().int().min(1).optional(),
      dimensioni: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    }))
    .mutation(({ input }) => {
      const idx = commesse.findIndex((c) => c.id === input.commessaId);
      if (idx === -1) throw new Error("Commessa non trovata");
      const prodotti: any[] = commesse[idx].prodotti ?? [];
      const pIdx = prodotti.findIndex((p) => p.id === input.prodottoId);
      if (pIdx === -1) throw new Error("Prodotto non trovato");
      const { commessaId, prodottoId, ...updates } = input;
      prodotti[pIdx] = { ...prodotti[pIdx], ...updates };
      commesse[idx].updatedAt = new Date();
      _store.save();
      return prodotti[pIdx];
    }),

  removeProdotto: publicProcedure
    .input(z.object({ commessaId: z.number(), prodottoId: z.number() }))
    .mutation(({ input }) => {
      const idx = commesse.findIndex((c) => c.id === input.commessaId);
      if (idx === -1) throw new Error("Commessa non trovata");
      const prodotti: any[] = commesse[idx].prodotti ?? [];
      const pIdx = prodotti.findIndex((p) => p.id === input.prodottoId);
      if (pIdx === -1) throw new Error("Prodotto non trovato");
      prodotti.splice(pIdx, 1);
      commesse[idx].updatedAt = new Date();
      _store.save();
      return { success: true };
    }),

  stats: publicProcedure.query(() => {
    // Archived commesse (soft-archive) are excluded from every aggregation so
    // dashboard counters don't pollute with jobs the client declined.
    const active = commesse.filter((c) => !c.archivedAt);
    const total = active.length;
    const preventivi = active.filter((c) => c.stato === "preventivo").length;
    const inCorso = active.filter((c) =>
      !["preventivo", "finiture_saldo", "interventi_regolazioni", "archiviata"].includes(c.stato)
    ).length;
    const chiuse = active.filter((c) => ["finiture_saldo", "interventi_regolazioni", "archiviata"].includes(c.stato)).length;
    const urgenti = active.filter(
      (c) => c.priorita === "urgente" && c.stato !== "archiviata"
    ).length;
    return { total, preventivi, inCorso, chiuse, urgenti };
  }),

  // Aggregated by priority for dashboard card
  byPriorita: publicProcedure.query(() => {
    const buckets: Record<string, any[]> = { urgente: [], alta: [], media: [], bassa: [] };
    for (const c of commesse) {
      if (c.archivedAt) continue;
      if (c.stato === "archiviata") continue;
      if (buckets[c.priorita]) buckets[c.priorita].push(c);
    }
    // Sort each bucket newest first
    for (const k of Object.keys(buckets)) {
      buckets[k].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    return buckets;
  }),

  // ── Soft archive ──────────────────────────────────────────────────────────
  // Sets `archivedAt` to now. The commessa keeps its stato, prodotti,
  // documenti, aperture, interventi — nothing is destroyed. Restore just
  // clears the flag. Safe to re-archive after restore.
  archive: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = commesse.findIndex((c) => c.id === input);
    if (idx === -1) throw new Error("Commessa non trovata");
    if (commesse[idx].archivedAt) return commesse[idx];
    commesse[idx] = {
      ...commesse[idx],
      archivedAt: new Date().toISOString(),
      updatedAt: new Date(),
    };
    _store.save();
    return commesse[idx];
  }),

  restore: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = commesse.findIndex((c) => c.id === input);
    if (idx === -1) throw new Error("Commessa non trovata");
    if (!commesse[idx].archivedAt) return commesse[idx];
    commesse[idx] = {
      ...commesse[idx],
      archivedAt: null,
      updatedAt: new Date(),
    };
    _store.save();
    return commesse[idx];
  }),
});
