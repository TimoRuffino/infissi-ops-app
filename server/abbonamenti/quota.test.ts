// server/abbonamenti/quota.test.ts
// Quota storage che blocca (spec WS4 §6): `bloccoStorage` puro, poi
// `verificaCaricamento` sul repository in memoria (come worker.test.ts e
// servizio.test.ts: orologio finto per controllare `soglia100Dal`, che
// `applicaSoglie` timbra con `new Date()` reale).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MESSAGGIO_BUDGET_AZIENDA } from "../tars/costi/governor";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import { applicaSoglie } from "../tenants/storage";
import type { StatoStorage } from "../tenants/tipi";
import { MESSAGGI_ABBONAMENTO, meseLocale, TOLLERANZA_PREDEFINITA_GIORNI } from "./costanti";
import * as notificheModule from "./notifiche";
import { azzeraMemoriaAvvisiPerTest, bloccoStorage, politicaTarsAzienda, sogliaTars, verificaCaricamento } from "./quota";
import { creaProva } from "./servizio";
import type { Abbonamento } from "./tipi";

const T0 = new Date("2026-09-08T09:00:00Z");
const giorni = (n: number) => new Date(T0.getTime() + n * 86_400_000);
const attore = { tipo: "script" as const, nome: "test" };
const GB = 1024 ** 3;

const statoBase: StatoStorage = {
  tenantId: 2,
  bytes: 0,
  file: 0,
  quotaBytes: 1000,
  sogliaAvvisata: 0,
  ricalcolatoIl: null,
  aggiornatoIl: T0,
  soglia100Dal: null,
};

const abbonamentoBase: Abbonamento = {
  tenantId: 2,
  tipo: "paid",
  periodicita: null,
  stato: "trialing",
  inizioPeriodo: T0,
  finePeriodo: null,
  prossimoRinnovo: null,
  disdettaAFinePeriodo: false,
  budgetTarsNanoMese: null,
  extraTarsNano: 0,
  extraTarsMese: null,
  tolleranzaStorageGiorni: 7,
  tolleranzaTarsGiorni: 7,
  tarsSogliaAvvisata: 0,
  tarsSogliaMese: null,
  tarsSoglia100Dal: null,
  insolutoDal: null,
  provider: "nessuno",
  providerRef: null,
  omaggio: null,
  createdAt: T0,
  updatedAt: T0,
};

describe("bloccoStorage (puro)", () => {
  it("sotto quota: mai bloccato", () => {
    expect(bloccoStorage({ ...statoBase, bytes: 500 }, abbonamentoBase, T0)).toEqual({
      bloccato: false,
      bloccoDal: null,
    });
  });

  it("senza quota (quotaBytes <= 0): mai bloccato, qualunque sia bytes", () => {
    expect(bloccoStorage({ ...statoBase, bytes: 500, quotaBytes: 0 }, abbonamentoBase, T0)).toEqual({
      bloccato: false,
      bloccoDal: null,
    });
  });

  it("a quota, soglia100Dal più recente della tolleranza: non bloccato ma bloccoDal calcolato", () => {
    const soglia100Dal = giorni(-3); // tolleranza 7 giorni, ne mancano ancora 4
    const r = bloccoStorage({ ...statoBase, bytes: 1000, soglia100Dal }, abbonamentoBase, T0);
    expect(r.bloccato).toBe(false);
    expect(r.bloccoDal?.toISOString()).toBe(giorni(4).toISOString());
  });

  it("a quota, oltre la tolleranza: bloccato", () => {
    const soglia100Dal = giorni(-10); // tolleranza 7 giorni, scaduta da 3
    const r = bloccoStorage({ ...statoBase, bytes: 1200, soglia100Dal }, abbonamentoBase, T0);
    expect(r.bloccato).toBe(true);
    expect(r.bloccoDal?.toISOString()).toBe(giorni(-3).toISOString());
  });

  it("abbonamento assente: tolleranza predefinita di 7 giorni", () => {
    expect(TOLLERANZA_PREDEFINITA_GIORNI).toBe(7);
    const soglia100Dal = giorni(-8); // predefinita 7 giorni, scaduta da 1
    const r = bloccoStorage({ ...statoBase, bytes: 1000, soglia100Dal }, null, T0);
    expect(r.bloccato).toBe(true);
    expect(r.bloccoDal?.toISOString()).toBe(giorni(-1).toISOString());
  });

  it("a quota ma senza soglia100Dal (riga più vecchia di questa logica): non ancora bloccato, la tolleranza riparte da adesso", () => {
    const r = bloccoStorage({ ...statoBase, bytes: 1000, soglia100Dal: null }, abbonamentoBase, T0);
    expect(r.bloccato).toBe(false);
    expect(r.bloccoDal?.toISOString()).toBe(giorni(7).toISOString());
  });
});

