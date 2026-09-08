// Punto 17 del piano «Tars più intelligente»: le soglie nascono dalla
// storia dell'azienda, non da un numero scelto a mano. E punti 8 e 22: il
// margine come segnale, la posta in gioco come ordine.

import { describe, expect, it } from "vitest";
import {
  CAMPIONE_MINIMO_STATO,
  commesseLenteDiSede,
  medianePerStato,
  piuLenteDelSolito,
  type DipendenzeTempi,
} from "./tempiDiAttraversamento";
import { postaInGiocoDiSede, postaPerEntita } from "./postaInGioco";

const SEDE = 96_701;
const ALTRA = 96_702;
const ADESSO = new Date("2026-09-08T08:00:00Z");

/** Sei commesse chiuse: cinque passaggi «produzione» da 10 giorni, uno da 40. */
function storia(): DipendenzeTempi {
  const durate = [10, 10, 12, 8, 10, 40];
  const commesse = durate.map((_, i) => ({ id: 100 + i, sedeId: SEDE, stato: "archiviata" }));
  return {
    commesse: () => commesse,
    milestone: id => {
      const i = id - 100;
      if (i < 0 || i >= durate.length) return [];
      const inizio = new Date(Date.UTC(2026, 0, 10));
      const fine = new Date(inizio.getTime() + durate[i] * 86_400_000);
      return [
        { stato: "produzione", quando: inizio.toISOString().slice(0, 10) },
        { stato: "ordini_ultimazione", quando: fine.toISOString().slice(0, 10) },
      ];
    },
  };
}

describe("le mediane dalla storia vera", () => {
  it("calcola la mediana per stato, e la mediana non si fa spostare dal caso estremo", () => {
    const mediane = medianePerStato({ sedeId: SEDE, deps: storia() });
    const produzione = mediane.get("produzione")!;
    expect(produzione.campione).toBe(6);
    // Valori 8,10,10,10,12,40 → mediana 10, media sarebbe 15.
    expect(produzione.mediana).toBe(10);
  });

  it("sotto il campione minimo non si dichiara nessuna mediana", () => {
    const poche = storia();
    const ridotte = {
      ...poche,
      commesse: () => poche.commesse().slice(0, CAMPIONE_MINIMO_STATO - 1),
    };
    expect(medianePerStato({ sedeId: SEDE, deps: ridotte }).size).toBe(0);
  });

  it("le sedi hanno storie separate", () => {
    const altra = storia();
    const spostata = {
      ...altra,
      commesse: () => altra.commesse().map(c => ({ ...c, sedeId: ALTRA })),
    };
    expect(medianePerStato({ sedeId: SEDE, deps: spostata }).size).toBe(0);
  });
});

describe("più lente del solito", () => {
  const mediane = new Map([
    ["produzione", { stato: "produzione", mediana: 10, campione: 6 }],
  ]);

  it("il doppio della mediana è lento, una volta e mezza no", () => {
    const lente = piuLenteDelSolito({
      mediane,
      commesse: [
        { id: 1, stato: "produzione" },
        { id: 2, stato: "produzione" },
      ],
      giorniNelloStato: id => (id === 1 ? 25 : 15),
    });
    expect(lente.map(l => l.commessaId)).toEqual([1]);
    expect(lente[0].mediana).toBe(10);
    expect(lente[0].giorni).toBe(25);
  });

  it("uno stato senza mediana non produce segnalazioni: non si sa cosa sia normale", () => {
    expect(
      piuLenteDelSolito({
        mediane,
        commesse: [{ id: 1, stato: "attesa_posa" }],
        giorniNelloStato: () => 200,
      })
    ).toEqual([]);
  });

  it("sotto una settimana non si segnala niente, nemmeno se la mediana è un giorno", () => {
    expect(
      piuLenteDelSolito({
        mediane: new Map([["produzione", { stato: "produzione", mediana: 1, campione: 9 }]]),
        commesse: [{ id: 1, stato: "produzione" }],
        giorniNelloStato: () => 5,
      })
    ).toEqual([]);
  });

  it("le più fuori scala vengono prima", () => {
    const lente = piuLenteDelSolito({
      mediane,
      commesse: [
        { id: 1, stato: "produzione" },
        { id: 2, stato: "produzione" },
      ],
      giorniNelloStato: id => (id === 1 ? 22 : 90),
    });
    expect(lente.map(l => l.commessaId)).toEqual([2, 1]);
  });
});

describe("il giro completo di una sede", () => {
  it("mette insieme storia e lavori vivi", () => {
    const base = storia();
    const viva = { id: 200, sedeId: SEDE, stato: "produzione", archivedAt: null };
    const deps: DipendenzeTempi = {
      commesse: () => [...base.commesse(), viva],
      milestone: id =>
        id === 200
          ? [{ stato: "produzione", quando: "2026-07-01" }]
          : base.milestone(id),
    };
    const { mediane, lente } = commesseLenteDiSede({ sedeId: SEDE, adesso: ADESSO, deps });
    expect(mediane.get("produzione")!.mediana).toBe(10);
    expect(lente.map(l => l.commessaId)).toEqual([200]);
    expect(lente[0].giorni).toBeGreaterThan(60);
  });
});

describe("posta in gioco e margine (punti 8 e 22)", () => {
  const commesse = [
    {
      id: 1,
      sedeId: SEDE,
      stato: "produzione",
      archivedAt: null,
      importoTotale: 40_000,
      importoIncassato: 5_000,
      pattuitoImponibile: 32_000,
      costi: [{ id: 1, importo: 28_000 }],
    },
    {
      id: 2,
      sedeId: SEDE,
      stato: "produzione",
      archivedAt: null,
      importoTotale: 3_000,
      importoIncassato: 0,
      pattuitoImponibile: 2_500,
      costi: [{ id: 2, importo: 1_000 }],
    },
    // Senza costi il margine leggerebbe il 100%: non è una misura.
    {
      id: 3,
      sedeId: SEDE,
      stato: "produzione",
      archivedAt: null,
      importoTotale: 9_000,
      importoIncassato: 0,
      pattuitoImponibile: 8_000,
      costi: [],
    },
  ];
  const posta = postaInGiocoDiSede({ sedeId: SEDE, deps: { commesse: () => commesse } });

  it("il residuo è quello che resta da incassare", () => {
    expect(posta.get(1)!.residuo).toBe(35_000);
    expect(posta.get(2)!.residuo).toBe(3_000);
  });

  it("sotto la soglia è un flag, non una cifra", () => {
    expect(posta.get(1)!.sottoMargine).toBe(true); // 12,5 %
    expect(posta.get(2)!.sottoMargine).toBe(false); // 60 %
  });

  it("senza costi registrati il margine non si dichiara", () => {
    expect(posta.get(3)!.datiIncompleti).toBe(true);
    expect(posta.get(3)!.sottoMargine).toBe(false);
  });

  it("la posta per entità è quella che ordina le proposte", () => {
    const peso = postaPerEntita(posta);
    expect(peso["commessa:1"].residuo).toBe(35_000);
    expect(peso["commessa:1"].marginePerc).toBeCloseTo(0.125);
  });
});
