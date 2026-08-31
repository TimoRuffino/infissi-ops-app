import { describe, expect, it } from "vitest";

import {
  classifyTarsAvailability,
  kanbanPresentation,
  mobilePrioritySections,
  selectDashboardModules,
} from "./goldenScreenContracts";

describe("contratti puri delle golden screen", () => {
  it("compone i moduli del principal multi-ruolo senza montare economia non autorizzata", () => {
    expect(selectDashboardModules(new Set(["commessa.read"]))).toEqual([
      "priorita",
      "agenda",
      "commesse",
      "ticket",
    ]);

    expect(
      selectDashboardModules(new Set(["commessa.read", "economia.read"]))
    ).toEqual(["priorita", "agenda", "commesse", "ticket", "economia"]);

    expect(
      selectDashboardModules(new Set(["commessa.read", "tars.use"]))
    ).toEqual(["priorita", "agenda", "commesse", "ticket", "tars"]);
  });

  it("usa la lista per fase fino a 1199px e il board desktop da 1200px", () => {
    expect(kanbanPresentation(390)).toBe("mobile-phase-list");
    expect(kanbanPresentation(1199)).toBe("mobile-phase-list");
    expect(kanbanPresentation(1200)).toBe("desktop-board");
  });

  it("classifica Tars soltanto dai campi tipizzati ricevuti", () => {
    expect(
      classifyTarsAvailability({
        enabled: false,
        pending: false,
        provider: null,
        unavailableReason: null,
      })
    ).toEqual({ kind: "disabled" });

    expect(
      classifyTarsAvailability({
        enabled: true,
        pending: true,
        provider: null,
        unavailableReason: null,
      })
    ).toEqual({ kind: "loading" });

    expect(
      classifyTarsAvailability({
        enabled: true,
        pending: false,
        provider: null,
        unavailableReason: null,
      })
    ).toEqual({ kind: "unavailable", reason: null });

    expect(
      classifyTarsAvailability({
        enabled: true,
        pending: false,
        provider: "openai",
        unavailableReason: null,
      })
    ).toEqual({ kind: "available", provider: "openai" });

    expect(
      classifyTarsAvailability({
        enabled: true,
        pending: false,
        provider: "openai",
        unavailableReason: "Provider non disponibile.",
      })
    ).toEqual({
      kind: "unavailable",
      reason: "Provider non disponibile.",
    });
  });

  it("ordina le sezioni mobile per priorità e conserva le sconosciute in coda", () => {
    expect(
      mobilePrioritySections([
        "extra-b",
        "documenti",
        "stato",
        "extra-a",
        "identita",
        "timeline",
      ])
    ).toEqual([
      "identita",
      "stato",
      "timeline",
      "documenti",
      "extra-b",
      "extra-a",
    ]);
  });
});
