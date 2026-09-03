// server/computo/zone.test.ts
import { describe, expect, it } from "vitest";
import { normalizzaNomeComune, zonaPerComune } from "./zone";

describe("zona climatica per comune", () => {
  it("normalizza accenti, apostrofi e maiuscole", () => {
    expect(normalizzaNomeComune("  Forlì ")).toBe("forli");
    expect(normalizzaNomeComune("Sant'Angelo Lodigiano")).toBe("sant angelo lodigiano");
  });
  it("trova comuni noti con la zona attesa", () => {
    expect(zonaPerComune("Palermo")?.zona).toBe("B");
    expect(zonaPerComune("Cortina d'Ampezzo")?.zona).toBe("F");
    expect(zonaPerComune("Milano")?.zona).toBe("E");
    expect(zonaPerComune("La Spezia", "SP")?.provincia).toBe("SP");
  });
  it("con un solo candidato ignora la provincia indicata (sigle del 1993: Monza è salvata come MI)", () => {
    const monza = zonaPerComune("Monza", "MB");
    expect(monza).not.toBeNull();
    expect(monza?.zona).toBe("E");
    expect(monza?.provincia).toBe("MI");
  });
  it("con più candidati (omonimi veri) la provincia deve corrispondere", () => {
    expect(zonaPerComune("Samone", "TO")?.zona).toBe("E");
    expect(zonaPerComune("Samone", "TN")?.zona).toBe("F");
    expect(zonaPerComune("Samone", "XX")).toBeNull();
  });
  it("disambigua per provincia e risponde null se non trova", () => {
    expect(zonaPerComune("Castello", "XX")).toBeNull();
    expect(zonaPerComune("Comune Inventato")).toBeNull();
  });
});
