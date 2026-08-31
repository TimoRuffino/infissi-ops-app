import { describe, expect, it } from "vitest";

import {
  RECLAMO_STATES,
  RIFACIMENTO_STATES,
  SUPPORT_QUEUE_STATES,
  nextQueueAdvance,
  nextReclamoAdvance,
  nextRifacimentoAdvance,
  ticketMatchesQueueFilter,
} from "./supportQueue";

describe("ticketMatchesQueueFilter", () => {
  it("tiene un ticket dello stato filtrato che contiene la ricerca", () => {
    expect(
      ticketMatchesQueueFilter(
        { stato: "aperto", oggetto: "Vetro" },
        {
          stato: "aperto",
          search: "vetro",
        }
      )
    ).toBe(true);
  });

  it("scarta un ticket di un altro stato anche senza ricerca", () => {
    expect(
      ticketMatchesQueueFilter(
        { stato: "chiuso", oggetto: "Vetro" },
        {
          stato: "aperto",
          search: "",
        }
      )
    ).toBe(false);
  });

  it("non filtra per stato quando la coda è su «tutti»", () => {
    expect(
      ticketMatchesQueueFilter(
        { stato: "chiuso", oggetto: "Vetro" },
        { stato: "tutti", search: "" }
      )
    ).toBe(true);
  });

  it("cerca anche in descrizione, contatto, solleciti e riferimenti già letti", () => {
    const ticket = {
      stato: "assegnato",
      oggetto: "Persiana",
      descrizione: "Non chiude bene",
      contatto: "Rossi 3401234567",
      solleciti: [{ nota: "Sollecitato fornitore Wnd" }],
      riferimenti: ["C-2026-014", "TK-0007", null, undefined],
    };

    expect(
      ticketMatchesQueueFilter(ticket, { stato: "tutti", search: "chiude" })
    ).toBe(true);
    expect(
      ticketMatchesQueueFilter(ticket, { stato: "tutti", search: "rossi" })
    ).toBe(true);
    expect(
      ticketMatchesQueueFilter(ticket, { stato: "tutti", search: "wnd" })
    ).toBe(true);
    expect(
      ticketMatchesQueueFilter(ticket, { stato: "tutti", search: "c-2026-014" })
    ).toBe(true);
    expect(
      ticketMatchesQueueFilter(ticket, { stato: "tutti", search: "tapparella" })
    ).toBe(false);
  });

  // La ricerca è scritta a mano da chi ha il cliente al telefono: spazi e
  // maiuscole non devono far sparire il ticket.
  it("normalizza spazi e maiuscole con la collazione italiana", () => {
    expect(
      ticketMatchesQueueFilter(
        { stato: "aperto", oggetto: "Vetro GRAFFIATO" },
        { stato: "aperto", search: "  Graffiato " }
      )
    ).toBe(true);
  });

  it("non inventa campi assenti dal payload", () => {
    expect(
      ticketMatchesQueueFilter(
        { stato: "aperto" },
        { stato: "aperto", search: "vetro" }
      )
    ).toBe(false);
  });
});

describe("nextQueueAdvance", () => {
  it("segue la sequenza del router senza saltare passaggi", () => {
    expect(nextQueueAdvance("aperto")?.stato).toBe("assegnato");
    expect(nextQueueAdvance("assegnato")?.stato).toBe("in_lavorazione");
    expect(nextQueueAdvance("in_lavorazione")?.stato).toBe("chiuso");
  });

  it("non inventa un passo dopo la chiusura né per stati sconosciuti", () => {
    expect(nextQueueAdvance("chiuso")).toBeNull();
    expect(nextQueueAdvance("risolto")).toBeNull();
  });

  it("dichiara a parole la prossima azione, non solo con un colore", () => {
    expect(nextQueueAdvance("aperto")?.prossimaAzione).toBe(
      "Da assegnare a chi se ne occupa"
    );
  });
});

describe("SUPPORT_QUEUE_STATES", () => {
  // Gli stati sono quelli del router: la UI non ne aggiunge né ne toglie.
  it("resta la sequenza server aperto → assegnato → in lavorazione → chiuso", () => {
    expect(SUPPORT_QUEUE_STATES).toEqual([
      "aperto",
      "assegnato",
      "in_lavorazione",
      "chiuso",
    ]);
  });
});

describe("reclami e rifacimenti", () => {
  // `risolto` è ritirato lato server: la UI non lo rimette in circolo.
  it("tiene gli stati dei due flussi allineati al router", () => {
    expect(RECLAMO_STATES).toEqual(["aperto", "in_gestione", "chiuso"]);
    expect(RECLAMO_STATES).not.toContain("risolto");
    expect(RIFACIMENTO_STATES).toEqual([
      "aperto",
      "in_gestione",
      "in_produzione",
      "completato",
      "chiuso",
    ]);
  });

  it("avanza il reclamo di un passo alla volta", () => {
    expect(nextReclamoAdvance("aperto")?.stato).toBe("in_gestione");
    expect(nextReclamoAdvance("in_gestione")?.stato).toBe("chiuso");
    expect(nextReclamoAdvance("chiuso")).toBeNull();
  });

  it("porta il rifacimento in produzione senza saltare al chiuso", () => {
    expect(nextRifacimentoAdvance("aperto")?.stato).toBe("in_gestione");
    expect(nextRifacimentoAdvance("in_gestione")?.stato).toBe("in_produzione");
    expect(nextRifacimentoAdvance("in_produzione")?.stato).toBe("completato");
    expect(nextRifacimentoAdvance("completato")?.stato).toBe("chiuso");
    expect(nextRifacimentoAdvance("chiuso")).toBeNull();
  });
});
