import { describe, expect, it } from "vitest";
import {
  extractProcessMetrics,
  metricImprovement,
  type CompanyFrame,
} from "./processMetrics";

const frame: CompanyFrame = {
  clienti: {
    attivi: 50,
    senzaTelefonoOEmail: 4,
    nonAssegnati: 3,
  },
  commesse: {
    attive: 23,
    nonAssegnate: 2,
    ferme: [{ id: 7 }, { id: 9 }],
  },
  operativita: {
    interventiDaPresidiare: [{ id: 31 }, { id: 32 }, { id: 33 }],
    merceInRitardo: [{ id: 41 }],
  },
  tars: {
    esecuzioni30Giorni: 20,
    errori30Giorni: 2,
  },
};

describe("process metrics", () => {
  it("estrae metriche, denominatori e casi senza dati personali", () => {
    const metrics = extractProcessMetrics(frame);
    expect(metrics.find(item => item.key === "commesse_ferme_10g")).toEqual({
      key: "commesse_ferme_10g",
      label: "Commesse ferme oltre 10 giorni",
      value: 2,
      denominator: 23,
      unit: "count",
      desiredDirection: "lower",
      caseRefs: [
        { type: "commessa", id: 7 },
        { type: "commessa", id: 9 },
      ],
    });
    expect(metrics.find(item => item.key === "tars_errori_30g")).toMatchObject({
      value: 10,
      denominator: 20,
      unit: "percent",
    });
  });

  it("classifica il risultato nella direzione desiderata", () => {
    const countMetric = extractProcessMetrics(frame).find(
      item => item.key === "commesse_ferme_10g"
    )!;
    expect(metricImprovement(countMetric, 8, 3)).toBe("migliorato");
    expect(metricImprovement(countMetric, 8, 8)).toBe("invariato");
    expect(metricImprovement(countMetric, 8, 10)).toBe("peggiorato");

    const percentMetric = extractProcessMetrics(frame).find(
      item => item.key === "tars_errori_30g"
    )!;
    expect(metricImprovement(percentMetric, 10, 9.4)).toBe("invariato");
    expect(metricImprovement(percentMetric, 10, 8.9)).toBe("migliorato");
  });
});
