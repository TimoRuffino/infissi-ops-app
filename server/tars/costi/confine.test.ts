// Guardia STRUTTURALE del confine verso i provider a pagamento —
// spec §27.41.
//
// Questi test leggono il sorgente: non provano un comportamento ma
// l'impossibilità di reintrodurre un percorso non governato. Falliscono
// se qualcuno (persona o modello) aggiunge una chiamata diretta, sposta
// il ledger in memoria, o resuscita i client LLM legacy.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RADICE = join(__dirname, "..", "..", "..");

function fileSorgente(cartelle: string[]): string[] {
  const trovati: string[] = [];
  const visita = (percorso: string) => {
    for (const voce of readdirSync(percorso)) {
      if (voce === "node_modules" || voce === "dist" || voce.startsWith("."))
        continue;
      const completo = join(percorso, voce);
      if (statSync(completo).isDirectory()) visita(completo);
      else if (/\.(ts|tsx)$/.test(voce)) trovati.push(completo);
    }
  };
  for (const cartella of cartelle) visita(join(RADICE, cartella));
  return trovati;
}

// `shared/` è compilata e importata dal server: se non fosse scandita,
// un modulo lì dentro potrebbe chiamare il provider aggirando tutto
// (revisione).
const SORGENTI = fileSorgente(["server", "client/src", "scripts", "shared"]);
const relativo = (percorso: string) => percorso.slice(RADICE.length + 1);

/**
 * Le regole di confine valgono sul codice di PRODUZIONE: un test può
 * legittimamente importare l'adapter grezzo o nominare l'endpoint per
 * provarne il comportamento, ed è comunque coperto dalla guardia di rete
 * globale (provata sotto).
 */
const PRODUZIONE = SORGENTI.filter(f => !/\.test\.ts$/.test(f));

