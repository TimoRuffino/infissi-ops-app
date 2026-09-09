import { describe, expect, it } from "vitest";

import {
  TESTO_POSTA_NON_CONFIGURATA,
  etichettaBlocco,
  etichettaStatoAzienda,
  riassuntoBackup,
  riassuntoSpazio,
  riassuntoTars,
  testoEsitoInvito,
  tonoStatoAzienda,
} from "./testi";

const ADESSO = new Date("2026-09-09T10:00:00Z");

describe("etichettaStatoAzienda", () => {
  it("dice lo stato dal posto di chi lavora, non il valore della colonna", () => {
    expect(etichettaStatoAzienda("attivo")).toBe("Attiva");
    expect(etichettaStatoAzienda("sospeso")).toBe("Sospesa");
  });

  it("colora solo ciò che toglie qualcosa", () => {
    expect(tonoStatoAzienda("attivo")).toBe("success");
    expect(tonoStatoAzienda("sospeso")).toBe("danger");
  });
});

describe("etichettaBlocco", () => {
  it("tace quando non c'è nessun blocco all'orizzonte", () => {
    expect(etichettaBlocco(null, ADESSO)).toBeNull();
    expect(etichettaBlocco(undefined, ADESSO)).toBeNull();
  });

  it("distingue il fermo già accaduto dalla tolleranza che corre", () => {
    expect(etichettaBlocco(new Date("2026-09-01T00:00:00Z"), ADESSO)).toBe(
      "Fermo dal 01/09/2026"
    );
    expect(etichettaBlocco(new Date("2026-09-20T00:00:00Z"), ADESSO)).toBe(
      "Si ferma il 20/09/2026"
    );
  });
});

describe("riassuntoSpazio", () => {
  it("non inventa un numero quando lo spazio non è mai stato contato", () => {
    expect(riassuntoSpazio(null)).toBe("—");
    expect(riassuntoSpazio(undefined)).toBe("—");
  });

  it("scrive usato, quota e percentuale in una riga sola", () => {
    expect(
      riassuntoSpazio({
        bytes: 2 * 1024 ** 3,
        quotaBytes: 5 * 1024 ** 3,
        percentuale: 40,
      })
    ).toBe("2 GB di 5 GB · 40 %");
  });
});

describe("riassuntoTars", () => {
  it("dice «non lo so» quando il ledger non è leggibile", () => {
    expect(riassuntoTars({ consumoEur: null, budgetEur: 25, extraEur: 0, percentuale: null })).toBe("—");
  });

  it("senza tetto mostra il consumo e lo dichiara", () => {
    expect(
      riassuntoTars({ consumoEur: 3.5, budgetEur: null, extraEur: 0, percentuale: null })
    ).toBe("€ 3,50 · senza tetto");
  });

  it("con tetto somma l'extra del mese e mostra la percentuale", () => {
    expect(
      riassuntoTars({ consumoEur: 12.5, budgetEur: 25, extraEur: 5, percentuale: 41.7 })
    ).toBe("€ 12,50 di € 30,00 · 41,7 %");
  });
});

describe("riassuntoBackup", () => {
  it("dice «mai» invece di lasciare la casella vuota", () => {
    expect(riassuntoBackup(null)).toBe("Mai");
  });

  it("scrive la data e l'esito, non i file", () => {
    expect(
      riassuntoBackup({ startedAt: new Date("2026-09-08T02:00:00Z"), ok: true })
    ).toBe("08/09/2026 · riuscito");
    expect(
      riassuntoBackup({ startedAt: new Date("2026-09-08T02:00:00Z"), ok: false })
    ).toBe("08/09/2026 · fallito");
    expect(
      riassuntoBackup({ startedAt: new Date("2026-09-08T02:00:00Z"), ok: null })
    ).toBe("08/09/2026 · in corso");
  });
});

describe("testoEsitoInvito", () => {
  it("dice a chi è andato l'invito quando la posta ha funzionato", () => {
    expect(testoEsitoInvito({ inviato: true, email: "anna@esempio.it" })).toBe(
      "Invito inviato a anna@esempio.it."
    );
  });

  it("senza posta chiede di copiare il link, con le stesse parole del server", () => {
    const testo = testoEsitoInvito({
      inviato: false,
      link: "https://app.wyndoor.com/invito/abc",
    });
    expect(testo).toContain("copia");
    expect(testo).toBe(TESTO_POSTA_NON_CONFIGURATA);
  });
});
