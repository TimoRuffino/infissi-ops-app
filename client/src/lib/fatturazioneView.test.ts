import { describe, expect, it } from "vitest";
import type {
  CommessaDaFatturare,
  EsitoPasso,
  PassoFatturazione,
} from "@shared/fatturazione/passi";

import {
  etichettaPulsante,
  filtraCommesse,
  giorniTesto,
  importiCard,
  passoDallaQuery,
  passoIniziale,
  passoRaggiungibile,
  tonoPasso,
} from "./fatturazioneView";

const passiTutti = (
  esito: EsitoPasso
): Record<PassoFatturazione, EsitoPasso> => ({
  documenti: esito,
  contratto: esito,
  limiti: esito,
  fattura: esito,
});

const commessa = (
  overrides: Partial<CommessaDaFatturare> = {}
): CommessaDaFatturare => ({
  commessaId: 1,
  codice: "ABC-001",
  cliente: "Mario Rossi",
  stato: "aggiornamento_contratto",
  statoDal: "2026-08-01T00:00:00.000Z",
  giorniNelloStato: 5,
  documenti: { totale: 2, contratti: 1 },
  passi: passiTutti("da_fare"),
  prossimoPasso: "documenti",
  pattuitoCent: 100000,
  pattuitoTipo: "lordo",
  fatturaPrevistaCent: 100000,
  fatturaPrevistaStima: false,
  fatturaStato: null,
  ...overrides,
});

describe("etichettaPulsante", () => {
  it("«Inizia fatturazione» quando tutti i passi sono da fare", () => {
    expect(etichettaPulsante(passiTutti("da_fare"))).toBe(
      "Inizia fatturazione"
    );
  });

  it("«Continua» con un percorso misto", () => {
    expect(
      etichettaPulsante({
        documenti: "fatto",
        contratto: "in_corso",
        limiti: "da_fare",
        fattura: "da_fare",
      })
    ).toBe("Continua");
  });

  it("«Fatturata» quando il passo Fattura è fatto", () => {
    expect(etichettaPulsante(passiTutti("fatto"))).toBe("Fatturata");
  });

  // Regressione: un passo dietro un flag spento è `non_disponibile`, non
  // `in_corso`/`fatto` — non conta come «iniziato». Prima della fix, un solo
  // passo `non_disponibile` bastava a proporre «Continua» su una commessa
  // mai toccata.
  it("«Inizia fatturazione» quando i passi da fare hanno la fattura non disponibile (flag spento)", () => {
    expect(
      etichettaPulsante({
        documenti: "da_fare",
        contratto: "da_fare",
        limiti: "da_fare",
        fattura: "non_disponibile",
      })
    ).toBe("Inizia fatturazione");
  });

  it("«Inizia fatturazione» anche con più passi non disponibili (limiti e fattura dietro flag spenti)", () => {
    expect(
      etichettaPulsante({
        documenti: "da_fare",
        contratto: "da_fare",
        limiti: "non_disponibile",
        fattura: "non_disponibile",
      })
    ).toBe("Inizia fatturazione");
  });

  it("«Continua» quando tutto è fatto tranne la fattura", () => {
    expect(
      etichettaPulsante({
        documenti: "fatto",
        contratto: "fatto",
        limiti: "fatto",
        fattura: "da_fare",
      })
    ).toBe("Continua");
  });
});

describe("tonoPasso", () => {
  it("mappa ogni esito sul suo tono", () => {
    expect(tonoPasso("da_fare")).toBe("neutro");
    expect(tonoPasso("in_corso")).toBe("attivo");
    expect(tonoPasso("fatto")).toBe("ok");
    expect(tonoPasso("non_disponibile")).toBe("spento");
  });
});

