// I prompt passati sono un registro, non codice vivo.
//
// Solo v9 è importato dall'orchestratore; da v1 a v8 nessuno li carica.
// Riscriverli durante un rebranding falsificherebbe un archivio: portano il
// nome che il prodotto aveva quando furono scritti, ed è giusto così.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CARTELLA = join("server", "tars", "prompt");
const STORICI_COL_VECCHIO_NOME = ["v1", "v2", "v3", "v4"] as const;

// Composto da pezzi: così questo file non è esso stesso un residuo per la
// spazzata di shared/brand.test.ts.
const VECCHIO_NOME = ["Ruffino", "Flow"].join(" ");

describe("archivio dei prompt di Tars", () => {
  it("non riscrive i prompt storici", () => {
    for (const versione of STORICI_COL_VECCHIO_NOME) {
      const sorgente = readFileSync(
        join(CARTELLA, `${versione}.ts`),
        "utf8"
      );
      expect(sorgente, versione).toContain(VECCHIO_NOME);
    }
  });

  it("tiene in vita una sola versione del prompt", () => {
    const orchestratore = readFileSync(
      join("server", "tars", "orchestratore.ts"),
      "utf8"
    );
    expect(orchestratore).toContain('from "./prompt/v9"');
    // Non basta che importi v9: deve fallire anche se ne importa un'altra
    // insieme (l'asserzione sopra da sola passerebbe comunque). Enumerata
    // dal disco, non elencata a mano, così un domani v10 non richiede di
    // ricordarsi di aggiornare anche questo test.
    const altreVersioni = readdirSync(CARTELLA)
      .filter(nome => /^v\d+\.ts$/.test(nome) && nome !== "v9.ts")
      .map(nome => nome.replace(/\.ts$/, ""));
    expect(altreVersioni.length).toBeGreaterThan(0);
    for (const versione of altreVersioni) {
      expect(orchestratore, versione).not.toContain(
        `from "./prompt/${versione}"`
      );
    }
  });

  it("fa dire a Tars il nome nuovo", () => {
    const v9 = readFileSync(join(CARTELLA, "v9.ts"), "utf8");
    expect(v9).toContain("il cervello operativo di Wyndor");
    expect(v9).not.toContain(VECCHIO_NOME);
  });
});
