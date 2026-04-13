import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";

// --- Reclami (complaints) ---

let reclami: any[] = [
  {
    id: 1,
    commessaId: 4,
    clienteNome: "Scuola Elementare Manzoni",
    descrizione: "Infiltrazione d'acqua dalla finestra del corridoio al primo piano durante pioggia intensa",
    responsabile: "Marco Ruffino",
    stato: "aperto",
    dataApertura: "2026-04-10",
    dataRisoluzione: null,
    soluzione: null,
    createdAt: new Date("2026-04-10"),
    updatedAt: new Date("2026-04-10"),
  },
  {
    id: 2,
    commessaId: 1,
    clienteNome: "Condominio Parco Verde",
    descrizione: "Maniglia portafinestra soggiorno non chiude correttamente, segnalata difficolta' nella rotazione",
    responsabile: "Luca Bianchi",
    stato: "risolto",
    dataApertura: "2026-03-15",
    dataRisoluzione: "2026-03-22",
    soluzione: "Regolata ferramenta e sostituita maniglia difettosa in garanzia",
    createdAt: new Date("2026-03-15"),
    updatedAt: new Date("2026-03-22"),
  },
];

let nextReclamoId = 3;

// --- Rifacimenti (remakes) ---

let rifacimenti: any[] = [
  {
    id: 1,
    commessaId: 4,
    clienteNome: "Scuola Elementare Manzoni",
    descrizione: "Vetro camera aula 3A arrivato con dimensioni errate, necessario rifacimento completo",
    elemento: "Vetrocamera 120x150 basso emissivo",
    fornitoreCoinvolto: "Guardian Glass",
    ordineRifacimentoId: "RIF-2026-001",
    costoStimato: 480.00,
    responsabilita: "esterna",
    responsabile: "Marco Ruffino",
    stato: "in_produzione",
    dataApertura: "2026-04-05",
    dataChiusura: null,
    createdAt: new Date("2026-04-05"),
    updatedAt: new Date("2026-04-08"),
  },
];

let nextRifacimentoId = 2;

// --- Router ---

