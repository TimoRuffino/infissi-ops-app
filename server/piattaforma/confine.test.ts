// server/piattaforma/confine.test.ts
// Guardia STRUTTURALE del pannello piattaforma (WS6 spec §5.3, §11): questi
// test leggono il sorgente di server/piattaforma/, non lo eseguono — stesso
// stile di server/tenants/confine.test.ts. Falliscono se qualcuno
// reintroduce un percorso verso i dati di dominio, un accesso diretto allo
// store di un'altra azienda, o un segreto in un log.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileSorgente, relativo } from "../_core/sorgentiDiProva";

const PRODUZIONE = fileSorgente([join("server", "piattaforma")]).filter(f => !/\.test\.ts$/.test(f));
const testo = (f: string) => readFileSync(f, "utf8");

/** Gli specifier di `import ... from "..."` di un file (compresi i dinamici). */
function specifiersDiImport(sorgente: string): string[] {
  return [...sorgente.matchAll(/from\s+["']([^"']+)["']/g)].map(m => m[1]);
}

describe("confine del pannello piattaforma", () => {
  it("nessun accesso diretto storeDi: le letture per tenant passano da conTenant", () => {
    const colpevoli = PRODUZIONE.filter(f => /\bstoreDi\s*\(/.test(testo(f))).map(relativo);
    expect(colpevoli).toEqual([]);
  });

  it("nessun import di server/routers/ salvo utenti e sedi (già usati da tenants/servizio.ts)", () => {
    const consentiti = new Set(["../routers/utenti", "../routers/sedi"]);
    const colpevoli: string[] = [];
    for (const f of PRODUZIONE) {
      for (const specifier of specifiersDiImport(testo(f))) {
        if (specifier.includes("/routers/") && !consentiti.has(specifier)) {
          colpevoli.push(`${relativo(f)} → ${specifier}`);
        }
      }
    }
    expect(colpevoli).toEqual([]);
  });

  it("nessun import di moduli di dominio (comunicazioni, fatture, documenti, strumenti di Tars)", () => {
    const vietato = /(^|\/)(comunicazioni|fatture|documenti)\/|tars\/strumenti\//;
    const colpevoli: string[] = [];
    for (const f of PRODUZIONE) {
      for (const specifier of specifiersDiImport(testo(f))) {
        if (vietato.test(specifier)) colpevoli.push(`${relativo(f)} → ${specifier}`);
      }
    }
    expect(colpevoli).toEqual([]);
  });

  it("nessun console.log|warn|error con la parola «token»: il segreto dell'invito non si logga mai", () => {
    const colpevoli: string[] = [];
    for (const f of PRODUZIONE) {
      testo(f)
        .split("\n")
        .forEach((riga, i) => {
          if (/console\.(log|warn|error)\(/.test(riga) && /token/i.test(riga)) {
            colpevoli.push(`${relativo(f)}:${i + 1}`);
          }
        });
    }
    expect(colpevoli).toEqual([]);
  });

  // Già coperto dalla guardia globale (server/tenants/confine.test.ts, che
  // scandisce tutto `server/`): ripeterlo qui costa una riga ed evita che il
  // pannello dipenda, per questa garanzia, da un test fuori dalla sua cartella.
  it("nessuno schema di input tRPC accetta tenantId", () => {
    const colpevoli = PRODUZIONE.filter(f => /\btenantId\s*:\s*z\./.test(testo(f))).map(relativo);
    expect(colpevoli).toEqual([]);
  });
});
