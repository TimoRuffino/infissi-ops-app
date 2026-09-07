import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import { contestoDiProva } from "../_core/contestoDiProva";
import { getSediStore } from "./sedi";
import { getUtentiStore } from "./utenti";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import type { TenantRecord } from "../tenants/tipi";

const SEDE_T1 = 97601;
const SEDE_T2 = 97602;
const DIREZIONE_T1 = 97611;
const COMMERCIALE_T1 = 97612;

const sedi = getSediStore();
const utenti = getUtentiStore();
let nS = 0;
let nU = 0;
let t1: TenantRecord;

beforeEach(async () => {
  resetTenantRepositoryForTesting();
  const repo = getTenantRepository();
  t1 = await repo.assicuraTenantPredefinito();
  await repo.inserisci({ slug: "acme", nome: "Acme" });
  nS = sedi.length;
  nU = utenti.length;
  const now = new Date();
  sedi.push(
    { id: SEDE_T1, tenantId: 1, nome: "Ruffino Test", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now },
    { id: SEDE_T2, tenantId: 2, nome: "Acme Test", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now }
  );
  const base = { nome: "N", cognome: "C", attivo: true, password: "scrypt$x", createdAt: now, updatedAt: now };
  utenti.push(
    { ...base, id: DIREZIONE_T1, email: "sd1@ws1.test", ruoli: ["direzione"], sediIds: [SEDE_T1], tenantId: 1 },
    { ...base, id: COMMERCIALE_T1, email: "sc1@ws1.test", ruoli: ["commerciale"], sediIds: [SEDE_T1], tenantId: 1 }
  );
});

afterEach(() => {
  sedi.splice(nS);
  utenti.splice(nU);
});

const come = (utenteId: number, ruoli: string[]) =>
  appRouter.createCaller(
    contestoDiProva({ utenteId, ruoli, sedeId: SEDE_T1, sediIds: [SEDE_T1], tenantId: 1, tenant: t1 })
  );

describe("sedi per tenant", () => {
  it("create stampa il tenant, listAll e list mostrano solo le sedi del tenant", async () => {
    const io = come(DIREZIONE_T1, ["direzione"]);
    const nuova = await io.sedi.create({ nome: "Sarzana" });
    expect(nuova.tenantId).toBe(1);
    const tutte = await io.sedi.listAll();
    expect(tutte.some(s => s.id === SEDE_T2)).toBe(false);
    expect(tutte.some(s => s.id === nuova.id)).toBe(true);
    const mie = await come(COMMERCIALE_T1, ["commerciale"]).sedi.list();
    expect(mie.map(s => s.id)).toEqual([SEDE_T1]);
  });

  it("update e switch verso una sede altrui vengono rifiutati", async () => {
    const io = come(DIREZIONE_T1, ["direzione"]);
    await expect(io.sedi.update({ id: SEDE_T2, nome: "Rubata" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(io.sedi.switch({ sedeId: SEDE_T2 })).rejects.toThrow(/Non sei assegnato/);
    await expect(come(COMMERCIALE_T1, ["commerciale"]).sedi.switch({ sedeId: SEDE_T1 })).resolves.toMatchObject({ id: SEDE_T1 });
  });
});
