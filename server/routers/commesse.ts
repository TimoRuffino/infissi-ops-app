import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { addCommessaToCliente, getClienteById } from "./clienti";

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

// In-memory store (replace with Drizzle queries when DB is available)
let commesse: any[] = [];

let nextId = 1;

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
        createdBy: ctx.user?.id ?? null,
        createdAt: now,
        updatedAt: now,
      };
      commesse.push(commessa);
      // Link commessa back to cliente
      if (inputClienteId) {
        addCommessaToCliente(inputClienteId, id);
      }
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
      }
      const { id, ...updates } = input;
      commesse[idx] = { ...commesse[idx], ...updates, updatedAt: new Date() };
      if (input.stato === "archiviata") {
        commesse[idx].dataChiusura = new Date().toISOString().split("T")[0];
      }
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
      return commesse[idx];
    }),

  delete: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = commesse.findIndex((c) => c.id === input);
    if (idx === -1) throw new Error("Commessa non trovata");
    commesse.splice(idx, 1);
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
