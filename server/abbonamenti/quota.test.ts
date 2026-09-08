// server/abbonamenti/quota.test.ts
// Quota storage che blocca (spec WS4 §6): `bloccoStorage` puro, poi
// `verificaCaricamento` sul repository in memoria (come worker.test.ts e
// servizio.test.ts: orologio finto per controllare `soglia100Dal`, che
// `applicaSoglie` timbra con `new Date()` reale).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTenantRepository, resetTenantRepositoryForTesting } from "../tenants/repository";
import { applicaSoglie } from "../tenants/storage";
import type { StatoStorage } from "../tenants/tipi";
import { MESSAGGI_ABBONAMENTO, TOLLERANZA_PREDEFINITA_GIORNI } from "./costanti";
import { bloccoStorage, verificaCaricamento } from "./quota";
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
});
