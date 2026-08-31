import { describe, expect, it } from "vitest";

import {
  commesseListPermissions,
  customerPermissions,
  deliveryState,
  deliveryStateCopy,
  economicRoutePermissions,
  planningPermissions,
  supportQueuePermissions,
} from "./operationalRoutes";

describe("customerPermissions", () => {
  it("nasconde ogni CTA durante il caricamento", () => {
    expect(customerPermissions(null)).toEqual({
      canCreateCustomer: false,
      canUpdateCustomer: false,
      canAssignCustomer: false,
      canArchiveCustomer: false,
      canDeleteCustomer: false,
      canCreateCommessa: false,
      canPlanIntervento: false,
      canCreateTicket: false,
    });
  });

  it("non concede azioni figlie dalla sola lettura cliente", () => {
    expect(
      customerPermissions(
        new Set([
          "cliente.read",
          "cliente.update_operational",
          "commessa.create",
        ])
      )
    ).toMatchObject({
      canUpdateCustomer: true,
      canAssignCustomer: false,
      canCreateCommessa: true,
      canPlanIntervento: false,
      canCreateTicket: false,
    });
  });
});

describe("planningPermissions", () => {
  it("non espone CTA durante il caricamento delle capability", () => {
    expect(planningPermissions(null)).toEqual({
      canPlan: false,
      canAssign: false,
      canDelete: false,
    });
  });

  // Route Squadre: un set vuoto è una risposta del server, non un caricamento.
  // Nessuna capability di gestione non deve mai nascondere una lettura che il
  // router concede a ogni utente autenticato (`squadre.list`).
  it("mantiene la lettura Planning disponibile senza capability di gestione", () => {
    expect(planningPermissions(new Set())).toEqual({
      canPlan: false,
      canAssign: false,
      canDelete: false,
    });
  });

  it("separa pianificazione, assegnazione e cancellazione", () => {
    expect(planningPermissions(new Set(["intervento.plan"]))).toEqual({
      canPlan: true,
      canAssign: false,
      canDelete: false,
    });
    expect(
      planningPermissions(
        new Set(["intervento.plan", "intervento.assign", "intervento.delete"])
      )
    ).toEqual({ canPlan: true, canAssign: true, canDelete: true });
  });
});

describe("deliveryState", () => {
  it("non tratta una consegna senza data come ritardo", () => {
    expect(
      deliveryState({
        arrivato: false,
        dataConsegna: null,
        today: "2026-08-31",
      })
    ).toBe("unscheduled");
    expect(deliveryStateCopy("unscheduled")).toBe("Data da definire");
  });

  it("distingue ricevuto, ritardo, oggi e futuro", () => {
    expect(
      deliveryState({
        arrivato: true,
        dataConsegna: "2026-08-20",
        today: "2026-08-31",
      })
    ).toBe("received");
    expect(
      deliveryState({
        arrivato: false,
        dataConsegna: "2026-08-30",
        today: "2026-08-31",
      })
    ).toBe("late");
    expect(
      deliveryState({
        arrivato: false,
        dataConsegna: "2026-08-31",
        today: "2026-08-31",
      })
    ).toBe("due");
    expect(
      deliveryState({
        arrivato: false,
        dataConsegna: "2026-09-01",
        today: "2026-08-31",
      })
    ).toBe("pending");
  });
});

describe("commesseListPermissions", () => {
  it("nasconde ogni CTA durante il caricamento", () => {
    expect(commesseListPermissions(null)).toEqual({
      canCreate: false,
      canCreateWithAmount: false,
      canDelete: false,
    });
  });

  it("richiede economia.read per esporre l'importo in creazione", () => {
    expect(
      commesseListPermissions(new Set(["commessa.create"]))
    ).toEqual({
      canCreate: true,
      canCreateWithAmount: false,
      canDelete: false,
    });
    expect(
      commesseListPermissions(
        new Set(["commessa.create", "commessa.delete", "economia.read"])
      )
    ).toEqual({
      canCreate: true,
      canCreateWithAmount: true,
      canDelete: true,
    });
  });
});

describe("supportQueuePermissions", () => {
  it("nasconde l'apertura ticket durante il caricamento", () => {
    expect(supportQueuePermissions(null)).toEqual({ canCreateTicket: false });
  });

  // `ticket.manage` e `ticket.delete` restano fuori dalla matrice: la UI non
  // deve nascondere azioni che il router concede ancora per via legacy.
  it("dipende solo da ticket.create", () => {
    expect(supportQueuePermissions(new Set(["ticket.manage"]))).toEqual({
      canCreateTicket: false,
    });
    expect(supportQueuePermissions(new Set(["ticket.create"]))).toEqual({
      canCreateTicket: true,
    });
  });
});

describe("economicRoutePermissions", () => {
  it("nasconde ogni dato economico durante il caricamento", () => {
    expect(economicRoutePermissions(null)).toEqual({
      canReadPayments: false,
      canRecordPayments: false,
      canReadEconomy: false,
    });
  });

  it("separa la registrazione dei pagamenti dalla loro lettura", () => {
    expect(
      economicRoutePermissions(new Set(["pagamento.record"]))
    ).toEqual({
      canReadPayments: false,
      canRecordPayments: true,
      canReadEconomy: false,
    });
  });
});
