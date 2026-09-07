// server/tenants/confine.test.ts
// Guardie STRUTTURALI del tenant (spec WS1 §10.8), sul modello di
// server/tars/costi/confine.test.ts: leggono il sorgente e falliscono se
// qualcuno reintroduce un percorso che la spec vieta.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileSorgente, relativo, RADICE } from "../_core/sorgentiDiProva";

const PRODUZIONE = fileSorgente(["server", "shared", "scripts"]).filter(f => !/\.test\.ts$/.test(f));
const testo = (f: string) => readFileSync(f, "utf8");

describe("confine del tenant", () => {
  it("nessuno schema di input tRPC o di strumento Tars accetta tenantId o tenant", () => {
    const colpevoli = PRODUZIONE.filter(f => /\b(tenantId|tenant)\s*:\s*z\./.test(testo(f))).map(relativo);
    expect(colpevoli).toEqual([]);
  });

  it("INSERT INTO tenant* compare solo nel repository", () => {
    const scrittori = PRODUZIONE.filter(f => /INSERT INTO tenant/.test(testo(f))).map(relativo);
    expect(scrittori).toEqual([join("server", "tenants", "repository.ts")]);
  });

  it("portaChiusaPerTenant ha esattamente due chiamanti: la guardia e il login", () => {
    const chiamanti = PRODUZIONE.filter(
      f => testo(f).includes("portaChiusaPerTenant(") && !f.endsWith(join("tenants", "regole.ts"))
    )
      .map(relativo)
      .sort();
    expect(chiamanti).toEqual([join("server", "_core", "trpc.ts"), join("server", "routers.ts")]);
  });

  it("lo script tenant non importa router né store", () => {
    const script = testo(join(RADICE, "scripts", "tenant.ts"));
    expect(script).not.toMatch(/from "\.\.\/server\/routers/);
    expect(script).not.toMatch(/bootstrapAll/);
  });
});
