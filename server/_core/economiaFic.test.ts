import { describe, expect, it } from "vitest";
import {
  calcolaAggregatiFic,
  calcolaBreakEven,
  type DocumentoEconomico,
} from "./economiaFic";

const documento = (
  tipo: DocumentoEconomico["tipo"],
  data: string,
  netto: number,
  extra: Partial<DocumentoEconomico> = {}
): DocumentoEconomico => ({
  tipo,
  data,
  importoNetto: netto,
  importoIva: netto * 0.22,
  importoLordo: netto * 1.22,
  rate: [],
  presenteInFic: true,
  ignorato: false,
  ...extra,
});

describe("aggregati economici FiC", () => {
  it("rettifica fatture e costi con le rispettive note di credito", () => {
    const risultato = calcolaAggregatiFic(
      [
        documento("invoice", "2026-01-10", 1_000),
        documento("credit_note", "2026-01-20", 200),
        documento("expense", "2026-01-12", 400),
        documento("passive_credit_note", "2026-01-25", 50),
      ],
      2026
    );

    expect(risultato.vendite.netto).toBe(800);
    expect(risultato.acquisti.netto).toBe(350);
    expect(risultato.vendite.iva).toBeCloseTo(176);
    expect(risultato.mesi[0].venditeNetto).toBe(800);
    expect(risultato.mesi[0].acquistiNetto).toBe(350);
  });

  it("conta paid nei flussi e solo not_paid negli importi aperti", () => {
    const risultato = calcolaAggregatiFic(
      [
        documento("invoice", "2026-02-10", 1_000, {
          rate: [
            {
              importo: 400,
              stato: "paid",
              dataPagamento: "2026-02-20",
            },
            { importo: 500, stato: "not_paid" },
            { importo: 100, stato: "reversed" },
          ],
        }),
        documento("expense", "2026-02-11", 300, {
          rate: [
            {
              importo: 100,
              stato: "paid",
              dataPagamento: "2026-02-21",
            },
            { importo: 150, stato: "not_paid" },
            { importo: 50, stato: "cancelled" },
          ],
        }),
      ],
      2026
    );

    expect(risultato.vendite.pagato).toBe(400);
    expect(risultato.vendite.aperto).toBe(500);
    expect(risultato.acquisti.pagato).toBe(100);
    expect(risultato.acquisti.aperto).toBe(150);
  });

  it("attribuisce gli incassi al mese del pagamento anche per documenti di un altro anno", () => {
    const risultato = calcolaAggregatiFic(
      [
        documento("invoice", "2025-12-20", 1_000, {
          rate: [
            {
              importo: 1_220,
              stato: "paid",
              dataPagamento: "2026-02-03",
            },
          ],
        }),
      ],
      2026
    );

    expect(risultato.vendite.netto).toBe(0);
    expect(risultato.vendite.pagato).toBe(1_220);
    expect(risultato.mesi[1].incassi).toBe(1_220);
    expect(risultato.mesi[11].incassi).toBe(0);
  });

  it("separa le rate pagate senza data valida dal periodo annuale", () => {
    const risultato = calcolaAggregatiFic(
      [
        documento("invoice", "2026-02-10", 1_000, {
          rate: [
            { importo: 1_220, stato: "paid" },
            {
              importo: 100,
              stato: "paid",
              dataPagamento: "2026-19-01",
            },
          ],
        }),
        documento("expense", "2026-02-11", 400, {
          rate: [{ importo: 488, stato: "paid", dataPagamento: null }],
        }),
      ],
      2026
    );

    expect(risultato.vendite.pagato).toBe(0);
    expect(risultato.vendite.pagatoSenzaData).toBe(1_320);
    expect(risultato.vendite.ratePagateSenzaData).toBe(2);
    expect(risultato.acquisti.pagatoSenzaData).toBe(488);
    expect(risultato.acquisti.ratePagateSenzaData).toBe(1);
    expect(risultato.mesi.every(mese => mese.incassi === 0)).toBe(true);
    expect(risultato.mesi.every(mese => mese.uscite === 0)).toBe(true);
  });

  it("mantiene il conteggio senza data quando fattura e nota si compensano", () => {
    const risultato = calcolaAggregatiFic(
      [
        documento("invoice", "2026-02-10", 100, {
          rate: [{ importo: 122, stato: "paid", dataPagamento: null }],
        }),
        documento("credit_note", "2026-02-11", 100, {
          rate: [{ importo: 122, stato: "paid", dataPagamento: null }],
        }),
      ],
      2026
    );

    expect(risultato.vendite.pagatoSenzaData).toBe(0);
    expect(risultato.vendite.ratePagateSenzaData).toBe(2);
  });

  it("mantiene gli ignorati nei totali ed esclude solo fuori anno o non presenti", () => {
    const risultato = calcolaAggregatiFic(
      [
        documento("invoice", "2026-03-01", 100),
        documento("invoice", "2026-03-02", 200, { ignorato: true }),
        documento("invoice", "2026-03-03", 300, {
          presenteInFic: false,
        }),
        documento("invoice", "2025-03-04", 400),
      ],
      2026
    );

    expect(risultato.vendite.netto).toBe(300);
    expect(risultato.vendite.documenti).toBe(2);
  });
});

