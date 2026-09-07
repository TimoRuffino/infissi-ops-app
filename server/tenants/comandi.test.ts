// server/tenants/comandi.test.ts
import { describe, expect, it } from "vitest";
import { hashPassword } from "../_core/password";
import { richiestoDa, schemaPayloadCrea, schemaPayloadProprietario, schemaPayloadStato } from "./comandi";

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
