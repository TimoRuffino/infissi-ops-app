// Test del router tenants: `storage` espone il ledger dei byte dell'azienda
// della sessione (WS3 §3.2) — conta e avvisa, non blocca. `abbonamento` e
// `consumi` (WS4 §8) raccontano il contratto dell'azienda e le due risorse
// misurate; budget ed extra in euro solo a proprietario e direzione.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { hashPassword } from "../_core/password";
import {
  assicuraAbbonamentoPredefinito,
  concediOmaggio,
  creaProva,
} from "../abbonamenti/servizio";
import { GIORNI_PROVA, eurInNano } from "../abbonamenti/costanti";
import { creaUtenteInterno, getUtentiStore } from "../routers/utenti";
import {
  creaLedgerMemoriaPerTest,
  impostaLedgerPerTest,
} from "../tars/costi/ledger";
import { conTenant } from "./contestoCorrente";
import { getTenantRepository, resetTenantRepositoryForTesting } from "./repository";
import { tenantsRouter } from "./router";

const SEDE = 90401;
const UTENTE = 90411;
const T0 = new Date("2026-09-08T09:00:00.000Z");
const giorni = (n: number) => new Date(T0.getTime() + n * 86_400_000);
const attore = { tipo: "script" as const, nome: "test" };
const MODELLO = "gpt-5.6-terra";

let ledger: ReturnType<typeof creaLedgerMemoriaPerTest>;

function context(tenantId: number, sedeId = SEDE, ruoli = ["direzione"]): TrpcContext {
  return {
    user: {
      id: UTENTE,
      role: ruoli.includes("direzione") ? "admin" : "user",
      ruolo: ruoli[0],
      ruoli,
      name: `Utente ${UTENTE}`,
    } as any,
    req: { protocol: "http", headers: {} } as any,
    res: {} as any,
    sedeId,
    sediIds: [sedeId],
    tenantId,
    tenant: null,
  };
}

/** Una spesa di Tars già contabilizzata per l'azienda, nel mese di `adesso`. */
const spendi = (tenantId: number, costoNano: number, chiamataId: string) =>
  ledger.prenota({
    chiamataId,
    runId: `t7-run-${tenantId}`,
    tenantId,
    sedeId: SEDE,
    utenteId: UTENTE,
    conversazioneId: null,
    modello: MODELLO,
    costoPrenotatoNano: costoNano,
    limiti: { runNano: null, giornoNano: null, meseNano: null },
    adesso: T0,
  });

