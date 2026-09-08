// server/tenants/cli.test.ts
import { describe, expect, it } from "vitest";
import { anteprima, opzioni, workerSospesi } from "./cli";

describe("opzioni della CLI", () => {
  it("legge sottocomando, --chiave=valore e flag", () => {
    const o = opzioni(["node", "tenant.ts", "crea", "--slug=acme", "--nome=Acme Infissi", "--scrivi", "--attendi"]);
    expect(o.sotto).toBe("crea");
    expect(o.valori).toEqual({ slug: "acme", nome: "Acme Infissi" });
    expect(o.flag.has("scrivi")).toBe(true);
    expect(o.flag.has("attendi")).toBe(true);
    expect(opzioni(["node", "tenant.ts"]).sotto).toBeNull();
  });

  it("verifica --json: nessuna novità nel parser, --json è un flag come gli altri", () => {
    const o = opzioni(["node", "tenant", "verifica", "--json"]);
    expect(o.sotto).toBe("verifica");
    expect(o.flag.has("json")).toBe(true);
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

describe("workerSospesi", () => {
  it("workerSospesi legge gli eventi: l'ultima sospensione non riarmata e non scaduta", () => {
    const ev = (id: number, tipo: string, dettagli: any, minutiFa: number) =>
      ({ id, tenantId: 2, tipo, attore: "boot", motivo: null, dettagli, createdAt: new Date(Date.now() - minutiFa * 60_000) }) as any;
    const eventi = [
      ev(1, "worker_sospeso", { etichetta: "backup", minuti: 15, errore: "x" }, 5),
      ev(2, "worker_sospeso", { etichetta: "posta", minuti: 15, errore: "y" }, 30), // scaduta
      ev(3, "worker_sospeso", { etichetta: "tars", minuti: 60, errore: "z" }, 10),
      ev(4, "worker_riarmato", { etichetta: "tars" }, 2),
    ];
    expect(workerSospesi(eventi).map(w => w.etichetta)).toEqual(["backup"]);
  });
});
