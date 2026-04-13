import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { addCommessaToCliente } from "./clienti";

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
let commesse: any[] = [
  {
    id: 1,
    codice: "COM-2026-001",
    clienteId: 1,
    cliente: "Condominio Via Roma 15",
    indirizzo: "Via Roma 15",
    citta: "Palermo",
    telefono: "091 123 4567",
    email: "admin@condominioroma15.it",
    stato: "attesa_posa",
    priorita: "alta",
    squadraId: 1,
    dataApertura: "2026-02-10",
    dataConsegnaPrevista: "2026-05-15",
    dataChiusura: null,
    note: "Sostituzione completa infissi blocco A",
    createdAt: new Date("2026-02-10"),
    updatedAt: new Date("2026-04-01"),
  },
  {
    id: 2,
    codice: "COM-2026-002",
    clienteId: 2,
    cliente: "Villa Ferrara",
    indirizzo: "Via dei Giardini 42",
    citta: "Palermo",
    telefono: "091 987 6543",
    email: "ferrara@gmail.com",
    stato: "misure_esecutive",
    priorita: "media",
    squadraId: null,
    dataApertura: "2026-03-20",
    dataConsegnaPrevista: "2026-06-30",
    dataChiusura: null,
    note: "Ristrutturazione villa - infissi in alluminio",
    createdAt: new Date("2026-03-20"),
    updatedAt: new Date("2026-03-28"),
  },
  {
    id: 3,
    codice: "COM-2026-003",
    clienteId: 3,
    cliente: "Uffici Moretti S.r.l.",
    indirizzo: "Viale della Libertà 88",
    citta: "Palermo",
    telefono: "091 555 1234",
    email: "info@moretti.it",
    stato: "preventivo",
    priorita: "bassa",
    squadraId: null,
    dataApertura: "2026-04-05",
    dataConsegnaPrevista: "2026-08-01",
    dataChiusura: null,
    note: "Preventivo per sostituzione vetrate uffici piano 3",
    createdAt: new Date("2026-04-05"),
    updatedAt: new Date("2026-04-05"),
  },
  {
    id: 4,
    codice: "COM-2025-048",
    clienteId: 4,
    cliente: "Scuola Elementare Pirandello",
    indirizzo: "Via Maqueda 200",
    citta: "Palermo",
    telefono: "091 333 7890",
    email: "segreteria@scuolapirandello.edu.it",
    stato: "finiture_saldo",
    priorita: "urgente",
    squadraId: 2,
    dataApertura: "2025-11-01",
    dataConsegnaPrevista: "2026-01-15",
    dataChiusura: "2026-01-12",
    note: "Intervento completato con anticipo",
    createdAt: new Date("2025-11-01"),
    updatedAt: new Date("2026-01-12"),
  },
  {
    id: 5,
    codice: "COM-2026-004",
    clienteId: 5,
    cliente: "Residence Blu Mare",
    indirizzo: "Lungomare Cristoforo Colombo 12",
    citta: "Palermo",
    telefono: "091 444 5678",
    email: "direz@blumare.it",
    stato: "produzione",
    priorita: "alta",
    squadraId: 1,
    dataApertura: "2026-03-01",
    dataConsegnaPrevista: "2026-07-15",
    dataChiusura: null,
    note: "120 aperture - scorrevoli e portefinestre fronte mare",
    createdAt: new Date("2026-03-01"),
    updatedAt: new Date("2026-04-08"),
  },
];

let nextId = 6;

export const commesseRouter = router({
  list: publicProcedure
    .input(
      z.object({
        stato: z.string().optional(),
        search: z.string().optional(),
      }).optional()
    )
    .query(({ input }) => {
      let result = [...commesse];
      if (input?.stato) {
        result = result.filter((c) => c.stato === input.stato);
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
        codice: z.string().min(1),
        clienteId: z.number().optional(),
        cliente: z.string().min(1),
        indirizzo: z.string().optional(),
        citta: z.string().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
        priorita: z.enum(["bassa", "media", "alta", "urgente"]).optional(),
        note: z.string().optional(),
        dataConsegnaPrevista: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      const now = new Date();
      const id = nextId++;
      const { clienteId: inputClienteId, ...rest } = input;
      const commessa = {
        id,
        clienteId: inputClienteId ?? null,
        ...rest,
        stato: "preventivo" as const,
        priorita: input.priorita ?? "media",
        squadraId: null,
        dataApertura: now.toISOString().split("T")[0],
        dataConsegnaPrevista: input.dataConsegnaPrevista ?? null,
        dataChiusura: null,
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
        indirizzo: z.string().optional(),
        citta: z.string().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
        stato: z.enum(["preventivo", "misure_esecutive", "aggiornamento_contratto", "fatture_pagamento", "da_ordinare", "produzione", "ordini_ultimazione", "attesa_posa", "finiture_saldo", "interventi_regolazioni", "archiviata"]).optional(),
        priorita: z.enum(["bassa", "media", "alta", "urgente"]).optional(),
        squadraId: z.number().nullable().optional(),
        note: z.string().optional(),
        dataConsegnaPrevista: z.string().optional(),
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
});
