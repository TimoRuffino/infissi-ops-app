import { describe, expect, it } from "vitest";

import {
  chiaveRicerca,
  numeroCorrisponde,
  senzaAccenti,
  testoCorrisponde,
} from "./ricerca";

const chiave = (raw: string) => {
  const k = chiaveRicerca(raw);
  if (!k) throw new Error(`ricerca vuota: "${raw}"`);
  return k;
};

describe("ricerca — testo", () => {
  it("ignora maiuscole e accenti da entrambi i lati", () => {
    expect(testoCorrisponde(["Forlì"], chiave("forli"))).toBe(true);
    expect(testoCorrisponde(["forli"], chiave("Forlì"))).toBe(true);
    expect(testoCorrisponde(["Città di Castello"], chiave("citta"))).toBe(true);
  });

  it("trova dentro la voce, non solo in testa", () => {
    expect(testoCorrisponde(["Via Garibaldi 12"], chiave("garibaldi"))).toBe(
      true
    );
  });

  it("basta una voce sola su tante", () => {
    expect(
      testoCorrisponde([null, undefined, "", "La Spezia"], chiave("spezia"))
    ).toBe(true);
  });

  it("non inventa corrispondenze", () => {
    expect(testoCorrisponde(["Sarzana", null], chiave("levanto"))).toBe(false);
    expect(testoCorrisponde([], chiave("qualsiasi"))).toBe(false);
  });

  it("una ricerca di soli spazi non è una ricerca", () => {
    expect(chiaveRicerca("   ")).toBeNull();
    expect(chiaveRicerca("")).toBeNull();
  });

  it("gli spazi ripetuti non impediscono di trovare", () => {
    expect(testoCorrisponde(["Mario Rossi"], chiave("  mario   rossi "))).toBe(
      true
    );
  });

  it("senzaAccenti tocca i segni, non le lettere", () => {
    expect(senzaAccenti("Perù")).toBe("peru");
    expect(senzaAccenti("È così")).toBe("e cosi");
  });
});

describe("ricerca — numeri di telefono", () => {
  it("trova un numero scritto in un formato diverso dal digitato", () => {
    const salvato = "+39 340 1234567";
    expect(numeroCorrisponde([salvato], chiave("3401234567"))).toBe(true);
    expect(numeroCorrisponde([salvato], chiave("340 123 4567"))).toBe(true);
    expect(numeroCorrisponde([salvato], chiave("340-1234"))).toBe(true);
  });

  it("regge il prefisso presente da una parte sola", () => {
    // Nessuna delle due stringhe di cifre contiene l'altra: senza la forma
    // internazionale questo confronto fallirebbe.
    expect(numeroCorrisponde(["340-1234567"], chiave("+39 340 1234567"))).toBe(
      true
    );
    expect(numeroCorrisponde(["00393401234567"], chiave("3401234567"))).toBe(
      true
    );
  });

  it("trova anche un fisso cercato senza prefisso", () => {
    expect(numeroCorrisponde(["0187 872687"], chiave("872687"))).toBe(true);
    expect(numeroCorrisponde(["0187 872687"], chiave("0187"))).toBe(true);
  });

  it("poche cifre non sono una ricerca per numero", () => {
    // "12" starebbe dentro mezza anagrafica.
    expect(chiave("12").cifre).toBeNull();
    expect(numeroCorrisponde(["+39 340 1234567"], chiave("12"))).toBe(false);
  });

  it("un indirizzo con dentro un numero civico non pesca fra i telefoni", () => {
    const k = chiave("Via Roma 1234");
    expect(k.cifre).toBeNull();
    expect(numeroCorrisponde(["+39 340 1234567"], k)).toBe(false);
  });

  it("ignora le utenze vuote o non numeriche", () => {
    expect(numeroCorrisponde([null, undefined, "", "n/d"], chiave("3401"))).toBe(
      false
    );
  });

  it("non confonde due utenze diverse", () => {
    expect(numeroCorrisponde(["+39 340 1234567"], chiave("3339999999"))).toBe(
      false
    );
  });
});
