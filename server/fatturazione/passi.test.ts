// server/fatturazione/passi.test.ts
// `calcolaPassi` decide, per una commessa, a che punto è il percorso guidato
// di fatturazione: quattro passi (Documenti, Contratto, Limiti, Fattura),
// il prossimo da fare e l'importo di fattura previsto. È una funzione pura
// (nessun accesso a store): il router `fatturazioneGuidata` (piano 4, task
// successivi) le passa solo ciò che ha già letto.
//
// Specifica: docs/superpowers/specs/2026-09-05-fatturazione-guidata-design.md
// §4.1 (stato dei passi) e §4.3 (importi). Le lettere (a)-(i) nei commenti
// richiamano la tabella di casi del task.
import { describe, expect, it } from "vitest";

import { calcolaPassi, STATI_FATTURA_EMESSA, type IngressoPassi } from "./passi";

/** Ingresso di base — «niente di niente» — con solo le differenze del caso. */
function ingresso(overrides: Partial<IngressoPassi> = {}): IngressoPassi {
  return {
    documenti: [],
    contratto: null,
    computo: null,
    fatture: [],
    flag: { limiti: true, fatturazione: true },
    ...overrides,
  };
}

describe("STATI_FATTURA_EMESSA", () => {
  it("sono esattamente emessa, inviata, consegnata, mancata_consegna", () => {
    expect([...STATI_FATTURA_EMESSA]).toEqual([
      "emessa",
      "inviata",
      "consegnata",
      "mancata_consegna",
    ]);
  });
});

