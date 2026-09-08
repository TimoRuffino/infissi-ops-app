// Le frasi che l'azienda legge nell'avviso della shell (spec WS4 §8). Test
// puro: nessun DOM, nessuna query — `frasiAvviso` riceve i due payload del
// router e l'istante, e restituisce righe. Ogni caso fissa il TESTO ITALIANO
// esatto: è il contratto con chi legge, e cambiarlo deve costare un test.
import { describe, expect, it } from "vitest";

import {
  etichettaStato,
  etichettaTipo,
  frasiAvviso,
  meseScritto,
  tonoStato,
  type Abbonamento,
  type Consumi,
} from "./testi";

const ADESSO = new Date(2026, 8, 8, 12, 0, 0); // 08/09/2026, mezzogiorno locale

/** Un'azienda in regola: prova lunga, spazio vuoto, Tars appena avviato. */
function abbonamentoTranquillo(): Abbonamento {
  return {
    tipo: "paid",
    stato: "trialing",
    periodicita: null,
    inizioPeriodo: new Date(2026, 8, 1),
    finePeriodo: new Date(2026, 9, 1),
    prossimoRinnovo: null,
    disdettaAFinePeriodo: false,
    omaggio: null,
    giorniAllaScadenza: 23,
    solaLettura: false,
  };
}

function consumiTranquilli(): Consumi {
  return {
    storage: {
      bytes: 1_000,
      quotaBytes: 100_000,
      percentuale: 1,
      bloccoDal: null,
      tolleranzaGiorni: 7,
    },
    tars: {
      percentuale: 12,
      budgetEur: 25,
      extraEur: 0,
      bloccoDal: null,
      tolleranzaGiorni: 7,
      mese: "2026-09",
    },
  };
}

const testi = (frasi: ReturnType<typeof frasiAvviso>) => frasi.map(f => f.testo);

