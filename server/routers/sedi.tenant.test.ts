import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import { contestoDiProva } from "../_core/contestoDiProva";
import { creaSedeInterna, getSediStore, sediAttiveDelTenant } from "./sedi";
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

  it("update rifiuta di disattivare l'ultima sede attiva del tenant; con due sedi attive è consentito (Important 2)", async () => {
    const io = come(DIREZIONE_T1, ["direzione"]);

    // Il fixture di questo file non dà al tenant 1 altre sedi attive oltre a
    // SEDE_T1 (SEDE_T2 è del tenant 2), ma non lo diamo per scontato:
    // leggiamo sediAttiveDelTenant(1) e disattiviamo (in modo reversibile)
    // ogni altra sede attiva del tenant, per costruire il caso «ultima sede
    // attiva» a prescindere da quante il fixture ne avesse già.
    const altre = sediAttiveDelTenant(1).filter(s => s.id !== SEDE_T1);
    const ripristina = altre.map(({ id }) => {
      const row = sedi.find(s => s.id === id)!;
      row.attiva = false;
      return () => {
        row.attiva = true;
      };
    });

    try {
      expect(sediAttiveDelTenant(1).map(s => s.id)).toEqual([SEDE_T1]);

      await expect(io.sedi.update({ id: SEDE_T1, attiva: false })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      // Rifiutata: la sede resta attiva.
      expect(sedi.find(s => s.id === SEDE_T1)?.attiva).toBe(true);

      // Con una seconda sede attiva del tenant, la disattivazione è consentita.
      const seconda = creaSedeInterna({ tenantId: 1, nome: "Seconda sede T1" });
      await expect(io.sedi.update({ id: SEDE_T1, attiva: false })).resolves.toMatchObject({
        id: SEDE_T1,
        attiva: false,
      });
      expect(seconda.tenantId).toBe(1);
    } finally {
      ripristina.forEach(fn => fn());
    }
  });
});