describe("break-even mensile", () => {
  it("esclude dal break-even i costi FiC fissi non presenti nel registro", () => {
    const emessi = [1, 2, 3].map(mese =>
      documento("invoice", `2026-0${mese}-10`, 10_000, { ignorato: true })
    );
    const costi = [1, 2, 3].flatMap(mese => [
      documento("expense", `2026-0${mese}-12`, 4_000, {
        classificazione: "variabile_commessa",
      }),
      documento("expense", `2026-0${mese}-15`, 1_000, {
        classificazione: "fisso",
      }),
    ]);

    const risultato = calcolaBreakEven({
      anno: 2026,
      mese: 4,
      documentiEmessi: emessi,
      costi,
    });

    expect(risultato.stato).toBe("disponibile");
    expect(risultato.fatturatoBase).toBe(30_000);
    expect(risultato.costiFissiMensili).toBe(0);
    expect(risultato.obiettivoMensile).toBe(0);
  });

  it("i costi fissi dichiarati a mano entrano nell'obiettivo", () => {
    // Stipendi e contributi non passano da Fatture in Cloud: senza questa
    // via il pareggio girava su una parte sola dei costi fissi.
    const emessi = [1, 2, 3].map(mese =>
      documento("invoice", `2026-0${mese}-10`, 10_000)
    );
    const costi = [1, 2, 3].flatMap(mese => [
      documento("expense", `2026-0${mese}-12`, 4_000, {
        classificazione: "variabile_commessa",
      }),
      documento("expense", `2026-0${mese}-15`, 1_000, {
        classificazione: "fisso",
      }),
    ]);

    const senza = calcolaBreakEven({
      anno: 2026,
      mese: 4,
      documentiEmessi: emessi,
      costi,
    });
    const con = calcolaBreakEven({
      anno: 2026,
      mese: 4,
      documentiEmessi: emessi,
      costi,
      costiFissiDichiarati: [{ mensile: 5_000, dal: "2026-01", al: null }],
    });

    expect(senza.costiFissiDichiarati).toBe(0);
    expect(con.costiFissiDichiarati).toBe(15_000);
    // Il peso di oggi arriva solo dal registro: 5.000 dichiarati.
    expect(con.costiFissiMensili).toBeCloseTo(5_000, 2);
    expect(con.obiettivoMensile).toBeGreaterThan(senza.obiettivoMensile!);
  });

  it("una voce gia' chiusa non alza l'obiettivo di oggi", () => {
    const emessi = [1, 2, 3].map(mese =>
      documento("invoice", `2026-0${mese}-10`, 10_000)
    );
    const costi = [1, 2, 3].flatMap(mese => [
      documento("expense", `2026-0${mese}-12`, 4_000, {
        classificazione: "variabile_commessa",
      }),
      documento("expense", `2026-0${mese}-15`, 1_000, {
        classificazione: "fisso",
      }),
    ]);

    const risultato = calcolaBreakEven({
      anno: 2026,
      mese: 4,
      documentiEmessi: emessi,
      costi,
      // Chiusa a gennaio: pesa sul totale del periodo, non sul mese corrente.
      costiFissiDichiarati: [{ mensile: 5_000, dal: "2026-01", al: "2026-01" }],
    });

    expect(risultato.costiFissiDichiarati).toBe(5_000);
    expect(risultato.costiFissiMensili).toBe(0);
  });

  it("usa margine di contribuzione e costi fissi degli ultimi dodici mesi", () => {
    const emessi: DocumentoEconomico[] = [];
    const costi: DocumentoEconomico[] = [];
    for (let mese = 8; mese <= 12; mese++) {
      const mm = String(mese).padStart(2, "0");
      emessi.push(documento("invoice", `2025-${mm}-10`, 10_000));
      costi.push(
        documento("expense", `2025-${mm}-12`, 4_000, {
          classificazione: "variabile_commessa",
        }),
        documento("expense", `2025-${mm}-15`, 3_000, {
          classificazione: "fisso",
        })
      );
    }
    for (let mese = 1; mese <= 7; mese++) {
      emessi.push(
        documento("invoice", `2026-${String(mese).padStart(2, "0")}-10`, 10_000)
      );
      costi.push(
        documento(
          "expense",
          `2026-${String(mese).padStart(2, "0")}-12`,
          4_000,
          {
            classificazione: "variabile_commessa",
          }
        ),
        documento(
          "expense",
          `2026-${String(mese).padStart(2, "0")}-15`,
          3_000,
          {
            classificazione: "fisso",
          }
        )
      );
    }
    emessi.push(documento("invoice", "2026-08-05", 2_000));
    emessi.push(documento("invoice", "2026-08-32", 77_000));
    emessi.push(documento("invoice", "2026-02-31", 99_000));
    costi.push(
      documento("expense", "2026-02-31", 99_000, {
        classificazione: "fisso",
      })
    );

    const risultato = calcolaBreakEven({
      anno: 2026,
      mese: 8,
      documentiEmessi: emessi,
      costi,
      costiFissiDichiarati: [{ mensile: 3_000, dal: "2025-08", al: null }],
    });

    expect(risultato.stato).toBe("disponibile");
    expect(risultato.affidabilita).toBe("alta");
    expect(risultato.mesiCoperti).toBe(12);
    expect(risultato.margineContribuzione).toBeCloseTo(0.6);
    expect(risultato.costiFissiMensili).toBeCloseTo(3_000);
    expect(risultato.obiettivoMensile).toBeCloseTo(5_000);
    expect(risultato.fatturatoMese).toBe(2_000);
    expect(risultato.ancoraDaFatturare).toBeCloseTo(3_000);
  });

  it("usa i mesi disponibili con affidabilita media e segnala i dubbi", () => {
    const emessi = [3, 4, 5].map(mese =>
      documento("invoice", `2026-0${mese}-10`, 10_000)
    );
    const costi = [3, 4, 5].flatMap(mese => [
      documento("expense", `2026-0${mese}-12`, 2_000, {
        classificazione: "variabile_commessa",
      }),
      documento("expense", `2026-0${mese}-15`, 1_600, {
        classificazione: "fisso",
      }),
    ]);
    costi.push(
      documento("expense", "2026-05-20", 900, {
        classificazione: "dubbio",
      })
    );

    const risultato = calcolaBreakEven({
      anno: 2026,
      mese: 6,
      documentiEmessi: emessi,
      costi,
      costiFissiDichiarati: [{ mensile: 1_600, dal: "2026-03", al: null }],
    });

    expect(risultato.stato).toBe("disponibile");
    expect(risultato.affidabilita).toBe("media");
    expect(risultato.mesiCoperti).toBe(3);
    expect(risultato.costiFissiMensili).toBe(1_600);
    expect(risultato.documentiDubbi).toBe(1);
    expect(risultato.importoDubbio).toBe(900);
  });

  it("non inventa un obiettivo con meno di tre mesi", () => {
    const risultato = calcolaBreakEven({
      anno: 2026,
      mese: 5,
      documentiEmessi: [documento("invoice", "2026-03-10", 10_000)],
      costi: [
        documento("expense", "2026-03-12", 2_000, {
          classificazione: "fisso",
        }),
      ],
    });

    expect(risultato.stato).toBe("dati_insufficienti");
    expect(risultato.obiettivoMensile).toBeNull();
    expect(risultato.motivi).toContain(
      "Servono almeno tre mesi di dati economici."
    );
  });
});