describe("verificaCaricamento", () => {
  beforeEach(async () => {
    delete process.env.FLAG_MULTI_AZIENDA; // nei test = acceso
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
    // Tenant 3: riservato ai test R11 sulle letture (spy), mai bloccato
    // altrove nel file — `bloccatiVisti` è un Set di modulo che sopravvive
    // fra i test di questo file, quindi un id condiviso con un test che
    // blocca e non sblocca falserebbe il conteggio delle letture.
    await repo.inserisci({ id: 3, slug: "terza-r11", nome: "Terza R11" });
  });

  afterEach(() => {
    resetTenantRepositoryForTesting();
    delete process.env.FLAG_MULTI_AZIENDA;
    vi.useRealTimers();
  });

  it("interruttore spento: null sempre, anche con lo storage ben oltre quota", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    const repo = getTenantRepository();
    await repo.impostaQuotaStorage(2, 1000);
    await repo.aggiornaStorage(2, 5000, 1);
    expect(await verificaCaricamento(2, 10, T0)).toBeNull();
  });

  it("nessun byte mai contato per l'azienda: null, niente da bloccare", async () => {
    await getTenantRepository().impostaQuotaStorage(2, 1000);
    expect(await verificaCaricamento(2, 10, T0)).toBeNull();
  });

  it("sotto quota: null, nessun evento", async () => {
    const repo = getTenantRepository();
    await repo.impostaQuotaStorage(2, 1000);
    await repo.aggiornaStorage(2, 500, 1);
    expect(await verificaCaricamento(2, 10, T0)).toBeNull();
    expect(await repo.eventi(2)).toEqual([]);
  });

  it("bloccato oltre la tolleranza: messaggio con i GB della quota, un solo evento storage_bloccato al giorno", async () => {
    vi.useFakeTimers({ now: T0 });
    const repo = getTenantRepository();
    await creaProva(2, T0, attore); // tolleranza predefinita di 7 giorni
    await repo.impostaQuotaStorage(2, 2 * GB);
    const stato = await repo.aggiornaStorage(2, 2 * GB, 1); // esattamente al 100 %
    await applicaSoglie(stato); // soglia100Dal = "adesso" reale, col clock finto T0

    const dopoTolleranza = giorni(8);
    vi.setSystemTime(dopoTolleranza);
    const esito = await verificaCaricamento(2, 10, dopoTolleranza);
    expect(esito).toEqual({ messaggio: MESSAGGI_ABBONAMENTO.spazioEsaurito(2) });

    const eventi1 = await repo.eventi(2);
    expect(eventi1.filter(e => e.tipo === "storage_bloccato")).toHaveLength(1);
    expect(eventi1.find(e => e.tipo === "storage_bloccato")?.dettagli).toEqual({
      bytes: 2 * GB,
      quotaBytes: 2 * GB,
      bloccoDal: giorni(7).toISOString(),
    });

    // Un secondo caricamento lo stesso giorno: stesso messaggio, nessun
    // secondo evento (dedup sul giorno locale, spec §6).
    const esito2 = await verificaCaricamento(2, 10, dopoTolleranza);
    expect(esito2).toEqual({ messaggio: MESSAGGI_ABBONAMENTO.spazioEsaurito(2) });
    expect((await repo.eventi(2)).filter(e => e.tipo === "storage_bloccato")).toHaveLength(1);
  });

  it("tornando sotto quota dopo un blocco: null e un evento storage_sbloccato, una volta sola", async () => {
    vi.useFakeTimers({ now: T0 });
    const repo = getTenantRepository();
    await creaProva(2, T0, attore);
    await repo.impostaQuotaStorage(2, 2 * GB);
    const stato = await repo.aggiornaStorage(2, 2 * GB, 1);
    await applicaSoglie(stato);

    const dopoTolleranza = giorni(8);
    vi.setSystemTime(dopoTolleranza);
    await verificaCaricamento(2, 10, dopoTolleranza); // blocca, registra storage_bloccato

    // L'azienda libera spazio: torna al 25 %.
    const liberato = await repo.aggiornaStorage(2, -(1.5 * GB), 0);
    await applicaSoglie(liberato); // azzera soglia100Dal

    // R11: qui `soglia100Dal` è già null (appena azzerata sopra) — la
    // cronologia si legge lo stesso SOLO perché `bloccatiVisti` ricorda che
    // questo processo ha visto il tenant 2 bloccato al giro precedente.
    // Senza quel set, questa chiamata prenderebbe la via corta e lo sblocco
    // pendente non verrebbe mai scritto.
    const esito = await verificaCaricamento(2, 10, dopoTolleranza);
    expect(esito).toBeNull();
    // Nella cronologia ci sono anche `abbonamento_creato` (creaProva) e
    // `storage_soglia` (il primo attraversamento del 100 %, applicaSoglie):
    // qui interessano solo blocco e sblocco, uno ciascuno, in quest'ordine.
    expect((await repo.eventi(2)).map(e => e.tipo).filter(t => t === "storage_bloccato" || t === "storage_sbloccato")).toEqual([
      "storage_bloccato",
      "storage_sbloccato",
    ]);

    // Un secondo giro ancora sotto quota: nessun secondo sblocco.
    const esito2 = await verificaCaricamento(2, 10, dopoTolleranza);
    expect(esito2).toBeNull();
    expect((await repo.eventi(2)).filter(e => e.tipo === "storage_sbloccato")).toHaveLength(1);
  });

  // Fix round 1 (R11): il gancio gira a ogni upload — leggere 50 eventi
  // quando non c'è niente da deduplicare né da sbloccare costerebbe un giro
  // DB (~147ms) per ogni file caricato da un'azienda tranquilla. Tenant 3 è
  // riservato a questi due test (mai bloccato altrove nel file): `bloccatiVisti`
  // è un Set di modulo che sopravvive fra i test dello stesso file, quindi un
  // id già bloccato da un altro test falserebbe il conteggio delle letture.
  it("sotto quota, senza storico: una sola lettura di storageDi, zero letture di eventi", async () => {
    const repo = getTenantRepository();
    await repo.impostaQuotaStorage(3, 1000);
    await repo.aggiornaStorage(3, 500, 1);

    const storageDiSpy = vi.spyOn(repo, "storageDi");
    const eventiSpy = vi.spyOn(repo, "eventi");

    expect(await verificaCaricamento(3, 10, T0)).toBeNull();

    expect(storageDiSpy).toHaveBeenCalledTimes(1);
    expect(eventiSpy).not.toHaveBeenCalled();
  });

  it("bloccato: legge la cronologia (dedup del blocco)", async () => {
    vi.useFakeTimers({ now: T0 });
    const repo = getTenantRepository();
    await creaProva(3, T0, attore);
    await repo.impostaQuotaStorage(3, 2 * GB);
    const stato = await repo.aggiornaStorage(3, 2 * GB, 1); // esattamente al 100 %
    await applicaSoglie(stato);

    const dopoTolleranza = giorni(8);
    vi.setSystemTime(dopoTolleranza);
    const eventiSpy = vi.spyOn(repo, "eventi");

    const esito = await verificaCaricamento(3, 10, dopoTolleranza);

    expect(esito).toEqual({ messaggio: MESSAGGI_ABBONAMENTO.spazioEsaurito(2) });
    expect(eventiSpy).toHaveBeenCalled();
  });

  it("avvisaConsumi: memo aggiunto solo quando notificaAzienda restituisce > 0", async () => {
    // Azzera il memo prima di iniziare
    azzeraMemoriaAvvisiPerTest();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 4, slug: "test-memo", nome: "Test Memo" });
    await creaProva(4, T0, attore);
    await repo.impostaQuotaStorage(4, 1000);
    // Storage già al 85% per trigger notificaAzienda (soglia 80%)
    await repo.aggiornaStorage(4, 850, 5);

    // Primo caricamento: notificaAzienda torna 0 (fallita), la chiave NON va nel memo
    const notificaSpy = vi.spyOn(notificheModule, "notificaAzienda")
      .mockResolvedValueOnce(0); // fallita, non creata
    await verificaCaricamento(4, 10, T0);

    // Secondo caricamento stesso giorno: notificaAzienda torna 0 di nuovo.
    // Se il memo fosse stato aggiunto al primo giro, questa chiamata saltarebbe
    // la notifica (early return dalla chiave nel memo). Con memo vuoto, tenta ancora.
    notificaSpy.mockResolvedValueOnce(0);
    await verificaCaricamento(4, 10, T0);
    expect(notificaSpy).toHaveBeenCalledTimes(2);

    // Terzo caricamento: questa volta notificaAzienda torna 1 (successo),
    // il memo ora contiene la chiave
    notificaSpy.mockResolvedValueOnce(1);
    await verificaCaricamento(4, 10, T0);
    expect(notificaSpy).toHaveBeenCalledTimes(3);

    // Quarto caricamento: memo non vuoto per questa chiave, early return, nessuna nuova chiamata
    notificaSpy.mockResolvedValueOnce(1);
    await verificaCaricamento(4, 10, T0);
    expect(notificaSpy).toHaveBeenCalledTimes(3);

    vi.restoreAllMocks();
  });
});

