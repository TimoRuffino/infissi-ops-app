import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";

let aperture: any[] = [
  { id: 1, commessaId: 1, codice: "A1-F01", descrizione: "Finestra soggiorno", piano: "1", locale: "Soggiorno", tipologia: "finestra", larghezza: "120.00", altezza: "140.00", profondita: null, materiale: "PVC", colore: "Bianco", vetro: "Doppio vetro 4/16/4", stato: "posata", noteRilievo: "Tapparella esistente da rimuovere", criticitaAccesso: null, createdAt: new Date("2026-02-15"), updatedAt: new Date("2026-04-01") },
  { id: 2, commessaId: 1, codice: "A1-F02", descrizione: "Portafinestra balcone", piano: "1", locale: "Camera", tipologia: "portafinestra", larghezza: "90.00", altezza: "220.00", profondita: null, materiale: "PVC", colore: "Bianco", vetro: "Doppio vetro 4/16/4", stato: "in_posa", noteRilievo: "Soglia da adeguare", criticitaAccesso: "Passaggio stretto nel corridoio", createdAt: new Date("2026-02-15"), updatedAt: new Date("2026-03-28") },
  { id: 3, commessaId: 1, codice: "A1-F03", descrizione: "Finestra cucina", piano: "1", locale: "Cucina", tipologia: "finestra", larghezza: "80.00", altezza: "120.00", profondita: null, materiale: "PVC", colore: "Bianco", vetro: "Doppio vetro 4/16/4", stato: "consegnata", noteRilievo: null, criticitaAccesso: null, createdAt: new Date("2026-02-15"), updatedAt: new Date("2026-03-15") },
  { id: 4, commessaId: 2, codice: "VF-F01", descrizione: "Vetrata salone", piano: "PT", locale: "Salone", tipologia: "scorrevole", larghezza: "300.00", altezza: "260.00", profondita: null, materiale: "Alluminio", colore: "Antracite RAL 7016", vetro: "Triplo vetro basso-emissivo", stato: "da_rilevare", noteRilievo: null, criticitaAccesso: "Accesso giardino con pendenza", createdAt: new Date("2026-03-22"), updatedAt: new Date("2026-03-22") },
  { id: 5, commessaId: 2, codice: "VF-F02", descrizione: "Finestra studio", piano: "1", locale: "Studio", tipologia: "finestra", larghezza: "140.00", altezza: "160.00", profondita: null, materiale: "Alluminio", colore: "Antracite RAL 7016", vetro: "Triplo vetro basso-emissivo", stato: "da_rilevare", noteRilievo: null, criticitaAccesso: null, createdAt: new Date("2026-03-22"), updatedAt: new Date("2026-03-22") },
  { id: 6, commessaId: 5, codice: "BM-S01", descrizione: "Scorrevole panoramico", piano: "3", locale: "Suite", tipologia: "scorrevole", larghezza: "400.00", altezza: "280.00", profondita: null, materiale: "Alluminio", colore: "Bianco RAL 9010", vetro: "Doppio vetro selettivo", stato: "rilevata", noteRilievo: "Scorrevole a 4 ante, predisposizione motorizzazione", criticitaAccesso: "Solo montacarichi", createdAt: new Date("2026-03-10"), updatedAt: new Date("2026-03-25") },
];

let nextId = 7;

export const apertureRouter = router({
  byCommessa: publicProcedure.input(z.number()).query(({ input }) => {
    return aperture
      .filter((a) => a.commessaId === input)
      .sort((a, b) => a.codice.localeCompare(b.codice));
  }),

  byId: publicProcedure.input(z.number()).query(({ input }) => {
    return aperture.find((a) => a.id === input) ?? null;
  }),

  create: publicProcedure
    .input(
      z.object({
        commessaId: z.number(),
        codice: z.string().min(1),
        descrizione: z.string().optional(),
        piano: z.string().optional(),
        locale: z.string().optional(),
        tipologia: z.enum(["finestra", "portafinestra", "porta", "scorrevole", "fisso", "altro"]),
        larghezza: z.string().optional(),
        altezza: z.string().optional(),
        profondita: z.string().optional(),
        materiale: z.string().optional(),
        colore: z.string().optional(),
        vetro: z.string().optional(),
        noteRilievo: z.string().optional(),
        criticitaAccesso: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      const now = new Date();
      const apertura = {
        id: nextId++,
        ...input,
        stato: "da_rilevare" as const,
        createdAt: now,
        updatedAt: now,
      };
      aperture.push(apertura);
      return apertura;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        descrizione: z.string().optional(),
        piano: z.string().optional(),
        locale: z.string().optional(),
        tipologia: z.enum(["finestra", "portafinestra", "porta", "scorrevole", "fisso", "altro"]).optional(),
        larghezza: z.string().optional(),
        altezza: z.string().optional(),
        profondita: z.string().optional(),
        materiale: z.string().optional(),
        colore: z.string().optional(),
        vetro: z.string().optional(),
        stato: z.enum(["da_rilevare", "rilevata", "ordinata", "consegnata", "in_posa", "posata", "verificata"]).optional(),
        noteRilievo: z.string().optional(),
        criticitaAccesso: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      const idx = aperture.findIndex((a) => a.id === input.id);
      if (idx === -1) throw new Error("Apertura non trovata");
      const { id, ...updates } = input;
      aperture[idx] = { ...aperture[idx], ...updates, updatedAt: new Date() };
      return aperture[idx];
    }),

  delete: publicProcedure.input(z.number()).mutation(({ input }) => {
    const idx = aperture.findIndex((a) => a.id === input);
    if (idx === -1) throw new Error("Apertura non trovata");
    aperture.splice(idx, 1);
    return { success: true };
  }),
});
