export type TarsAgentStatus =
  | "caricamento"
  | "spento"
  | "disponibile"
  | "degradato";

export type TarsAgentInterruttori = {
  tars?: boolean;
  [nome: string]: boolean | undefined;
};

export type TarsAgentStato = {
  provider?: string | null;
  providerDettaglio?: {
    motivoIndisponibilita?: string | null;
  } | null;
};

export type GateQueryAgente = {
  risolto: boolean;
  tarsAcceso: boolean;
  statoAbilitato: boolean;
  costiAbilitati: boolean;
};

/**
 * The platform gate is intentionally the only prerequisite for Tars queries.
 * A missing response is different from an explicit off switch: in both cases
 * no Tars request should be started.
 */
export function derivaGateQueryAgente(
  interruttori: TarsAgentInterruttori | undefined,
  direzione: boolean
): GateQueryAgente {
  const risolto = interruttori != null && "tars" in interruttori;
  const tarsAcceso = risolto && interruttori.tars === true;
  return {
    risolto,
    tarsAcceso,
    statoAbilitato: tarsAcceso,
    costiAbilitati: tarsAcceso && direzione,
  };
}

export function derivaStatoAgente(input: {
  interruttori: TarsAgentInterruttori | undefined;
  stato: TarsAgentStato | undefined;
  erroreStato: boolean;
  erroreInterruttori?: boolean;
  erroreCosti?: boolean;
}): TarsAgentStatus {
  if (input.erroreInterruttori) return "degradato";
  if (!input.interruttori) return "caricamento";
  const gate = derivaGateQueryAgente(input.interruttori, false);
  if (!gate.risolto) return "caricamento";
  if (!gate.tarsAcceso) return "spento";
  if (input.erroreStato || input.erroreCosti) return "degradato";
  if (!input.stato) return "caricamento";
  if (
    input.stato.provider === "finto" ||
    Boolean(input.stato.providerDettaglio?.motivoIndisponibilita)
  ) {
    return "degradato";
  }
  return "disponibile";
}

const USD_FORMATTER = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formattaCostoUsd(value: number | null | undefined): string {
  return value != null && Number.isFinite(value)
    ? USD_FORMATTER.format(value)
    : "—";
}

/** Returns a clamped percentage, or null when the budget cannot be evaluated. */
export function percentualeBudget(
  spesa: number | null | undefined,
  budget: number | null | undefined
): number | null {
  if (
    spesa == null ||
    budget == null ||
    !Number.isFinite(spesa) ||
    !Number.isFinite(budget) ||
    budget <= 0
  ) {
    return null;
  }
  return Math.min(100, Math.max(0, (spesa / budget) * 100));
}

export function etichettaAmbitoCosti(): string {
  return "Consumi globali · tutte le sedi";
}

export function etichettaStatoAgente(stato: TarsAgentStatus): string {
  switch (stato) {
    case "caricamento":
      return "Caricamento";
    case "spento":
      return "Spento";
    case "disponibile":
      return "Disponibile";
    case "degradato":
      return "Degradato";
  }
}
