import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { addCommessaToCliente, getClienteById } from "./clienti";
import { hasPreventivoOrContratto } from "./preventiviContratti";
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
  // Backfill prodotti[] on legacy records so the field is always an array.
  for (const c of items) {
    if (!Array.isArray((c as any).prodotti)) (c as any).prodotti = [];
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

export const commesseRouter = router({
  list: publicProcedure
    .input(
      z.object({
        stato: z.string().optional(),
        search: z.string().optional(),
        clienteId: z.number().optional(),
      }).optional()
    )
    .query(({ input }) => {
      let result = [...commesse];
      if (input?.stato) {
        result = result.filter((c) => c.stato === input.stato);
      }
      if (input?.clienteId) {
        result = result.filter((c) => c.clienteId === input.clienteId);
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
      })
    )
    .mutation(({ input, ctx }) => {
      const now = new Date();
      const id = nextId++;
      const { clienteId: inputClienteId, cliente: clienteName, ...rest } = input;

      // Derive cliente display name from cliente record if clienteId given
      let clienteDisplay = clienteName ?? "";
      if (inputClienteId) {
        const c = getClienteById(inputClienteId);
        if (c) clienteDisplay = `${c.nome} ${c.cognome}`.trim();
      }

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
      })
    )
    .mutation(({ input }) => {
      const idx = commesse.findIndex((c) => c.id === input.id);
      if (idx === -1) throw new Error("Commessa non trovata");
      // Enforce state machine on stato transitions
      if (input.stato && input.stato !== commesse[idx].stato) {
        validateTransizione(commesse[idx].stato, input.stato);
        // Gate: cannot leave "preventivo" without at least one preventivo/contratto doc
        if (
          commesse[idx].stato === "preventivo" &&
          input.stato === "misure_esecutive" &&
          !hasPreventivoOrContratto(commesse[idx].id)
        ) {
          throw new Error(
            "Impossibile avanzare: caricare almeno un file di tipo Preventivo o Contratto sulla commessa."
          );
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
    const total = commesse.length;
    const preventivi = commesse.filter((c) => c.stato === "preventivo").length;
    const inCorso = commesse.filter((c) =>
      !["preventivo", "finiture_saldo", "interventi_regolazioni", "archiviata"].includes(c.stato)
    ).length;
    const chiuse = commesse.filter((c) => ["finiture_saldo", "interventi_regolazioni", "archiviata"].includes(c.stato)).length;
    const urgenti = commesse.filter(
      (c) => c.priorita === "urgente" && c.stato !== "archiviata"
    ).length;
    return { total, preventivi, inCorso, chiuse, urgenti };
  }),

  // Aggregated by priority for dashboard card
  byPriorita: publicProcedure.query(() => {
    const buckets: Record<string, any[]> = { urgente: [], alta: [], media: [], bassa: [] };
    for (const c of commesse) {
      if (c.stato === "archiviata") continue;
      if (buckets[c.priorita]) buckets[c.priorita].push(c);
    }
    // Sort each bucket newest first
    for (const k of Object.keys(buckets)) {
      buckets[k].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    return buckets;
  }),
});
