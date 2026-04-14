import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";

// ── Types ───────────────────────────────────────────────────────────────────

type DistintaBase = {
  id: number;
  commessaId: number;
  aperturaId: number;
  stato: "bozza" | "validata" | "in_produzione" | "completata";
  componenti: ComponenteBOM[];
  noteValidazione?: string;
  validataDa?: string;
  dataValidazione?: string;
  createdAt: Date;
  updatedAt: Date;
};

type ComponenteBOM = {
  id: number;
  tipo: "profilo" | "vetro" | "ferramenta" | "guarnizione" | "accessorio";
  descrizione: string;
  codiceArticolo?: string;
  fornitoreId?: number;
  quantita: number;
  unitaMisura: string;
  lotto?: string;
  note?: string;
};

type FaseProduzione = {
  id: number;
  commessaId: number;
  aperturaId?: number;
  distinaBaseId: number;
  fase: string;
  ordine: number;
  stato: "da_fare" | "in_corso" | "completata" | "non_conforme";
  operatore?: string;
  dataInizio?: string;
  dataFine?: string;
  checklistItems: ChecklistProdItem[];
  note?: string;
  createdAt: Date;
  updatedAt: Date;
};

type ChecklistProdItem = {
  id: number;
  descrizione: string;
  obbligatorio: boolean;
  completato: boolean;
  esito?: "ok" | "non_conforme";
  note?: string;
};

type NonConformita = {
  id: number;
  commessaId: number;
  aperturaId?: number;
  faseProduzioneId?: number;
  tipo: "materiale_difettoso" | "errore_taglio" | "errore_assemblaggio" | "vetro_rotto" | "ferramenta_errata" | "altro";
  gravita: "lieve" | "media" | "grave" | "bloccante";
  descrizione: string;
  azioneCorrettiva?: string;
  stato: "aperta" | "in_gestione" | "risolta" | "chiusa";
  segnalataDa: string;
  dataApertura: string;
  dataChiusura?: string;
  createdAt: Date;
  updatedAt: Date;
};

// ── In-memory data ──────────────────────────────────────────────────────────

let nextBomId = 1;
let nextFaseId = 1;
let nextNcId = 1;
let nextCompId = 1;
let nextCheckId = 1;

const _distinteStore = persistedStore<DistintaBase>("produzione_distinte", (loaded) => {
  nextBomId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
  let maxComp = 0;
  for (const d of loaded) {
    for (const c of (d as any).componenti ?? []) {
      if (c.id > maxComp) maxComp = c.id;
    }
  }
  nextCompId = maxComp + 1;
});
const distinteBasi = _distinteStore.items;

const _fasiStore = persistedStore<FaseProduzione>("produzione_fasi", (loaded) => {
  nextFaseId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
  let maxCheck = 0;
  for (const f of loaded) {
    for (const c of (f as any).checklistItems ?? []) {
      if (c.id > maxCheck) maxCheck = c.id;
    }
  }
  nextCheckId = maxCheck + 1;
});
const fasiProduzione = _fasiStore.items;

const _ncStore = persistedStore<NonConformita>("produzione_nc", (loaded) => {
  nextNcId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
});
const nonConformita = _ncStore.items;

// ── Router ──────────────────────────────────────────────────────────────────

