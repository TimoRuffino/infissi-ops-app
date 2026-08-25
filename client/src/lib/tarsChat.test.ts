import { describe, expect, it } from "vitest";
import { chatNeedsRefresh } from "./tarsChat";

describe("Tars chat refresh", () => {
  it("continua finche una domanda risposta non ha un discendente", () => {
    expect(
      chatNeedsRefresh([
        {
          id: 1,
          origineId: null,
          tipo: "domanda",
          stato: "risposta",
          seguitoAt: new Date(),
          esito: null,
        },
      ])
    ).toBe(true);

    expect(
      chatNeedsRefresh([
        {
          id: 1,
          origineId: null,
          tipo: "domanda",
          stato: "risposta",
          seguitoAt: new Date(),
          esito: null,
        },
        {
          id: 2,
          origineId: 1,
          tipo: "crea_lead",
          stato: "pendente",
          seguitoAt: null,
          esito: null,
        },
      ])
    ).toBe(false);
  });

  it("continua durante un'approvazione senza esito", () => {
    expect(
      chatNeedsRefresh([
        {
          id: 3,
          origineId: null,
          tipo: "crea_lead",
          stato: "approvata",
          seguitoAt: null,
          esito: null,
        },
      ])
    ).toBe(true);
    expect(
      chatNeedsRefresh([
        {
          id: 3,
          origineId: null,
          tipo: "crea_lead",
          stato: "approvata",
          seguitoAt: null,
          esito: "Cliente e commessa creati",
        },
      ])
    ).toBe(false);
  });
});
