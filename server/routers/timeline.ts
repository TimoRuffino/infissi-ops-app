import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import { getCommessaById } from "./commesse";

// Cross-sede guard: timeline steps belong to a commessa; only visible/mutable
// when that commessa is in the active sede.
function commessaInSede(commessaId: number, sedeId: number | null) {
  const c = getCommessaById(commessaId);
  if (!c) return null;
  if (sedeId != null && (c as any).sedeId !== sedeId) return null;
  return c;
}

// ── 19-step order timeline ────────────────────────────────────────────────────
const STEP_LABELS: string[] = [
  "Rilievo Misure",
  "Firma Contratto (allegato)",
  "Fatturazione",
  "Invio Fattura al Cliente",
  "Pagamento 1\u00B0 Acconto Cliente",
  "Ordine Merce al Fornitore",
  "Conferma Ordine Fornitore (allegato)",
  "Pagamento Acconto Fornitore",
  "Data Spedizione Prevista Fornitore",
  "Pagamento Merce Pronta Fornitore",
  "Pagamento Secondo Acconto Cliente",
  "Data Consegna Merce",
  "Appuntamento Posa",
  "Lista Merce Posata",
  "DDT Posa (allegato)",
  "Finiture",
  "Pagamento Ultimo Cliente (Saldo)",
  "Fine Lavori \u2014 DDT Finale (allegato + foto)",
  "Recensione del Cliente",
];

type Stato = "da_fare" | "in_corso" | "completato";

interface TimelineStep {
  id: number;
  commessaId: number;
  stepNumber: number;
  label: string;
  stato: Stato;
  dataCompletamento: string | null;
  utente: string | null;
  note: string | null;
  allegato: string | null;
}

// In-memory store (replace with Drizzle queries when DB is available)
let nextId = 1;
const _stepsStore = persistedStore<TimelineStep>("timeline_steps", (loaded) => {
  nextId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
});
const steps = _stepsStore.items;

function createStepsForCommessa(commessaId: number): TimelineStep[] {
  const newSteps: TimelineStep[] = STEP_LABELS.map((label, idx) => ({
    id: nextId++,
    commessaId,
    stepNumber: idx + 1,
    label,
    stato: "da_fare" as Stato,
    dataCompletamento: null,
    utente: null,
    note: null,
    allegato: null,
  }));
  steps.push(...newSteps);
  _stepsStore.save();
  return newSteps;
}

// ── Demo data for commessa 1: first 3 steps completed ────────────────────────
(function seedDemo() {
  const demoSteps = createStepsForCommessa(1);
  demoSteps[0].stato = "completato";
  demoSteps[0].dataCompletamento = "2026-02-12";
  demoSteps[0].utente = "Marco Ferrara";
  demoSteps[0].note = "Misure prese in loco - blocco A";

  demoSteps[1].stato = "completato";
  demoSteps[1].dataCompletamento = "2026-02-18";
  demoSteps[1].utente = "Marco Ferrara";
  demoSteps[1].allegato = "contratto_COM-2026-001.pdf";

  demoSteps[2].stato = "completato";
  demoSteps[2].dataCompletamento = "2026-02-20";
  demoSteps[2].utente = "Anna Russo";
  demoSteps[2].note = "Fattura emessa - importo totale";
})();

export const timelineRouter = router({
  byCommessa: protectedProcedure
    .input(z.number())
    .query(({ input: commessaId, ctx }) => {
      // Don't instantiate or leak another sede's timeline.
      if (!commessaInSede(commessaId, ctx.sedeId)) return [];
      let result = steps.filter((s) => s.commessaId === commessaId);
      if (result.length === 0) {
        result = createStepsForCommessa(commessaId);
      }
      return result.sort((a, b) => a.stepNumber - b.stepNumber);
    }),

  updateStep: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        stato: z.enum(["da_fare", "in_corso", "completato"]).optional(),
        dataCompletamento: z.string().nullable().optional(),
        utente: z.string().nullable().optional(),
        note: z.string().nullable().optional(),
        allegato: z.string().nullable().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const idx = steps.findIndex((s) => s.id === input.id);
      if (idx === -1) throw new Error("Step non trovato");
      if (!commessaInSede(steps[idx].commessaId, ctx.sedeId)) {
        throw new Error("Step non trovato");
      }
      const { id, ...updates } = input;
      steps[idx] = { ...steps[idx], ...updates } as TimelineStep;
      _stepsStore.save();
      return steps[idx];
    }),

  stats: protectedProcedure
    .input(z.number())
    .query(({ input: commessaId, ctx }) => {
      if (!commessaInSede(commessaId, ctx.sedeId)) {
        return { completati: 0, totale: 0, percentuale: 0 };
      }
      let result = steps.filter((s) => s.commessaId === commessaId);
      if (result.length === 0) {
        result = createStepsForCommessa(commessaId);
      }
      const completati = result.filter((s) => s.stato === "completato").length;
      const totale = result.length;
      const percentuale = totale > 0 ? Math.round((completati / totale) * 100) : 0;
      return { completati, totale, percentuale };
    }),
});
