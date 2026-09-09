// server/piattaforma/inviti.test.ts
// Servizio degli inviti (spec §6.1): `invitaProprietario` trova l'utente
// dentro conTenant (per id, per email, o l'unico con ruolo proprietario),
// emette il token via repo.emettiInvito (che annulla i precedenti), manda
// la posta senza mai lanciare se fallisce — il link torna comunque al
// chiamante — e registra invito_inviato SENZA il token. `accettaInvito`
// consuma il token (monouso), imposta password+attivo e registra
// invito_accettato. Setup come server/tenants/servizio.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "../_core/password";
import { __impostaPostaPerTest } from "../_core/postaPiattaforma";
import { getSediStore } from "../routers/sedi";
import { creaUtenteInterno, getUtentiStore } from "../routers/utenti";
import { RUOLO_PROPRIETARIO, TTL_INVITO_MS } from "../tenants/costanti";
import { conTenant } from "../tenants/contestoCorrente";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import { crea } from "../tenants/servizio";
import { MESSAGGI_PIATTAFORMA } from "./costanti";
import { accettaInvito, anteprimaInvito, avvisaBaseUrlMancante, invitaProprietario } from "./inviti";

const sedi = getSediStore();
const utenti = getUtentiStore();
let nS = 0;
let nU = 0;
const script = { tipo: "script" as const, nome: "script:inviti@test" };
const piattaforma = { tipo: "piattaforma" as const, email: "t@r.it" };
const T0 = new Date("2026-09-09T09:00:00.000Z");

const inputAcme = () => ({
  slug: "acme",
  nome: "Acme Infissi",
  sede: { nome: "Acme Infissi", citta: "Sarzana" },
  proprietario: {
    nome: "Mario",
    cognome: "Rossi",
    email: "mario@acme.test",
    passwordHash: hashPassword("Password-lunga-12"),
  },
});

beforeEach(() => {
  resetTenantRepositoryForTesting();
  nS = sedi.length;
  nU = utenti.length;
});

afterEach(() => {
  sedi.splice(nS);
  utenti.splice(nU);
  __impostaPostaPerTest(null);
});

describe("invitaProprietario", () => {
  it("invita l'unico proprietario, manda la posta e registra l'evento senza token", async () => {
    const inviati: any[] = [];
    __impostaPostaPerTest(async m => {
      inviati.push(m);
      return { inviato: true, id: "em_1" };
    });
    const { tenant } = await crea(inputAcme(), script);
    const esito = await invitaProprietario({
      tenantId: tenant.id,
      attore: piattaforma,
      adesso: T0,
      baseUrl: "https://crm.test",
    });
    expect(esito.inviato).toBe(true);
    expect(esito.link).toMatch(/^https:\/\/crm\.test\/invito\/[A-Za-z0-9_-]{40,}$/);
    // I5: la base torna al chiamante, così il pannello può dire su quale
    // indirizzo è composto il link che sta mostrando.
    expect(esito.baseUrl).toBe("https://crm.test");
    expect(inviati[0].a).toBe("mario@acme.test");
    expect(inviati[0].testo).toContain(esito.link);
    const eventi = await getTenantRepository().eventi(tenant.id);
    const ev = eventi.find(e => e.tipo === "invito_inviato")!;
    expect(ev.attore).toBe("piattaforma:t@r.it");
    expect(JSON.stringify(ev.dettagli)).not.toContain(esito.link.split("/invito/")[1]);
    expect(ev.dettagli).toMatchObject({ email: "mario@acme.test", inviato: true });
  });

  it("senza posta: il link torna comunque e l'evento dice perché", async () => {
    __impostaPostaPerTest(async () => ({ inviato: false, motivo: "non configurata" }));
    const { tenant } = await crea(inputAcme(), script);
    const esito = await invitaProprietario({
      tenantId: tenant.id,
      attore: piattaforma,
      adesso: T0,
      baseUrl: "https://crm.test",
    });
    expect(esito).toMatchObject({ inviato: false, motivo: "non configurata" });
    expect(esito.link).toContain("/invito/");
    const eventi = await getTenantRepository().eventi(tenant.id);
    const ev = eventi.find(e => e.tipo === "invito_inviato")!;
    expect(ev.dettagli).toMatchObject({ inviato: false, motivo: "non configurata" });
  });

  it("reinvio: il vecchio link smette di funzionare, il nuovo funziona", async () => {
    __impostaPostaPerTest(async () => ({ inviato: true, id: "em_1" }));
    const { tenant } = await crea(inputAcme(), script);
    const primo = await invitaProprietario({
      tenantId: tenant.id,
      attore: piattaforma,
      adesso: T0,
      baseUrl: "https://crm.test",
    });
    const secondo = await invitaProprietario({
      tenantId: tenant.id,
      attore: piattaforma,
      adesso: T0,
      baseUrl: "https://crm.test",
    });
    expect(secondo.link).not.toBe(primo.link);
    const tokenVecchio = primo.link.split("/invito/")[1];
    const tokenNuovo = secondo.link.split("/invito/")[1];
    expect(await anteprimaInvito({ token: tokenVecchio, adesso: T0 })).toBeNull();
    expect(await anteprimaInvito({ token: tokenNuovo, adesso: T0 })).not.toBeNull();
  });

  it("con più proprietari senza email rifiuta; con email invita quello", async () => {
    __impostaPostaPerTest(async () => ({ inviato: true, id: "em_2" }));
    const { tenant, sedeId } = await crea(inputAcme(), script);
    const secondo = conTenant(tenant.id, () =>
      creaUtenteInterno({
        tenantId: tenant.id,
        nome: "Luca",
        cognome: "Bianchi",
        email: "luca@acme.test",
        ruoli: [RUOLO_PROPRIETARIO],
        sediIds: [sedeId],
        passwordHash: hashPassword("Password-lunga-12"),
      })
    );
    await expect(
      invitaProprietario({ tenantId: tenant.id, attore: piattaforma, adesso: T0, baseUrl: "https://crm.test" })
    ).rejects.toThrow(MESSAGGI_PIATTAFORMA.proprietarioAmbiguo);
    const esito = await invitaProprietario({
      tenantId: tenant.id,
      email: "luca@acme.test",
      attore: piattaforma,
      adesso: T0,
      baseUrl: "https://crm.test",
    });
    expect(esito.inviato).toBe(true);
    const eventi = await getTenantRepository().eventi(tenant.id);
    const ev = eventi.find(e => e.tipo === "invito_inviato")!;
    expect(ev.dettagli).toMatchObject({ email: "luca@acme.test", utenteId: secondo.id });
  });
});