describe("passoRaggiungibile", () => {
  // Ruling P4-R14 (I2 della review finale): «documenti» non blocca mai
  // «contratto» — si può ancora scrivere il contratto a mano a fascicolo
  // vuoto, come su main prima di questo piano. «limiti» e «fattura»
  // restano bloccati finché «contratto» non è `fatto`.
  it("apre documenti e contratto quando non si è ancora fatto nulla; limiti e fattura restano bloccati", () => {
    const passi = passiTutti("da_fare");
    expect(passoRaggiungibile(passi, "documenti")).toBe(true);
    expect(passoRaggiungibile(passi, "contratto")).toBe(true);
    expect(passoRaggiungibile(passi, "limiti")).toBe(false);
    expect(passoRaggiungibile(passi, "fattura")).toBe(false);
  });

  it("lascia tornare sui passi già fatti e stare su quello in corso", () => {
    const passi: Record<PassoFatturazione, EsitoPasso> = {
      documenti: "fatto",
      contratto: "in_corso",
      limiti: "da_fare",
      fattura: "da_fare",
    };
    expect(passoRaggiungibile(passi, "documenti")).toBe(true);
    expect(passoRaggiungibile(passi, "contratto")).toBe(true);
    // Il primo non concluso è «contratto»: i limiti restano oltre il salto.
    expect(passoRaggiungibile(passi, "limiti")).toBe(false);
    expect(passoRaggiungibile(passi, "fattura")).toBe(false);
  });

  it("apre il passo successivo appena il precedente è fatto", () => {
    const passi: Record<PassoFatturazione, EsitoPasso> = {
      documenti: "fatto",
      contratto: "fatto",
      limiti: "da_fare",
      fattura: "da_fare",
    };
    expect(passoRaggiungibile(passi, "limiti")).toBe(true);
    expect(passoRaggiungibile(passi, "fattura")).toBe(false);
  });

  it("apre anche un passo non disponibile, se è il primo non concluso", () => {
    // Fatturazione spenta con tutto il resto chiuso: il quarto passo si
    // apre e spiega perché è fermo, invece di restare un pallino muto.
    const passi: Record<PassoFatturazione, EsitoPasso> = {
      documenti: "fatto",
      contratto: "fatto",
      limiti: "fatto",
      fattura: "non_disponibile",
    };
    expect(passoRaggiungibile(passi, "fattura")).toBe(true);
  });

  it("non apre nulla oltre l'ultimo quando il percorso è concluso", () => {
    const passi = passiTutti("fatto");
    for (const passo of [
      "documenti",
      "contratto",
      "limiti",
      "fattura",
    ] as const) {
      expect(passoRaggiungibile(passi, passo)).toBe(true);
    }
  });

  // Regressione: una bozza di fattura (`in_corso`) rende il passo
  // raggiungibile anche se il fascicolo non ha ancora un contratto. Senza il
  // ramo `in_corso` di `passoRaggiungibile`, il primo non concluso resterebbe
  // «documenti» e questo test fallirebbe.
  it("il passo Fattura è raggiungibile con una bozza in corso, anche senza contratto", () => {
    const passi: Record<PassoFatturazione, EsitoPasso> = {
      documenti: "da_fare",
      contratto: "da_fare",
      limiti: "da_fare",
      fattura: "in_corso",
    };
    expect(passoRaggiungibile(passi, "fattura")).toBe(true);
  });
});

describe("passoDallaQuery", () => {
  it("legge un passo valido dalla query", () => {
    expect(passoDallaQuery("?passo=contratto")).toBe("contratto");
    expect(passoDallaQuery("passo=limiti")).toBe("limiti");
  });

  it("ignora un valore che non è uno dei quattro passi", () => {
    expect(passoDallaQuery("?passo=fatturazione")).toBeNull();
    expect(passoDallaQuery("?passo=")).toBeNull();
  });

  it("torna null senza il parametro", () => {
    expect(passoDallaQuery("")).toBeNull();
    expect(passoDallaQuery("?altro=1")).toBeNull();
  });
});

