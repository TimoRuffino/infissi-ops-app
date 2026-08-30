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

const SORGENTI = fileSorgente(["server", "client/src", "scripts"]);
const relativo = (percorso: string) => percorso.slice(RADICE.length + 1);

describe("confine dei costi — nessuna chiamata a pagamento fuori dal governor", () => {
  it("solo providerGovernato.ts importa il provider reale grezzo", () => {
    const importatori = SORGENTI.filter(f => {
      const testo = readFileSync(f, "utf8");
      return (
        testo.includes("creaProviderRealeGrezzo") &&
        !f.endsWith(join("tars", "openai", "adapter.ts")) &&
        !f.endsWith("confine.test.ts")
      );
    }).map(relativo);
    expect(importatori).toEqual([
      join("server", "tars", "costi", "providerGovernato.ts"),
    ]);
  });

  it("l'endpoint OpenAI compare SOLO nell'adapter", () => {
    const conEndpoint = SORGENTI.filter(f => {
      const testo = readFileSync(f, "utf8");
      return (
        /api\.openai\.com\/v1\//.test(testo) && !f.endsWith("confine.test.ts")
      );
    }).map(relativo);
    expect(conEndpoint).toEqual([
      join("server", "tars", "openai", "adapter.ts"),
    ]);
  });

  it("gli altri gateway LLM a pagamento vivono solo nei moduli legacy senza consumatori", () => {
    const gateway =
      /(api\.openai\.com|forge\.manus\.im|api\.anthropic\.com|generativelanguage\.googleapis\.com)/;
    const conGateway = SORGENTI.filter(f => {
      if (f.endsWith("confine.test.ts")) return false;
      return gateway.test(readFileSync(f, "utf8"));
    })
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
