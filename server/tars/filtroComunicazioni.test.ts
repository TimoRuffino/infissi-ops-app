import { beforeEach, describe, expect, it } from "vitest";
import {
  classificaComunicazione,
  regoleFiltroMittente,
  salvaRegolaMittente,
} from "./filtroComunicazioni";

const base = {
  sedeId: 1,
  mittente: "contatto@example.com",
  oggetto: "",
  testo: "",
  allegati: [],
  clienteId: null,
  commessaId: null,
};

describe("filtro comunicazioni", () => {
  beforeEach(() => {
    regoleFiltroMittente.splice(0, regoleFiltroMittente.length);
  });

  it("si fida del flag spam del server mail", () => {
    const esito = classificaComunicazione({
      ...base,
      segnali: { spamFlag: "YES" },
    });
    expect(esito.categoria).toBe("spam");
    expect(esito.score).toBeGreaterThanOrEqual(70);
  });

  it("esclude una newsletter solo con segnali promozionali convergenti", () => {
    const esito = classificaComunicazione({
      ...base,
      mittente: "news@fornitore.it",
      oggetto: "Offerte speciali di agosto",
      testo: "Sconti su tutto. Disiscriviti quando vuoi.",
      segnali: {
        listUnsubscribe: "<mailto:unsubscribe@fornitore.it>",
        precedence: "bulk",
      },
    });
    expect(esito.categoria).toBe("offerta_marketing");
  });

  it("riconosce una richiesta di preventivo come nuovo lead", () => {
    const esito = classificaComunicazione({
      ...base,
      oggetto: "Richiesta preventivo nuovi infissi",
      testo: "Vorrei un preventivo e un sopralluogo per sostituire le finestre.",
    });
    expect(esito.categoria).toBe("nuovo_lead");
  });

  it("una commessa già collegata prevale sul linguaggio promozionale", () => {
    const esito = classificaComunicazione({
      ...base,
      commessaId: 42,
      oggetto: "Offerta speciale",
      testo: "Sconto esclusivo sulla conferma d'ordine della vostra commessa.",
    });
    expect(esito.categoria).toBe("operativa");
  });

  it("lascia i casi ambigui da classificare invece di nasconderli", () => {
    const esito = classificaComunicazione({
      ...base,
      oggetto: "Informazioni",
      testo: "Buongiorno, potete richiamarmi?",
    });
    expect(esito.categoria).toBe("da_classificare");
  });

  it("applica la decisione persistente sul mittente", () => {
    salvaRegolaMittente({
      sedeId: 1,
      mittente: "Vendite <promo@example.com>",
      categoria: "offerta_marketing",
    });
    const esito = classificaComunicazione({
      ...base,
      mittente: "PROMO@example.com",
      oggetto: "Ciao",
      testo: "Messaggio generico",
    });
    expect(esito.categoria).toBe("offerta_marketing");
    expect(esito.fonte).toBe("regola_mittente");
  });
});
