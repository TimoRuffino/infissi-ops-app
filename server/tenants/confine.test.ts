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

  it("portaChiusaPerTenant non compare più in server/", () => {
    const superstiti = PRODUZIONE.filter(f => testo(f).includes("portaChiusaPerTenant")).map(relativo);
    expect(superstiti).toEqual([]);
  });

  // Fix round 1 (Task 7): contestoCorrente.ts deve restare una FOGLIA del
  // grafo dei moduli — niente ./contesto, ./repository o router — altrimenti
  // si riapre il ciclo con _core/trpc.ts (che importa `conTenant` da lì) che
  // faceva crashare al semplice import un router caricato prima di questo
  // modulo (v. _core/ordineImport.test.ts).
  it("server/tenants/contestoCorrente.ts importa solo interruttori, costanti e _core/persistence", () => {
    const testoModulo = testo(join(RADICE, "server", "tenants", "contestoCorrente.ts"));
    const specifiers = [...testoModulo.matchAll(/^import\s+(?:.+?\s+from\s+)?["']([^"']+)["'];?\s*$/gm)]
      .map(m => m[1])
      .filter(s => !s.startsWith("node:"));
    expect(new Set(specifiers)).toEqual(new Set(["../platform/interruttori", "./costanti", "../_core/persistence"]));
  });

  it("AsyncLocalStorage compare solo in server/tenants/contestoCorrente.ts", () => {
    const usi = PRODUZIONE.filter(f => /AsyncLocalStorage/.test(testo(f))).map(relativo);
    expect(usi).toEqual([join("server", "tenants", "contestoCorrente.ts")]);
  });

  it("lo script tenant non importa router né store", () => {
    const script = testo(join(RADICE, "scripts", "tenant.ts"));
    expect(script).not.toMatch(/from "\.\.\/server\/routers/);
    expect(script).not.toMatch(/bootstrapAll/);
  });
});