describe("break-even: cosa coprire e con quale margine", () => {
  const scenario = () => {
    const emessi = [1, 2, 3].map(mese =>
      documento("invoice", `2026-0${mese}-10`, 10_000)
    );
    const costi = [1, 2, 3].flatMap(mese => [
      documento("expense", `2026-0${mese}-12`, 4_000, {
        classificazione: "variabile_commessa",
      }),
      documento("expense", `2026-0${mese}-15`, 1_000, {
        classificazione: "fisso",
      }),
      documento("expense", `2026-0${mese}-20`, 2_000, {
        classificazione: "straordinario",
      }),
    ]);
    return {
      emessi,
      costi,
      costiFissiDichiarati: [{ mensile: 1_000, dal: "2026-01", al: null }],
    };
  };

  it("mostra i costi da coprire separati dal fatturato che serve", () => {
    const { emessi, costi, costiFissiDichiarati } = scenario();
    const r = calcolaBreakEven({
      anno: 2026,
      mese: 4,
      documentiEmessi: emessi,
      costi,
      costiFissiDichiarati,
    });
    // 1.000 al mese di costi fissi, margine 60%: servono 1.666 di fatturato.
    expect(r.daCoprireMensile).toBeCloseTo(1_000, 2);
    expect(r.margineContribuzione).toBeCloseTo(0.6, 4);
    expect(r.obiettivoMensile).toBeCloseTo(1_666.67, 2);
    // Gli straordinari esistono e restano fuori: dirlo è il punto.
    expect(r.costiStraordinari).toBe(6_000);
    expect(r.straordinariInclusi).toBe(false);
  });

  it("gli straordinari possono entrare fra i costi da coprire", () => {
    const { emessi, costi, costiFissiDichiarati } = scenario();
    const r = calcolaBreakEven({
      anno: 2026,
      mese: 4,
      documentiEmessi: emessi,
      costi,
      costiFissiDichiarati,
      includiStraordinari: true,
    });
    expect(r.straordinariInclusi).toBe(true);
    expect(r.daCoprireMensile).toBeCloseTo(3_000, 2);
    expect(r.obiettivoMensile).toBeCloseTo(5_000, 2);
  });

  it("un margine fissato a mano prevale, e resta detto quale era il calcolato", () => {
    const { emessi, costi, costiFissiDichiarati } = scenario();
    const r = calcolaBreakEven({
      anno: 2026,
      mese: 4,
      documentiEmessi: emessi,
      costi,
      costiFissiDichiarati,
      margineManuale: 0.25,
    });
    expect(r.margineFonte).toBe("manuale");
    expect(r.margineCalcolato).toBeCloseTo(0.6, 4);
    expect(r.margineContribuzione).toBeCloseTo(0.25, 4);
    expect(r.obiettivoMensile).toBeCloseTo(4_000, 2);
  });

  it("un margine fuori scala viene ignorato invece di produrre un obiettivo assurdo", () => {
    const { emessi, costi, costiFissiDichiarati } = scenario();
    for (const margine of [0, -0.5, 1.5]) {
      const r = calcolaBreakEven({
        anno: 2026,
        mese: 4,
        documentiEmessi: emessi,
        costi,
        costiFissiDichiarati,
        margineManuale: margine,
      });
      expect(r.margineFonte).toBe("calcolato");
      expect(r.obiettivoMensile).toBeCloseTo(1_666.67, 2);
    }
  });
});

describe("break-even: totale certo", () => {
  it("usa solo il registro confermato e ignora i documenti FiC fissi legacy", () => {
    const result = calcolaBreakEven({
      periodoDa: "2025-09-01",
      periodoA: "2026-08-31",
      documentiEmessi: [],
      documentiRicevuti: [{ classificazione: "fisso", importoNetto: 99_000 }],
      costiFissiDichiarati: [{ mensile: 2_500, mesiNelPeriodo: 12 }],
    } as any);

    expect(result.costiFissiMensili).toBe(2_500);
    expect(result.daCoprireMensile).toBe(2_500);
  });
});
