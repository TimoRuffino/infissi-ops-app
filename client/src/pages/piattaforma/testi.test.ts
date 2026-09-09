import { describe, expect, it } from "vitest";

import {
  TESTO_POSTA_NON_CONFIGURATA,
  attoreLeggibile,
  dataOraItaliana,
  dettagliCompatti,
  erroreDelComando,
  etichettaBlocco,
  etichettaComando,
  etichettaEvento,
  etichettaStatoAzienda,
  etichettaStatoComando,
  riassuntoBackup,
  riassuntoSpazio,
  riassuntoTars,
  statoInvito,
  testoEsitoInvito,
  tonoStatoAzienda,
  tonoStatoComando,
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

describe("etichettaEvento", () => {
  it("scrive il fatto in italiano, non il valore della colonna", () => {
    expect(etichettaEvento("invito_inviato")).toBe("Invito inviato");
    expect(etichettaEvento("abbonamento_stato")).toBe("Stato dell'abbonamento");
    expect(etichettaEvento("worker_sospeso")).toBe("Worker fermato");
    expect(etichettaEvento("storage_bloccato")).toBe("Caricamenti fermi");
    expect(etichettaEvento("archivi_ripristinati")).toBe("Archivi ripristinati");
  });

  it("non nasconde un tipo che non conosce: lo mostra com'è", () => {
    expect(etichettaEvento("tipo_inventato_domani")).toBe("tipo_inventato_domani");
  });
});

describe("attoreLeggibile", () => {
  it("dice chi ha agito, non la stringa del registro", () => {
    expect(attoreLeggibile("piattaforma:t@r.it")).toBe("piattaforma (t@r.it)");
    expect(attoreLeggibile("script:tenant@host")).toBe("riga di comando (tenant@host)");
    expect(attoreLeggibile("boot")).toBe("avvio del server");
    expect(attoreLeggibile("utente:12")).toBe("utente 12");
  });

  it("lascia passare com'è quello che non riconosce", () => {
    expect(attoreLeggibile("qualcosa-di-nuovo")).toBe("qualcosa-di-nuovo");
    expect(attoreLeggibile("")).toBe("—");
  });
});

describe("etichettaComando", () => {
  it("chiama i comandi con il nome dell'azione, non del case", () => {
    expect(etichettaComando("imposta_abbonamento")).toBe("Abbonamento");
    expect(etichettaComando("ricalcola_storage")).toBe("Ricalcolo dello spazio");
    expect(etichettaComando("ripristina_archivi")).toBe("Ripristino degli archivi");
    expect(etichettaComando("crea")).toBe("Creazione");
    expect(etichettaComando("sospendi")).toBe("Sospensione");
  });

  it("non nasconde un comando che non conosce", () => {
    expect(etichettaComando("comando_futuro")).toBe("comando_futuro");
  });
});

describe("stato di un comando", () => {
  it("dice «in corso» finché il comando non si è chiuso", () => {
    expect(etichettaStatoComando("in_attesa")).toBe("In corso…");
    expect(etichettaStatoComando("eseguito")).toBe("Eseguito");
    expect(etichettaStatoComando("errore")).toBe("Errore");
  });

  it("colora di rosso solo il comando fallito", () => {
    expect(tonoStatoComando("eseguito")).toBe("success");
    expect(tonoStatoComando("in_attesa")).toBe("warning");
    expect(tonoStatoComando("errore")).toBe("danger");
  });
});

describe("erroreDelComando", () => {
  it("tira fuori il messaggio del dominio così com'è", () => {
    expect(erroreDelComando({ errore: "Il tenant 1 non si tocca" })).toBe(
      "Il tenant 1 non si tocca"
    );
  });

  it("tace quando non c'è nessun errore da mostrare", () => {
    expect(erroreDelComando(null)).toBeUndefined();
    expect(erroreDelComando(undefined)).toBeUndefined();
    expect(erroreDelComando({ tenantId: 3 })).toBeUndefined();
    expect(erroreDelComando({ errore: "" })).toBeUndefined();
  });
});

describe("dataOraItaliana", () => {
  it("scrive giorno e ora, perché due eventi dello stesso giorno vanno distinti", () => {
    expect(dataOraItaliana(new Date(2026, 8, 9, 14, 32))).toBe("09/09/2026 14:32");
    expect(dataOraItaliana(new Date(2026, 0, 1, 0, 5))).toBe("01/01/2026 00:05");
  });
});

describe("dettagliCompatti", () => {
  it("tace quando non c'è niente da dire", () => {
    expect(dettagliCompatti(null)).toBe("");
    expect(dettagliCompatti(undefined)).toBe("");
    expect(dettagliCompatti({})).toBe("");
  });

  it("mette i dettagli su una riga sola, leggibile", () => {
    expect(dettagliCompatti({ da: "trialing", a: "active" })).toBe("da: trialing · a: active");
  });

  it("non stampa «null» e «undefined» come se fossero valori", () => {
    expect(dettagliCompatti({ motivo: null, giorni: 30, ripiego: true })).toBe(
      "giorni: 30 · ripiego: sì"
    );
  });

  it("appiattisce quello che non è un valore semplice invece di stampare [object Object]", () => {
    expect(dettagliCompatti({ campo: { a: 1 } })).toBe('campo: {"a":1}');
  });
});

describe("statoInvito", () => {
  const scadeDopo = new Date("2026-09-20T00:00:00Z");
  const scadePrima = new Date("2026-09-01T00:00:00Z");

  it("un invito annullato resta annullato, anche se sarebbe ancora buono", () => {
    expect(
      statoInvito({ scadeIl: scadeDopo, usatoIl: null, annullatoIl: new Date() }, ADESSO)
    ).toEqual({ etichetta: "Annullato", tono: "secondary", pendente: false });
  });

  it("un invito usato lo dice, e non è più pendente", () => {
    expect(
      statoInvito({ scadeIl: scadeDopo, usatoIl: new Date(), annullatoIl: null }, ADESSO)
    ).toEqual({ etichetta: "Accettato", tono: "success", pendente: false });
  });

  it("distingue lo scaduto dall'invito ancora vivo", () => {
    expect(statoInvito({ scadeIl: scadePrima, usatoIl: null, annullatoIl: null }, ADESSO)).toEqual({
      etichetta: "Scaduto",
      tono: "warning",
      pendente: false,
    });
    expect(statoInvito({ scadeIl: scadeDopo, usatoIl: null, annullatoIl: null }, ADESSO)).toEqual({
      etichetta: "In sospeso",
      tono: "info",
      pendente: true,
    });
  });
});
