// "Fisso" è una definizione aritmetica, non un'opinione: se questa regola
// sbaglia, sbaglia il break-even e l'obiettivo mensile su /pagamenti.

import { describe, expect, it } from "vitest";
import {
  applicaCostiRicorrenti,
  rilevaCostiRicorrenti,
} from "./costiRicorrenti";

let seq = 0;
const costo = (
  fornitore: string,
  data: string,
  importoNetto: number,
  extra: Partial<any> = {}
) => ({
  id: ++seq,
  sedeId: 1,
  tipo: "expense" as const,
  data,
  fornitoreNome: fornitore,
  importoNetto,
  classificazione: "dubbio",
  fonteClassificazione: null as string | null,
  motivazione: null as string | null,
  confidenza: null as number | null,
  aggiornatoAt: new Date(0),
  ...extra,
});

describe("rilevaCostiRicorrenti", () => {
  it("riconosce tre mesi consecutivi dello stesso importo", () => {
    const gruppi = rilevaCostiRicorrenti(
      [
        costo("Immobiliare Sarzana Srl", "2026-05-01", 900),
        costo("Immobiliare Sarzana Srl", "2026-06-01", 900),
        costo("Immobiliare Sarzana Srl", "2026-07-01", 900),
      ],
      1
    );
    expect(gruppi).toHaveLength(1);
    expect(gruppi[0].importo).toBe(900);
    expect(gruppi[0].mesi).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(gruppi[0].motivazione).toContain("3 mesi consecutivi");
  });

  it("due mesi non bastano: è una coincidenza", () => {
    expect(
      rilevaCostiRicorrenti(
        [
          costo("Fornitore X", "2026-05-10", 400),
          costo("Fornitore X", "2026-06-10", 400),
        ],
        1
      )
    ).toEqual([]);
  });

  it("mesi sparsi non sono una ricorrenza", () => {
    expect(
      rilevaCostiRicorrenti(
        [
          costo("Sporadico", "2026-01-10", 300),
          costo("Sporadico", "2026-05-10", 300),
          costo("Sporadico", "2026-11-10", 300),
        ],
        1
      )
    ).toEqual([]);
  });

  it("importi diversi dallo stesso fornitore non fanno serie", () => {
    expect(
      rilevaCostiRicorrenti(
        [
          costo("Wnd", "2026-05-02", 1_200),
          costo("Wnd", "2026-06-02", 3_400),
          costo("Wnd", "2026-07-02", 780),
        ],
        1
      )
    ).toEqual([]);
  });

  it("tollera scarti di pochi centesimi e la forma societaria", () => {
    const gruppi = rilevaCostiRicorrenti(
      [
        costo("Assicurazioni Alfa S.r.l.", "2026-05-01", 250),
        costo("ASSICURAZIONI ALFA SRL", "2026-06-01", 250.2),
        costo("Assicurazioni Alfa s.r.l", "2026-07-01", 250),
      ],
      1
    );
    expect(gruppi).toHaveLength(1);
    expect(gruppi[0].mesi).toHaveLength(3);
  });

  it("le note di credito passive restano fuori", () => {
    expect(
      rilevaCostiRicorrenti(
        [
          costo("Storni Srl", "2026-05-01", 100, { tipo: "passive_credit_note" }),
          costo("Storni Srl", "2026-06-01", 100, { tipo: "passive_credit_note" }),
          costo("Storni Srl", "2026-07-01", 100, { tipo: "passive_credit_note" }),
        ],
        1
      )
    ).toEqual([]);
  });

  it("non attraversa le sedi", () => {
    expect(
      rilevaCostiRicorrenti(
        [
          costo("Canone", "2026-05-01", 100),
          costo("Canone", "2026-06-01", 100, { sedeId: 2 }),
          costo("Canone", "2026-07-01", 100),
        ],
        1
      )
    ).toEqual([]);
  });
});

describe("applicaCostiRicorrenti", () => {
  it("marca fisso con fonte regola e motivazione leggibile", () => {
    const costi = [
      costo("Canone Cloud", "2026-05-01", 49),
      costo("Canone Cloud", "2026-06-01", 49),
      costo("Canone Cloud", "2026-07-01", 49),
    ];
    const esito = applicaCostiRicorrenti(costi, 1);

    expect(esito.aggiornati).toBe(3);
    for (const riga of costi) {
      expect(riga.classificazione).toBe("fisso");
      expect(riga.fonteClassificazione).toBe("regola");
      expect(riga.motivazione).toContain("mesi consecutivi");
    }
  });

  it("è idempotente", () => {
    const costi = [
      costo("Leasing", "2026-05-01", 310),
      costo("Leasing", "2026-06-01", 310),
      costo("Leasing", "2026-07-01", 310),
    ];
    applicaCostiRicorrenti(costi, 1);
    expect(applicaCostiRicorrenti(costi, 1).aggiornati).toBe(0);
  });

  it("non sovrascrive la decisione di una persona", () => {
    const costi = [
      costo("Commercialista", "2026-05-01", 200, {
        classificazione: "straordinario",
        fonteClassificazione: "utente",
      }),
      costo("Commercialista", "2026-06-01", 200),
      costo("Commercialista", "2026-07-01", 200),
    ];
    applicaCostiRicorrenti(costi, 1);

    expect(costi[0].classificazione).toBe("straordinario");
    expect(costi[1].classificazione).toBe("fisso");
  });

  it("sovrascrive invece una classificazione di Tars", () => {
    const costi = [
      costo("Affitto", "2026-05-01", 900, {
        classificazione: "straordinario",
        fonteClassificazione: "tars",
      }),
      costo("Affitto", "2026-06-01", 900),
      costo("Affitto", "2026-07-01", 900),
    ];
    applicaCostiRicorrenti(costi, 1);
    expect(costi[0].classificazione).toBe("fisso");
    expect(costi[0].fonteClassificazione).toBe("regola");
  });
});