describe("tenantsRouter", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ now: T0 });
    ledger = creaLedgerMemoriaPerTest();
    impostaLedgerPerTest(ledger);
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    await repo.impostaQuotaStorage(2, 1000);
  });
  afterEach(() => {
    resetTenantRepositoryForTesting();
    impostaLedgerPerTest(null);
    vi.useRealTimers();
  });

  it("mio: l'azienda della sessione (smoke)", async () => {
    const caller = tenantsRouter.createCaller(context(2));
    const risultato = await caller.mio();
    expect(risultato.id).toBe(2);
    expect(risultato.slug).toBe("acme");
  });

  describe("mio: piattaforma", () => {
    const PASSWORD = "Password-lunga-12";
    let admin: any;
    let nU = 0;

    beforeEach(() => {
      const utenti = getUtentiStore();
      nU = utenti.length;
      admin = conTenant(1, () =>
        creaUtenteInterno({
          tenantId: 1,
          nome: "Admin",
          cognome: "Piattaforma",
          email: "admin.piattaforma.router.test@wyndoor.test",
          ruoli: ["direzione"],
          sediIds: [SEDE],
          passwordHash: hashPassword(PASSWORD),
        })
      );
    });

    afterEach(() => {
      getUtentiStore().splice(nU);
      delete process.env.PLATFORM_ADMIN_EMAILS;
    });

    // `loginMethod` di default `"local"`: l'utente locale vero, come emesso
    // da `apriSessioneLocale`/`localUserDa` (server/localAuth.ts). Passare
    // `"oauth"` o `null` simula l'utente OAuth legacy con lo stesso id
    // numerico (server/tenants/contesto.ts:12-23, stesso mirror).
    function contestoAmministratore(loginMethod: string | null = "local"): TrpcContext {
      const base = context(1);
      return { ...base, user: { ...(base.user as any), id: admin.id, loginMethod } };
    }

    it("con l'email dell'utente in PLATFORM_ADMIN_EMAILS: true", async () => {
      process.env.PLATFORM_ADMIN_EMAILS = admin.email;
      const risultato = await tenantsRouter.createCaller(contestoAmministratore("local")).mio();
      expect(risultato.piattaforma).toBe(true);
    });

    it("senza la variabile d'ambiente: false", async () => {
      const risultato = await tenantsRouter.createCaller(contestoAmministratore()).mio();
      expect(risultato.piattaforma).toBe(false);
    });

    it("stesso id numerico ma non locale (OAuth legacy) o senza loginMethod: false anche con l'email in elenco", async () => {
      process.env.PLATFORM_ADMIN_EMAILS = admin.email;
      const conOauth = await tenantsRouter.createCaller(contestoAmministratore("oauth")).mio();
      expect(conOauth.piattaforma).toBe(false);
      const senzaLoginMethod = await tenantsRouter.createCaller(contestoAmministratore(null)).mio();
      expect(senzaLoginMethod.piattaforma).toBe(false);
    });
  });

  it("storage: byte, file e percentuale dell'azienda della sessione, senza bloccare", async () => {
    const repo = getTenantRepository();
    await repo.aggiornaStorage(2, 500, 1);
    const caller = tenantsRouter.createCaller(context(2));
    expect(await caller.storage()).toEqual({
      bytes: 500,
      file: 1,
      quotaBytes: 1000,
      percentuale: 50,
      sogliaAvvisata: 0,
      ricalcolatoIl: null,
    });
  });

  it("storage: zeri e default quando l'azienda non ha ancora un ledger", async () => {
    const caller = tenantsRouter.createCaller(context(2));
    expect(await caller.storage()).toEqual({
      bytes: 0,
      file: 0,
      quotaBytes: 1000,
      percentuale: 0,
      sogliaAvvisata: 0,
      ricalcolatoIl: null,
    });
  });

  it("abbonamento: la prova di 30 giorni dell'azienda della sessione", async () => {
    await creaProva(2, T0, attore);
    expect(await tenantsRouter.createCaller(context(2)).abbonamento()).toEqual({
      tipo: "paid",
      stato: "trialing",
      periodicita: null,
      inizioPeriodo: T0,
      finePeriodo: giorni(GIORNI_PROVA),
      prossimoRinnovo: null,
      disdettaAFinePeriodo: false,
      omaggio: null,
      giorniAllaScadenza: GIORNI_PROVA,
      solaLettura: false,
    });
  });

  it("abbonamento: campi a null quando l'azienda non ha ancora un abbonamento", async () => {
    expect(await tenantsRouter.createCaller(context(2)).abbonamento()).toEqual({
      tipo: null,
      stato: null,
      periodicita: null,
      inizioPeriodo: null,
      finePeriodo: null,
      prossimoRinnovo: null,
      disdettaAFinePeriodo: false,
      omaggio: null,
      giorniAllaScadenza: null,
      solaLettura: false,
    });
  });

  it("abbonamento: omaggio con scadenza e sola lettura per l'azienda sospesa", async () => {
    await creaProva(2, T0, attore);
    await concediOmaggio(2, { motivo: "pilota", scadenza: giorni(100) }, attore, T0);
    await getTenantRepository().aggiornaStato(2, "sospeso", "verifica");
    expect(await tenantsRouter.createCaller(context(2)).abbonamento()).toMatchObject({
      tipo: "complimentary",
      stato: "active",
      omaggio: { scadenza: giorni(100) },
      giorniAllaScadenza: 100,
      solaLettura: true,
    });
  });

  it("consumi: storage e Tars dell'azienda, importi in euro per la direzione", async () => {
    const repo = getTenantRepository();
    await repo.aggiornaStorage(2, 500, 1);
    await creaProva(2, T0, attore); // budget predefinito: 25 €/mese
    await spendi(2, eurInNano(25) / 10, "t7-a"); // il 10 % del budget

    expect(await tenantsRouter.createCaller(context(2)).consumi()).toEqual({
      storage: {
        bytes: 500,
        quotaBytes: 1000,
        percentuale: 50,
        bloccoDal: null,
        tolleranzaGiorni: 7,
      },
      tars: {
        percentuale: 10,
        budgetEur: 25,
        extraEur: 0,
        bloccoDal: null,
        tolleranzaGiorni: 7,
        mese: "2026-09",
      },
    });
  });

  it("consumi: chi non è proprietario o direzione non vede budget ed extra", async () => {
    await creaProva(2, T0, attore);
    await spendi(2, eurInNano(25) / 10, "t7-b");
    const consumi = await tenantsRouter
      .createCaller(context(2, SEDE, ["commerciale"]))
      .consumi();
    expect(consumi.tars).toMatchObject({
      percentuale: 10,
      budgetEur: null,
      extraEur: null,
    });
  });

  it("consumi: senza budget d'azienda (tenant 1) la percentuale Tars è null", async () => {
    await assicuraAbbonamentoPredefinito(T0);
    await spendi(1, eurInNano(25), "t7-c");
    const consumi = await tenantsRouter.createCaller(context(1)).consumi();
    expect(consumi.tars).toMatchObject({ percentuale: null, budgetEur: null, extraEur: 0 });
  });

  it("consumi: un ledger dei costi non leggibile dà percentuale null, non un errore", async () => {
    await creaProva(2, T0, attore);
    vi.spyOn(ledger, "consumoAziendaMese").mockRejectedValue(new Error("LEDGER_ASSENTE"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const consumi = await tenantsRouter.createCaller(context(2)).consumi();
    expect(consumi.tars).toMatchObject({ percentuale: null, budgetEur: 25 });
    expect(warn).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("consumi: il blocco storage in tolleranza porta la data di stacco", async () => {
    const repo = getTenantRepository();
    await creaProva(2, T0, attore);
    await repo.aggiornaStorage(2, 1000, 1); // esattamente al 100 %
    await repo.impostaSoglia100Storage(2, giorni(-2));
    const consumi = await tenantsRouter.createCaller(context(2)).consumi();
    expect(consumi.storage).toMatchObject({
      percentuale: 100,
      bloccoDal: giorni(5),
      tolleranzaGiorni: 7,
    });
  });

  it("consumi: extraEur è null quando il tenant non ha abbonamento", async () => {
    // Tenant 2 senza abbonamento — extraEur deve essere null, non 0
    const consumi = await tenantsRouter.createCaller(context(2)).consumi();
    expect(consumi.tars).toMatchObject({
      percentuale: null,
      budgetEur: null,
      extraEur: null, // non 0
    });
  });

  it("consumi: extraEur è 0 quando il tenant ha abbonamento ma nessun extra questo mese", async () => {
    // Tenant 2 con abbonamento ma senza extra: extraEur = 0
    await creaProva(2, T0, attore); // budget predefinito 25 €/mese
    const consumi = await tenantsRouter.createCaller(context(2)).consumi();
    expect(consumi.tars).toMatchObject({
      budgetEur: 25,
      extraEur: 0, // abbonamento c'è ma nessun extra
    });
  });
});