describe("frasiAvviso", () => {
  it("tace quando l'azienda è in regola e sotto le soglie", () => {
    expect(frasiAvviso(abbonamentoTranquillo(), consumiTranquilli(), ADESSO)).toEqual([]);
  });

  it("tace finché i due payload non sono arrivati", () => {
    expect(frasiAvviso(undefined, undefined, ADESSO)).toEqual([]);
  });

  it("annuncia la prova che finisce entro sette giorni", () => {
    const frasi = frasiAvviso(
      { ...abbonamentoTranquillo(), giorniAllaScadenza: 3 },
      consumiTranquilli(),
      ADESSO
    );
    expect(testi(frasi)).toEqual(["La prova gratuita finisce fra 3 giorni"]);
    expect(frasi[0].tono).toBe("attenzione");
    expect(frasi[0].chiave).toBe("prova:3");
  });

  it("usa il singolare all'ultimo giorno e «oggi» quando è scaduta oggi", () => {
    expect(
      testi(frasiAvviso({ ...abbonamentoTranquillo(), giorniAllaScadenza: 1 }, consumiTranquilli(), ADESSO))
    ).toEqual(["La prova gratuita finisce fra 1 giorno"]);
    expect(
      testi(frasiAvviso({ ...abbonamentoTranquillo(), giorniAllaScadenza: 0 }, consumiTranquilli(), ADESSO))
    ).toEqual(["La prova gratuita finisce oggi"]);
  });

  it("annuncia l'omaggio in scadenza con il suo nome, non come una prova", () => {
    const frasi = frasiAvviso(
      {
        ...abbonamentoTranquillo(),
        tipo: "complimentary",
        stato: "active",
        giorniAllaScadenza: 5,
        omaggio: { scadenza: new Date(2026, 8, 13) },
      },
      consumiTranquilli(),
      ADESSO
    );
    expect(testi(frasi)).toEqual(["L'abbonamento omaggio finisce fra 5 giorni"]);
    expect(frasi[0].chiave).toBe("omaggio:5");
  });

  it("dice da quanti giorni l'abbonamento è insoluto e cosa succede dopo", () => {
    const frasi = frasiAvviso(
      { ...abbonamentoTranquillo(), stato: "past_due", giorniAllaScadenza: -2 },
      consumiTranquilli(),
      ADESSO
    );
    expect(testi(frasi)).toEqual([
      "Abbonamento scaduto: da 2 giorni in attesa di pagamento, poi sola lettura",
    ]);
    expect(frasi[0].tono).toBe("errore");
  });

  it("annuncia la sola lettura e non ripete l'insoluto", () => {
    const frasi = frasiAvviso(
      { ...abbonamentoTranquillo(), stato: "suspended", giorniAllaScadenza: -12, solaLettura: true },
      consumiTranquilli(),
      ADESSO
    );
    expect(testi(frasi)).toEqual([
      "Azienda in sola lettura: nessuna modifica finché l'abbonamento non è regolarizzato",
    ]);
    expect(frasi[0].tono).toBe("errore");
    expect(frasi[0].chiave).toBe("sola-lettura");
  });

  it("avvisa dallo 80 % di spazio dicendo quanto dura la tolleranza", () => {
    const consumi = consumiTranquilli();
    const frasi = frasiAvviso(abbonamentoTranquillo(), {
      ...consumi,
      storage: { ...consumi.storage, bytes: 92_000, percentuale: 92 },
    }, ADESSO);
    expect(testi(frasi)).toEqual([
      "Spazio al 92 %: oltre il 100 % i caricamenti si fermano dopo 7 giorni",
    ]);
    expect(frasi[0].tono).toBe("attenzione");
    expect(frasi[0].chiave).toBe("storage:92");
  });

  it("dice la data del blocco mentre la tolleranza corre", () => {
    const consumi = consumiTranquilli();
    const frasi = frasiAvviso(abbonamentoTranquillo(), {
      ...consumi,
      storage: {
        ...consumi.storage,
        bytes: 101_000,
        percentuale: 101,
        bloccoDal: new Date(2026, 8, 15, 9, 0, 0),
      },
    }, ADESSO);
    expect(testi(frasi)).toEqual([
      "Spazio al 101 %: dal 15/09/2026 i caricamenti nuovi si fermano",
    ]);
    expect(frasi[0].tono).toBe("attenzione");
  });

  it("dichiara i caricamenti fermi quando la tolleranza è finita", () => {
    const consumi = consumiTranquilli();
    const frasi = frasiAvviso(abbonamentoTranquillo(), {
      ...consumi,
      storage: {
        ...consumi.storage,
        bytes: 120_000,
        percentuale: 120,
        bloccoDal: new Date(2026, 8, 1, 9, 0, 0),
      },
    }, ADESSO);
    expect(testi(frasi)).toEqual([
      "Caricamenti fermi dal 01/09/2026: libera spazio o chiedi capacità",
    ]);
    expect(frasi[0].tono).toBe("errore");
    expect(frasi[0].chiave).toBe("storage-bloccato:2026-09-01");
  });

  it("avvisa dall'80 % del budget Tars del mese", () => {
    const consumi = consumiTranquilli();
    const frasi = frasiAvviso(abbonamentoTranquillo(), {
      ...consumi,
      tars: { ...consumi.tars, percentuale: 85 },
    }, ADESSO);
    expect(testi(frasi)).toEqual(["Tars all'85 % del budget del mese"]);
    expect(frasi[0].tono).toBe("attenzione");
    expect(frasi[0].chiave).toBe("tars:85");
  });

  it("dichiara Tars fermo quando la tolleranza del budget è finita", () => {
    const consumi = consumiTranquilli();
    const frasi = frasiAvviso(abbonamentoTranquillo(), {
      ...consumi,
      tars: { ...consumi.tars, percentuale: 140, bloccoDal: new Date(2026, 8, 2) },
    }, ADESSO);
    expect(testi(frasi)).toEqual(["Tars fermo per questo mese"]);
    expect(frasi[0].tono).toBe("errore");
    expect(frasi[0].chiave).toBe("tars-bloccato:2026-09");
  });

  it("tace su Tars quando l'azienda non ha un budget (percentuale sconosciuta)", () => {
    const consumi = consumiTranquilli();
    expect(
      frasiAvviso(abbonamentoTranquillo(), {
        ...consumi,
        tars: { ...consumi.tars, percentuale: null, budgetEur: null },
      }, ADESSO)
    ).toEqual([]);
  });

  it("mette in fila abbonamento, spazio e Tars quando cadono insieme", () => {
    const frasi = frasiAvviso(
      { ...abbonamentoTranquillo(), giorniAllaScadenza: 2 },
      {
        storage: {
          bytes: 95_000,
          quotaBytes: 100_000,
          percentuale: 95,
          bloccoDal: null,
          tolleranzaGiorni: 7,
        },
        tars: {
          percentuale: 88,
          budgetEur: 25,
          extraEur: 0,
          bloccoDal: null,
          tolleranzaGiorni: 7,
          mese: "2026-09",
        },
      },
      ADESSO
    );
    expect(frasi.map(f => f.chiave)).toEqual(["prova:2", "storage:95", "tars:88"]);
  });
});

describe("etichette della scheda", () => {
  it("traduce ogni stato in italiano operativo e non lascia buchi", () => {
    expect(etichettaStato("trialing")).toBe("In prova");
    expect(etichettaStato("active")).toBe("Attivo");
    expect(etichettaStato("past_due")).toBe("In attesa di pagamento");
    expect(etichettaStato("suspended")).toBe("Sola lettura");
    expect(etichettaStato("cancelled")).toBe("Disdetto");
    // Un'azienda senza riga di abbonamento non deve leggere «null».
    expect(etichettaStato(null)).toBe("Nessun abbonamento");
  });

  it("chiama l'omaggio col suo nome e dà il tono giusto agli stati che tolgono", () => {
    expect(etichettaTipo("complimentary")).toBe("Abbonamento omaggio");
    expect(etichettaTipo("paid")).toBe("Abbonamento");
    expect(tonoStato("active")).toBe("quieto");
    expect(tonoStato("past_due")).toBe("attenzione");
    expect(tonoStato("suspended")).toBe("errore");
  });

  it("legge il mese del budget in italiano e non si rompe su un valore storto", () => {
    expect(meseScritto("2026-09")).toBe("settembre 2026");
    expect(meseScritto("boh")).toBe("boh");
  });
});
