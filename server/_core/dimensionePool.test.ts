// Quante connessioni verso Postgres. Il valore di partenza è la correzione
// vera (cinque erano poche per diciotto moduli più i lavori di fondo); i
// limiti servono perché il numero arriva da una variabile d'ambiente, e una
// variabile scritta a mano può dire qualunque cosa.
import { describe, expect, it } from "vitest";

import { dimensionePool } from "./persistence";

describe("dimensione del pool di connessioni", () => {
  it("senza indicazioni tiene venti connessioni", () => {
    expect(dimensionePool(undefined)).toBe(20);
    expect(dimensionePool("")).toBe(20);
  });

  it("rispetta un valore esplicito", () => {
    expect(dimensionePool("8")).toBe(8);
    expect(dimensionePool("35")).toBe(35);
  });

  it("un valore assurdo non spegne il database", () => {
    expect(dimensionePool("0")).toBe(20);
    expect(dimensionePool("-3")).toBe(20);
    expect(dimensionePool("mille")).toBe(20);
  });

  it("c'è un tetto: i posti del database sono condivisi", () => {
    expect(dimensionePool("500")).toBe(50);
  });

  it("i decimali si troncano, non si arrotondano per eccesso", () => {
    expect(dimensionePool("12.9")).toBe(12);
  });

  it("resta comunque più del cinque di prima", () => {
    expect(dimensionePool(undefined)).toBeGreaterThan(5);
  });
});
