import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { persistedStore } from "../_core/persistence";
import {
  advanceCommesseFromTimeline,
  getCommessaById,
  STATI_COMMESSA,
  type StatoCommessa,
} from "./commesse";

// Cross-sede guard: timeline steps belong to a commessa; only visible/mutable
// when that commessa is in the active sede.
function commessaInSede(commessaId: number, sedeId: number | null) {
  const c = getCommessaById(commessaId);
  if (!c) return null;
  if (sedeId != null && (c as any).sedeId !== sedeId) return null;
  return c;
}

// ── 17-step order timeline ────────────────────────────────────────────────────
const STEP_LABELS: string[] = [
  "Rilievo Misure",
  "Firma Contratto (allegato)",
  "Fatturazione",
  // "Invio Fattura al Cliente" rimosso su richiesta: emettere la fattura
  // significa già mandarla, e lo step restava aperto per sempre.
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
  // "Fine Lavori \u2014 DDT Finale" rimosso su richiesta.
  "Recensione del Cliente",
];

// Completing these operational milestones advances the commessa by one board
// column. Intermediate timeline steps remain useful as a checklist but do not
// alter the workflow state.
const STATO_PER_MILESTONE: Partial<Record<number, (typeof STATI_COMMESSA)[number]>> = {
  1: "misure_esecutive",
  2: "aggiornamento_contratto",
  3: "fatture_pagamento",
  4: "da_ordinare",
  5: "produzione",
  9: "ordini_ultimazione",
  10: "attesa_posa",
  14: "finiture_saldo",
  16: "interventi_regolazioni",
  17: "archiviata",
};

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

// Step ritirati dopo essere già finiti nelle timeline salvate. Il nome è
// l'unico appiglio rimasto per riconoscerli, quindi resta qui: le righe
// vanno tolte dallo store al bootstrap, non solo dalla lista dei nuovi.
const STEP_RITIRATI: RegExp[] = [
  // Duplicava il DDT di posa.
  /DDT\s*Finale/i,
  // Emettere la fattura significa già mandarla (richiesta del 02/09/2026).
  /^\s*Invio Fattura al Cliente\s*$/i,
];

/**
 * Toglie dalle timeline già salvate gli step ritirati e rinumera 1..n gli
 * step di ogni commessa, così non restano buchi fra un passo e l'altro.
 *
 * Idempotente: su uno store già ripulito non tocca niente e risponde
 * `false`, altrimenti ogni avvio riscriverebbe l'intero blob.
 */
export function migraStepRitirati(caricati: TimelineStep[]): boolean {
  let rimosso = false;
  for (let i = caricati.length - 1; i >= 0; i--) {
    const label = caricati[i].label ?? "";
    if (STEP_RITIRATI.some((ritirato) => ritirato.test(label))) {
      caricati.splice(i, 1);
      rimosso = true;
    }
  }
  if (!rimosso) return false;

  const perCommessa = new Map<number, TimelineStep[]>();
  for (const step of caricati) {
    const arr = perCommessa.get(step.commessaId);
    if (arr) arr.push(step);
    else perCommessa.set(step.commessaId, [step]);
  }
  perCommessa.forEach((arr) => {
    arr.sort((a, b) => a.stepNumber - b.stepNumber);
    arr.forEach((step, idx) => (step.stepNumber = idx + 1));
  });
  return true;
}

// In-memory store (replace with Drizzle queries when DB is available)
let nextId = 1;
const _stepsStore = persistedStore<TimelineStep>("timeline_steps", (loaded) => {
  if (migraStepRitirati(loaded)) setTimeout(() => _stepsStore.save(), 0);
  nextId = loaded.length ? Math.max(...loaded.map((x: any) => x.id)) + 1 : 1;
});
const steps = _stepsStore.items;

/**
 * Gli step della timeline di una commessa: servono a capire quando la
 * commessa ha visto l'ultimo fatto reale (`updatedAt` viene riscritto in
 * blocco dai lavori di fondo e non dice più niente — 03/09/2026).
 */
