// server/piattaforma/accesso.test.ts
// Chi amministra la piattaforma (WS6 §3.1): funzione pura testata a parte,
// il builder tRPC che la applica come guardia (senza guardiaTenant, perché
// l'amministratore agisce SU un'altra azienda) e la conferma password delle
// mutation sensibili, con lo stesso limitatore di tentativi del login.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../_core/password";
import { piattaformaProcedure, router } from "../_core/trpc";
import { creaUtenteInterno, getUtentiStore } from "../routers/utenti";
import { conTenant } from "../tenants/contestoCorrente";
import {
  __azzeraLimiteConfermePerTest,
  amministraPiattaforma,
  confermaPassword,
  emailAmministratori,
  utenteAmministratore,
} from "./accesso";
import { MESSAGGI_PIATTAFORMA } from "./costanti";

afterEach(() => {
  delete process.env.PLATFORM_ADMIN_EMAILS;
});

describe("amministraPiattaforma", () => {
  it("vero solo per utente attivo del tenant 1 con email in elenco (senza maiuscole né spazi)", () => {
    process.env.PLATFORM_ADMIN_EMAILS = " T.Ruffino@ruffinogroup.it , altro@x.it";
    expect([...emailAmministratori()]).toEqual(["t.ruffino@ruffinogroup.it", "altro@x.it"]);
    expect(amministraPiattaforma({ email: "t.ruffino@RUFFINOGROUP.it", tenantId: 1, attivo: true })).toBe(true);
    expect(amministraPiattaforma({ email: "t.ruffino@ruffinogroup.it", tenantId: 2, attivo: true })).toBe(false);
    expect(amministraPiattaforma({ email: "t.ruffino@ruffinogroup.it", tenantId: 1, attivo: false })).toBe(false);
    expect(amministraPiattaforma({ email: "nessuno@x.it", tenantId: 1, attivo: true })).toBe(false);
    expect(amministraPiattaforma(null)).toBe(false);
  });

  it("con la variabile vuota nessuno amministra", () => {
    expect(amministraPiattaforma({ email: "t.ruffino@ruffinogroup.it", tenantId: 1, attivo: true })).toBe(false);
  });
});

// Un router di prova esposto dietro `piattaformaProcedure`, come indicato dal
// task brief: verifica che la guardia applichi UNAUTHORIZED/FORBIDDEN e che
// metta `ctx.amministratore` a disposizione delle procedure a valle.
const provaRouter = router({
  p: piattaformaProcedure.query(({ ctx }) => ctx.amministratore),
});

function contestoAnonimo() {
  return {
    user: null,
    req: { protocol: "http", headers: {} } as any,
    res: { cookie() {}, clearCookie() {} } as any,
    sedeId: null,
    sediIds: [],
    tenantId: null,
    tenant: null,
  } as any;
}

/**
 * `loginMethod` di default `null`: rappresenta l'utente OAuth legacy (o un
 * JWT malformato) che NON deve mai risultare amministratore anche con lo
 * stesso id numerico — passare `"local"` esplicitamente per i casi che
 * simulano l'utente locale vero (v. `risolviTenantPerUtente`).
 */
function contestoUtente(utenteId: number, loginMethod: string | null = null) {
  return {
    ...contestoAnonimo(),
    user: { id: utenteId, loginMethod } as any,
  };
}

describe("piattaformaProcedure", () => {
  const PASSWORD = "Password-lunga-12";
  let admin: any;

  beforeEach(() => {
    admin = conTenant(1, () =>
      creaUtenteInterno({
        tenantId: 1,
        nome: "Admin",
        cognome: "Piattaforma",
        email: "admin.piattaforma.accesso.test@wyndoor.test",
        ruoli: ["direzione"],
        sediIds: [1],
        passwordHash: hashPassword(PASSWORD),
      })
    );
    process.env.PLATFORM_ADMIN_EMAILS = admin.email;
  });

  afterEach(() => {
    const utenti = getUtentiStore();
    const indice = utenti.findIndex((u: any) => u.id === admin.id);
    if (indice >= 0) utenti.splice(indice, 1);
  });

  it("anonimo: UNAUTHORIZED", async () => {
    await expect(provaRouter.createCaller(contestoAnonimo()).p()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("utente non in elenco: FORBIDDEN con il messaggio del pannello", async () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    await expect(provaRouter.createCaller(contestoUtente(admin.id, "local")).p()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: MESSAGGI_PIATTAFORMA.nonAmministratore,
    });
  });

  it("utente in elenco: ctx.amministratore con id ed email", async () => {
    await expect(provaRouter.createCaller(contestoUtente(admin.id, "local")).p()).resolves.toEqual({
      id: admin.id,
      email: admin.email.toLowerCase(),
    });
  });

  it("stesso id numerico ma non locale (OAuth legacy) o senza loginMethod: null/FORBIDDEN anche con l'email in elenco", async () => {
    // `utenteAmministratore` da solo, senza passare dal router: il guasto
    // trovato in revisione era qui, un id numerico bastava a farlo passare.
    expect(utenteAmministratore({ id: admin.id, loginMethod: "oauth" })).toBeNull();
    expect(utenteAmministratore({ id: admin.id })).toBeNull();
    await expect(provaRouter.createCaller(contestoUtente(admin.id, "oauth")).p()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: MESSAGGI_PIATTAFORMA.nonAmministratore,
    });
    await expect(provaRouter.createCaller(contestoUtente(admin.id)).p()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: MESSAGGI_PIATTAFORMA.nonAmministratore,
    });
  });
});

describe("confermaPassword", () => {
  const PASSWORD = "Password-lunga-12";
  let admin: any;

  beforeEach(() => {
    admin = conTenant(1, () =>
      creaUtenteInterno({
        tenantId: 1,
        nome: "Admin",
        cognome: "Conferma",
        email: "admin.conferma.accesso.test@wyndoor.test",
        ruoli: ["direzione"],
        sediIds: [1],
        passwordHash: hashPassword(PASSWORD),
      })
    );
    process.env.PLATFORM_ADMIN_EMAILS = admin.email;
    __azzeraLimiteConfermePerTest();
  });

  afterEach(() => {
    const utenti = getUtentiStore();
    const indice = utenti.findIndex((u: any) => u.id === admin.id);
    if (indice >= 0) utenti.splice(indice, 1);
    __azzeraLimiteConfermePerTest();
  });

  it("password giusta: nessun errore", () => {
    expect(() =>
      confermaPassword({ id: admin.id, email: admin.email, loginMethod: "local" }, PASSWORD)
    ).not.toThrow();
  });

  it("password sbagliata cinque volte, la sesta è TOO_MANY_REQUESTS", () => {
    for (let i = 0; i < 5; i++) {
      expect(() =>
        confermaPassword({ id: admin.id, email: admin.email, loginMethod: "local" }, "sbagliata")
      ).toThrow(MESSAGGI_PIATTAFORMA.passwordNonCorretta);
    }
    try {
      confermaPassword({ id: admin.id, email: admin.email, loginMethod: "local" }, "sbagliata");
      throw new Error("doveva lanciare");
    } catch (errore: any) {
      expect(errore.code).toBe("TOO_MANY_REQUESTS");
    }
  });

  it("loginMethod non locale: UNAUTHORIZED anche con la password giusta (stesso id di un amministratore)", () => {
    expect(() =>
      confermaPassword({ id: admin.id, email: admin.email, loginMethod: "oauth" }, PASSWORD)
    ).toThrow(MESSAGGI_PIATTAFORMA.passwordNonCorretta);
  });
});
