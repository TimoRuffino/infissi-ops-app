// server/_core/context.tenant.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME, SEDE_COOKIE } from "@shared/const";
import { createContext } from "./context";
import { createLocalToken, type LocalUser } from "../localAuth";
import { getSediStore } from "../routers/sedi";
import { getUtentiStore } from "../routers/utenti";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";

const SEDE_T2 = 97301;
const SEDE_T1 = 97302;
const COMMERCIALE_T2 = 97311;
const SPENTO_T2 = 97312;
const SENZA_SEDE_T3 = 97313;
const PROPRIETARIO_T2 = 97314;
const SPENTO_T1 = 97315;

const sedi = getSediStore();
const utenti = getUtentiStore();
let nS = 0;
let nU = 0;

function utenteLocale(id: number, ruoli: string[]): LocalUser {
  return {
    id,
    openId: `local-${id}`,
    name: `Utente ${id}`,
    email: `u${id}@prova.test`,
    loginMethod: "local",
    role: ruoli.includes("direzione") ? "admin" : "user",
    ruolo: ruoli[0],
    ruoli,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

async function contestoCon(id: number, ruoli: string[], sedeCookie?: number) {
  const token = await createLocalToken(utenteLocale(id, ruoli));
  const cookie =
    `${COOKIE_NAME}=${token}` + (sedeCookie ? `; ${SEDE_COOKIE}=${sedeCookie}` : "");
  return createContext({
    req: { headers: { cookie }, protocol: "http" } as any,
    res: {} as any,
  });
}

beforeEach(async () => {
  resetTenantRepositoryForTesting();
  const repo = getTenantRepository();
  await repo.assicuraTenantPredefinito();
  await repo.inserisci({ slug: "acme", nome: "Acme" }); // id 2
  await repo.inserisci({ slug: "vuota", nome: "Vuota" }); // id 3, senza sedi
  nS = sedi.length;
  nU = utenti.length;
  const now = new Date();
  sedi.push(
    { id: SEDE_T2, tenantId: 2, nome: "Acme", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now },
    { id: SEDE_T1, tenantId: 1, nome: "Ruffino Bis", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now }
  );
  const base = { nome: "N", cognome: "C", attivo: true, sediIds: [SEDE_T2], createdAt: now, updatedAt: now };
  utenti.push(
    { ...base, id: COMMERCIALE_T2, email: "c@acme.test", ruoli: ["commerciale"], tenantId: 2 },
    { ...base, id: SPENTO_T2, email: "s@acme.test", ruoli: ["commerciale"], tenantId: 2, attivo: false },
    { ...base, id: SENZA_SEDE_T3, email: "v@vuota.test", ruoli: ["direzione"], tenantId: 3, sediIds: [] },
    { ...base, id: PROPRIETARIO_T2, email: "p@acme.test", ruoli: ["proprietario", "direzione"], tenantId: 2 },
    { ...base, id: SPENTO_T1, email: "s@ruffino.test", ruoli: ["commerciale"], tenantId: 1, attivo: false }
  );
});

afterEach(() => {
  sedi.splice(nS);
  utenti.splice(nU);
  delete process.env.FLAG_MULTI_AZIENDA;
});

describe("createContext con FLAG_MULTI_AZIENDA acceso", () => {
  it("risolve tenant, record e sedi dallo store; il cookie di una sede altrui è ignorato", async () => {
    const ctx = await contestoCon(COMMERCIALE_T2, ["commerciale"], SEDE_T1);
    expect(ctx.user?.id).toBe(COMMERCIALE_T2);
    expect(ctx.tenantId).toBe(2);
    expect(ctx.tenant?.slug).toBe("acme");
    expect(ctx.sediIds).toEqual([SEDE_T2]);
    expect(ctx.sedeId).toBe(SEDE_T2);
  });

  it("un utente disattivato con JWT valido non è più autenticato", async () => {
    const ctx = await contestoCon(SPENTO_T2, ["commerciale"]);
    expect(ctx.user).toBeNull();
    expect(ctx.tenantId).toBeNull();
    expect(ctx.tenant).toBeNull();
    expect(ctx.sedeId).toBeNull();
  });

  it("un tenant senza sedi attive dà sedeId null e sediIds vuoto", async () => {
    const ctx = await contestoCon(SENZA_SEDE_T3, ["direzione"]);
    expect(ctx.tenantId).toBe(3);
    expect(ctx.sediIds).toEqual([]);
    expect(ctx.sedeId).toBeNull();
  });

  it("i ruoli vengono dallo store: un JWT con 'direzione' non basta se lo store dice 'commerciale' (Important 1)", async () => {
    // Il token porta ruoli più ampi di quelli reali nello store (revoca non
    // ancora scaduta lato JWT): ctx.user deve riflettere lo store, non il token.
    const ctx = await contestoCon(COMMERCIALE_T2, ["direzione"]);
    expect((ctx.user as any)?.ruoli).toEqual(["commerciale"]);
    expect((ctx.user as any)?.role).toBe("user");
  });

  it("i ruoli vengono dallo store: un JWT con 'commerciale' diventa admin se lo store dice proprietario+direzione", async () => {
    // Caso inverso: il token è rimasto indietro rispetto a una promozione.
    const ctx = await contestoCon(PROPRIETARIO_T2, ["commerciale"]);
    expect((ctx.user as any)?.ruoli).toEqual(["proprietario", "direzione"]);
    expect((ctx.user as any)?.role).toBe("admin");
  });
});

describe("createContext con FLAG_MULTI_AZIENDA spento", () => {
  it("un utente del tenant 1: tenant implicito, nessuna rilettura dei ruoli, sedi come oggi", async () => {
    // `attivo: false` e la sessione regge lo stesso: a flag spento il CRM è
    // quello di prima, che il record disattivato non lo rilegge. L'unico
    // controllo nuovo (R10) è sull'azienda, non sui ruoli né su `attivo`.
    process.env.FLAG_MULTI_AZIENDA = "off";
    const ctx = await contestoCon(SPENTO_T1, ["commerciale"]);
    expect(ctx.user?.id).toBe(SPENTO_T1);
    expect(ctx.tenantId).toBe(1);
    expect(ctx.tenant).toBeNull();
    expect(ctx.sediIds).toEqual([SEDE_T2]);
    expect(ctx.sedeId).toBe(SEDE_T2);
  });

  // R10 (revisione finale del WS6): a flag spento `createContext` fissava
  // tenantId = 1 per CHIUNQUE e `allowedSediForUser` dava a un utente del
  // tenant 2 le sedi di Ruffino Group. Con una seconda azienda a terra, dopo
  // il WS6, spegnere l'interruttore non è più «il CRM di prima»: è la porta
  // di Ruffino Group aperta ai suoi clienti. Quindi la porta si chiude.
  it("un utente di un'altra azienda non entra: sessione rifiutata, una riga di log", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const spia = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ctx = await contestoCon(COMMERCIALE_T2, ["commerciale"], SEDE_T1);
      expect(ctx.user).toBeNull();
      expect(ctx.tenantId).toBeNull();
      expect(ctx.sediIds).toEqual([]);
      expect(ctx.sedeId).toBeNull();
      expect(spia).toHaveBeenCalledTimes(1);
      expect(String(spia.mock.calls[0]?.[0])).toBe(
        "[tenants] sessione rifiutata a interruttore spento (tenant 2)"
      );
    } finally {
      spia.mockRestore();
    }
  });
});
