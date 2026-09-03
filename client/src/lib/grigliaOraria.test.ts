// La griglia oraria promette tre cose, e sono queste a essere provate qui:
// l'altezza di un blocco è la sua durata, due lavori nella stessa fascia
// stanno affiancati e non nascosti, e i dati storti (fine prima dell'inizio,
// ora mancante, orario impossibile) non fanno sparire niente dallo schermo.
//
// Un appuntamento che non si vede è peggio di un calendario brutto: è una
// squadra che si presenta dove non deve.
import { describe, expect, it } from "vitest";

import {
  DURATA_MINIMA_VISIVA_MIN,
  LARGHEZZA_MINIMA_PCT,
  DURATA_PREDEFINITA_MIN,
  ORA_APERTURA_MIN,
  ORA_CHIUSURA_MIN,
  caricoGiornata,
  disponiSovrapposti,
  finestraOraria,
  intervalloDi,
  minutiDaOra,
  oraDaMinuti,
  oreDellaFinestra,
  posizioneBlocco,
} from "./grigliaOraria";

const ev = (id: number, inizio: string | null, fine?: string | null) => ({
  id,
  inizio,
  fine,
});

describe("minutiDaOra", () => {
  it("legge un orario normale", () => {
    expect(minutiDaOra("08:00")).toBe(480);
    expect(minutiDaOra("00:00")).toBe(0);
    expect(minutiDaOra("23:59")).toBe(1439);
    expect(minutiDaOra("9:30")).toBe(570);
  });

  it("rifiuta quello che non è un orario", () => {
    for (const brutto of [null, undefined, "", "  ", "mezzogiorno", "8", "08:0", "25:00", "10:75", "8:00:00"]) {
      expect(minutiDaOra(brutto as any)).toBeNull();
    }
  });

  it("gli spazi attorno non contano", () => {
    expect(minutiDaOra(" 14:30 ")).toBe(870);
  });

  it("torna indietro senza perdere niente", () => {
    for (const m of [0, 480, 870, 1439]) {
      expect(minutiDaOra(oraDaMinuti(m))).toBe(m);
    }
  });
});

describe("intervalloDi", () => {
  it("usa inizio e fine quando ci sono entrambi", () => {
    expect(intervalloDi(ev(1, "08:00", "13:00"))).toEqual({
      inizioMin: 480,
      fineMin: 780,
    });
  });

  it("senza fine mette una durata di default, non altezza zero", () => {
    expect(intervalloDi(ev(1, "09:00"))).toEqual({
      inizioMin: 540,
      fineMin: 540 + DURATA_PREDEFINITA_MIN,
    });
  });

  it("una fine prima dell'inizio è un dato sbagliato, non un viaggio nel tempo", () => {
    expect(intervalloDi(ev(1, "15:00", "09:00"))).toEqual({
      inizioMin: 900,
      fineMin: 900 + DURATA_PREDEFINITA_MIN,
    });
  });

  it("una fine uguale all'inizio riceve comunque una durata", () => {
    const i = intervalloDi(ev(1, "10:00", "10:00"))!;
    expect(i.fineMin).toBeGreaterThan(i.inizioMin);
  });

  it("senza inizio non è un blocco della griglia", () => {
    expect(intervalloDi(ev(1, null, "12:00"))).toBeNull();
  });
});

describe("finestraOraria", () => {
  it("di base è la giornata lavorativa, non la mezzanotte", () => {
    expect(finestraOraria([ev(1, "09:00", "10:00")])).toEqual({
      daMin: ORA_APERTURA_MIN,
      aMin: ORA_CHIUSURA_MIN,
    });
  });

  it("si allarga per contenere chi sta fuori orario", () => {
    const f = finestraOraria([ev(1, "06:15", "07:00"), ev(2, "18:00", "20:30")]);
    expect(f.daMin).toBe(6 * 60);
    expect(f.aMin).toBe(21 * 60);
  });

  it("non supera la mezzanotte", () => {
    expect(finestraOraria([ev(1, "23:00", "23:59")]).aMin).toBe(24 * 60);
  });

  it("senza eventi resta la giornata lavorativa", () => {
    expect(finestraOraria([])).toEqual({
      daMin: ORA_APERTURA_MIN,
      aMin: ORA_CHIUSURA_MIN,
    });
  });

  it("gli eventi senza orario non la spostano", () => {
    expect(finestraOraria([ev(1, null), ev(2, "10:00", "11:00")])).toEqual({
      daMin: ORA_APERTURA_MIN,
      aMin: ORA_CHIUSURA_MIN,
    });
  });

  it("le ore etichettate coprono la finestra, estremi inclusi", () => {
    const ore = oreDellaFinestra({ daMin: 7 * 60, aMin: 10 * 60 });
    expect(ore.map(oraDaMinuti)).toEqual(["07:00", "08:00", "09:00", "10:00"]);
  });
});

