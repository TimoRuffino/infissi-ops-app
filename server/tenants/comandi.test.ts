// server/tenants/comandi.test.ts
import { describe, expect, it } from "vitest";
import { hashPassword } from "../_core/password";
import {
  richiestoDa,
  schemaPayloadAbbonamento,
  schemaPayloadCrea,
  schemaPayloadProprietario,
  schemaPayloadStato,
} from "./comandi";

describe("schemi dei comandi", () => {
  it("crea: slug, nome, sede e proprietario con hash scrypt", () => {
    const ok = schemaPayloadCrea.parse({
      slug: "acme",
      nome: "Acme Infissi",
      sede: { nome: "Acme Infissi" },
      proprietario: { nome: "Mario", cognome: "Rossi", email: "m@acme.it", passwordHash: hashPassword("Password-lunga-12") },
    });
    expect(ok.sede.citta).toBeUndefined();
    expect(() => schemaPayloadCrea.parse({ ...ok, slug: "Acme" })).toThrow();
    expect(() => schemaPayloadCrea.parse({ ...ok, proprietario: { ...ok.proprietario, passwordHash: "in-chiaro" } })).toThrow();
  });
  it("stato e proprietario", () => {
    expect(schemaPayloadStato.parse({ slug: "acme", motivo: "insoluto" }).motivo).toBe("insoluto");
    expect(() => schemaPayloadStato.parse({ slug: "acme", motivo: "x" })).toThrow();
    expect(schemaPayloadProprietario.parse({ slug: "acme", email: "m@acme.it" }).email).toBe("m@acme.it");
  });
  it("richiestoDa nomina lo script e l'host", () => {
    expect(richiestoDa()).toMatch(/^script:tenant@.+/);
  });
});

// Task 3 fix round 1: `schemaPayloadAbbonamento` era esercitato solo
// indirettamente (via `eseguiComandiInAttesa`/`anteprima`) — qui la copertura
// diretta delle sette varianti e dei limiti principali.
describe("schemaPayloadAbbonamento", () => {
  const slug = "acme";

  it("accetta ciascuna delle sette azioni con un payload valido", () => {
    expect(schemaPayloadAbbonamento.parse({ azione: "omaggio", slug, motivo: "pilota", scadenza: null }).azione).toBe(
      "omaggio"
    );
    expect(
      schemaPayloadAbbonamento.parse({ azione: "omaggio", slug, motivo: "pilota", scadenza: "2026-12-31" }).azione
    ).toBe("omaggio");
    expect(schemaPayloadAbbonamento.parse({ azione: "proroga", slug, motivo: "cortesia", giorni: 10 }).azione).toBe(
      "proroga"
    );
    expect(schemaPayloadAbbonamento.parse({ azione: "quota", slug, quotaGb: 200 }).azione).toBe("quota");
    expect(schemaPayloadAbbonamento.parse({ azione: "budget_tars", slug, eur: 40 }).azione).toBe("budget_tars");
    // `eur: null` toglie il tetto: l'altro ramo dello stesso schema.
    expect(schemaPayloadAbbonamento.parse({ azione: "budget_tars", slug, eur: null }).azione).toBe("budget_tars");
    expect(schemaPayloadAbbonamento.parse({ azione: "extra_tars", slug, eur: 5 }).azione).toBe("extra_tars");
    expect(schemaPayloadAbbonamento.parse({ azione: "tolleranze", slug, storage: 3, tars: 9 }).azione).toBe(
      "tolleranze"
    );
    // Entrambi i campi di `tolleranze` sono opzionali: nessuno dei due passato è ammesso.
    expect(schemaPayloadAbbonamento.parse({ azione: "tolleranze", slug }).azione).toBe("tolleranze");
    expect(schemaPayloadAbbonamento.parse({ azione: "disdetta", slug, disdetta: true }).azione).toBe("disdetta");
  });

  it("rifiuta un'azione sconosciuta", () => {
    expect(() => schemaPayloadAbbonamento.parse({ azione: "sconto", slug })).toThrow();
  });

  it("omaggio senza motivo", () => {
    expect(() => schemaPayloadAbbonamento.parse({ azione: "omaggio", slug, scadenza: null })).toThrow();
  });

  it("proroga con giorni: 0", () => {
    expect(() => schemaPayloadAbbonamento.parse({ azione: "proroga", slug, motivo: "cortesia", giorni: 0 })).toThrow();
  });

  it("omaggio con scadenza non AAAA-MM-GG", () => {
    expect(() =>
      schemaPayloadAbbonamento.parse({ azione: "omaggio", slug, motivo: "pilota", scadenza: "31-12-2026" })
    ).toThrow();
  });

  it("extra_tars con eur: 0", () => {
    expect(() => schemaPayloadAbbonamento.parse({ azione: "extra_tars", slug, eur: 0 })).toThrow();
  });
});
