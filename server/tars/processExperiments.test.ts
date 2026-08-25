import { describe, expect, it } from "vitest";
import { extractProcessMetrics, type CompanyFrame } from "./processMetrics";
import {
  createArrayProcessExperimentRepository,
  createMemoryProcessExperimentRepository,
  type ProcessExperiment,
} from "./processExperiments";

const frame: CompanyFrame = {
  clienti: { attivi: 40, senzaTelefonoOEmail: 3, nonAssegnati: 2 },
  commesse: {
    attive: 20,
    nonAssegnate: 2,
    ferme: [{ id: 4 }, { id: 8 }, { id: 12 }],
  },
  operativita: {
    interventiDaPresidiare: [{ id: 21 }, { id: 22 }],
    merceInRitardo: [{ id: 31 }],
  },
  tars: { esecuzioni30Giorni: 10, errori30Giorni: 1 },
};

describe("process experiment repository", () => {
  it("mantiene una fotografia al giorno per sede e conserva lo storico", () => {
    const repository = createMemoryProcessExperimentRepository();
    repository.saveSnapshot(1, extractProcessMetrics(frame), new Date("2026-08-25T08:00:00Z"));
    repository.saveSnapshot(1, extractProcessMetrics({
      ...frame,
      commesse: { ...frame.commesse, ferme: [{ id: 4 }] },
    }), new Date("2026-08-25T18:00:00Z"));
    repository.saveSnapshot(1, extractProcessMetrics(frame), new Date("2026-08-24T08:00:00Z"));
    repository.saveSnapshot(2, extractProcessMetrics(frame), new Date("2026-08-25T08:00:00Z"));

    expect(repository.listSnapshots(1)).toHaveLength(2);
    expect(repository.latestSnapshot(1)?.metrics.find(
      metric => metric.key === "commesse_ferme_10g"
    )?.value).toBe(1);
    expect(repository.listSnapshots(2)).toHaveLength(1);
  });

  it("crea un solo esperimento aperto per proposta e metrica", () => {
    const repository = createMemoryProcessExperimentRepository();
    const input = {
      sedeId: 1,
      proposalId: 91,
      canonicalKey: "processo:1:commesse_ferme_10g",
      metricKey: "commesse_ferme_10g" as const,
      action: "Revisione settimanale delle commesse ferme",
      responsibleUserId: 7,
      baselineValue: 8,
      baselineDenominator: 20,
      targetValue: 4,
      dueAt: new Date("2026-09-15T12:00:00Z"),
      now: new Date("2026-08-25T12:00:00Z"),
    };

    const first = repository.createExperiment(input);
    const retry = repository.createExperiment(input);
    expect(retry.id).toBe(first.id);
    expect(() => repository.createExperiment({
      ...input,
      proposalId: 92,
    })).toThrow(/esperimento.*aperto/i);
  });

  it("registra risultato e collegamento al Centro Azioni", () => {
    const repository = createMemoryProcessExperimentRepository();
    const experiment = repository.createExperiment({
      sedeId: 1,
      proposalId: 101,
      canonicalKey: "processo:1:tars_errori_30g",
      metricKey: "tars_errori_30g",
      action: "Rivedere ogni errore Tars entro il giorno successivo",
      responsibleUserId: 3,
      baselineValue: 10,
      baselineDenominator: 20,
      targetValue: 5,
      dueAt: new Date("2026-09-10T12:00:00Z"),
      now: new Date("2026-08-25T12:00:00Z"),
    });

    repository.attachActionCase(experiment.id, 1, 501);
    const completed = repository.completeExperiment({
      id: experiment.id,
      sedeId: 1,
      measuredValue: 4,
      outcome: "migliorato",
      measuredAt: new Date("2026-09-10T13:00:00Z"),
    });

    expect(completed).toMatchObject({
      actionCaseId: 501,
      status: "valutato",
      measuredValue: 4,
      outcome: "migliorato",
    });
  });

  it("calcola gli id dopo l'idratazione tardiva dello store persistito", () => {
    const snapshots: any[] = [];
    const experiments: ProcessExperiment[] = [];
    const repository = createArrayProcessExperimentRepository(
      snapshots,
      experiments,
      () => {},
      () => {}
    );
    experiments.push({
      id: 99,
      sedeId: 1,
      proposalId: 90,
      actionCaseId: null,
      canonicalKey: "processo:1:merce_in_ritardo",
      metricKey: "merce_in_ritardo",
      action: "Controllo consegne",
      responsibleUserId: 7,
      baselineValue: 4,
      baselineDenominator: 4,
      targetValue: 1,
      dueAt: new Date("2026-09-10T12:00:00Z"),
      status: "valutato",
      outcome: "migliorato",
      measuredValue: 1,
      measuredAt: new Date("2026-09-10T12:00:00Z"),
      createdAt: new Date("2026-08-20T12:00:00Z"),
      updatedAt: new Date("2026-09-10T12:00:00Z"),
    });

    expect(repository.createExperiment({
      sedeId: 1,
      proposalId: 91,
      canonicalKey: "processo:1:commesse_ferme_10g",
      metricKey: "commesse_ferme_10g",
      action: "Revisione settimanale",
      responsibleUserId: 7,
      baselineValue: 8,
      baselineDenominator: 20,
      targetValue: 4,
      dueAt: new Date("2026-09-15T12:00:00Z"),
      now: new Date("2026-08-25T12:00:00Z"),
    }).id).toBe(100);
  });
});
