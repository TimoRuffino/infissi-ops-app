import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";

let garanzie: any[] = [
  {
    id: 1,
    commessaId: 4,
    aperturaId: null,
    tipo: "prodotto",
    descrizione: "Garanzia serramenti PVC 10 anni",
    fornitore: "Finstral S.p.A.",
    dataInizio: "2026-01-12",
    dataScadenza: "2036-01-12",
    durataMesi: 120,
    stato: "attiva",
    documentoRif: "GAR-2026-001",
    note: "Copre difetti di fabbricazione e tenuta termica",
    createdAt: new Date("2026-01-12"),
    updatedAt: new Date("2026-01-12"),
  },
  {
    id: 2,
    commessaId: 4,
    aperturaId: null,
    tipo: "posa",
    descrizione: "Garanzia posa in opera 5 anni",
    fornitore: "Ruffino Group",
    dataInizio: "2026-01-12",
    dataScadenza: "2031-01-12",
    durataMesi: 60,
    stato: "attiva",
    documentoRif: "GAR-2026-002",
    note: "Copre difetti di installazione e sigillatura",
    createdAt: new Date("2026-01-12"),
    updatedAt: new Date("2026-01-12"),
  },
  {
    id: 3,
    commessaId: 1,
    aperturaId: null,
    tipo: "prodotto",
    descrizione: "Garanzia vetrocamera 10 anni",
    fornitore: "Guardian Glass",
    dataInizio: "2026-04-09",
    dataScadenza: "2036-04-09",
    durataMesi: 120,
    stato: "attiva",
    documentoRif: "GAR-2026-003",
    note: "Garanzia anti-appannamento e tenuta gas",
    createdAt: new Date("2026-04-09"),
    updatedAt: new Date("2026-04-09"),
  },
  {
    id: 4,
    commessaId: 1,
    aperturaId: null,
    tipo: "accessorio",
    descrizione: "Garanzia ferramenta Roto 5 anni",
    fornitore: "Roto Frank AG",
    dataInizio: "2026-04-09",
    dataScadenza: "2031-04-09",
    durataMesi: 60,
    stato: "attiva",
    documentoRif: "GAR-2026-004",
    note: null,
    createdAt: new Date("2026-04-09"),
    updatedAt: new Date("2026-04-09"),
  },
];

let nextId = 5;

export const garanzieRouter = router({
  list: publicProcedure
    .input(
      z.object({
        commessaId: z.number().optional(),
        stato: z.string().optional(),
        tipo: z.string().optional(),
      }).optional()
    )
    .query(({ input }) => {
      let result = [...garanzie];
      if (input?.commessaId) result = result.filter((g) => g.commessaId === input.commessaId);
      if (input?.stato) result = result.filter((g) => g.stato === input.stato);
      if (input?.tipo) result = result.filter((g) => g.tipo === input.tipo);
      return result.sort((a, b) => a.dataScadenza.localeCompare(b.dataScadenza));
    }),

  create: publicProcedure
    .input(
      z.object({
        commessaId: z.number(),
        aperturaId: z.number().nullable().optional(),
        tipo: z.enum(["prodotto", "posa", "accessorio", "vetro", "altro"]),
        descrizione: z.string().min(1),
        fornitore: z.string().optional(),
        dataInizio: z.string(),
        durataMesi: z.number().min(1),
        documentoRif: z.string().optional(),
        note: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      const now = new Date();
      const start = new Date(input.dataInizio);
      const end = new Date(start);
      end.setMonth(end.getMonth() + input.durataMesi);

      const garanzia = {
        id: nextId++,
        ...input,
        aperturaId: input.aperturaId ?? null,
        dataScadenza: end.toISOString().split("T")[0],
        stato: "attiva" as const,
        createdAt: now,
        updatedAt: now,
      };
      garanzie.push(garanzia);
      return garanzia;
    }),

  update: publicProcedure
    .input(z.object({
      id: z.number(),
      tipo: z.enum(["prodotto", "posa", "accessorio", "vetro", "altro"]).optional(),
      descrizione: z.string().optional(),
      fornitore: z.string().optional(),
      stato: z.enum(["attiva", "scaduta", "sospesa", "revocata"]).optional(),
      documentoRif: z.string().optional(),
      note: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const idx = garanzie.findIndex((g) => g.id === input.id);
      if (idx === -1) throw new Error("Garanzia non trovata");
      const { id, ...updates } = input;
      garanzie[idx] = { ...garanzie[idx], ...updates, updatedAt: new Date() };
      return garanzie[idx];
    }),

  delete: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = garanzie.findIndex((g) => g.id === input);
    if (idx === -1) throw new Error("Garanzia non trovata");
    garanzie.splice(idx, 1);
    return { success: true };
  }),

  stats: publicProcedure.query(() => {
    const today = new Date().toISOString().split("T")[0];
    const in90 = new Date();
    in90.setDate(in90.getDate() + 90);
    const threshold = in90.toISOString().split("T")[0];

    const total = garanzie.length;
    const attive = garanzie.filter((g) => g.stato === "attiva").length;
    const inScadenza = garanzie.filter(
      (g) => g.stato === "attiva" && g.dataScadenza >= today && g.dataScadenza <= threshold
    ).length;
    const scadute = garanzie.filter(
      (g) => g.stato === "attiva" && g.dataScadenza < today
    ).length;
    return { total, attive, inScadenza, scadute };
  }),
});
