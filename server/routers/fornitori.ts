import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";

// ── Types ───────────────────────────────────────────────────────────────────

type Fornitore = {
  id: number;
  ragioneSociale: string;
  partitaIva: string;
  indirizzo?: string;
  citta?: string;
  telefono?: string;
  email?: string;
  categoria: "pvc" | "alluminio" | "vetro" | "ferramenta" | "persiane" | "blindati" | "accessori" | "guarnizioni" | "altro";
  referenteCommerciale?: string;
  scontistica?: number; // % sconto
  note?: string;
  attivo: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type OrdineFornitore = {
  id: number;
  fornitoreId: number;
  commessaId: number;
  codiceOrdine: string;
  stato: "bozza" | "inviato" | "confermato" | "in_transito" | "ricevuto_parziale" | "ricevuto" | "contestato";
  dataOrdine: string;
  dataConsegnaPrevista?: string;
  dataConsegnaEffettiva?: string;
  righe: RigaOrdine[];
  noteOrdine?: string;
  noteRicevimento?: string;
  importoTotale?: number;
  createdAt: Date;
  updatedAt: Date;
};

type RigaOrdine = {
  id: number;
  descrizione: string;
  codiceArticolo?: string;
  quantita: number;
  quantitaRicevuta: number;
  unitaMisura: string;
  prezzoUnitario?: number;
  lotto?: string;
  conforme?: boolean;
  noteDifetto?: string;
};

// ── In-memory data ──────────────────────────────────────────────────────────

let fornitori: Fornitore[] = [
  {
    id: 1,
    ragioneSociale: "Schüco Italia S.r.l.",
    partitaIva: "01234567891",
    indirizzo: "Via dell'Industria 20",
    citta: "Bologna",
    telefono: "051 600 1234",
    email: "ordini@schuco.it",
    categoria: "alluminio",
    referenteCommerciale: "Paolo Bianchi",
    scontistica: 15,
    note: "Fornitore principale profili alluminio. Lead time 3-4 settimane.",
    attivo: true,
    createdAt: new Date("2025-06-01"),
    updatedAt: new Date("2026-01-15"),
  },
  {
    id: 2,
    ragioneSociale: "Vetro Sud S.p.A.",
    partitaIva: "09876543211",
    indirizzo: "Zona Industriale ASI",
    citta: "Catania",
    telefono: "095 789 0123",
    email: "commerciale@vetrosud.it",
    categoria: "vetro",
    referenteCommerciale: "Maria Greco",
    scontistica: 10,
    note: "Vetri basso-emissivi e stratificati. Consegna 10gg lavorativi.",
    attivo: true,
    createdAt: new Date("2025-08-01"),
    updatedAt: new Date("2026-02-10"),
  },
  {
    id: 3,
    ragioneSociale: "Roto Frank AG",
    partitaIva: "DE123456789",
    indirizzo: "Stuttgarter Str. 145",
    citta: "Leinfelden",
    telefono: "+49 711 7598 0",
    email: "orders@roto-frank.com",
    categoria: "ferramenta",
    referenteCommerciale: "Hans Weber",
    scontistica: 8,
    note: "Ferramenta anta-ribalta, cerniere, maniglie. Ordine minimo €500.",
    attivo: true,
    createdAt: new Date("2025-09-15"),
    updatedAt: new Date("2026-03-01"),
  },
  {
    id: 4,
    ragioneSociale: "Guarniflex S.r.l.",
    partitaIva: "04567890123",
    indirizzo: "Via Artigianato 8",
    citta: "Brescia",
    telefono: "030 222 3344",
    email: "info@guarniflex.it",
    categoria: "guarnizioni",
    note: "Guarnizioni EPDM e TPE per profili Schüco e Reynaers.",
    attivo: true,
    createdAt: new Date("2026-01-10"),
    updatedAt: new Date("2026-01-10"),
  },
];

let ordini: OrdineFornitore[] = [
  {
    id: 1,
    fornitoreId: 1,
    commessaId: 1,
    codiceOrdine: "ORD-2026-001",
    stato: "ricevuto",
    dataOrdine: "2026-02-20",
    dataConsegnaPrevista: "2026-03-15",
    dataConsegnaEffettiva: "2026-03-14",
    righe: [
      { id: 1, descrizione: "Profilo ASS 77 PD HI", codiceArticolo: "SCH-ASS77-01", quantita: 120, quantitaRicevuta: 120, unitaMisura: "ml", prezzoUnitario: 18.50, lotto: "L2026-0342", conforme: true },
      { id: 2, descrizione: "Traverso ASS 77 PD", codiceArticolo: "SCH-ASS77-TR", quantita: 60, quantitaRicevuta: 60, unitaMisura: "ml", prezzoUnitario: 14.20, lotto: "L2026-0342", conforme: true },
    ],
    noteOrdine: "Profili per commessa Condominio Via Roma - Blocco A",
    noteRicevimento: "Consegna anticipata 1gg. Materiale conforme.",
    importoTotale: 3072,
    createdAt: new Date("2026-02-20"),
    updatedAt: new Date("2026-03-14"),
  },
  {
    id: 2,
    fornitoreId: 2,
    commessaId: 1,
    codiceOrdine: "ORD-2026-002",
    stato: "confermato",
    dataOrdine: "2026-03-01",
    dataConsegnaPrevista: "2026-03-20",
    righe: [
      { id: 1, descrizione: "Vetrocamera 4/16/4 BE", codiceArticolo: "VS-4164BE", quantita: 24, quantitaRicevuta: 0, unitaMisura: "pz", prezzoUnitario: 45.00 },
      { id: 2, descrizione: "Vetro stratificato 33.1 satinato", codiceArticolo: "VS-331SAT", quantita: 6, quantitaRicevuta: 0, unitaMisura: "pz", prezzoUnitario: 78.00 },
    ],
    noteOrdine: "Vetri per aperture piano 1 e 2",
    importoTotale: 1548,
    createdAt: new Date("2026-03-01"),
    updatedAt: new Date("2026-03-05"),
  },
  {
    id: 3,
    fornitoreId: 3,
    commessaId: 5,
    codiceOrdine: "ORD-2026-003",
    stato: "in_transito",
    dataOrdine: "2026-03-20",
    dataConsegnaPrevista: "2026-04-10",
    righe: [
      { id: 1, descrizione: "Kit ferramenta anta-ribalta NT", codiceArticolo: "RF-NT-KIT", quantita: 80, quantitaRicevuta: 0, unitaMisura: "kit", prezzoUnitario: 32.00 },
      { id: 2, descrizione: "Maniglia DK Secustik", codiceArticolo: "RF-DK-SEC", quantita: 80, quantitaRicevuta: 0, unitaMisura: "pz", prezzoUnitario: 12.50 },
    ],
    noteOrdine: "Ferramenta per Residence Blu Mare - scorrevoli fronte mare",
    importoTotale: 3560,
    createdAt: new Date("2026-03-20"),
    updatedAt: new Date("2026-03-25"),
  },
];

type Listino = {
  id: number;
  fornitoreId: number;
  nome: string;
  versione: string;
  dataValidita: string;
  nomeFile: string;
  tipo: "pdf" | "excel" | "altro";
  note?: string;
  createdAt: Date;
};

let listini: Listino[] = [
  { id: 1, fornitoreId: 1, nome: "Listino Profili ASS 2026", versione: "v2.1", dataValidita: "2026-01-01", nomeFile: "schuco_listino_2026_v2.1.pdf", tipo: "pdf", note: "Aggiornamento prezzi Q1 2026", createdAt: new Date("2026-01-05") },
  { id: 2, fornitoreId: 1, nome: "Listino Profili ASS 2025", versione: "v1.0", dataValidita: "2025-01-01", nomeFile: "schuco_listino_2025.pdf", tipo: "pdf", createdAt: new Date("2025-01-10") },
  { id: 3, fornitoreId: 2, nome: "Listino Vetri 2026", versione: "v1.0", dataValidita: "2026-03-01", nomeFile: "vetrosud_listino_2026.xlsx", tipo: "excel", note: "Inclusi nuovi vetri selettivi", createdAt: new Date("2026-03-01") },
];
let nextListinoId = 4;

let nextFornitoreId = 5;
let nextOrdineId = 4;
let nextRigaId = 10;

// ── Router ──────────────────────────────────────────────────────────────────

export const fornitoriRouter = router({
  // ── Fornitori CRUD ──────────────────────────────────────────────────────
  list: publicProcedure
    .input(
      z.object({
        search: z.string().optional(),
        categoria: z.string().optional(),
        attivo: z.boolean().optional(),
      }).optional()
    )
    .query(({ input }) => {
      let result = [...fornitori];
      if (input?.categoria) result = result.filter((f) => f.categoria === input.categoria);
      if (input?.attivo !== undefined) result = result.filter((f) => f.attivo === input.attivo);
      if (input?.search) {
        const q = input.search.toLowerCase();
        result = result.filter(
          (f) =>
            f.ragioneSociale.toLowerCase().includes(q) ||
            f.citta?.toLowerCase().includes(q) ||
            f.email?.toLowerCase().includes(q)
        );
      }
      return result.sort((a, b) => a.ragioneSociale.localeCompare(b.ragioneSociale));
    }),

  byId: publicProcedure.input(z.number()).query(({ input }) => {
    return fornitori.find((f) => f.id === input) ?? null;
  }),

  create: publicProcedure
    .input(
      z.object({
        ragioneSociale: z.string().min(1),
        partitaIva: z.string().min(1),
        indirizzo: z.string().optional(),
        citta: z.string().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
        categoria: z.enum(["pvc", "alluminio", "vetro", "ferramenta", "persiane", "blindati", "accessori", "guarnizioni", "altro"]),
        referenteCommerciale: z.string().optional(),
        scontistica: z.number().optional(),
        note: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      const now = new Date();
      const fornitore: Fornitore = {
        id: nextFornitoreId++,
        ...input,
        attivo: true,
        createdAt: now,
        updatedAt: now,
      };
      fornitori.push(fornitore);
      return fornitore;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        ragioneSociale: z.string().optional(),
        partitaIva: z.string().optional(),
        indirizzo: z.string().optional(),
        citta: z.string().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
        categoria: z.enum(["pvc", "alluminio", "vetro", "ferramenta", "persiane", "blindati", "accessori", "guarnizioni", "altro"]).optional(),
        referenteCommerciale: z.string().optional(),
        scontistica: z.number().optional(),
        note: z.string().optional(),
        attivo: z.boolean().optional(),
      })
    )
    .mutation(({ input }) => {
      const idx = fornitori.findIndex((f) => f.id === input.id);
      if (idx === -1) throw new Error("Fornitore non trovato");
      const { id, ...updates } = input;
      fornitori[idx] = { ...fornitori[idx], ...updates, updatedAt: new Date() };
      return fornitori[idx];
    }),

  delete: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = fornitori.findIndex((f) => f.id === input);
    if (idx === -1) throw new Error("Fornitore non trovato");
    fornitori.splice(idx, 1);
    return { success: true };
  }),

  stats: publicProcedure.query(() => {
    const totale = fornitori.filter((f) => f.attivo).length;
    const perCategoria = fornitori.reduce((acc, f) => {
      if (f.attivo) acc[f.categoria] = (acc[f.categoria] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const ordiniAttivi = ordini.filter((o) => !["ricevuto", "contestato"].includes(o.stato)).length;
    const importoPendente = ordini
      .filter((o) => !["ricevuto", "contestato"].includes(o.stato))
      .reduce((sum, o) => sum + (o.importoTotale ?? 0), 0);
    return { totale, perCategoria, ordiniAttivi, importoPendente };
  }),

  // ── Ordini Fornitori ────────────────────────────────────────────────────
  ordini: router({
    list: publicProcedure
      .input(
        z.object({
          fornitoreId: z.number().optional(),
          commessaId: z.number().optional(),
          stato: z.string().optional(),
        }).optional()
      )
      .query(({ input }) => {
        let result = [...ordini];
        if (input?.fornitoreId) result = result.filter((o) => o.fornitoreId === input.fornitoreId);
        if (input?.commessaId) result = result.filter((o) => o.commessaId === input.commessaId);
        if (input?.stato) result = result.filter((o) => o.stato === input.stato);
        // Enrich w/ fornitore name
        return result
          .map((o) => ({
            ...o,
            fornitoreNome: fornitori.find((f) => f.id === o.fornitoreId)?.ragioneSociale ?? "?",
          }))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }),

    byId: publicProcedure.input(z.number()).query(({ input }) => {
      const o = ordini.find((o) => o.id === input);
      if (!o) return null;
      return {
        ...o,
        fornitoreNome: fornitori.find((f) => f.id === o.fornitoreId)?.ragioneSociale ?? "?",
      };
    }),

    create: publicProcedure
      .input(
        z.object({
          fornitoreId: z.number(),
          commessaId: z.number(),
          codiceOrdine: z.string().min(1),
          dataConsegnaPrevista: z.string().optional(),
          righe: z.array(
            z.object({
              descrizione: z.string().min(1),
              codiceArticolo: z.string().optional(),
              quantita: z.number().min(1),
              unitaMisura: z.string(),
              prezzoUnitario: z.number().optional(),
            })
          ),
          noteOrdine: z.string().optional(),
        })
      )
      .mutation(({ input }) => {
        const now = new Date();
        const righe: RigaOrdine[] = input.righe.map((r) => ({
          id: nextRigaId++,
          ...r,
          quantitaRicevuta: 0,
        }));
        const importoTotale = righe.reduce(
          (sum, r) => sum + (r.prezzoUnitario ?? 0) * r.quantita,
          0
        );
        const ordine: OrdineFornitore = {
          id: nextOrdineId++,
          fornitoreId: input.fornitoreId,
          commessaId: input.commessaId,
          codiceOrdine: input.codiceOrdine,
          stato: "bozza",
          dataOrdine: now.toISOString().split("T")[0],
          dataConsegnaPrevista: input.dataConsegnaPrevista,
          righe,
          noteOrdine: input.noteOrdine,
          importoTotale,
          createdAt: now,
          updatedAt: now,
        };
        ordini.push(ordine);
        return ordine;
      }),

    updateStato: publicProcedure
      .input(
        z.object({
          id: z.number(),
          stato: z.enum(["bozza", "inviato", "confermato", "in_transito", "ricevuto_parziale", "ricevuto", "contestato"]),
          noteRicevimento: z.string().optional(),
          dataConsegnaEffettiva: z.string().optional(),
          righeAggiornate: z
            .array(
              z.object({
                id: z.number(),
                quantitaRicevuta: z.number(),
                lotto: z.string().optional(),
                conforme: z.boolean().optional(),
                noteDifetto: z.string().optional(),
              })
            )
            .optional(),
        })
      )
      .mutation(({ input }) => {
        const idx = ordini.findIndex((o) => o.id === input.id);
        if (idx === -1) throw new Error("Ordine non trovato");
        ordini[idx].stato = input.stato;
        ordini[idx].updatedAt = new Date();
        if (input.noteRicevimento) ordini[idx].noteRicevimento = input.noteRicevimento;
        if (input.dataConsegnaEffettiva) ordini[idx].dataConsegnaEffettiva = input.dataConsegnaEffettiva;
        if (input.righeAggiornate) {
          for (const ra of input.righeAggiornate) {
            const rigaIdx = ordini[idx].righe.findIndex((r) => r.id === ra.id);
            if (rigaIdx !== -1) {
              ordini[idx].righe[rigaIdx] = { ...ordini[idx].righe[rigaIdx], ...ra };
            }
          }
        }
        return ordini[idx];
      }),

    delete: publicProcedure.input(z.number()).mutation(({ input }) => {
      const idx = ordini.findIndex((o) => o.id === input);
      if (idx === -1) throw new Error("Ordine non trovato");
      ordini.splice(idx, 1);
      return { success: true };
    }),
  }),

  // ── Listini ──────────────────────────────────────────────────────────────
  listini: router({
    list: publicProcedure
      .input(z.object({ fornitoreId: z.number().optional() }).optional())
      .query(({ input }) => {
        let result = [...listini];
        if (input?.fornitoreId) result = result.filter((l) => l.fornitoreId === input.fornitoreId);
        return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }),

    create: publicProcedure
      .input(z.object({
        fornitoreId: z.number(),
        nome: z.string().min(1),
        versione: z.string().min(1),
        dataValidita: z.string(),
        nomeFile: z.string().min(1),
        tipo: z.enum(["pdf", "excel", "altro"]),
        note: z.string().optional(),
      }))
      .mutation(({ input }) => {
        const listino: Listino = {
          id: nextListinoId++,
          ...input,
          createdAt: new Date(),
        };
        listini.push(listino);
        return listino;
      }),

    delete: publicProcedure.input(z.number()).mutation(({ input }) => {
      const idx = listini.findIndex((l) => l.id === input);
      if (idx === -1) throw new Error("Listino non trovato");
      listini.splice(idx, 1);
      return { success: true };
    }),
  }),
});
