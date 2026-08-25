import { describe, expect, it } from "vitest";
import { createMemoryActionCaseRepository } from "../actionCenter/repository";
import { createMemoryProcessExperimentRepository } from "./processExperiments";
import { reviewDueProcessExperiments } from "./processExperimentReview";

describe("process experiment review", () => {
  it("misura l'esito e risolve il presidio nel Centro Azioni", async () => {
    const experiments = createMemoryProcessExperimentRepository();
    const actions = createMemoryActionCaseRepository();
    const now = new Date("2026-09-15T12:00:00Z");
    const experiment = experiments.createExperiment({
      sedeId: 1,
      proposalId: 81,
      canonicalKey: "processo:1:commesse_ferme_10g",
      metricKey: "commesse_ferme_10g",
      action: "Revisione settimanale",
      responsibleUserId: 7,
      baselineValue: 8,
      baselineDenominator: 20,
      targetValue: 4,
      dueAt: new Date("2026-09-15T10:00:00Z"),
      now: new Date("2026-08-25T12:00:00Z"),
    });
    const action = await actions.upsertDraft(
      {
        canonicalKey: experiment.canonicalKey,
        sedeId: 1,
        targetType: "proposta_tars",
        targetId: 81,
        commessaId: null,
        clienteId: null,
        title: "Riduci commesse ferme",
        priority: "alta",
        priorityScore: 80,
        assigneeUserId: 7,
        dueAt: experiment.dueAt,
        link: "/tars?tab=oggi",
        signals: [],
        signalFingerprint: "fp-1",
        nextAction: {
          sourceKind: "process_experiment",
          label: "Revisione settimanale",
        },
      },
      new Date("2026-08-25T12:00:00Z")
    );
    experiments.attachActionCase(experiment.id, 1, action.record.id);

    const result = await reviewDueProcessExperiments({
      experiments,
      actions,
      now,
      readMetric: async () => ({
        key: "commesse_ferme_10g",
        label: "Commesse ferme oltre 10 giorni",
        value: 3,
        denominator: 20,
        unit: "count",
        desiredDirection: "lower",
        caseRefs: [],
      }),
    });

    expect(result).toEqual({ evaluated: 1, failed: 0 });
    expect(experiments.findOpenExperiment(1, experiment.canonicalKey)).toBeNull();
    expect(await actions.findById(1, action.record.id)).toMatchObject({
      status: "risolta",
    });
    expect(await actions.listEvents(1, action.record.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "esperimento_valutato",
          metadata: expect.objectContaining({
            outcome: "migliorato",
            measuredValue: 3,
          }),
        }),
      ])
    );
  });

  it("lascia aperto l'esperimento se la metrica non è leggibile", async () => {
    const experiments = createMemoryProcessExperimentRepository();
    const actions = createMemoryActionCaseRepository();
    const experiment = experiments.createExperiment({
      sedeId: 2,
      proposalId: 82,
      canonicalKey: "processo:2:merce_in_ritardo",
      metricKey: "merce_in_ritardo",
      action: "Controllo consegne",
      responsibleUserId: 7,
      baselineValue: 4,
      baselineDenominator: 4,
      targetValue: 1,
      dueAt: new Date("2026-09-15T10:00:00Z"),
      now: new Date("2026-08-25T12:00:00Z"),
    });

    const result = await reviewDueProcessExperiments({
      experiments,
      actions,
      now: new Date("2026-09-15T12:00:00Z"),
      readMetric: async () => null,
    });

    expect(result).toEqual({ evaluated: 0, failed: 1 });
    expect(experiments.findOpenExperiment(2, experiment.canonicalKey)).not.toBeNull();
  });
});