describe("disponiSovrapposti", () => {
  it("chi non si tocca sta su una colonna sola, a tutta larghezza", () => {
    const d = disponiSovrapposti([
      ev(1, "08:00", "09:00"),
      ev(2, "10:00", "11:00"),
    ]);
    expect(d.map(b => b.colonne)).toEqual([1, 1]);
    expect(d.map(b => b.colonna)).toEqual([0, 0]);
  });

  it("due che si accavallano si dividono la larghezza", () => {
    const d = disponiSovrapposti([
      ev(1, "09:00", "11:00"),
      ev(2, "10:00", "12:00"),
    ]);
    expect(d.map(b => b.colonne)).toEqual([2, 2]);
    expect(d.map(b => b.colonna)).toEqual([0, 1]);
  });

  it("una catena A-B-C tiene la stessa larghezza per tutti e tre", () => {
    // A 09-10, B 09:30-10:30, C 10:15-11: A e C sono disgiunti, ma B li lega,
    // quindi appartengono allo stesso gruppo e hanno la stessa larghezza. Sono
    // due colonne e non tre: C riusa la colonna che A ha lasciato libera, e
    // allargare a tre sprecherebbe un terzo dello spazio per niente.
    const d = disponiSovrapposti([
      ev(1, "09:00", "10:00"),
      ev(2, "09:30", "10:30"),
      ev(3, "10:15", "11:00"),
    ]);
    expect(new Set(d.map(b => b.colonne))).toEqual(new Set([2]));
    const perId = new Map(d.map(b => [b.evento.id, b.colonna]));
    expect(perId.get(1)).toBe(0);
    expect(perId.get(2)).toBe(1);
    expect(perId.get(3)).toBe(0);
  });

  it("una colonna liberata si riusa invece di allargare tutto", () => {
    // Il lungo tiene la colonna 0; i due brevi si passano la colonna 1.
    const d = disponiSovrapposti([
      ev(1, "09:00", "12:00"),
      ev(2, "09:00", "10:00"),
      ev(3, "10:00", "11:00"),
    ]);
    expect(d.every(b => b.colonne === 2)).toBe(true);
    const perId = new Map(d.map(b => [b.evento.id, b.colonna]));
    expect(perId.get(1)).toBe(0);
    expect(perId.get(2)).toBe(1);
    expect(perId.get(3)).toBe(1);
  });

  it("a parità di inizio il più lungo sta a sinistra", () => {
    const d = disponiSovrapposti([
      ev(1, "08:00", "09:00"),
      ev(2, "08:00", "17:00"),
    ]);
    expect(d[0].evento.id).toBe(2);
    expect(d[0].colonna).toBe(0);
  });

  it("chi finisce quando l'altro comincia non si accavalla", () => {
    const d = disponiSovrapposti([
      ev(1, "09:00", "10:00"),
      ev(2, "10:00", "11:00"),
    ]);
    expect(d.every(b => b.colonne === 1)).toBe(true);
  });

  it("gli eventi senza orario restano fuori dalla griglia", () => {
    const d = disponiSovrapposti([ev(1, null), ev(2, "09:00", "10:00")]);
    expect(d).toHaveLength(1);
    expect(d[0].evento.id).toBe(2);
  });

  it("nessun blocco viene perso, comunque siano ordinati in ingresso", () => {
    const eventi = [
      ev(1, "14:00", "18:00"),
      ev(2, "08:00", "17:00"),
      ev(3, "09:30", "10:30"),
      ev(4, "08:00", "08:30"),
      ev(5, "19:00", "20:00"),
    ];
    expect(disponiSovrapposti(eventi)).toHaveLength(5);
    expect(disponiSovrapposti([...eventi].reverse())).toHaveLength(5);
  });

  it("due blocchi della stessa colonna non si sovrappongono mai", () => {
    const d = disponiSovrapposti([
      ev(1, "08:00", "12:00"),
      ev(2, "08:30", "09:30"),
      ev(3, "09:00", "10:00"),
      ev(4, "09:45", "11:00"),
      ev(5, "13:00", "14:00"),
    ]);
    for (let i = 0; i < d.length; i++) {
      for (let j = i + 1; j < d.length; j++) {
        if (d[i].colonna !== d[j].colonna) continue;
        const separati =
          d[i].fineMin <= d[j].inizioMin || d[j].fineMin <= d[i].inizioMin;
        expect(separati).toBe(true);
      }
    }
  });
});