// ── Budget Tars per azienda (WS4, spec §7) ──────────────────────────────

describe("sogliaTars (puro)", () => {
  it("senza budget nessuna soglia: il tenant 1 e i piani senza tetto non avvisano mai", () => {
    expect(sogliaTars(0, null)).toBe(0);
    expect(sogliaTars(9_999, null)).toBe(0);
  });

  it("le tre soglie scattano a 50, 80 e 100 % e restano 100 oltre il budget", () => {
    expect(sogliaTars(49, 100)).toBe(0);
    expect(sogliaTars(50, 100)).toBe(50);
    expect(sogliaTars(79, 100)).toBe(50);
    expect(sogliaTars(80, 100)).toBe(80);
    expect(sogliaTars(99, 100)).toBe(80);
    expect(sogliaTars(100, 100)).toBe(100);
    expect(sogliaTars(250, 100)).toBe(100);
  });

  it("budget zero (piano senza Tars incluso): esaurito per definizione", () => {
    expect(sogliaTars(0, 0)).toBe(100);
    expect(sogliaTars(1, 0)).toBe(100);
  });
});

describe("politicaTarsAzienda — limite", () => {
  const BUDGET = 1_000_000_000; // 1 USD in nano
  const EXTRA = 500_000_000;

  const salva = (tenantId: number, patch: Partial<Abbonamento> = {}) =>
    getTenantRepository().salvaAbbonamento({ ...abbonamentoBase, tenantId, ...patch });

  beforeEach(async () => {
    delete process.env.FLAG_MULTI_AZIENDA;
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    await repo.inserisci({ id: 2, slug: "acme", nome: "Acme" });
  });

  afterEach(() => {
    resetTenantRepositoryForTesting();
    delete process.env.FLAG_MULTI_AZIENDA;
  });

  it("interruttore spento: nessun tetto, mai", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    await salva(2, { budgetTarsNanoMese: BUDGET, tarsSoglia100Dal: giorni(-30) });
    expect(await politicaTarsAzienda().limite(2, T0)).toEqual({ limiteNano: null, bloccante: false });
  });

  it("tenant 1: nessun tetto d'azienda anche se la riga ne portasse uno (valgono i TARS_* globali)", async () => {
    await salva(1, { budgetTarsNanoMese: BUDGET, tarsSoglia100Dal: giorni(-30) });
    expect(await politicaTarsAzienda().limite(1, T0)).toEqual({ limiteNano: null, bloccante: false });
  });

  it("azienda senza abbonamento o senza budget: nessun tetto", async () => {
    expect(await politicaTarsAzienda().limite(2, T0)).toEqual({ limiteNano: null, bloccante: false });
    await salva(2, { budgetTarsNanoMese: null });
    expect(await politicaTarsAzienda().limite(2, T0)).toEqual({ limiteNano: null, bloccante: false });
  });

  it("budget più l'extra DEL MESE, non bloccante finché il 100 % non è scattato", async () => {
    await salva(2, { budgetTarsNanoMese: BUDGET, extraTarsNano: EXTRA, extraTarsMese: meseLocale(T0) });
    expect(await politicaTarsAzienda().limite(2, T0)).toEqual({
      limiteNano: BUDGET + EXTRA,
      bloccante: false,
    });
  });

  it("l'extra di un altro mese non allarga il tetto di questo", async () => {
    await salva(2, { budgetTarsNanoMese: BUDGET, extraTarsNano: EXTRA, extraTarsMese: "2026-08" });
    expect(await politicaTarsAzienda().limite(2, T0)).toEqual({ limiteNano: BUDGET, bloccante: false });
  });

  it("bloccante solo OLTRE la tolleranza dal primo 100 %", async () => {
    await salva(2, {
      budgetTarsNanoMese: BUDGET,
      tolleranzaTarsGiorni: 7,
      tarsSoglia100Dal: giorni(-3),
    });
    expect(await politicaTarsAzienda().limite(2, T0)).toEqual({ limiteNano: BUDGET, bloccante: false });

    await salva(2, {
      budgetTarsNanoMese: BUDGET,
      tolleranzaTarsGiorni: 7,
      tarsSoglia100Dal: giorni(-8),
    });
    expect(await politicaTarsAzienda().limite(2, T0)).toEqual({ limiteNano: BUDGET, bloccante: true });
  });
});

