// server/tenants/cli.test.ts
import { describe, expect, it } from "vitest";
import { anteprima, opzioni } from "./cli";

describe("opzioni della CLI", () => {
  it("legge sottocomando, --chiave=valore e flag", () => {
    const o = opzioni(["node", "tenant.ts", "crea", "--slug=acme", "--nome=Acme Infissi", "--scrivi", "--attendi"]);
    expect(o.sotto).toBe("crea");
    expect(o.valori).toEqual({ slug: "acme", nome: "Acme Infissi" });
    expect(o.flag.has("scrivi")).toBe(true);
    expect(o.flag.has("attendi")).toBe(true);
    expect(opzioni(["node", "tenant.ts"]).sotto).toBeNull();
  });

  it("l'anteprima non mostra mai l'hash della password", () => {
    const testo = anteprima({
      tipo: "crea",
      tenantId: null,
      payload: { slug: "acme", proprietario: { email: "m@acme.it", passwordHash: "scrypt$32768$aa$bb" } },
    });
    expect(testo).toContain('"slug": "acme"');
    expect(testo).not.toContain("scrypt$");
    expect(testo).toContain("<hash>");
  });
});
