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
});