describe("politicaTarsAzienda — dopoPrenotazione", () => {
  const BUDGET = 1_000_000_000; // 1 USD in nano
  const mese = meseLocale(T0);

  const salva = (tenantId: number, patch: Partial<Abbonamento> = {}) =>
    getTenantRepository().salvaAbbonamento({
      ...abbonamentoBase,
      tenantId,
      budgetTarsNanoMese: BUDGET,
      tarsSogliaMese: mese,
      ...patch,
    });

  const tipi = async (tenantId: number) =>
    (await getTenantRepository().eventi(tenantId)).map(e => e.tipo);

  // La deduplicazione «un evento al giorno» di `dopoPrenotazione` confronta il
  // giorno di `adesso` con quello di `createdAt`, che il repository in memoria
  // timbra con l'orologio vero: senza orologio finto i due giorni coincidono
  // solo l'8/9/2026 e la suite diventa rossa da sola il giorno dopo. Come nel
  // blocco `verificaCaricamento`: si congela a T0 e si sposta con
  // `vi.setSystemTime` quando il caso avanza `adesso` (in produzione
  // `created_at DEFAULT NOW()` e `adesso` condividono l'orologio).
  beforeEach(async () => {
    vi.useFakeTimers({ now: T0, toFake: ["Date"] });
    delete process.env.FLAG_MULTI_AZIENDA;
    resetTenantRepositoryForTesting();
    const repo = getTenantRepository();
    await repo.inserisci({ id: 1, slug: "ruffino-group", nome: "Ruffino Group" });
    for (const id of [2, 4, 5, 6]) {
      await repo.inserisci({ id, slug: `azienda-${id}`, nome: `Azienda ${id}` });
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    resetTenantRepositoryForTesting();
    delete process.env.FLAG_MULTI_AZIENDA;
  });

  it("il messaggio del governor è quello dell'abbonamento (copia sorvegliata)", () => {
    expect(MESSAGGIO_BUDGET_AZIENDA).toBe(MESSAGGI_ABBONAMENTO.budgetTars);
  });

  it("interruttore spento, tenant 1 o azienda senza budget: nessun evento", async () => {
    process.env.FLAG_MULTI_AZIENDA = "off";
    await salva(2);
    await politicaTarsAzienda().dopoPrenotazione(2, BUDGET, T0, { rifiutata: false });
    expect(await tipi(2)).toEqual([]);

    delete process.env.FLAG_MULTI_AZIENDA;
    await salva(1);
    await politicaTarsAzienda().dopoPrenotazione(1, BUDGET, T0, { rifiutata: false });
    expect(await tipi(1)).toEqual([]);

    await salva(4, { budgetTarsNanoMese: null });
    await politicaTarsAzienda().dopoPrenotazione(4, BUDGET, T0, { rifiutata: false });
    expect(await tipi(4)).toEqual([]);
  });

  it("soglia 50 %: un evento tars_soglia, una volta sola nel mese", async () => {
    await salva(2);
    const politica = politicaTarsAzienda();
    await politica.dopoPrenotazione(2, BUDGET * 0.6, T0, { rifiutata: false });
    await politica.dopoPrenotazione(2, BUDGET * 0.7, T0, { rifiutata: false });

    const eventi = await getTenantRepository().eventi(2);
    expect(eventi.filter(e => e.tipo === "tars_soglia")).toHaveLength(1);
    expect(eventi[0].dettagli).toEqual({ percentuale: 50, mese });
    expect(getTenantRepository().abbonamentoDi(2)?.tarsSogliaAvvisata).toBe(50);
    expect(getTenantRepository().abbonamentoDi(2)?.tarsSoglia100Dal).toBeNull();
  });

  it("soglia 100 %: evento e tarsSoglia100Dal timbrato una volta sola", async () => {
    await salva(2);
    const politica = politicaTarsAzienda();
    await politica.dopoPrenotazione(2, BUDGET, T0, { rifiutata: false });
    const dopoIlPrimo = getTenantRepository().abbonamentoDi(2);
    expect(dopoIlPrimo?.tarsSogliaAvvisata).toBe(100);
    expect(dopoIlPrimo?.tarsSoglia100Dal?.toISOString()).toBe(T0.toISOString());

    await politica.dopoPrenotazione(2, BUDGET * 2, giorni(1), { rifiutata: false });
    expect((await tipi(2)).filter(t => t === "tars_soglia")).toHaveLength(1);
    // Il timbro NON si sposta: la tolleranza si conta dal primo 100 %.
    expect(getTenantRepository().abbonamentoDi(2)?.tarsSoglia100Dal?.toISOString()).toBe(
      T0.toISOString()
    );
  });

  it("mese nuovo: soglie e timbro del 100 % ripartono da zero", async () => {
    await salva(2, { tarsSogliaAvvisata: 100, tarsSoglia100Dal: T0 });
    const nuovoMese = new Date("2026-10-02T09:00:00Z");
    await politicaTarsAzienda().dopoPrenotazione(2, BUDGET * 0.1, nuovoMese, { rifiutata: false });

    const abbonamento = getTenantRepository().abbonamentoDi(2);
    expect(abbonamento?.tarsSogliaMese).toBe(meseLocale(nuovoMese));
    expect(abbonamento?.tarsSogliaAvvisata).toBe(0);
    expect(abbonamento?.tarsSoglia100Dal).toBeNull();
    expect(await tipi(2)).toEqual([]);
  });

  it("consumo tornato sotto il 100 % (budget alzato): il timbro si azzera, il blocco cade", async () => {
    await salva(2, { tarsSogliaAvvisata: 100, tarsSoglia100Dal: T0 });
    await politicaTarsAzienda().dopoPrenotazione(2, BUDGET * 0.4, T0, { rifiutata: false });
    expect(getTenantRepository().abbonamentoDi(2)?.tarsSoglia100Dal).toBeNull();
  });

  it("primo rifiuto del giorno: un evento tars_bloccato, poi lo sblocco quando la chiamata passa", async () => {
    await salva(5, { tarsSogliaAvvisata: 100, tarsSoglia100Dal: giorni(-10) });
    const politica = politicaTarsAzienda();

    await politica.dopoPrenotazione(5, BUDGET * 1.2, T0, { rifiutata: true });
    await politica.dopoPrenotazione(5, BUDGET * 1.2, T0, { rifiutata: true });
    expect((await tipi(5)).filter(t => t === "tars_bloccato")).toHaveLength(1);

    // Giorno dopo, ancora bloccata: un secondo evento (uno al giorno).
    vi.setSystemTime(giorni(1));
    await politica.dopoPrenotazione(5, BUDGET * 1.2, giorni(1), { rifiutata: true });
    expect((await tipi(5)).filter(t => t === "tars_bloccato")).toHaveLength(2);

    // Ancora lo stesso giorno: la dedup regge anche col timbro di ieri in coda.
    await politica.dopoPrenotazione(5, BUDGET * 1.2, giorni(1), { rifiutata: true });
    expect((await tipi(5)).filter(t => t === "tars_bloccato")).toHaveLength(2);

    // La chiamata passa di nuovo (mese nuovo o budget alzato): sblocco, una volta sola.
    vi.setSystemTime(giorni(2));
    await politica.dopoPrenotazione(5, BUDGET * 0.2, giorni(2), { rifiutata: false });
    await politica.dopoPrenotazione(5, BUDGET * 0.3, giorni(2), { rifiutata: false });
    expect((await tipi(5)).filter(t => t === "tars_sbloccato")).toHaveLength(1);
  });

  it("una chiamata accettata senza blocchi precedenti non registra sblocchi", async () => {
    await salva(6);
    await politicaTarsAzienda().dopoPrenotazione(6, BUDGET * 0.1, T0, { rifiutata: false });
    expect(await tipi(6)).toEqual([]);
  });
});
