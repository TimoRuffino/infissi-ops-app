import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";

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

let distinteBasi: DistintaBase[] = [
  {
    id: 1,
    commessaId: 1,
    aperturaId: 1,
    stato: "in_produzione",
    componenti: [
      { id: 1, tipo: "profilo", descrizione: "Profilo ASS 77 PD HI - telaio", codiceArticolo: "SCH-ASS77-01", fornitoreId: 1, quantita: 5.4, unitaMisura: "ml", lotto: "L2026-0342" },
      { id: 2, tipo: "profilo", descrizione: "Profilo ASS 77 PD HI - anta", codiceArticolo: "SCH-ASS77-02", fornitoreId: 1, quantita: 4.8, unitaMisura: "ml", lotto: "L2026-0342" },
      { id: 3, tipo: "vetro", descrizione: "Vetrocamera 4/16/4 BE", codiceArticolo: "VS-4164BE", fornitoreId: 2, quantita: 1, unitaMisura: "pz" },
      { id: 4, tipo: "ferramenta", descrizione: "Kit anta-ribalta NT", codiceArticolo: "RF-NT-KIT", fornitoreId: 3, quantita: 1, unitaMisura: "kit" },
      { id: 5, tipo: "guarnizione", descrizione: "Guarnizione EPDM perimetrale", codiceArticolo: "GF-EPDM-01", fornitoreId: 4, quantita: 5.4, unitaMisura: "ml" },
    ],
    noteValidazione: "Misure verificate su rilievo definitivo del 2026-02-15",
    validataDa: "Ing. Marco Ferretti",
    dataValidazione: "2026-02-18",
    createdAt: new Date("2026-02-16"),
    updatedAt: new Date("2026-03-20"),
  },
  {
    id: 2,
    commessaId: 1,
    aperturaId: 2,
    stato: "validata",
    componenti: [
      { id: 6, tipo: "profilo", descrizione: "Profilo ASS 77 PD HI - telaio scorrevole", codiceArticolo: "SCH-ASS77-SC", fornitoreId: 1, quantita: 8.2, unitaMisura: "ml" },
      { id: 7, tipo: "vetro", descrizione: "Vetro stratificato 33.1 satinato", codiceArticolo: "VS-331SAT", fornitoreId: 2, quantita: 2, unitaMisura: "pz" },
      { id: 8, tipo: "ferramenta", descrizione: "Kit scorrevole alzante", codiceArticolo: "RF-SC-ALZ", fornitoreId: 3, quantita: 1, unitaMisura: "kit" },
    ],
    validataDa: "Ing. Marco Ferretti",
    dataValidazione: "2026-02-20",
    createdAt: new Date("2026-02-18"),
    updatedAt: new Date("2026-02-20"),
  },
];