describe("confine dei costi — nessuna chiamata a pagamento fuori dal governor", () => {
  it("in PRODUZIONE solo providerGovernato.ts importa il provider reale grezzo", () => {
    const importatori = PRODUZIONE.filter(f => {
      const testo = readFileSync(f, "utf8");
      return (
        testo.includes("creaProviderRealeGrezzo") &&
        !f.endsWith(join("tars", "openai", "adapter.ts"))
      );
    }).map(relativo);
    expect(importatori).toEqual([
      join("server", "tars", "costi", "providerGovernato.ts"),
    ]);
  });

  it("l'endpoint OpenAI compare SOLO nell'adapter", () => {
    const conEndpoint = PRODUZIONE.filter(f =>
      /api\.openai\.com\/v1\//.test(readFileSync(f, "utf8"))
    ).map(relativo);
    expect(conEndpoint).toEqual([
      join("server", "tars", "openai", "adapter.ts"),
    ]);
  });

  it("la guardia di rete globale è registrata: nessun test può uscire su Internet", () => {
    const config = readFileSync(join(RADICE, "vitest.config.ts"), "utf8");
    expect(config).toContain("setupFiles");
    expect(config).toContain("server/_core/testSetup.ts");
    const setup = readFileSync(
      join(RADICE, "server", "_core", "testSetup.ts"),
      "utf8"
    );
    expect(setup).toContain("RETE VIETATA NEI TEST");
    expect(setup).toContain("globalThis.fetch");
  });

  it("gli altri gateway LLM a pagamento vivono solo nei moduli legacy senza consumatori", () => {
    const gateway =
      /(api\.openai\.com|forge\.manus\.im|api\.anthropic\.com|generativelanguage\.googleapis\.com)/;
    const conGateway = PRODUZIONE.filter(f =>
      gateway.test(readFileSync(f, "utf8"))
    )
      .map(relativo)
      .sort();
    // Elenco CHIUSO: un gateway nuovo richiede una decisione registrata,
    // non un import distratto. `llm.ts` è legacy e senza consumatori
    // (test precedente), l'adapter è governato.
    expect(conGateway).toEqual([
      join("server", "_core", "llm.ts"),
      join("server", "tars", "openai", "adapter.ts"),
    ]);
  });

  it("i client LLM legacy restano SENZA consumatori (aggirerebbero il governor)", () => {
    const legacy = ["_core/llm", "_core/voiceTranscription", "_core/imageGeneration"];
    const consumatori: string[] = [];
    for (const f of SORGENTI) {
      if (/_core[\\/](llm|voiceTranscription|imageGeneration)\.ts$/.test(f)) {
        continue;
      }
      if (f.endsWith("confine.test.ts")) continue;
      const testo = readFileSync(f, "utf8");
      for (const modulo of legacy) {
        const nome = modulo.split("/")[1];
        // import ... from ".../llm" | "../_core/llm"
        const regex = new RegExp(
          `from\\s+["'][^"']*(?:_core/)?${nome}["']`,
          "m"
        );
        if (regex.test(testo)) consumatori.push(`${relativo(f)} → ${nome}`);
      }
    }
    expect(consumatori).toEqual([]);
  });

  it("il router di Tars non costruisce provider da sé: passa dalla fabbrica unica", () => {
    const router = readFileSync(
      join(RADICE, "server", "routers", "tars.ts"),
      "utf8"
    );
    expect(router).toContain("creaProviderPerRun");
    expect(router).not.toContain("creaProviderRealeGrezzo");
    // Il fake si costruisce solo dentro la fabbrica: qui c'è il copione.
    expect(router).not.toMatch(/creaProviderFinto\s*\(/);
  });

  it("il ledger autorevole NON può essere in memoria", () => {
    const ledger = readFileSync(
      join(RADICE, "server", "tars", "costi", "ledger.ts"),
      "utf8"
    );
    // La disponibilità del ledger autorevole dipende SOLO da kvSql:
    // nessun override di test può abilitare il provider reale.
    const funzione = ledger.slice(
      ledger.indexOf("export function ledgerAutorevoleDisponibile")
    );
    const corpo = funzione.slice(0, funzione.indexOf("}") + 1);
    expect(corpo).toContain("Boolean(kvSql)");
    expect(corpo).not.toContain("ledgerOverride");
  });

  it("il registro azioni non espone primitive generiche, force o auto-approvazione", async () => {
    const { REGISTRO_AZIONI } = await import("../azioni/registry");
    const { comeDefinizioneProvider } = await import("../profili");
    const nomi = REGISTRO_AZIONI.map(a => a.nome);

    expect(nomi).not.toContain("executeSql");
    expect(nomi).not.toContain("updateRecord");
    expect(nomi.some(nome => /(approva|applica|autorizza)/i.test(nome))).toBe(false);
    for (const azione of REGISTRO_AZIONI) {
      const schema = comeDefinizioneProvider(azione.strumento);
      expect(schema.parametri).not.toHaveProperty("properties.force");
    }
  });

  it("il ledger R1 è PostgreSQL in produzione e la memoria è confinata ai test", () => {
    const sorgente = readFileSync(
      join(RADICE, "server", "tars", "azioni", "executions.ts"),
      "utf8"
    );
    expect(sorgente).toContain("CREATE TABLE IF NOT EXISTS tars_azioni_esecuzioni");
    expect(sorgente).toContain('process.env.NODE_ENV === "test"');
    expect(sorgente).toContain('input.ledger && process.env.NODE_ENV !== "test"');
    expect(sorgente).toContain("LEDGER_ESECUZIONI_ASSENTE");
    expect(sorgente).not.toMatch(/\b(?:UPDATE|DELETE)\s+tars_azioni_esecuzioni\b/i);
  });

  it("registro, policy e ledger non importano provider grezzi", () => {
    for (const nome of ["registry.ts", "policy.ts", "executions.ts"]) {
      const sorgente = readFileSync(
        join(RADICE, "server", "tars", "azioni", nome),
        "utf8"
      );
      expect(sorgente).not.toMatch(/from\s+["'][^"']*(?:provider|_core\/llm|openai)[^"']*["']/i);
    }
  });

  it("l'override del ledger e l'iniezione diretta vivono SOLO nei test", () => {
    // `impostaLedgerPerTest` disattiverebbe i tetti lasciando in piedi il
    // provider reale: nessun modulo di produzione può chiamarla, e
    // nessuno può passare un `ledger` custom al governor (revisione).
    const usiFuoriDaiTest = SORGENTI.filter(f => {
      if (/\.test\.ts$/.test(f)) return false;
      if (f.endsWith(join("tars", "costi", "ledger.ts"))) return false;
      const testo = readFileSync(f, "utf8");
      return /impostaLedgerPerTest\s*\(/.test(testo);
    }).map(relativo);
    expect(usiFuoriDaiTest).toEqual([]);

    const iniezioniLedger = SORGENTI.filter(f => {
      if (/\.test\.ts$/.test(f)) return false;
      if (f.endsWith(join("tars", "costi", "governor.ts"))) return false;
      const testo = readFileSync(f, "utf8");
      return /avvolgiConGovernor\s*\([\s\S]{0,400}ledger:/.test(testo);
    }).map(relativo);
    expect(iniezioniLedger).toEqual([]);
  });

  it("il governor prenota PRIMA di chiamare il provider sottostante", () => {
    const governor = readFileSync(
      join(RADICE, "server", "tars", "costi", "governor.ts"),
      "utf8"
    );
    const posizionePrenota = governor.indexOf("ledger.prenota(");
    const posizioneChiamata = governor.indexOf("sottostante.rispondi(");
    expect(posizionePrenota).toBeGreaterThan(0);
    expect(posizioneChiamata).toBeGreaterThan(posizionePrenota);
    // I tre tetti sono tutti verificati.
    const ledgerSorgente = readFileSync(
      join(RADICE, "server", "tars", "costi", "ledger.ts"),
      "utf8"
    );
    expect(ledgerSorgente).toContain("limiti.runNano");
    expect(ledgerSorgente).toContain("limiti.giornoNano");
    expect(ledgerSorgente).toContain("limiti.meseNano");
  });

  it("le tariffe non usano floating point per la contabilità", () => {
    const tariffe = readFileSync(
      join(RADICE, "server", "tars", "costi", "tariffe.ts"),
      "utf8"
    );
    expect(tariffe).toContain("BigInt");
    // Nessun prezzo scritto come decimale nel catalogo.
    const catalogo = tariffe.slice(
      tariffe.indexOf("CATALOGO_TARIFFE"),
      tariffe.indexOf("export function tariffaDi")
    );
    expect(catalogo).not.toMatch(/:\s*\d+\.\d+\s*,/);
  });
});
