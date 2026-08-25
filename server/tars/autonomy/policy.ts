export type AutonomyEvidence = {
  capability: string;
  whitelistedCapabilities: string[];
  enabledByDirection: boolean;
  featureEnabled: boolean;
  evalReportId: string | null;
  sampleSize: number;
  accuracy: number;
  observedFrom: Date;
  observedTo: Date;
  modelVersion: string;
  promptVersion: string;
  workflowVersion: string;
  currentModelVersion: string;
  currentPromptVersion: string;
  currentWorkflowVersion: string;
  riskClass: "low" | "medium" | "high";
  irreversible: boolean;
  undoAvailable: boolean;
  systemPrincipalMinimal: boolean;
  incidents: number;
  killSwitchActive: boolean;
  now: Date;
};

export type AutonomyGateResult = {
  allowed: boolean;
  reasons: string[];
  expiresAt: Date | null;
  status: "non_qualificata" | "in_osservazione" | "qualificata" | "revocata";
};

const MIN_OBSERVATION_MS = 42 * 86_400_000;
const QUALIFICATION_TTL_MS = 30 * 86_400_000;

export function evaluateAutonomyGate(
  input: AutonomyEvidence
): AutonomyGateResult {
  const reasons: string[] = [];
  if (input.killSwitchActive) reasons.push("kill switch attivo");
  if (!input.whitelistedCapabilities.includes(input.capability)) {
    reasons.push("capability fuori whitelist");
  }
  if (!input.enabledByDirection) reasons.push("abilitazione direzione assente");
  if (!input.featureEnabled) reasons.push("feature flag disattivata");
  if (!input.evalReportId) reasons.push("report eval allegato assente");
  if (input.sampleSize < 100) reasons.push("servono almeno 100 esiti");
  if (input.accuracy < 0.98) reasons.push("accuratezza inferiore al 98%");
  if (
    input.observedTo.getTime() - input.observedFrom.getTime() <
    MIN_OBSERVATION_MS
  ) {
    reasons.push("osservazione inferiore a 6 settimane");
  }
  if (input.modelVersion !== input.currentModelVersion) {
    reasons.push("versione modello cambiata");
  }
  if (input.promptVersion !== input.currentPromptVersion) {
    reasons.push("versione prompt cambiata");
  }
  if (input.workflowVersion !== input.currentWorkflowVersion) {
    reasons.push("versione workflow cambiata");
  }
  if (input.riskClass === "high") reasons.push("capability a rischio alto");
  if (input.irreversible) reasons.push("azione irreversibile");
  if (!input.undoAvailable) reasons.push("undo non disponibile");
  if (!input.systemPrincipalMinimal)
    reasons.push("principal di sistema non minimo");
  if (input.incidents > 0) reasons.push("incidenti presenti");

  const allowed = reasons.length === 0;
  const revoked = reasons.some(reason =>
    /kill switch|versione|incidenti/.test(reason)
  );
  return {
    allowed,
    reasons,
    expiresAt: allowed
      ? new Date(input.now.getTime() + QUALIFICATION_TTL_MS)
      : null,
    status: allowed
      ? "qualificata"
      : revoked
        ? "revocata"
        : input.sampleSize > 0
          ? "in_osservazione"
          : "non_qualificata",
  };
}