export function stepsDiCommessa(commessaId: number): {
  dataCompletamento: string | null;
  stato: string;
}[] {
  return steps
    .filter(s => s.commessaId === commessaId)
    .map(s => ({ dataCompletamento: s.dataCompletamento, stato: s.stato }));
}

export function reconcileTimelineBoardStates(): {
  analizzate: number;
  aggiornate: number;
} {
  const targets = new Map<number, StatoCommessa>();

  for (const step of steps) {
    if (step.stato !== "completato") continue;
    const target = STATO_PER_MILESTONE[step.stepNumber];
    if (!target) continue;
    const previous = targets.get(step.commessaId);
    if (
      !previous ||
      STATI_COMMESSA.indexOf(target) > STATI_COMMESSA.indexOf(previous)
    ) {
      targets.set(step.commessaId, target);
    }
  }

  return {
    analizzate: targets.size,
    aggiornate: advanceCommesseFromTimeline(targets),
  };
}

/**
 * L'altra metà del collegamento timeline ↔ board.
 *
 * `reconcileTimelineBoardStates` porta avanti la board quando la timeline
 * avanza; questa porta avanti la TIMELINE quando avanza la board. Senza,
 * chi lavora dal Kanban lasciava indietro una timeline piena di step aperti
 * che nessuno avrebbe più chiuso, e la percentuale di avanzamento mentiva.
 *
 * Solo in avanti: una commessa arretrata di un passo non riapre gli step:
 * il lavoro è stato fatto davvero, e riaprirlo cancellerebbe date e note di
 * chi l'ha completato.
 */
export function allineaTimelineAlBoard(
  commessaId: number,
  stato: string,
  utente?: string | null
): number {
  const indiceStato = STATI_COMMESSA.indexOf(stato as StatoCommessa);
  if (indiceStato < 0) return 0;

  const suoi = steps.filter(step => step.commessaId === commessaId);
  // Nessuna timeline ancora materializzata: la creerà `byCommessa` con gli
  // step giusti, e a quel punto questa funzione la troverà.
  if (suoi.length === 0) return 0;

  const oggi = new Date().toISOString().split("T")[0];
  let completati = 0;
  for (const step of suoi) {
    if (step.stato === "completato") continue;
    const traguardo = STATO_PER_MILESTONE[step.stepNumber];
    if (!traguardo) continue;
    // La milestone è "raggiunta" quando la board ha superato o toccato lo
    // stato che quella milestone rappresenta.
    if (STATI_COMMESSA.indexOf(traguardo) > indiceStato) continue;
    step.stato = "completato";
    step.dataCompletamento = step.dataCompletamento ?? oggi;
    step.utente = step.utente ?? utente ?? null;
    completati++;
  }
  if (completati > 0) _stepsStore.save();
  return completati;
}

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
        force: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const idx = steps.findIndex((s) => s.id === input.id);
      if (idx === -1) throw new Error("Step non trovato");
      const commessa = commessaInSede(steps[idx].commessaId, ctx.sedeId);
      if (!commessa) {
        throw new Error("Step non trovato");
      }

      const targetStato = STATO_PER_MILESTONE[steps[idx].stepNumber];
      const isNewCompletion =
        input.stato === "completato" && steps[idx].stato !== "completato";

      if (isNewCompletion && targetStato) {
        const currentIdx = STATI_COMMESSA.indexOf(commessa.stato as any);
        const targetIdx = STATI_COMMESSA.indexOf(targetStato);

        // A timeline reopened after the board has already advanced must not
        // pull the commessa backwards. If the board is behind, its own update
        // mutation enforces one-step transitions, permissions and file gates.
        if (currentIdx < targetIdx) {
          const { appRouter } = await import("../routers");
          await appRouter.createCaller(ctx).commesse.update({
            id: commessa.id,
            stato: targetStato,
            force: input.force,
          });
        }
      }

      const { id, force: _force, ...updates } = input;
      void _force;
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
