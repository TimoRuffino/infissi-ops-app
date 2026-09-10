// Chi può importare il seed dei venticinque. Sul modello di
// server/tenants/confine.test.ts: legge i sorgenti e fallisce se qualcuno
// aggiunge un import senza aggiornare questa lista.
//
// Il motivo: il seed sono i fornitori della Ruffino Group. Ogni modulo di
// dominio che lo legge fa vedere quei fornitori a TUTTE le aziende, che è
// esattamente il difetto che questo lavoro toglie.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const AMMESSI = [
  // Il ripiego a interruttore spento.
  "server/fornitori/riconoscimento.ts",
  // L'importazione una tantum, chiesta da una persona dalla pagina
  // `/fornitori` e rifiutata per ogni azienda che non sia la Ruffino Group.
  "server/routers/fornitori.ts",
];

function sorgenti(dir: string, acc: string[] = []): string[] {
  for (const voce of readdirSync(dir)) {
    if (voce === "node_modules" || voce === "dist") continue;
    const percorso = join(dir, voce);
    if (statSync(percorso).isDirectory()) sorgenti(percorso, acc);
    else if (/\.tsx?$/.test(voce) && !/\.test\.tsx?$/.test(voce)) acc.push(percorso);
  }
  return acc;
}

describe("confine del seed dei fornitori", () => {
  it("solo i file ammessi importano SEED_FORNITORI_TENANT_1", () => {
    const colpevoli = sorgenti("server")
      .concat(sorgenti("client/src"))
      .filter(f => /SEED_FORNITORI_TENANT_1/.test(readFileSync(f, "utf8")))
      .map(f => f.replace(/\\/g, "/"))
      .sort();
    expect(colpevoli).toEqual(AMMESSI.slice().sort());
  });
});