describe("calcolaPassi", () => {
  it("(a) senza nulla, i quattro passi sono da fare e si parte dai documenti", () => {
    const r = calcolaPassi(ingresso());
    expect(r.passi).toEqual({
      documenti: "da_fare",
      contratto: "da_fare",
      limiti: "da_fare",
      fattura: "da_fare",
    });
    expect(r.prossimoPasso).toBe("documenti");
    expect(r.fatturaStato).toBeNull();
    expect(r.fatturaPrevistaCent).toBeNull();
    expect(r.fatturaPrevistaStima).toBe(false);
  });

  it("(b) un documento di tipo contratto basta a chiudere Documenti anche senza contratto strutturato", () => {
    const r = calcolaPassi(
      ingresso({
        documenti: [{ tipo: "contratto", mimeType: "application/pdf" }],
      })
    );
    expect(r.passi.documenti).toBe("fatto");
    expect(r.passi.contratto).toBe("da_fare");
    expect(r.prossimoPasso).toBe("contratto");
  });

  it("(c) un contratto con righe e un computo valido ok chiudono Limiti: si passa a Fattura", () => {
    const r = calcolaPassi(
      ingresso({
        contratto: { righe: 3, pattuitoCent: 5_000_000, pattuitoTipo: "lordo" },
        computo: { valido: true, esito: "ok" },
      })
    );
    expect(r.passi).toEqual({
      documenti: "fatto",
      contratto: "fatto",
      limiti: "fatto",
      fattura: "da_fare",
    });
    expect(r.prossimoPasso).toBe("fattura");
    // Pattuito lordo, senza bozza: l'importo previsto è il pattuito stesso.
    expect(r.fatturaPrevistaCent).toBe(5_000_000);
    expect(r.fatturaPrevistaStima).toBe(false);
  });

  it("(d) un computo che esiste ma non è valido/ok lascia Limiti in corso, non fatto", () => {
    const r = calcolaPassi(
      ingresso({
        contratto: { righe: 3, pattuitoCent: 5_000_000, pattuitoTipo: "lordo" },
        computo: { valido: false, esito: "incompleto" },
      })
    );
    expect(r.passi.limiti).toBe("in_corso");
    expect(r.prossimoPasso).toBe("limiti");
  });

  it("(e) una bozza di fattura mette Fattura in corso e ne diventa l'importo previsto", () => {
    const r = calcolaPassi(
      ingresso({
        contratto: { righe: 3, pattuitoCent: 5_000_000, pattuitoTipo: "lordo" },
        computo: { valido: true, esito: "ok" },
        fatture: [{ stato: "bozza", totaleCent: 4_800_000, tipo: "fattura" }],
      })
    );
    expect(r.passi.fattura).toBe("in_corso");
    expect(r.prossimoPasso).toBe("fattura");
    // La bozza vince sul pattuito: è un importo vero, non una stima.
    expect(r.fatturaPrevistaCent).toBe(4_800_000);
    expect(r.fatturaPrevistaStima).toBe(false);
    expect(r.fatturaStato).toBe("bozza");
  });

  it("(f) una fattura inviata chiude anche Fattura: nessun passo resta da fare", () => {
    const r = calcolaPassi(
      ingresso({
        contratto: { righe: 3, pattuitoCent: 5_000_000, pattuitoTipo: "lordo" },
        computo: { valido: true, esito: "ok" },
        fatture: [{ stato: "inviata", totaleCent: 5_000_000, tipo: "fattura" }],
      })
    );
    expect(r.passi.fattura).toBe("fatto");
    expect(r.prossimoPasso).toBeNull();
    expect(r.fatturaStato).toBe("inviata");
  });

  it("(g1) con il flag fatturazione spento, Fattura è non disponibile e il prossimo passo resta Limiti se non è fatto", () => {
    const r = calcolaPassi(
      ingresso({
        contratto: { righe: 2, pattuitoCent: 1_000_000, pattuitoTipo: "lordo" },
        computo: null,
        flag: { limiti: true, fatturazione: false },
      })
    );
    expect(r.passi.fattura).toBe("non_disponibile");
    expect(r.prossimoPasso).toBe("limiti");
  });

  it("(g2) con il flag fatturazione spento e tutto il resto fatto, non resta nessun prossimo passo", () => {
    const r = calcolaPassi(
      ingresso({
        contratto: { righe: 2, pattuitoCent: 1_000_000, pattuitoTipo: "lordo" },
        computo: { valido: true, esito: "ok" },
        flag: { limiti: true, fatturazione: false },
      })
    );
    expect(r.passi.fattura).toBe("non_disponibile");
    expect(r.prossimoPasso).toBeNull();
  });

  it("(h) un pattuito imponibile senza bozza è stimato lordo, con il +10% dichiarato come stima", () => {
    const r = calcolaPassi(
      ingresso({
        contratto: {
          righe: 1,
          pattuitoCent: 1_000_000,
          pattuitoTipo: "imponibile",
        },
      })
    );
    expect(r.fatturaPrevistaCent).toBe(1_100_000);
    expect(r.fatturaPrevistaStima).toBe(true);
  });

  it("(i) una fattura annullata non conta: né per lo stato, né per l'importo previsto, né per l'avanzamento", () => {
    const r = calcolaPassi(
      ingresso({
        fatture: [
          { stato: "annullata", totaleCent: 1_000_000, tipo: "fattura" },
          { stato: "bozza", totaleCent: 2_000_000, tipo: "fattura" },
        ],
      })
    );
    // La bozza reale conta, l'annullata viene ignorata come se non esistesse.
    expect(r.passi.fattura).toBe("in_corso");
    expect(r.fatturaStato).toBe("bozza");
    expect(r.fatturaPrevistaCent).toBe(2_000_000);
    expect(r.fatturaPrevistaStima).toBe(false);
  });

  it("(i-bis) con la sola fattura annullata, Fattura resta da fare e l'importo previsto è nullo senza contratto", () => {
    const r = calcolaPassi(
      ingresso({
        fatture: [{ stato: "annullata", totaleCent: 1_000_000, tipo: "fattura" }],
      })
    );
    expect(r.passi.fattura).toBe("da_fare");
    expect(r.fatturaStato).toBeNull();
    expect(r.fatturaPrevistaCent).toBeNull();
  });
});
