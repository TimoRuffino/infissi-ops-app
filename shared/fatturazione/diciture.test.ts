import { describe, expect, it } from "vitest";
import { DICITURE, dicitureDefault } from "./diciture";

describe("diciture", () => {
  it("ogni bonus ha la sua frase per il bonifico parlante", () => {
    expect(dicitureDefault("ristrutturazione")).toContain(
      "bonifico_ristrutturazione"
    );
    expect(dicitureDefault("ecobonus")).toContain("bonifico_ecobonus");
    expect(dicitureDefault("nessuna")).not.toContain(
      "bonifico_ristrutturazione"
    );
    for (const chiave of dicitureDefault("ristrutturazione"))
      expect(DICITURE[chiave]).toBeTruthy();
  });

  // R19: le fatture 106 e 119 portano la manutenzione straordinaria
  // insieme alla riga della pratica edilizia. CIL resta manutenzione
  // ordinaria: la pratica c'è, ma l'intervento non cambia natura.
  it("con CILA o SCIA l'intervento è manutenzione straordinaria", () => {
    expect(dicitureDefault("nessuna", "cila")).toContain("intervento_straordinaria");
    expect(dicitureDefault("nessuna", "scia")).toContain("intervento_straordinaria");
    expect(dicitureDefault("nessuna", "cila")).not.toContain("intervento_manutenzione");
    expect(dicitureDefault("ristrutturazione", "cil")).toContain("intervento_manutenzione");
    expect(dicitureDefault("ristrutturazione")).toContain("intervento_manutenzione");
    expect(DICITURE.intervento_straordinaria).toContain("lettera b");
  });

  it("il template della pratica edilizia lascia i segnaposto da compilare a mano", () => {
    for (const segnaposto of ["{tipo}", "{numero}", "{data}", "{comune}", "{intestatario}"]) {
      expect(DICITURE.pratica_edilizia).toContain(segnaposto);
    }
  });
});
