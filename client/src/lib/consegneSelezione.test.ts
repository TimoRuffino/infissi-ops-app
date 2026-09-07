import { describe, expect, it } from "vitest";
import { selezioneValida } from "./consegneSelezione";

describe("selezioneValida", () => {
  const consegne = [
    { prodottoId: 1, arrivato: false },
    { prodottoId: 2, arrivato: false },
    { prodottoId: 3, arrivato: true },
  ];

  it("tiene solo le spunte che hanno ancora una consegna aperta", () => {
    expect(selezioneValida([1, 2, 3, 99], consegne)).toEqual([1, 2]);
  });

  it("senza spunte non guarda nemmeno l'elenco", () => {
    expect(selezioneValida([], consegne)).toEqual([]);
    // Anche con un elenco vuoto (la scheda non è ancora stata aperta) non
    // succede niente: è quello che faceva esplodere la pagina quando la
    // selezione si sincronizzava con un effetto (React #185).
    expect(selezioneValida([], [])).toEqual([]);
  });

  it("una consegna segnata ricevuta cade dalla selezione", () => {
    const dopo = consegne.map(c => (c.prodottoId === 1 ? { ...c, arrivato: true } : c));
    expect(selezioneValida([1, 2], dopo)).toEqual([2]);
  });
});