export const reclamiRifacimentiRouter = router({
  reclami: router({
    list: publicProcedure
      .input(z.object({
        commessaId: z.number().optional(),
        stato: z.string().optional(),
      }).optional())
      .query(({ input }) => {
        let result = [...reclami];
        if (input?.commessaId) result = result.filter((r) => r.commessaId === input.commessaId);
        if (input?.stato) result = result.filter((r) => r.stato === input.stato);
        return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }),

    create: publicProcedure
      .input(z.object({
        commessaId: z.number(),
        clienteNome: z.string().min(1),
        descrizione: z.string().min(1),
        responsabile: z.string().optional(),
      }))
      .mutation(({ input }) => {
        const now = new Date();
        const reclamo = {
          id: nextReclamoId++,
          ...input,
          responsabile: input.responsabile ?? null,
          stato: "aperto" as const,
          dataApertura: now.toISOString().split("T")[0],
          dataRisoluzione: null,
          soluzione: null,
          createdAt: now,
          updatedAt: now,
        };
        reclami.push(reclamo);
        return reclamo;
      }),

    update: publicProcedure
      .input(z.object({
        id: z.number(),
        clienteNome: z.string().optional(),
        descrizione: z.string().optional(),
        responsabile: z.string().optional(),
        stato: z.enum(["aperto", "in_gestione", "risolto", "chiuso"]).optional(),
        soluzione: z.string().optional(),
      }))
      .mutation(({ input }) => {
        const idx = reclami.findIndex((r) => r.id === input.id);
        if (idx === -1) throw new Error("Reclamo non trovato");
        const { id, ...updates } = input;
        if (updates.stato === "risolto" || updates.stato === "chiuso") {
          (updates as any).dataRisoluzione = new Date().toISOString().split("T")[0];
        }
        reclami[idx] = { ...reclami[idx], ...updates, updatedAt: new Date() };
        return reclami[idx];
      }),

    delete: publicProcedure.input(z.number()).mutation(({ input }) => {
      const idx = reclami.findIndex((r) => r.id === input);
      if (idx === -1) throw new Error("Reclamo non trovato");
      reclami.splice(idx, 1);
      return { success: true };
    }),

    stats: publicProcedure.query(() => {
      const aperti = reclami.filter((r) => r.stato === "aperto").length;
      const inGestione = reclami.filter((r) => r.stato === "in_gestione").length;
      const risolti = reclami.filter((r) => r.stato === "risolto").length;
      const chiusi = reclami.filter((r) => r.stato === "chiuso").length;
      return { aperti, inGestione, risolti, chiusi, totale: reclami.length };
    }),
  }),

  rifacimenti: router({
    list: publicProcedure
      .input(z.object({
        commessaId: z.number().optional(),
        stato: z.string().optional(),
        responsabilita: z.enum(["interna", "esterna"]).optional(),
      }).optional())
      .query(({ input }) => {
        let result = [...rifacimenti];
        if (input?.commessaId) result = result.filter((r) => r.commessaId === input.commessaId);
        if (input?.stato) result = result.filter((r) => r.stato === input.stato);
        if (input?.responsabilita) result = result.filter((r) => r.responsabilita === input.responsabilita);
        return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }),

    create: publicProcedure
      .input(z.object({
        commessaId: z.number(),
        clienteNome: z.string().min(1),
        descrizione: z.string().min(1),
        elemento: z.string().min(1),
        fornitoreCoinvolto: z.string().optional(),
        ordineRifacimentoId: z.string().optional(),
        costoStimato: z.number().optional(),
        responsabilita: z.enum(["interna", "esterna"]),
        responsabile: z.string().optional(),
      }))
      .mutation(({ input }) => {
        const now = new Date();
        const rifacimento = {
          id: nextRifacimentoId++,
          ...input,
          fornitoreCoinvolto: input.fornitoreCoinvolto ?? null,
          ordineRifacimentoId: input.ordineRifacimentoId ?? null,
          costoStimato: input.costoStimato ?? null,
          responsabile: input.responsabile ?? null,
          stato: "aperto" as const,
          dataApertura: now.toISOString().split("T")[0],
          dataChiusura: null,
          createdAt: now,
          updatedAt: now,
        };
        rifacimenti.push(rifacimento);
        return rifacimento;
      }),

    update: publicProcedure
      .input(z.object({
        id: z.number(),
        clienteNome: z.string().optional(),
        descrizione: z.string().optional(),
        elemento: z.string().optional(),
        fornitoreCoinvolto: z.string().optional(),
        ordineRifacimentoId: z.string().optional(),
        costoStimato: z.number().optional(),
        responsabilita: z.enum(["interna", "esterna"]).optional(),
        responsabile: z.string().optional(),
        stato: z.enum(["aperto", "in_gestione", "in_produzione", "completato", "chiuso"]).optional(),
      }))
      .mutation(({ input }) => {
        const idx = rifacimenti.findIndex((r) => r.id === input.id);
        if (idx === -1) throw new Error("Rifacimento non trovato");
        const { id, ...updates } = input;
        if (updates.stato === "completato" || updates.stato === "chiuso") {
          (updates as any).dataChiusura = new Date().toISOString().split("T")[0];
        }
        rifacimenti[idx] = { ...rifacimenti[idx], ...updates, updatedAt: new Date() };
        return rifacimenti[idx];
      }),

    delete: publicProcedure.input(z.number()).mutation(({ input }) => {
      const idx = rifacimenti.findIndex((r) => r.id === input);
      if (idx === -1) throw new Error("Rifacimento non trovato");
      rifacimenti.splice(idx, 1);
      return { success: true };
    }),

    stats: publicProcedure.query(() => {
      const aperti = rifacimenti.filter((r) => r.stato === "aperto").length;
      const inGestione = rifacimenti.filter((r) => r.stato === "in_gestione").length;
      const inProduzione = rifacimenti.filter((r) => r.stato === "in_produzione").length;
      const completati = rifacimenti.filter((r) => r.stato === "completato").length;
      const chiusi = rifacimenti.filter((r) => r.stato === "chiuso").length;
      const costoTotaleStimato = rifacimenti
        .filter((r) => r.costoStimato !== null)
        .reduce((sum: number, r: any) => sum + r.costoStimato, 0);
      const interni = rifacimenti.filter((r) => r.responsabilita === "interna").length;
      const esterni = rifacimenti.filter((r) => r.responsabilita === "esterna").length;
      return { aperti, inGestione, inProduzione, completati, chiusi, costoTotaleStimato, interni, esterni, totale: rifacimenti.length };
    }),
  }),
});