describe("posizioneBlocco", () => {
  const finestra = { daMin: 7 * 60, aMin: 19 * 60 }; // 12 ore

  it("l'altezza è la durata: una posa di 6 ore occupa mezza griglia", () => {
    const [b] = disponiSovrapposti([ev(1, "08:00", "14:00")]);
    const p = posizioneBlocco(b, finestra);
    expect(p.altezzaPct).toBeCloseTo(50, 5);
    expect(p.topPct).toBeCloseTo((60 / 720) * 100, 5);
  });

  it("un blocco brevissimo resta cliccabile invece di sparire", () => {
    const [b] = disponiSovrapposti([ev(1, "09:00", "09:05")]);
    const p = posizioneBlocco(b, finestra);
    expect(p.altezzaPct).toBeCloseTo((DURATA_MINIMA_VISIVA_MIN / 720) * 100, 5);
  });

  it("l'alzata minima non fa sporgere il blocco sotto la griglia", () => {
    const [b] = disponiSovrapposti([ev(1, "18:55", "19:00")]);
    const p = posizioneBlocco(b, finestra);
    expect(p.topPct + p.altezzaPct).toBeLessThanOrEqual(100.0001);
  });

  it("chi comincia prima della finestra viene tagliato, non spostato fuori", () => {
    const [b] = disponiSovrapposti([ev(1, "05:00", "08:00")]);
    const p = posizioneBlocco(b, finestra);
    expect(p.topPct).toBe(0);
    expect(p.altezzaPct).toBeCloseTo((60 / 720) * 100, 5);
  });

  it("due sovrapposti si dividono a metà senza coprirsi", () => {
    const d = disponiSovrapposti([
      ev(1, "09:00", "11:00"),
      ev(2, "09:30", "11:30"),
    ]);
    const p = d.map(b => posizioneBlocco(b, finestra));
    expect(p[0]).toMatchObject({ sinistraPct: 0, larghezzaPct: 50 });
    expect(p[1]).toMatchObject({ sinistraPct: 50, larghezzaPct: 50 });
    // Il bordo destro del primo tocca il sinistro del secondo: niente
    // sovrapposizione, perché a due colonne non serve.
    expect(p[0].sinistraPct + p[0].larghezzaPct).toBe(p[1].sinistraPct);
  });

  it("da tre in su si accavallano invece di assottigliarsi", () => {
    const d = disponiSovrapposti([
      ev(1, "09:00", "12:00"),
      ev(2, "09:00", "12:00"),
      ev(3, "09:00", "12:00"),
    ]);
    const p = d.map(b => posizioneBlocco(b, finestra));
    // A parti uguali sarebbero 33%: qui restano metà colonna e si coprono.
    for (const x of p) expect(x.larghezzaPct).toBe(LARGHEZZA_MINIMA_PCT);
    expect(p[0].sinistraPct + p[0].larghezzaPct).toBeGreaterThan(p[1].sinistraPct);
  });

  it("con quattro in parallelo nessuno scende sotto la larghezza minima", () => {
    // A parti uguali sarebbero il 25% l'uno: righelli muti. La cascata li
    // tiene leggibili e distribuisce gli inizi lungo la colonna.
    const d = disponiSovrapposti([
      ev(1, "09:00", "12:00"),
      ev(2, "09:00", "12:00"),
      ev(3, "09:00", "12:00"),
      ev(4, "09:00", "12:00"),
    ]);
    const p = d.map(b => posizioneBlocco(b, finestra));
    for (const x of p) expect(x.larghezzaPct).toBe(LARGHEZZA_MINIMA_PCT);
    const inizi = p.map(x => Math.round(x.sinistraPct));
    expect(new Set(inizi).size).toBe(4);
    expect(Math.max(...inizi)).toBe(100 - LARGHEZZA_MINIMA_PCT);
  });

  it("nessun blocco esce dai bordi orizzontali", () => {
    const d = disponiSovrapposti([
      ev(1, "09:00", "12:00"),
      ev(2, "09:00", "12:00"),
      ev(3, "09:00", "12:00"),
    ]);
    for (const b of d) {
      const p = posizioneBlocco(b, finestra);
      expect(p.sinistraPct).toBeGreaterThanOrEqual(0);
      expect(p.sinistraPct + p.larghezzaPct).toBeLessThanOrEqual(100.0001);
    }
  });
});

describe("caricoGiornata", () => {
  it("una giornata vuota è a zero", () => {
    expect(caricoGiornata([])).toBe(0);
  });

  it("una posa 08-19 riempie la giornata lavorativa", () => {
    expect(caricoGiornata([ev(1, "07:00", "19:00")])).toBe(1);
  });

  it("mezza giornata è mezzo carico", () => {
    expect(caricoGiornata([ev(1, "07:00", "13:00")])).toBeCloseTo(0.5, 5);
  });

  it("due squadre in contemporanea non contano due volte", () => {
    const insieme = caricoGiornata([
      ev(1, "09:00", "12:00"),
      ev(2, "09:00", "12:00"),
    ]);
    expect(insieme).toBeCloseTo(caricoGiornata([ev(1, "09:00", "12:00")]), 5);
  });

  it("i pezzi staccati si sommano", () => {
    // 09-10 e 14-16 = tre ore su dodici.
    expect(
      caricoGiornata([ev(1, "09:00", "10:00"), ev(2, "14:00", "16:00")])
    ).toBeCloseTo(3 / 12, 5);
  });

  it("le sovrapposizioni parziali si fondono", () => {
    // 09-11 e 10-12 = tre ore, non quattro.
    expect(
      caricoGiornata([ev(1, "09:00", "11:00"), ev(2, "10:00", "12:00")])
    ).toBeCloseTo(3 / 12, 5);
  });

  it("non supera mai 1, nemmeno con il lavoro notturno", () => {
    expect(caricoGiornata([ev(1, "00:00", "23:59")])).toBe(1);
  });

  it("gli eventi senza orario non contano", () => {
    expect(caricoGiornata([ev(1, null), ev(2, null)])).toBe(0);
  });
});
