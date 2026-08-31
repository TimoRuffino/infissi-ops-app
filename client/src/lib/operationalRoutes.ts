// Matrici pure di gating operativo per le route della slice Modular Control.
//
// Ogni funzione consuma le capability effettive già risolte lato server
// (ReadonlySet<string> da `permessi.mie` via OperationalContext) e produce
// un oggetto di sole booleane. Nessun ruolo, nessun fallback isDirezione,
// nessuna policy: è gating UX puro, il server resta l'autorità.

export type PlanningPermissions = {
  canPlan: boolean;
  canAssign: boolean;
  canDelete: boolean;
};

export function planningPermissions(
  capabilities: ReadonlySet<string> | null
): PlanningPermissions {
  return {
    canPlan: capabilities?.has("intervento.plan") ?? false,
    canAssign: capabilities?.has("intervento.assign") ?? false,
    canDelete: capabilities?.has("intervento.delete") ?? false,
  };
}

export type DeliveryState =
  | "late"
  | "due"
  | "pending"
  | "received"
  | "unscheduled";

export function deliveryState({
  arrivato,
  dataConsegna,
  today,
}: {
  arrivato: boolean;
  dataConsegna: string | null | undefined;
  today: string;
}): DeliveryState {
  if (arrivato) return "received";
  if (!dataConsegna) return "unscheduled";
  if (dataConsegna < today) return "late";
  if (dataConsegna === today) return "due";
  return "pending";
}

export function deliveryStateCopy(state: DeliveryState): string {
  return {
    late: "In ritardo",
    due: "Prevista oggi",
    pending: "In arrivo",
    received: "Ricevuto",
    unscheduled: "Data da definire",
  }[state];
}

export type CustomerPermissions = {
  canCreateCustomer: boolean;
  canUpdateCustomer: boolean;
  canAssignCustomer: boolean;
  canArchiveCustomer: boolean;
  canDeleteCustomer: boolean;
  canCreateCommessa: boolean;
  canPlanIntervento: boolean;
  canCreateTicket: boolean;
};

export function customerPermissions(
  capabilities: ReadonlySet<string> | null
): CustomerPermissions {
  return {
    canCreateCustomer: capabilities?.has("cliente.create") ?? false,
    canUpdateCustomer:
      capabilities?.has("cliente.update_operational") ?? false,
    canAssignCustomer: capabilities?.has("cliente.assign") ?? false,
    canArchiveCustomer: capabilities?.has("cliente.archive") ?? false,
    canDeleteCustomer: capabilities?.has("cliente.delete") ?? false,
    canCreateCommessa: capabilities?.has("commessa.create") ?? false,
    canPlanIntervento: capabilities?.has("intervento.plan") ?? false,
    canCreateTicket: capabilities?.has("ticket.create") ?? false,
  };
}

export type CommesseListPermissions = {
  canCreate: boolean;
  canCreateWithAmount: boolean;
  canDelete: boolean;
};

export function commesseListPermissions(
  capabilities: ReadonlySet<string> | null
): CommesseListPermissions {
  const canCreate = capabilities?.has("commessa.create") ?? false;
  const canReadEconomy = capabilities?.has("economia.read") ?? false;
  return {
    canCreate,
    canCreateWithAmount: canCreate && canReadEconomy,
    canDelete: capabilities?.has("commessa.delete") ?? false,
  };
}

export type EconomicRoutePermissions = {
  canReadPayments: boolean;
  canRecordPayments: boolean;
  canReadEconomy: boolean;
};

export function economicRoutePermissions(
  capabilities: ReadonlySet<string> | null
): EconomicRoutePermissions {
  return {
    canReadPayments: capabilities?.has("pagamento.read") ?? false,
    canRecordPayments: capabilities?.has("pagamento.record") ?? false,
    canReadEconomy: capabilities?.has("economia.read") ?? false,
  };
}
