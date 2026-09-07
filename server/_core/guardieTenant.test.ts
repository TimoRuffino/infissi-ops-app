// server/_core/guardieTenant.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import { contestoDiProva } from "./contestoDiProva";
import { hashPassword } from "./password";
import { getSediStore } from "../routers/sedi";
import { getUtentiStore } from "../routers/utenti";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import type { TenantRecord } from "../tenants/tipi";

const SEDE = 97401; // sede reale del tenant 1, spinta nello store: serve a sedi.switch
let acme: TenantRecord;
const sedi = getSediStore();
let nSedi = 0;

beforeEach(async () => {
  resetTenantRepositoryForTesting();
  const repo = getTenantRepository();
  await repo.assicuraTenantPredefinito();
  acme = await repo.inserisci({ slug: "acme", nome: "Acme" });
  nSedi = sedi.length;
  const now = new Date();
  sedi.push({ id: SEDE, tenantId: 1, nome: "Guardie", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now });
});

afterEach(() => {
  sedi.splice(nSedi);
  delete process.env.FLAG_MULTI_AZIENDA;
});

describe("porta chiusa (WS1)", () => {
  it("un tenant diverso da 1 non entra nelle procedure business, ma tenants.mio risponde", async () => {
    const caller = appRouter.createCaller(
      contestoDiProva({ utenteId: 97411, sedeId: SEDE, tenantId: acme.id, tenant: acme })
    );
    await expect(caller.clienti.list({})).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "L'azienda non è ancora attiva su questa installazione.",
    });
    await expect(caller.tenants.mio()).resolves.toMatchObject({
      id: acme.id,
      slug: "acme",
      stato: "attivo",
      proprietario: false,
      multiAzienda: true,
    });
  });

  it("con l'interruttore spento la porta non esiste e tenants.mio risponde col tenant 1", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const caller = appRouter.createCaller(
      contestoDiProva({ utenteId: 97411, sedeId: SEDE, tenantId: acme.id, tenant: acme })
    );
    await expect(caller.clienti.list({})).resolves.toBeInstanceOf(Array);
    await expect(caller.tenants.mio()).resolves.toMatchObject({ multiAzienda: false });
  });
});

describe("sola lettura del tenant sospeso", () => {
  it("legge, non scrive; sedi.switch è esente; adminProcedure eredita", async () => {
    const sospeso = await getTenantRepository().aggiornaStato(1, "sospeso", "prova");
    const caller = appRouter.createCaller(
      contestoDiProva({ utenteId: 97412, sedeId: SEDE, sediIds: [SEDE], tenantId: 1, tenant: sospeso })
    );
    await expect(caller.clienti.list({})).resolves.toBeInstanceOf(Array);
    await expect(caller.clienti.create({ nome: "Mario", cognome: "Sospeso" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Azienda sospesa: il gestionale è in sola lettura.",
    });
    await expect(caller.sedi.create({ nome: "Nuova" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(caller.sedi.switch({ sedeId: SEDE })).resolves.toMatchObject({ id: SEDE });
  });
});

describe("sede attiva obbligatoria", () => {
  it("con un tenant reale e sedeId null la procedura protetta rifiuta", async () => {
    const t1 = getTenantRepository().perId(1)!;
    const caller = appRouter.createCaller(
      contestoDiProva({ utenteId: 97413, sedeId: null, sediIds: [], tenantId: 1, tenant: t1 })
    );
    await expect(caller.clienti.list({})).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "L'azienda non ha una sede attiva.",
    });
  });
});

describe("login", () => {
  it("rifiuta gli utenti di un tenant diverso da 1 prima di emettere il cookie", async () => {
    const utenti = getUtentiStore();
    const n = utenti.length;
    utenti.push({
      id: 97414, nome: "A", cognome: "B", email: "porta@acme.test", ruoli: ["direzione"],
      sediIds: [], attivo: true, tenantId: acme.id, password: hashPassword("Password-lunga-12"),
      createdAt: new Date(), updatedAt: new Date(),
    });
    try {
      const anonimo = { ...contestoDiProva({ utenteId: 0, sedeId: null, tenantId: null }), user: null };
      const caller = appRouter.createCaller(anonimo);
      await expect(
        caller.auth.login({ email: "porta@acme.test", password: "Password-lunga-12" })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    } finally {
      utenti.splice(n);
    }
  });
});
