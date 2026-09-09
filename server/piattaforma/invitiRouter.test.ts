// server/piattaforma/invitiRouter.test.ts
// Router pubblico `inviti` (spec §6.2): `anteprima` legge senza consumare;
// `accetta` imposta la password e apre la sessione locale come `auth.login`
// — stesso cookie (COOKIE_NAME), stessa forma di LocalUser — dietro il
// limitatore di tentativi con chiave derivata dall'hash del token (mai il
// token in chiaro). Contesto di prova come server/tenants/router.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "@shared/const";
import type { TrpcContext } from "../_core/context";
import { hashPassword } from "../_core/password";
import { __impostaPostaPerTest } from "../_core/postaPiattaforma";
import { getSediStore } from "../routers/sedi";
import { getUtentiStore } from "../routers/utenti";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import { crea } from "../tenants/servizio";
import { MESSAGGI_PIATTAFORMA } from "./costanti";
import { invitaProprietario } from "./inviti";
import { invitiRouter } from "./invitiRouter";

const sedi = getSediStore();
const utenti = getUtentiStore();
let nS = 0;
let nU = 0;
const script = { tipo: "script" as const, nome: "script:invitiRouter@test" };
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

function contesto(): TrpcContext {
  return {
    user: null,
    req: { protocol: "http", headers: {} } as any,
    res: { cookie: vi.fn(), clearCookie: vi.fn() } as any,
    sedeId: null,
    sediIds: [],
    tenantId: null,
    tenant: null,
  };
}

async function nuovoInvito() {
  const { tenant, utenteId } = await crea(inputAcme(), script);
  const { link } = await invitaProprietario({
    tenantId: tenant.id,
    attore: piattaforma,
    adesso: T0,
    baseUrl: "https://crm.test",
  });
  return { tenant, utenteId, token: link.split("/invito/")[1] };
}

beforeEach(() => {
  resetTenantRepositoryForTesting();
  nS = sedi.length;
  nU = utenti.length;
  __impostaPostaPerTest(async () => ({ inviato: true, id: "em_1" }));
});

afterEach(() => {
  sedi.splice(nS);
  utenti.splice(nU);
  __impostaPostaPerTest(null);
  vi.restoreAllMocks();
});

describe("invitiRouter.anteprima", () => {
  it("token valido: azienda, email e nome, senza consumarlo", async () => {
    const { token } = await nuovoInvito();
    const anteprima = await invitiRouter.createCaller(contesto()).anteprima({ token });
    expect(anteprima).toMatchObject({ azienda: "Acme Infissi", email: "mario@acme.test", nome: "Mario" });
    // Non consumato: una seconda lettura torna lo stesso risultato.
    await expect(invitiRouter.createCaller(contesto()).anteprima({ token })).resolves.toMatchObject({
      email: "mario@acme.test",
    });
  });

  it("token non valido: NOT_FOUND con il messaggio del pannello", async () => {
    await expect(
      invitiRouter.createCaller(contesto()).anteprima({ token: "x".repeat(43) })
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: MESSAGGI_PIATTAFORMA.invitoNonValido });
  });
});

describe("invitiRouter.accetta", () => {
  it("imposta il cookie di sessione e torna il LocalUser dell'utente invitato", async () => {
    const { utenteId, token } = await nuovoInvito();
    const ctx = contesto();
    const risultato = await invitiRouter.createCaller(ctx).accetta({ token, password: "Password-nuova-12" });
    expect(risultato).toMatchObject({ id: utenteId, email: "mario@acme.test", loginMethod: "local" });
    expect(ctx.res.cookie).toHaveBeenCalledWith(COOKIE_NAME, expect.any(String), expect.any(Object));
  });

  it("token già usato: NOT_FOUND, nessuna seconda sessione", async () => {
    const { token } = await nuovoInvito();
    const primo = contesto();
    await invitiRouter.createCaller(primo).accetta({ token, password: "Password-nuova-12" });
    const secondo = contesto();
    await expect(
      invitiRouter.createCaller(secondo).accetta({ token, password: "Password-nuova-12" })
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: MESSAGGI_PIATTAFORMA.invitoNonValido });
    expect(secondo.res.cookie).not.toHaveBeenCalled();
  });

  it("token sbagliato cinque volte: la sesta dà TOO_MANY_REQUESTS", async () => {
    const tokenSbagliato = "y".repeat(43);
    for (let i = 0; i < 5; i++) {
      await expect(
        invitiRouter.createCaller(contesto()).accetta({ token: tokenSbagliato, password: "Password-nuova-12" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(
      invitiRouter.createCaller(contesto()).accetta({ token: tokenSbagliato, password: "Password-nuova-12" })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", message: MESSAGGI_PIATTAFORMA.troppiTentativi });
  });

  it("password troppo corta: rifiutata dallo schema, prima di toccare il servizio", async () => {
    const { token } = await nuovoInvito();
    await expect(
      invitiRouter.createCaller(contesto()).accetta({ token, password: "corta" })
    ).rejects.toThrow();
  });
});