export const produzioneRouter = router({
  // ── Distinte Base ─────────────────────────────────────────────────────
  bom: router({
    list: publicProcedure
      .input(z.object({ commessaId: z.number().optional(), stato: z.string().optional() }).optional())
      .query(({ input }) => {
        let result = [...distinteBasi];
        if (input?.commessaId) result = result.filter((d) => d.commessaId === input.commessaId);
        if (input?.stato) result = result.filter((d) => d.stato === input.stato);
        return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }),

    byId: publicProcedure.input(z.number()).query(({ input }) => {
      return distinteBasi.find((d) => d.id === input) ?? null;
    }),

    create: publicProcedure
      .input(
        z.object({
          commessaId: z.number(),
          aperturaId: z.number(),
          componenti: z.array(
            z.object({
              tipo: z.enum(["profilo", "vetro", "ferramenta", "guarnizione", "accessorio"]),
              descrizione: z.string().min(1),
              codiceArticolo: z.string().optional(),
              fornitoreId: z.number().optional(),
              quantita: z.number(),
              unitaMisura: z.string(),
              note: z.string().optional(),
            })
          ),
        })
      )
      .mutation(({ input }) => {
        const now = new Date();
        const bom: DistintaBase = {
          id: nextBomId++,
          commessaId: input.commessaId,
          aperturaId: input.aperturaId,
          stato: "bozza",
          componenti: input.componenti.map((c) => ({ id: nextCompId++, ...c })),
          createdAt: now,
          updatedAt: now,
        };
        distinteBasi.push(bom);
        _distinteStore.save();
        return bom;
      }),

    validate: publicProcedure
      .input(
        z.object({
          id: z.number(),
          validataDa: z.string(),
          noteValidazione: z.string().optional(),
        })
      )
      .mutation(({ input }) => {
        const idx = distinteBasi.findIndex((d) => d.id === input.id);
        if (idx === -1) throw new Error("Distinta base non trovata");
        if (distinteBasi[idx].stato !== "bozza") throw new Error("Solo le distinte in bozza possono essere validate");
        distinteBasi[idx].stato = "validata";
        distinteBasi[idx].validataDa = input.validataDa;
        distinteBasi[idx].noteValidazione = input.noteValidazione;
        distinteBasi[idx].dataValidazione = new Date().toISOString().split("T")[0];
        distinteBasi[idx].updatedAt = new Date();
        _distinteStore.save();
        return distinteBasi[idx];
      }),

    updateStato: publicProcedure
      .input(z.object({ id: z.number(), stato: z.enum(["bozza", "validata", "in_produzione", "completata"]) }))
      .mutation(({ input }) => {
        const idx = distinteBasi.findIndex((d) => d.id === input.id);
        if (idx === -1) throw new Error("Distinta base non trovata");
        distinteBasi[idx].stato = input.stato;
        distinteBasi[idx].updatedAt = new Date();
        _distinteStore.save();
        return distinteBasi[idx];
      }),

    delete: publicProcedure.input(z.number()).mutation(({ input }) => {
      const idx = distinteBasi.findIndex((d) => d.id === input);
      if (idx === -1) throw new Error("Distinta base non trovata");
      distinteBasi.splice(idx, 1);
      _distinteStore.save();
      return { success: true };
    }),

    stats: publicProcedure.input(z.object({ commessaId: z.number().optional() }).optional()).query(({ input }) => {
      let boms = [...distinteBasi];
      if (input?.commessaId) boms = boms.filter((d) => d.commessaId === input.commessaId);
      return {
        totale: boms.length,
        bozza: boms.filter((d) => d.stato === "bozza").length,
        validate: boms.filter((d) => d.stato === "validata").length,
        inProduzione: boms.filter((d) => d.stato === "in_produzione").length,
        completate: boms.filter((d) => d.stato === "completata").length,
      };
    }),
  }),

  // ── Fasi Produzione ───────────────────────────────────────────────────
  fasi: router({
    list: publicProcedure
      .input(z.object({ commessaId: z.number().optional(), distinaBaseId: z.number().optional() }).optional())
      .query(({ input }) => {
        let result = [...fasiProduzione];
        if (input?.commessaId) result = result.filter((f) => f.commessaId === input.commessaId);
        if (input?.distinaBaseId) result = result.filter((f) => f.distinaBaseId === input.distinaBaseId);
        return result.sort((a, b) => a.ordine - b.ordine);
      }),

    updateStato: publicProcedure
      .input(
        z.object({
          id: z.number(),
          stato: z.enum(["da_fare", "in_corso", "completata", "non_conforme"]),
          operatore: z.string().optional(),
          note: z.string().optional(),
        })
      )
      .mutation(({ input }) => {
        const idx = fasiProduzione.findIndex((f) => f.id === input.id);
        if (idx === -1) throw new Error("Fase non trovata");
        fasiProduzione[idx].stato = input.stato;
        if (input.operatore) fasiProduzione[idx].operatore = input.operatore;
        if (input.note) fasiProduzione[idx].note = input.note;
        if (input.stato === "in_corso" && !fasiProduzione[idx].dataInizio) {
          fasiProduzione[idx].dataInizio = new Date().toISOString().split("T")[0];
        }
        if (input.stato === "completata") {
          fasiProduzione[idx].dataFine = new Date().toISOString().split("T")[0];
        }
        fasiProduzione[idx].updatedAt = new Date();
        _fasiStore.save();
        return fasiProduzione[idx];
      }),

    toggleChecklist: publicProcedure
      .input(z.object({ faseId: z.number(), checklistItemId: z.number(), completato: z.boolean(), esito: z.enum(["ok", "non_conforme"]).optional() }))
      .mutation(({ input }) => {
        const faseIdx = fasiProduzione.findIndex((f) => f.id === input.faseId);
        if (faseIdx === -1) throw new Error("Fase non trovata");
        const itemIdx = fasiProduzione[faseIdx].checklistItems.findIndex((c) => c.id === input.checklistItemId);
        if (itemIdx === -1) throw new Error("Checklist item non trovato");
        fasiProduzione[faseIdx].checklistItems[itemIdx].completato = input.completato;
        if (input.esito) fasiProduzione[faseIdx].checklistItems[itemIdx].esito = input.esito;
        fasiProduzione[faseIdx].updatedAt = new Date();
        _fasiStore.save();
        return fasiProduzione[faseIdx];
      }),

    delete: publicProcedure.input(z.number()).mutation(({ input }) => {
      const idx = fasiProduzione.findIndex((f) => f.id === input);
      if (idx === -1) throw new Error("Fase non trovata");
      fasiProduzione.splice(idx, 1);
      _fasiStore.save();
      return { success: true };
    }),

    stats: publicProcedure.input(z.object({ commessaId: z.number().optional() }).optional()).query(({ input }) => {
      let fasi = [...fasiProduzione];
      if (input?.commessaId) fasi = fasi.filter((f) => f.commessaId === input.commessaId);
      return {
        totale: fasi.length,
        daFare: fasi.filter((f) => f.stato === "da_fare").length,
        inCorso: fasi.filter((f) => f.stato === "in_corso").length,
        completate: fasi.filter((f) => f.stato === "completata").length,
        nonConformi: fasi.filter((f) => f.stato === "non_conforme").length,
      };
    }),
  }),

  // ── Non Conformita ────────────────────────────────────────────────────
  nc: router({
    list: publicProcedure
      .input(z.object({ commessaId: z.number().optional(), stato: z.string().optional() }).optional())
      .query(({ input }) => {
        let result = [...nonConformita];
        if (input?.commessaId) result = result.filter((n) => n.commessaId === input.commessaId);
        if (input?.stato) result = result.filter((n) => n.stato === input.stato);
        return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }),

    create: publicProcedure
      .input(
        z.object({
          commessaId: z.number(),
          aperturaId: z.number().optional(),
          faseProduzioneId: z.number().optional(),
          tipo: z.enum(["materiale_difettoso", "errore_taglio", "errore_assemblaggio", "vetro_rotto", "ferramenta_errata", "altro"]),
          gravita: z.enum(["lieve", "media", "grave", "bloccante"]),
          descrizione: z.string().min(1),
          segnalataDa: z.string().min(1),
        })
      )
      .mutation(({ input }) => {
        const now = new Date();
        const nc: NonConformita = {
          id: nextNcId++,
          ...input,
          stato: "aperta",
          dataApertura: now.toISOString().split("T")[0],
          createdAt: now,
          updatedAt: now,
        };
        nonConformita.push(nc);
        _ncStore.save();
        return nc;
      }),

    updateStato: publicProcedure
      .input(
        z.object({
          id: z.number(),
          stato: z.enum(["aperta", "in_gestione", "risolta", "chiusa"]),
          azioneCorrettiva: z.string().optional(),
        })
      )
      .mutation(({ input }) => {
        const idx = nonConformita.findIndex((n) => n.id === input.id);
        if (idx === -1) throw new Error("Non conformita non trovata");
        nonConformita[idx].stato = input.stato;
        if (input.azioneCorrettiva) nonConformita[idx].azioneCorrettiva = input.azioneCorrettiva;
        if (input.stato === "chiusa") nonConformita[idx].dataChiusura = new Date().toISOString().split("T")[0];
        nonConformita[idx].updatedAt = new Date();
        _ncStore.save();
        return nonConformita[idx];
      }),

    delete: publicProcedure.input(z.number()).mutation(({ input }) => {
      const idx = nonConformita.findIndex((n) => n.id === input);
      if (idx === -1) throw new Error("Non conformita non trovata");
      nonConformita.splice(idx, 1);
      _ncStore.save();
      return { success: true };
    }),

    stats: publicProcedure.query(() => {
      return {
        totale: nonConformita.length,
        aperte: nonConformita.filter((n) => n.stato === "aperta").length,
        inGestione: nonConformita.filter((n) => n.stato === "in_gestione").length,
        risolte: nonConformita.filter((n) => n.stato === "risolta" || n.stato === "chiusa").length,
        bloccanti: nonConformita.filter((n) => n.gravita === "bloccante" && n.stato !== "chiusa").length,
      };
    }),
  }),
});