describe("anteprimaInvito e accettaInvito", () => {
  it("accetta: imposta la password, attiva l'utente, brucia il token, registra l'evento", async () => {
    __impostaPostaPerTest(async () => ({ inviato: true, id: "x" }));
    const { tenant, utenteId } = await crea(inputAcme(), script);
    const { link } = await invitaProprietario({
      tenantId: tenant.id,
      attore: piattaforma,
      adesso: T0,
      baseUrl: "https://crm.test",
    });
    const token = link.split("/invito/")[1];
    expect(await anteprimaInvito({ token, adesso: T0 })).toMatchObject({
      azienda: "Acme Infissi",
      email: "mario@acme.test",
      nome: "Mario",
    });
    const esito = await accettaInvito({ token, password: "Password-nuova-12", adesso: T0 });
    expect(esito).toEqual({ tenantId: tenant.id, utenteId, email: "mario@acme.test" });
    const utente = conTenant(tenant.id, () => getUtentiStore().find((u: any) => u.id === utenteId));
    expect(verifyPassword("Password-nuova-12", utente.password)).toBe(true);
    expect(utente.attivo).toBe(true);
    const eventi = await getTenantRepository().eventi(tenant.id);
    expect(eventi.find(e => e.tipo === "invito_accettato")).toMatchObject({
      attore: `utente:${utenteId}`,
      dettagli: { utenteId },
    });
    await expect(accettaInvito({ token, password: "Password-nuova-12", adesso: T0 })).rejects.toThrow(
      MESSAGGI_PIATTAFORMA.invitoNonValido
    );
    expect(await anteprimaInvito({ token, adesso: T0 })).toBeNull();
  });

  it("scaduto: oltre il TTL, anteprima e accettazione rifiutano", async () => {
    __impostaPostaPerTest(async () => ({ inviato: true, id: "x" }));
    const { tenant } = await crea(inputAcme(), script);
    const { link } = await invitaProprietario({
      tenantId: tenant.id,
      attore: piattaforma,
      adesso: T0,
      baseUrl: "https://crm.test",
    });
    const token = link.split("/invito/")[1];
    const dopoScadenza = new Date(T0.getTime() + TTL_INVITO_MS + 1000);
    expect(await anteprimaInvito({ token, adesso: dopoScadenza })).toBeNull();
    await expect(accettaInvito({ token, password: "Password-nuova-12", adesso: dopoScadenza })).rejects.toThrow(
      MESSAGGI_PIATTAFORMA.invitoNonValido
    );
  });

  it("token inesistente: anteprima null, accettazione rifiuta", async () => {
    expect(await anteprimaInvito({ token: "z".repeat(43), adesso: T0 })).toBeNull();
    await expect(accettaInvito({ token: "z".repeat(43), password: "Password-nuova-12", adesso: T0 })).rejects.toThrow(
      MESSAGGI_PIATTAFORMA.invitoNonValido
    );
  });
});

// I5 (revisione finale): senza APP_BASE_URL il link d'invito nasce dall'Host
// della richiesta — di solito giusto, ma dietro un proxy o su un dominio
// vecchio manda il proprietario su un indirizzo che non è quello buono, e
// nessuno se ne accorge finché non arriva la segnalazione.
describe("avvisaBaseUrlMancante", () => {
  const precedente = process.env.APP_BASE_URL;

  afterEach(() => {
    if (precedente === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = precedente;
  });

  it("senza APP_BASE_URL: un avviso solo, che nomina la variabile", () => {
    delete process.env.APP_BASE_URL;
    const spia = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(avvisaBaseUrlMancante()).toBe(true);
      expect(spia).toHaveBeenCalledTimes(1);
      expect(String(spia.mock.calls[0]?.[0])).toBe(
        "[piattaforma] APP_BASE_URL non impostata: i link d'invito useranno l'host della richiesta"
      );
    } finally {
      spia.mockRestore();
    }
  });

  it("con APP_BASE_URL: nessun avviso", () => {
    process.env.APP_BASE_URL = "https://app.wyndoor.com";
    const spia = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(avvisaBaseUrlMancante()).toBe(false);
      expect(spia).not.toHaveBeenCalled();
    } finally {
      spia.mockRestore();
    }
  });
});