describe("passoIniziale", () => {
  it("usa il richiesto quando è raggiungibile, anche se diverso dal prossimo passo del server", () => {
    const passi: Record<PassoFatturazione, EsitoPasso> = {
      documenti: "fatto",
      contratto: "in_corso",
      limiti: "da_fare",
      fattura: "da_fare",
    };
    expect(passoIniziale(passi, "limiti", "contratto")).toBe("contratto");
    // «documenti» è alle spalle ma resta raggiungibile (già fatto).
    expect(passoIniziale(passi, "limiti", "documenti")).toBe("documenti");
  });

  // Ruling P4-R14: a fascicolo vuoto (nessun passo fatto), «contratto»
  // richiesto via `?passo=` resta raggiungibile — non rimbalza su
  // «documenti» come prima di questa fix.
  it("apre «contratto» via query anche a fascicolo vuoto, con «documenti» l'unico passo non concluso", () => {
    const passi = passiTutti("da_fare");
    expect(passoIniziale(passi, "documenti", "contratto")).toBe("contratto");
  });

  it("ripiega sul prossimo passo quando il richiesto non è raggiungibile (P4-R8)", () => {
    const passi: Record<PassoFatturazione, EsitoPasso> = {
      documenti: "fatto",
      contratto: "in_corso",
      limiti: "da_fare",
      fattura: "da_fare",
    };
    // «fattura» è oltre il primo passo non concluso: non raggiungibile.
    expect(passoIniziale(passi, "contratto", "fattura")).toBe("contratto");
  });

  it("apre l'ultimo passo quando il percorso è concluso e non c'è un prossimo passo (M5)", () => {
    const passi = passiTutti("fatto");
    expect(passoIniziale(passi, null, null)).toBe("fattura");
    // Anche con un passo richiesto: il percorso finito non lo rende un caso speciale.
    expect(passoIniziale(passi, null, "contratto")).toBe("contratto");
  });
});

describe("giorniTesto", () => {
  it("scrive «oggi», il singolare e il plurale", () => {
    expect(giorniTesto(0)).toBe("oggi");
    expect(giorniTesto(1)).toBe("1 giorno");
    expect(giorniTesto(12)).toBe("12 giorni");
  });

  it("usa il trattino quando non c'è una data di riferimento", () => {
    expect(giorniTesto(null)).toBe("—");
  });
});

describe("importiCard", () => {
  it("nasconde la riga quando il server non manda gli importi (niente economia.read)", () => {
    expect(
      importiCard(
        commessa({
          pattuitoCent: null,
          pattuitoTipo: null,
          fatturaPrevistaCent: null,
          fatturaPrevistaStima: false,
        })
      )
    ).toEqual({ pattuito: null, prevista: null, stima: false });
  });

  it("formatta gli importi con gli helper euro e segnala la stima", () => {
    expect(
      importiCard(
        commessa({
          pattuitoCent: 150000,
          fatturaPrevistaCent: 150000,
          fatturaPrevistaStima: true,
        })
      )
    ).toEqual({
      pattuito: "€ 1.500,00",
      prevista: "€ 1.500,00",
      stima: true,
    });
  });

  it("i due importi sono indipendenti: il pattuito può mancare mentre la prevista c'è", () => {
    expect(
      importiCard(
        commessa({
          pattuitoCent: null,
          fatturaPrevistaCent: 50000,
          fatturaPrevistaStima: true,
        })
      )
    ).toEqual({ pattuito: null, prevista: "€ 500,00", stima: true });
  });
});

describe("filtraCommesse", () => {
  const elenco = [
    commessa({
      commessaId: 1,
      codice: "ABC-001",
      cliente: "Mario Rossi",
      stato: "aggiornamento_contratto",
    }),
    commessa({
      commessaId: 2,
      codice: "XYZ-002",
      cliente: "Anna Bianchi",
      stato: "fatture_pagamento",
    }),
  ];

  it("senza filtri restituisce tutto l'elenco", () => {
    expect(
      filtraCommesse(elenco, { stato: "tutti", testo: "" }).map(
        c => c.commessaId
      )
    ).toEqual([1, 2]);
  });

  it("filtra per stato", () => {
    expect(
      filtraCommesse(elenco, { stato: "fatture_pagamento", testo: "" }).map(
        c => c.commessaId
      )
    ).toEqual([2]);
  });

  it("cerca per cliente senza distinguere maiuscole e minuscole", () => {
    expect(
      filtraCommesse(elenco, { stato: "tutti", testo: "rossi" }).map(
        c => c.commessaId
      )
    ).toEqual([1]);
  });

  it("cerca per codice senza distinguere maiuscole e minuscole", () => {
    expect(
      filtraCommesse(elenco, { stato: "tutti", testo: "xyz" }).map(
        c => c.commessaId
      )
    ).toEqual([2]);
  });

  it("combina stato e testo", () => {
    expect(
      filtraCommesse(elenco, {
        stato: "aggiornamento_contratto",
        testo: "bianchi",
      })
    ).toEqual([]);
  });
});