let fasiProduzione: FaseProduzione[] = [
  {
    id: 1,
    commessaId: 1,
    aperturaId: 1,
    distinaBaseId: 1,
    fase: "Taglio profili",
    ordine: 1,
    stato: "completata",
    operatore: "Giuseppe Ferretti",
    dataInizio: "2026-03-18",
    dataFine: "2026-03-18",
    checklistItems: [
      { id: 1, descrizione: "Verifica misure su distinta base", obbligatorio: true, completato: true, esito: "ok" },
      { id: 2, descrizione: "Taglio telaio (45°)", obbligatorio: true, completato: true, esito: "ok" },
      { id: 3, descrizione: "Taglio anta (45°)", obbligatorio: true, completato: true, esito: "ok" },
      { id: 4, descrizione: "Sbavatura e pulizia", obbligatorio: true, completato: true, esito: "ok" },
    ],
    createdAt: new Date("2026-03-18"),
    updatedAt: new Date("2026-03-18"),
  },
  {
    id: 2,
    commessaId: 1,
    aperturaId: 1,
    distinaBaseId: 1,
    fase: "Saldatura / Assemblaggio telaio",
    ordine: 2,
    stato: "completata",
    operatore: "Giuseppe Ferretti",
    dataInizio: "2026-03-19",
    dataFine: "2026-03-19",
    checklistItems: [
      { id: 5, descrizione: "Saldatura angoli telaio", obbligatorio: true, completato: true, esito: "ok" },
      { id: 6, descrizione: "Pulizia cordone saldatura", obbligatorio: true, completato: true, esito: "ok" },
      { id: 7, descrizione: "Verifica squadratura (diagonali)", obbligatorio: true, completato: true, esito: "ok" },
      { id: 8, descrizione: "Montaggio traversi", obbligatorio: false, completato: false },
    ],
    createdAt: new Date("2026-03-19"),
    updatedAt: new Date("2026-03-19"),
  },
  {
    id: 3,
    commessaId: 1,
    aperturaId: 1,
    distinaBaseId: 1,
    fase: "Montaggio ferramenta e guarnizioni",
    ordine: 3,
    stato: "in_corso",
    operatore: "Luca Ferretti",
    dataInizio: "2026-03-20",
    checklistItems: [
      { id: 9, descrizione: "Inserimento guarnizioni telaio", obbligatorio: true, completato: true, esito: "ok" },
      { id: 10, descrizione: "Montaggio cerniere", obbligatorio: true, completato: true, esito: "ok" },
      { id: 11, descrizione: "Montaggio meccanismo anta-ribalta", obbligatorio: true, completato: false },
      { id: 12, descrizione: "Test apertura/chiusura", obbligatorio: true, completato: false },
    ],
    createdAt: new Date("2026-03-20"),
    updatedAt: new Date("2026-03-20"),
  },
  {
    id: 4,
    commessaId: 1,
    aperturaId: 1,
    distinaBaseId: 1,
    fase: "Vetratura e controllo qualita finale",
    ordine: 4,
    stato: "da_fare",
    checklistItems: [
      { id: 13, descrizione: "Inserimento vetrocamera", obbligatorio: true, completato: false },
      { id: 14, descrizione: "Posizionamento tasselli vetro", obbligatorio: true, completato: false },
      { id: 15, descrizione: "Verifica tenuta aria (test pressione)", obbligatorio: true, completato: false },
      { id: 16, descrizione: "Pulizia finale e protezione", obbligatorio: true, completato: false },
      { id: 17, descrizione: "Etichettatura CE e DoP", obbligatorio: true, completato: false },
      { id: 18, descrizione: "Foto prodotto finito", obbligatorio: false, completato: false },
    ],
    createdAt: new Date("2026-03-20"),
    updatedAt: new Date("2026-03-20"),
  },
];

let nonConformita: NonConformita[] = [
  {
    id: 1,
    commessaId: 1,
    aperturaId: 1,
    faseProduzioneId: 2,
    tipo: "errore_taglio",
    gravita: "lieve",
    descrizione: "Traverso tagliato 3mm corto. Recuperato con spessoramento.",
    azioneCorrettiva: "Spessoramento con guarnizione aggiuntiva. Verifica OK post-saldatura.",
    stato: "risolta",
    segnalataDa: "Giuseppe Ferretti",
    dataApertura: "2026-03-19",
    dataChiusura: "2026-03-19",
    createdAt: new Date("2026-03-19"),
    updatedAt: new Date("2026-03-19"),
  },
];

let nextBomId = 3;
let nextFaseId = 5;
let nextNcId = 2;
let nextCompId = 20;
let nextCheckId = 20;

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
        return distinteBasi[idx];
      }),

    updateStato: publicProcedure
      .input(z.object({ id: z.number(), stato: z.enum(["bozza", "validata", "in_produzione", "completata"]) }))
      .mutation(({ input }) => {
        const idx = distinteBasi.findIndex((d) => d.id === input.id);
        if (idx === -1) throw new Error("Distinta base non trovata");
        distinteBasi[idx].stato = input.stato;
        distinteBasi[idx].updatedAt = new Date();
        return distinteBasi[idx];
      }),

    delete: publicProcedure.input(z.number()).mutation(({ input }) => {
      const idx = distinteBasi.findIndex((d) => d.id === input);
      if (idx === -1) throw new Error("Distinta base non trovata");
      distinteBasi.splice(idx, 1);
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
        return fasiProduzione[faseIdx];
      }),

    delete: publicProcedure.input(z.number()).mutation(({ input }) => {
      const idx = fasiProduzione.findIndex((f) => f.id === input);
      if (idx === -1) throw new Error("Fase non trovata");
      fasiProduzione.splice(idx, 1);
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
        return nonConformita[idx];
      }),

    delete: publicProcedure.input(z.number()).mutation(({ input }) => {
      const idx = nonConformita.findIndex((n) => n.id === input);
      if (idx === -1) throw new Error("Non conformita non trovata");
      nonConformita.splice(idx, 1);
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
