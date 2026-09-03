import { describe, expect, it } from "vitest";
import { aggrega } from "./aggregati";
import { tariffeAttive } from "./tariffe";

const coeff = tariffeAttive(new Date("2026-09-03")).coefficienti;
const r = (categoria: any, quantita: number, l: number | null, h: number | null, oscuranteIntegrato: any = null) => ({
  categoria, oscuranteIntegrato, quantita, larghezzaMm: l,
  mq: l && h ? (l * h * quantita) / 1_000_000 : 0,
});

describe("aggregati del computo", () => {
  it("riproduce la fattura 127: 6 serramenti PVC, 20,56 mq, larghezza 10,17 m", () => {
    const a = aggrega([r("serramento_pvc", 3, 1900, 2400), r("serramento_pvc", 2, 1660, 1540), r("serramento_pvc", 1, 1150, 1540)], coeff);
    expect(a.n.serramenti).toBe(6);
    expect(a.mq.serramenti).toBeCloseTo(20.5638, 4);
    expect(a.larghezzaM).toBeCloseTo(10.17, 2);
    expect(a.nTotale).toBe(6);
    // Tempi: 6 × 0,5 h + 1/3 h materiali = 3,33 h tiro; 6 × 3 h = 18 h posa → 3 giornate
    expect(a.oreTiro).toBeCloseTo(3.333, 3);
    expect(a.orePosa).toBe(18);
    expect(a.giornatePosa).toBe(3);
    expect(a.righeSenzaMisure).toBe(0);
  });

  it("smista gli oscuranti integrati e quelli soli nelle chiavi del foglio", () => {
    const a = aggrega([
      r("serramento_alluminio", 2, 1200, 1400, "tapparella"),
      r("serramento_legno", 1, 1200, 1400, "persiana"),
      r("persiana", 3, 800, 1400),
      r("cassonetto", 2, 1200, 300),
      r("portoncino", 1, 1000, 2200, "persiana"),
      r("pergola", 1, 4000, 3000),
      r("controtelaio", 2, null, null),
    ], coeff);
    expect(a.n.serrTapp).toBe(2);
    expect(a.n.legnoPers).toBe(1);
    expect(a.n.persiane).toBe(3);
    expect(a.n.cassonetti).toBe(2);
    expect(a.n.portoncinoPers).toBe(1);
    expect(a.n.pergole).toBe(1);
    expect(a.n.serramenti).toBe(0);
    // larghezza: solo i serramenti (con o senza oscurante), non cassonetti/persiane sole/pergole
    expect(a.larghezzaM).toBeCloseTo(3.6, 2);
    // tiro: serramenti 3×0,5 + tapparelle (2 serrTapp + 2 cassonetti)×0,25 + persiane (1 legnoPers + 3 + 1 portoncinoPers)×0,25 + portoncino 1×0,5 + pergola 1×2 + 1/3
    expect(a.oreTiro).toBeCloseTo(1.5 + 1 + 1.25 + 0.5 + 2 + 1 / 3, 3);
    // posa: serramenti 3×3 + cassonetti 2×1 + oscuranti (2+1+3+1)×1,5 + pergola 16 + portoncino 1×3
    expect(a.orePosa).toBeCloseTo(9 + 2 + 10.5 + 16 + 3, 3);
    // il controtelaio non ha chiave (chiaveDi → null): non entra negli
    // aggregati, quindi non è una "riga senza misure" nel senso del
    // warning (che riguarda solo righe contate in n ma con mq 0).
    expect(a.righeSenzaMisure).toBe(0);
  });

  it("conta come «senza misure» solo le righe aggregate con mq 0, non i controtelai", () => {
    const a = aggrega([r("persiana", 1, null, null)], coeff);
    expect(a.n.persiane).toBe(1);
    expect(a.mq.persiane).toBe(0);
    expect(a.righeSenzaMisure).toBe(1);
  });
});
