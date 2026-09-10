// server/tenants/comandi.test.ts
import { describe, expect, it } from "vitest";
import { hashPassword } from "../_core/password";
import {
  richiestoDa,
  schemaPayloadAbbonamento,
  schemaPayloadCrea,
  schemaPayloadModificaProprietario,
  schemaPayloadModificaTenant,
  schemaPayloadProprietario,
  schemaPayloadStato,
  schemaPayloadSvuota,
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

// «Modifica azienda» (piano 09/09/2026, Task 2): copertura diretta degli
// schemi, come già per `schemaPayloadAbbonamento` sopra.
describe("schemaPayloadModificaTenant", () => {
  const slug = "acme";

  it("solo slug: ogni altro campo è facoltativo", () => {
    const ok = schemaPayloadModificaTenant.parse({ slug });
    expect(ok).toEqual({ slug });
  });

  it("accetta ogni campo, fatturazione e sede comprese", () => {
    const ok = schemaPayloadModificaTenant.parse({
      slug,
      nome: "Acme Infissi",
      nuovoSlug: "acme-2",
      note: "cliente storico",
      fatturazione: {
        partitaIva: "12345678901",
        codiceFiscale: "RSSMRA80A01H501U",
        indirizzoLegale: "Via Roma 1, Sarzana",
        emailAmministrativa: "amministrazione@acme.it",
        pec: "acme@pec.it",
        codiceSdi: "ABC1234",
      },
      sede: { id: 7, nome: "Acme HQ", citta: "Sarzana" },
    });
    expect(ok.nuovoSlug).toBe("acme-2");
    expect(ok.fatturazione?.partitaIva).toBe("12345678901");
    expect(ok.sede).toEqual({ id: 7, nome: "Acme HQ", citta: "Sarzana" });
  });

  it("note e sede.citta accettano null", () => {
    const ok = schemaPayloadModificaTenant.parse({
      slug,
      note: null,
      sede: { id: 7, nome: "Acme HQ", citta: null },
    });
    expect(ok.note).toBeNull();
    expect(ok.sede?.citta).toBeNull();
  });

  it("fatturazione è un patch parziale: un solo campo è ammesso", () => {
    const ok = schemaPayloadModificaTenant.parse({ slug, fatturazione: { pec: "acme@pec.it" } });
    expect(ok.fatturazione).toEqual({ pec: "acme@pec.it" });
  });

  it("rifiuta un nuovoSlug non valido", () => {
    expect(() => schemaPayloadModificaTenant.parse({ slug, nuovoSlug: "Acme!" })).toThrow();
  });

  it("rifiuta una partitaIva che non ha 11 cifre", () => {
    expect(() => schemaPayloadModificaTenant.parse({ slug, fatturazione: { partitaIva: "123" } })).toThrow();
  });

  it("rifiuta un codiceSdi che non ha 7 caratteri", () => {
    expect(() => schemaPayloadModificaTenant.parse({ slug, fatturazione: { codiceSdi: "ABC" } })).toThrow();
  });

  it("rifiuta una emailAmministrativa non valida", () => {
    expect(() =>
      schemaPayloadModificaTenant.parse({ slug, fatturazione: { emailAmministrativa: "non-una-email" } })
    ).toThrow();
  });

  it("sede vuole id, nome e citta insieme: citta mancante è rifiutata", () => {
    expect(() => schemaPayloadModificaTenant.parse({ slug, sede: { id: 7, nome: "Acme HQ" } })).toThrow();
  });

  // Fix round Task 2 → Task 3 (revisione, nit 4): un form o `--note=` della
  // CLI non sanno scrivere `null`, solo una stringa vuota — deve valere come
  // "azzera il campo", non come un valore da rifiutare (es. l'email vuota
  // fallirebbe `.email()` senza questa normalizzazione).
  it("stringa vuota (anche solo spazi) su un campo nullable diventa null: note, i sei campi di fatturazione, sede.citta", () => {
    const ok = schemaPayloadModificaTenant.parse({
      slug,
      note: "   ",
      fatturazione: {
        partitaIva: "",
        codiceFiscale: " ",
        indirizzoLegale: "",
        emailAmministrativa: "",
        pec: "",
        codiceSdi: "",
      },
      sede: { id: 7, nome: "Acme HQ", citta: "" },
    });
    expect(ok.note).toBeNull();
    expect(ok.fatturazione).toEqual({
      partitaIva: null,
      codiceFiscale: null,
      indirizzoLegale: null,
      emailAmministrativa: null,
      pec: null,
      codiceSdi: null,
    });
    expect(ok.sede?.citta).toBeNull();
  });

  // Fix round Task 2 → Task 3 (nit 5): `partitaIva` si trimma come i suoi
  // cinque simili, prima del controllo delle 11 cifre.
  it("partitaIva si trimma come i suoi cinque simili: gli spazi attorno alle 11 cifre sono ammessi", () => {
    const ok = schemaPayloadModificaTenant.parse({ slug, fatturazione: { partitaIva: "  12345678901  " } });
    expect(ok.fatturazione?.partitaIva).toBe("12345678901");
  });

  // Task 3 fix round 1: `vuotoANull` (comandi.ts) ora dichiara a TypeScript
  // che l'INPUT dei campi che avvolge è `string | null` (guardia di tipo in
  // server/tenants/comandi.tipi.assert.ts, type-checkata da `pnpm check`
  // perché non è un `*.test.ts`). Questo test prova il lato runtime dello
  // stesso bug: un valore che non è né stringa né null era GIÀ rifiutato
  // prima della fix (il preprocess lo passa inalterato al validatore vero,
  // che non lo accetta) — qui si conferma che restringere il tipo non ha
  // allentato nulla a runtime.
  it("un valore che non è né stringa né null resta rifiutato a runtime, non solo a tipo", () => {
    expect(() => schemaPayloadModificaTenant.parse({ slug, note: 12345 as unknown as string })).toThrow();
    expect(() =>
      schemaPayloadModificaTenant.parse({ slug, fatturazione: { pec: {} as unknown as string } })
    ).toThrow();
  });
});

describe("schemaPayloadModificaProprietario", () => {
  const slug = "acme";

  it("utenteId è facoltativo", () => {
    const ok = schemaPayloadModificaProprietario.parse({
      slug,
      nome: "Mario",
      cognome: "Rossi",
      email: "mario@acme.it",
    });
    expect(ok.utenteId).toBeUndefined();
    expect(ok.telefono).toBeUndefined();
  });

  it("accetta utenteId e telefono, telefono nullable", () => {
    const ok = schemaPayloadModificaProprietario.parse({
      slug,
      utenteId: 42,
      nome: "Mario",
      cognome: "Rossi",
      email: "mario@acme.it",
      telefono: null,
    });
    expect(ok.utenteId).toBe(42);
    expect(ok.telefono).toBeNull();
  });

  it("rifiuta un'email non valida", () => {
    expect(() =>
      schemaPayloadModificaProprietario.parse({ slug, nome: "Mario", cognome: "Rossi", email: "non-una-email" })
    ).toThrow();
  });

  it("rifiuta nome/cognome vuoti", () => {
    expect(() =>
      schemaPayloadModificaProprietario.parse({ slug, nome: "", cognome: "Rossi", email: "mario@acme.it" })
    ).toThrow();
  });

  it("rifiuta un utenteId non positivo", () => {
    expect(() =>
      schemaPayloadModificaProprietario.parse({
        slug,
        utenteId: 0,
        nome: "Mario",
        cognome: "Rossi",
        email: "mario@acme.it",
      })
    ).toThrow();
  });

  // Fix round Task 2 → Task 3 (nit 4): stessa regola di `note`/`fatturazione`
  // sopra, qui per il campo telefono.
  it("telefono vuoto (anche solo spazi) diventa null", () => {
    const ok = schemaPayloadModificaProprietario.parse({
      slug,
      nome: "Mario",
      cognome: "Rossi",
      email: "mario@acme.it",
      telefono: "   ",
    });
    expect(ok.telefono).toBeNull();
  });

  // Task 3 fix round 1: stesso lato runtime del test analogo su
  // schemaPayloadModificaTenant sopra — un array non è né stringa né null.
  it("telefono non stringa/null resta rifiutato a runtime", () => {
    expect(() =>
      schemaPayloadModificaProprietario.parse({
        slug,
        nome: "Mario",
        cognome: "Rossi",
        email: "mario@acme.it",
        telefono: [] as unknown as string,
      })
    ).toThrow();
  });
});

describe("ciclo di vita (piano 10/09/2026)", () => {
  it("schemaPayloadCrea: statoIniziale accetta solo attivo e in_attesa, ed è facoltativo", () => {
    const base = {
      slug: "acme",
      nome: "Acme",
      sede: { nome: "Acme" },
      proprietario: { nome: "M", cognome: "R", email: "m@r.it", passwordHash: hashPassword("Password-lunga-12") },
    };
    expect(schemaPayloadCrea.parse(base).statoIniziale).toBeUndefined();
    expect(schemaPayloadCrea.parse({ ...base, statoIniziale: "in_attesa" }).statoIniziale).toBe("in_attesa");
    expect(() => schemaPayloadCrea.parse({ ...base, statoIniziale: "sospeso" })).toThrow();
  });

  it("schemaPayloadSvuota: slug obbligatorio, forza facoltativa", () => {
    expect(schemaPayloadSvuota.parse({ slug: "acme" })).toEqual({ slug: "acme" });
    expect(schemaPayloadSvuota.parse({ slug: "acme", forza: true }).forza).toBe(true);
    expect(() => schemaPayloadSvuota.parse({ forza: true })).toThrow();
  });
});
