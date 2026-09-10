// Due conferme dello stesso ordine: parlano della stessa merce o di merce
// diversa? È il discriminante fra una revisione e una conferma parziale, e
// decide se il costo è il più alto dei due o la loro somma.
import { describe, expect, it } from "vitest";
import { confrontoArticoli } from "./confrontoArticoli";

describe("confrontoArticoli", () => {
  it("nessun articolo in comune: sono due pezzi dello stesso ordine", () => {
    expect(
      confrontoArticoli(
        ["PORST-C013 PORTA BLIND.STEEL/C", "KPO50 KIT PORTA"],
        ["F85 FALSO TELAIO 2100X850", "COI5 SET COPRIFILI INTERNO"]
      )
    ).toBe("disgiunti");
  });

  it("un articolo in comune basta: parlano della stessa merce", () => {
    expect(
      confrontoArticoli(
        ["PORST-C013 PORTA BLIND.STEEL/C", "KPO50 KIT PORTA"],
        ["PORST-C013 PORTA BLIND.STEEL/C", "COI5 SET COPRIFILI"]
      )
    ).toBe("sovrapposti");
  });

  it("le differenze di scrittura non fanno due articoli", () => {
    // Lo stesso codice con spaziatura e maiuscole diverse è lo stesso codice.
    expect(
      confrontoArticoli(
        ["PORST-C013   PORTA BLIND.STEEL/C"],
        ["porst-c013 porta blind.steel/c"]
      )
    ).toBe("sovrapposti");
  });

  it("senza articoli da una parte non si può dire", () => {
    // Un'assenza non è una prova di disgiunzione: sommare qui sarebbe
    // inventare un costo.
    expect(confrontoArticoli([], ["KPO50 KIT PORTA"])).toBe("ignoto");
    expect(confrontoArticoli(["KPO50 KIT PORTA"], null)).toBe("ignoto");
    expect(confrontoArticoli(undefined, undefined)).toBe("ignoto");
  });

  it("un articolo dal nome troppo generico non conta come prova", () => {
    // «1», «NR», «-» non identificano niente: se restano solo quelli, ignoto.
    expect(confrontoArticoli(["1", "NR"], ["-", "  "])).toBe("ignoto");
  });
});
