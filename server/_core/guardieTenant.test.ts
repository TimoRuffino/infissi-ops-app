// server/_core/guardieTenant.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import { contestoDiProva } from "./contestoDiProva";
import { hashPassword } from "./password";
import { getSediStore } from "../routers/sedi";
import { getUtentiStore } from "../routers/utenti";
import { MESSAGGI } from "../tenants/costanti";
import { modalitaTenantStretta, tenantCorrente } from "../tenants/contestoCorrente";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import type { TenantRecord } from "../tenants/tipi";
import { istanziaStoresPerTenant } from "./persistence";
import { protectedProcedure, router } from "./trpc";

const SEDE = 97401; // sede reale del tenant 1, spinta nello store: serve a sedi.switch
let acme: TenantRecord;
const sedi = getSediStore();
let nSedi = 0;

beforeEach(async () => {
  resetTenantRepositoryForTesting();
  const repo = getTenantRepository();
  await repo.assicuraTenantPredefinito();
  acme = await repo.inserisci({ slug: "acme", nome: "Acme" });
  // Come per un tenant nato a caldo (tenants.servizio.crea): senza questa
  // riga i suoi store non esistono e le procedure business (ora raggiungibili
  // senza la porta chiusa) troverebbero «store non istanziato».
  await istanziaStoresPerTenant(acme.id);
  nSedi = sedi.length;
  const now = new Date();
  sedi.push({ id: SEDE, tenantId: 1, nome: "Guardie", citta: null, indirizzo: null, attiva: true, createdAt: now, updatedAt: now });
});

afterEach(() => {
  sedi.splice(nSedi);
  delete process.env.FLAG_MULTI_AZIENDA;
});

describe("tenant 2 (WS2: la porta chiusa non esiste più)", () => {
  it("un tenant diverso da 1 entra nelle procedure business; tenants.mio risponde", async () => {
    const caller = appRouter.createCaller(
      contestoDiProva({ utenteId: 97411, sedeId: SEDE, tenantId: acme.id, tenant: acme })
    );
    await expect(caller.clienti.list({})).resolves.toBeInstanceOf(Array);
    await expect(caller.tenants.mio()).resolves.toMatchObject({
      id: acme.id,
      slug: "acme",
      stato: "attivo",
      proprietario: false,
      multiAzienda: true,
    });
  });

  it("con l'interruttore spento tenants.mio risponde col tenant 1", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const caller = appRouter.createCaller(
      contestoDiProva({ utenteId: 97411, sedeId: SEDE, tenantId: acme.id, tenant: acme })
    );
    await expect(caller.clienti.list({})).resolves.toBeInstanceOf(Array);
    await expect(caller.tenants.mio()).resolves.toMatchObject({ multiAzienda: false });
  });
});

describe("il tenant nel contesto della procedura protetta", () => {
  it("dentro una procedura protetta tenantCorrente() è il tenant del contesto", async () => {
    const provaRouter = router({
      tenant: protectedProcedure.query(() => tenantCorrente()),
    });
    modalitaTenantStretta(true);
    try {
      const caller = provaRouter.createCaller(
        contestoDiProva({ utenteId: 97416, sedeId: SEDE, tenantId: acme.id, tenant: acme })
      );
      await expect(caller.tenant()).resolves.toBe(acme.id);
    } finally {
      modalitaTenantStretta(false);
    }
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
  const PASSWORD = "Password-lunga-12";

  /** Due utenti veri nello store, uno per azienda, ripuliti dal chiamante. */
  function seminaUtenti(): () => void {
    const utenti = getUtentiStore();
    const n = utenti.length;
    const base = {
      nome: "A", cognome: "B", ruoli: ["direzione"], sediIds: [], attivo: true,
      password: hashPassword(PASSWORD), createdAt: new Date(), updatedAt: new Date(),
    };
    utenti.push(
      { ...base, id: 97414, email: "porta@acme.test", tenantId: acme.id },
      { ...base, id: 97415, email: "porta@ruffino.test", tenantId: 1 }
    );
    return () => utenti.splice(n);
  }

  const callerAnonimo = () =>
    appRouter.createCaller({
      ...contestoDiProva({ utenteId: 0, sedeId: null, tenantId: null }),
      user: null,
    });

  it("un utente di un tenant diverso da 1 entra: riceve il cookie di sessione", async () => {
    const pulisci = seminaUtenti();
    try {
      await expect(
        callerAnonimo().auth.login({ email: "porta@acme.test", password: PASSWORD })
      ).resolves.toMatchObject({ id: 97414, email: "porta@acme.test" });
    } finally {
      pulisci();
    }
  });

  // R10: a interruttore spento la porta è chiusa per chi non è di Ruffino
  // Group — la sessione lo porterebbe dentro il tenant 1 (context.ts fissa
  // tenantId = 1 per tutti a flag spento). Il rifiuto arriva DOPO la
  // verifica della password: senza credenziali giuste nessuno può usarlo per
  // scoprire quali email appartengono a un'altra azienda.
  it("a interruttore spento l'utente di un'altra azienda non entra, quello del tenant 1 sì", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const pulisci = seminaUtenti();
    try {
      await expect(
        callerAnonimo().auth.login({ email: "porta@acme.test", password: PASSWORD })
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: MESSAGGI.multiAziendaSpento,
      });
      await expect(
        callerAnonimo().auth.login({ email: "porta@ruffino.test", password: PASSWORD })
      ).resolves.toMatchObject({ id: 97415, email: "porta@ruffino.test" });
    } finally {
      pulisci();
    }
  });

  it("a interruttore spento la password sbagliata resta «Email o password non validi»: nessuna enumerazione", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const pulisci = seminaUtenti();
    try {
      await expect(
        callerAnonimo().auth.login({ email: "porta@acme.test", password: "sbagliata-ma-lunga" })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "Email o password non validi" });
    } finally {
      pulisci();
    }
  });
});
