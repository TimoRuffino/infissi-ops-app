export const PROCESS_METRIC_KEYS = [
  "commesse_ferme_10g",
  "commesse_non_assegnate",
  "clienti_senza_contatti",
  "interventi_senza_squadra",
  "merce_in_ritardo",
  "tars_errori_30g",
] as const;

export type ProcessMetricKey = (typeof PROCESS_METRIC_KEYS)[number];

export type ProcessMetricReading = {
  key: ProcessMetricKey;
  label: string;
  value: number;
  denominator: number;
  unit: "count" | "percent";
  desiredDirection: "lower" | "higher";
  caseRefs: Array<{ type: string; id: number }>;
};

export type ProcessExperimentOutcome =
  | "migliorato"
  | "invariato"
  | "peggiorato";

export type CompanyFrame = {
  clienti: {
    attivi: number;
    senzaTelefonoOEmail: number;
    nonAssegnati: number;
  };
  commesse: {
    attive: number;
    nonAssegnate: number;
    ferme: Array<{ id: number }>;
  };
  operativita: {
    interventiDaPresidiare: Array<{ id: number }>;
    merceInRitardo: Array<{ id: number }>;
  };
  tars: {
    esecuzioni30Giorni: number;
    errori30Giorni: number;
  };
};

function refs(type: string, values: Array<{ id: number }>) {
  return values
    .slice(0, 20)
    .map(value => ({ type, id: Number(value.id) }));
}

export function extractProcessMetrics(
  frame: CompanyFrame
): ProcessMetricReading[] {
  const executions = Math.max(0, Number(frame.tars.esecuzioni30Giorni) || 0);
  const errors = Math.max(0, Number(frame.tars.errori30Giorni) || 0);
  return [
    {
      key: "commesse_ferme_10g",
      label: "Commesse ferme oltre 10 giorni",
      value: frame.commesse.ferme.length,
      denominator: Math.max(0, frame.commesse.attive),
      unit: "count",
      desiredDirection: "lower",
      caseRefs: refs("commessa", frame.commesse.ferme),
    },
    {
      key: "commesse_non_assegnate",
      label: "Commesse senza assegnatario",
      value: Math.max(0, frame.commesse.nonAssegnate),
      denominator: Math.max(0, frame.commesse.attive),
      unit: "count",
      desiredDirection: "lower",
      caseRefs: [],
    },
    {
      key: "clienti_senza_contatti",
      label: "Clienti senza telefono o email",
      value: Math.max(0, frame.clienti.senzaTelefonoOEmail),
      denominator: Math.max(0, frame.clienti.attivi),
      unit: "count",
      desiredDirection: "lower",
      caseRefs: [],
    },
    {
      key: "interventi_senza_squadra",
      label: "Interventi pianificati senza squadra",
      value: frame.operativita.interventiDaPresidiare.length,
      denominator: frame.operativita.interventiDaPresidiare.length,
      unit: "count",
      desiredDirection: "lower",
      caseRefs: refs("intervento", frame.operativita.interventiDaPresidiare),
    },
    {
      key: "merce_in_ritardo",
      label: "Consegne merce in ritardo",
      value: frame.operativita.merceInRitardo.length,
      denominator: frame.operativita.merceInRitardo.length,
      unit: "count",
      desiredDirection: "lower",
      caseRefs: refs("magazzino", frame.operativita.merceInRitardo),
    },
    {
      key: "tars_errori_30g",
      label: "Esecuzioni Tars in errore negli ultimi 30 giorni",
      value: executions > 0 ? Math.round((errors / executions) * 1_000) / 10 : 0,
      denominator: executions,
      unit: "percent",
      desiredDirection: "lower",
      caseRefs: [],
    },
  ];
}

export function metricImprovement(
  metric: Pick<ProcessMetricReading, "unit" | "desiredDirection">,
  baseline: number,
  current: number
): ProcessExperimentOutcome {
  const tolerance = metric.unit === "percent" ? 1 : 0;
  const delta = current - baseline;
  if (Math.abs(delta) <= tolerance) return "invariato";
  const improved =
    metric.desiredDirection === "lower" ? delta < 0 : delta > 0;
  return improved ? "migliorato" : "peggiorato";
}
