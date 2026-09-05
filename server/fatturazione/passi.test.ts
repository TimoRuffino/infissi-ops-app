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

  // Ruling P4-R2: una nota di credito può convivere con la fattura vera già
  // emessa (nasce apposta per correggerla) e non deve mai mascherarne lo
  // stato o l'importo — né quando la fattura è emessa, né quando manca del
  // tutto.
  it("(j) una nota di credito in bozza non è la fattura attesa: contano lo stato e l'importo della fattura vera", () => {
    const r = calcolaPassi(
      ingresso({
        contratto: { righe: 3, pattuitoCent: 5_200_000, pattuitoTipo: "lordo" },
        computo: { valido: true, esito: "ok" },
        fatture: [
          { stato: "emessa", totaleCent: 5_000_000, tipo: "fattura" },
          { stato: "bozza", totaleCent: 300_000, tipo: "nota_credito" },
        ],
      })
    );
    expect(r.passi.fattura).toBe("fatto");
    // Non "bozza" (quella è della nota di credito): la fattura è emessa.
    expect(r.fatturaStato).toBe("emessa");
    // Nessuna bozza di tipo fattura: l'importo previsto torna al pattuito,
    // non ai 300_000 della nota di credito.
    expect(r.fatturaPrevistaCent).toBe(5_200_000);
    expect(r.fatturaPrevistaStima).toBe(false);
  });

  it("(j-bis) una nota di credito da sola, senza alcuna fattura, non vale come stato né come importo previsto", () => {
    const r = calcolaPassi(
      ingresso({
        fatture: [{ stato: "bozza", totaleCent: 300_000, tipo: "nota_credito" }],
      })
    );
    expect(r.fatturaStato).toBeNull();
    expect(r.fatturaPrevistaCent).toBeNull();
    expect(r.fatturaPrevistaStima).toBe(false);
  });

  it("(k) con il flag limiti spento, Limiti è non disponibile anche senza computo, e il prossimo passo lo salta", () => {
    const r = calcolaPassi(
      ingresso({
        contratto: { righe: 2, pattuitoCent: 1_000_000, pattuitoTipo: "lordo" },
        computo: null,
        flag: { limiti: false, fatturazione: true },
      })
    );
    expect(r.passi.limiti).toBe("non_disponibile");
    // Documenti e Contratto sono già fatti: il prossimo passo salta Limiti
    // (non disponibile, non "da fare") e arriva dritto a Fattura.
    expect(r.prossimoPasso).toBe("fattura");
  });

  it("(l1) una riga sola basta a chiudere Contratto", () => {
    const r = calcolaPassi(
      ingresso({
        contratto: { righe: 1, pattuitoCent: 100_000, pattuitoTipo: "lordo" },
      })
    );
    expect(r.passi.contratto).toBe("fatto");
  });

  it("(l2) un contratto senza righe resta in corso, non da fare", () => {
    const r = calcolaPassi(
      ingresso({
        contratto: { righe: 0, pattuitoCent: 100_000, pattuitoTipo: "lordo" },
      })
    );
    expect(r.passi.contratto).toBe("in_corso");
  });

  it("(m1) una nota di credito emessa da sola non completa il passo Fattura né ne diventa lo stato", () => {
    const r = calcolaPassi(
      ingresso({
        fatture: [{ stato: "emessa", totaleCent: 500_000, tipo: "nota_credito" }],
      })
    );
    // "emessa" è nel set STATI_FATTURA_EMESSA, ma qui conta il tipo: non è
    // una fattura, quindi il passo resta in corso (una nota attiva esiste),
    // mai "fatto" — e non diventa lo stato mostrato in card.
    expect(r.passi.fattura).toBe("in_corso");
    expect(r.fatturaStato).toBeNull();
  });

  it("(m2) una nota di credito in bozza non alimenta l'importo previsto quando c'è un contratto: vince il pattuito", () => {
    const r = calcolaPassi(
      ingresso({
        contratto: { righe: 2, pattuitoCent: 2_000_000, pattuitoTipo: "lordo" },
        fatture: [{ stato: "bozza", totaleCent: 500_000, tipo: "nota_credito" }],
      })
    );
    // Se la bozza della nota di credito alimentasse la previsione vedremmo
    // 500_000: invece, senza alcuna bozza di tipo fattura, la previsione
    // ricade sul pattuito del contratto.
    expect(r.fatturaPrevistaCent).toBe(2_000_000);
    expect(r.fatturaPrevistaStima).toBe(false);
  });

  it("(n) una fattura in_emissione mette il proprio totale come importo previsto", () => {
    const r = calcolaPassi(
      ingresso({
        contratto: { righe: 2, pattuitoCent: 1_000_000, pattuitoTipo: "lordo" },
        fatture: [{ stato: "in_emissione", totaleCent: 950_000, tipo: "fattura" }],
      })
    );
    expect(r.fatturaPrevistaCent).toBe(950_000);
    expect(r.fatturaPrevistaStima).toBe(false);
    expect(r.fatturaStato).toBe("in_emissione");
  });

  it("(o1) con due fatture attive in ordine cronologico, lo stato è quello dell'ultima", () => {
    const r = calcolaPassi(
      ingresso({
        fatture: [
          { stato: "bozza", totaleCent: 1_000_000, tipo: "fattura" },
          { stato: "in_emissione", totaleCent: 1_100_000, tipo: "fattura" },
        ],
      })
    );
    expect(r.fatturaStato).toBe("in_emissione");
  });

  it("(o2) se l'ultima fattura è annullata, lo stato torna a quello della precedente non annullata", () => {
    const r = calcolaPassi(
      ingresso({
        fatture: [
          { stato: "in_emissione", totaleCent: 1_000_000, tipo: "fattura" },
          { stato: "bozza", totaleCent: 1_100_000, tipo: "fattura" },
          { stato: "annullata", totaleCent: 1_200_000, tipo: "fattura" },
        ],
      })
    );
    expect(r.fatturaStato).toBe("bozza");
  });

  it("(p) un documento contratto con un mimeType diverso da pdf chiude comunque Documenti: conta il tipo, non il mime", () => {
    const r = calcolaPassi(
      ingresso({
        documenti: [{ tipo: "contratto", mimeType: "image/jpeg" }],
      })
    );
    expect(r.passi.documenti).toBe("fatto");
  });
});
