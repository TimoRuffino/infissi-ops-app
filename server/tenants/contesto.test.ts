// server/tenants/contesto.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSediStore } from "../routers/sedi";
import { getUtentiStore } from "../routers/utenti";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";
import { risolviTenantPerUtente, sediAmmesse, tenantIdDellaSede } from "./contesto";

const SEDE_T2 = 97201;
const SEDE_T2_SPENTA = 97202;
const SEDE_T1 = 97203;
const DIREZIONE_T2 = 97211;
const COMMERCIALE_T2 = 97212;
const SPENTO_T2 = 97213;
const SENZA_SEDI_T2 = 97214;

const sedi = getSediStore();
const utenti = getUtentiStore();
let nSedi = 0;
let nUtenti = 0;

beforeEach(async () => {
  resetTenantRepositoryForTesting();
  const repo = getTenantRepository();
  await repo.assicuraTenantPredefinito();
  await repo.inserisci({ slug: "acme", nome: "Acme" }); // id 2
  nSedi = sedi.length;
  nUtenti = utenti.length;
  const now = new Date();
  sedi.push(
    { id: SEDE_T2, tenantId: 2, nome: "Acme Sede", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now },
    { id: SEDE_T2_SPENTA, tenantId: 2, nome: "Acme Vecchia", citta: null, indirizzo: null, attiva: false, createdAt: now, updatedAt: now },
    { id: SEDE_T1, tenantId: 1, nome: "Ruffino Bis", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now }
  );
  const base = { nome: "N", cognome: "C", attivo: true, createdAt: now, updatedAt: now };
  utenti.push(
    { ...base, id: DIREZIONE_T2, email: "d@acme.test", ruoli: ["direzione"], sediIds: [SEDE_T2], tenantId: 2 },
    { ...base, id: COMMERCIALE_T2, email: "c@acme.test", ruoli: ["commerciale"], sediIds: [SEDE_T2, SEDE_T1], tenantId: 2 },
    { ...base, id: SPENTO_T2, email: "s@acme.test", ruoli: ["commerciale"], sediIds: [SEDE_T2], tenantId: 2, attivo: false },
    { ...base, id: SENZA_SEDI_T2, email: "z@acme.test", ruoli: ["ordini"], sediIds: [SEDE_T1], tenantId: 2 }
  );
});

afterEach(() => {
  sedi.splice(nSedi);
  utenti.splice(nUtenti);
});

describe("sediAmmesse", () => {
  it("direzione e proprietario vedono tutte le sedi attive del tenant", () => {
    expect(sediAmmesse({ id: DIREZIONE_T2 }, 2)).toEqual([SEDE_T2]);
  });
  it("gli altri vedono solo le proprie sedi, mai quelle di un altro tenant", () => {
    expect(sediAmmesse({ id: COMMERCIALE_T2 }, 2)).toEqual([SEDE_T2]);
  });
  it("senza sedi valide ricade sulla prima sede attiva del tenant", () => {
    expect(sediAmmesse({ id: SENZA_SEDI_T2 }, 2)).toEqual([SEDE_T2]);
  });
});

describe("risolviTenantPerUtente", () => {
  const locale = (id: number) => ({ id, loginMethod: "local" });
  it("restituisce tenant e record per un utente locale attivo", () => {
    const r = risolviTenantPerUtente(locale(COMMERCIALE_T2));
    expect(r?.tenantId).toBe(2);
    expect(r?.tenant.slug).toBe("acme");
    expect(r?.utente.id).toBe(COMMERCIALE_T2);
  });
  it("rifiuta utente disattivato, inesistente, non locale, o con tenant sconosciuto", () => {
    expect(risolviTenantPerUtente(locale(SPENTO_T2))).toBeNull();
    expect(risolviTenantPerUtente(locale(999_999))).toBeNull();
    expect(risolviTenantPerUtente({ id: COMMERCIALE_T2, loginMethod: "oauth" })).toBeNull();
    utenti.push({ id: 97299, nome: "X", cognome: "Y", email: "x@y.test", ruoli: ["ordini"], sediIds: [], attivo: true, tenantId: 42, createdAt: new Date(), updatedAt: new Date() });
    expect(risolviTenantPerUtente(locale(97299))).toBeNull();
  });
});

describe("tenantIdDellaSede", () => {
  it("legge il tenant dalla sede e ricade su 1", () => {
    expect(tenantIdDellaSede(SEDE_T2)).toBe(2);
    expect(tenantIdDellaSede(999_999)).toBe(1);
  });
});
